var map = null;
// `stations` is a flat list of individual chargers; `stationGroups` below
// groups them by site (see MODEL(hierarchy) note in config.js).
var stations = [];
var stationGroups = [];
var pendingPins = [];
var stationMarkers = [];
var stationMarkersByKey = {}; // group key -> Leaflet marker (one marker per site)
var openStationKeys = {};     // group key -> true while its card is expanded
var existingLocations = [];   // snapshot of already-configured locations, loaded once
var searchDebounce = null;

var MARKER_DEFAULT = { radius: 7, fillColor: "#1e293b", color: "#3b82f6", weight: 2, fillOpacity: 0.95 };
var MARKER_HOVER   = { radius: 9, fillColor: "#3b82f6", color: "#fff",    weight: 3, fillOpacity: 1 };
var MARKER_OPEN    = { radius: 9, fillColor: "#f59e0b", color: "#fff",    weight: 3, fillOpacity: 1 };

// ── Init ──────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async function() {
  await initL10n();
  document.documentElement.lang = l10nActiveLocale;
  document.title = t("doc-title-discover");
  document.querySelector("header h1").textContent = t("discover-title");
  document.getElementById("back-link").textContent = t("nav-back");
  document.getElementById("retry-btn").textContent = t("btn-allow-location");
  document.getElementById("add-pins-btn").textContent = t("discover-add-to-my-stations");

  var cfg = getConfig();
  document.body.setAttribute("data-theme", (cfg && cfg.theme) ? cfg.theme : "auto");
  if (cfg && cfg.handedness === "left") document.body.classList.add("left-handed");

  existingLocations = loadExistingLocations();

  map = L.map("map").setView([41.4, 2.17], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
    maxZoom: 18
  }).addTo(map);

  document.getElementById("add-pins-btn").addEventListener("click", pinSelected);
  document.getElementById("retry-btn").addEventListener("click", geolocate);

  map.on("moveend", function() {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function() {
      var c = map.getCenter();
      var b = map.getBounds();
      searchAll(c.lat, c.lng, {
        latNE: b.getNorthEast().lat, lngNE: b.getNorthEast().lng,
        latSW: b.getSouthWest().lat, lngSW: b.getSouthWest().lng
      });
    }, 2000);
  });

  geolocate();
});

// ── Geolocation ───────────────────────────────────────────────────────────

function geolocate() {
  setBanner(false);
  setStatus(t("discover-finding-location"));
  if (!navigator.geolocation) {
    setStatus(t("discover-geo-unsupported"), true);
    setBanner(true);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      setBanner(false);
      var lat = pos.coords.latitude;
      var lon = pos.coords.longitude;
      // map.getBounds() right after setView() can still report the OLD view —
      // Leaflet hasn't finished applying the pan/zoom yet at that point. Wait
      // for the moveend this setView triggers (fires once the view is
      // actually settled), then search immediately using its real bounds,
      // short-circuiting the persistent moveend handler's 2s debounce below.
      map.once("moveend", function() {
        clearTimeout(searchDebounce);
        var b = map.getBounds();
        searchAll(lat, lon, {
          latNE: b.getNorthEast().lat, lngNE: b.getNorthEast().lng,
          latSW: b.getSouthWest().lat, lngSW: b.getSouthWest().lng
        });
      });
      map.setView([lat, lon], 14);
      // Distinct from every charger-marker state (all solid dark/blue/amber
      // fills with a white ring): a soft halo behind an inverted white-fill,
      // blue-ring dot, so "you" never reads as just another highlighted pin.
      L.circleMarker([lat, lon], {
        radius: 7, fillColor: "#e82127", stroke: false, fillOpacity: 0.18
      }).addTo(map);
      L.circleMarker([lat, lon], {
        radius: 3, fillColor: "#fff", color: "#e82127", weight: 2, fillOpacity: 1
      }).addTo(map).bindPopup(t("discover-you-are-here"));
    },
    function(err) {
      setStatus(t("discover-geo-blocked", { reason: err.message }), true);
      setBanner(true);
    },
    { timeout: 20000, enableHighAccuracy: false, maximumAge: 60000 }
  );
}

// ── Search ────────────────────────────────────────────────────────────────

var searchGeneration = 0;

function searchAll(lat, lon, bounds) {
  var gen = ++searchGeneration;
  setStatus(t("discover-searching"));
  clearStationMarkers();
  document.getElementById("results").innerHTML = "";

  var adapterErrors = [];
  var adapters = window.ADAPTERS || {};
  var searches = Object.keys(adapters)
    .filter(function(key) {
      return adapters[key].capabilities &&
             adapters[key].capabilities.indexOf("SEARCH_NEARBY") >= 0 &&
             typeof adapters[key].searchNearby === "function";
    })
    .map(function(key) {
      return adapters[key].searchNearby(lat, lon, bounds).catch(function(e) {
        adapterErrors.push(key + ": " + e.message);
        return [];
      });
    });

  Promise.all(searches).then(function(results) {
    if (gen !== searchGeneration) return;
    stations = [];
    results.forEach(function(arr) {
      arr.forEach(function(s) { stations.push(s); });
    });
    stations.sort(function(a, b) { return a.distanceM - b.distanceM; });
    stationGroups = computeStationGroups(stations);
    renderResults();
    var errMsg = adapterErrors.length ? " (" + adapterErrors.join("; ") + ")" : "";
    setStatus(t("discover-chargers-found", { count: stations.length }) + errMsg, adapterErrors.length > 0);
  });
}

// Groups individual chargers into one entry per physical site (Location).
// A station without a `siteKey` (every non-evcharge station, and any
// evcharge charger the provider didn't return a site key for) is its own
// group of one — so this is a no-op for everything except evcharge sites
// with siblings, matching today's behavior exactly in every other case.
//
// TODO(hierarchy): exact siteKey match misses real-world duplicates the
// provider itself never deduplicated — e.g. id_charger 5671 and 2067 are the
// same physical site (same address/city/postal code) but ship with slightly
// different location coordinates and different location_id on evcharge's
// backend. See the longer note next to siteKey in adapters/evcharge.js.
function computeStationGroups(list) {
  var byKey = {};
  var order = [];
  list.forEach(function(s) {
    var key = stationKey(s.cpoKey, s.siteKey || s.id);
    if (!byKey[key]) {
      byKey[key] = { key: key, cpoKey: s.cpoKey, members: [], distanceM: s.distanceM };
      order.push(key);
    }
    byKey[key].members.push(s);
    if (s.distanceM < byKey[key].distanceM) byKey[key].distanceM = s.distanceM;
  });
  var groups = order.map(function(k) { return byKey[k]; });
  groups.forEach(function(g) {
    // Deterministic member order regardless of API/result order, so the
    // eventual "primary" pick (see pinSelected) never flips between searches.
    g.members.sort(function(a, b) {
      return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
    });
    var primary = g.members[0];
    g.name = primary.name;
    g.address = primary.address;
    g.lat = primary.lat;
    g.lon = primary.lon;
  });
  groups.sort(function(a, b) { return a.distanceM - b.distanceM; });
  return groups;
}

// ── Render list + map markers ─────────────────────────────────────────────

function renderResults() {
  var container = document.getElementById("results");
  if (stationGroups.length === 0) {
    container.innerHTML = '<p class="s-hint" style="text-align:center;padding:32px">' + t("discover-no-chargers-nearby") + '</p>';
    return;
  }

  container.innerHTML = stationGroups.map(function(g, gi) { return renderStationGroup(g, gi); }).join("");

  stationGroups.forEach(function(g) {
    if (!isNaN(g.lat) && !isNaN(g.lon)) {
      var marker = L.circleMarker([g.lat, g.lon], MARKER_DEFAULT).addTo(map);
      stationMarkers.push(marker);
      stationMarkersByKey[g.key] = marker;

      // No popup — hovering/clicking a POI drives the matching list row instead.
      marker.on("mouseover", function() {
        marker.setStyle(MARKER_HOVER);
        var card = findCard(g.key);
        if (card) card.classList.add("map-hover");
      });
      marker.on("mouseout", function() {
        marker.setStyle(baseMarkerStyle(g.key));
        var card = findCard(g.key);
        if (card) card.classList.remove("map-hover");
      });
      marker.on("click", function() {
        toggleStation(g.key);
        var card = findCard(g.key);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  });

  container.querySelectorAll(".discover-station-header").forEach(function(header) {
    var card = header.closest(".discover-station");
    var key = card.dataset.gkey;

    header.addEventListener("click", function() {
      toggleStation(key);
    });
    header.addEventListener("mouseenter", function() {
      var marker = stationMarkersByKey[key];
      if (marker) marker.setStyle(MARKER_HOVER);
    });
    header.addEventListener("mouseleave", function() {
      var marker = stationMarkersByKey[key];
      if (marker) marker.setStyle(baseMarkerStyle(key));
    });
  });
}

function renderStationGroup(g, gi) {
  var countBadge = g.members.length > 1
    ? '<span class="cpo-badge" title="' + esc(t("discover-multiple-chargers-title")) + '">' + t("discover-chargers-count-badge", { count: g.members.length }) + '</span>'
    : '';
  return '<div class="discover-station" data-gkey="' + esc(g.key) + '" data-gi="' + gi + '">' +
    '<div class="discover-station-header">' +
      '<div class="discover-station-meta">' +
        '<span class="connector-name">' + esc(g.name) + '</span>' +
        (g.address ? '<span class="connector-type">' + esc(g.address) + '</span>' : '') +
      '</div>' +
      '<div class="discover-station-aside">' +
        countBadge +
        '<span class="cpo-badge">' + esc(g.cpoKey) + '</span>' +
        '<span class="dist-chip">' + formatDistance(g.distanceM) + '</span>' +
        '<span class="discover-chevron">›</span>' +
      '</div>' +
    '</div>' +
    '<div class="discover-connectors" id="dc-' + gi + '"></div>' +
  '</div>';
}

// ── Expand station ────────────────────────────────────────────────────────

function toggleStation(groupKey) {
  var group = stationGroups.find(function(g) { return g.key === groupKey; });
  var card = findCard(groupKey);
  var connDiv = card ? card.querySelector(".discover-connectors") : null;
  if (!group || !card || !connDiv) return;

  if (connDiv.dataset.loaded === "1") {
    openStationKeys[groupKey] = card.classList.toggle("open");
    updateMarkerStyle(groupKey);
    return;
  }

  connDiv.innerHTML = '<div class="discover-loading">' + t("discover-loading-connectors") + '</div>';
  card.classList.add("open");
  openStationKeys[groupKey] = true;
  updateMarkerStyle(groupKey);

  var adapter = window.ADAPTERS && window.ADAPTERS[group.cpoKey];
  if (!adapter) {
    connDiv.innerHTML = '<div class="s-error" style="padding:12px">' + t("discover-no-adapter", { cpo: esc(group.cpoKey) }) + '</div>';
    connDiv.dataset.loaded = "1";
    return;
  }

  // Each group.members[i] is one Charger/ChargePoint at this Location (see
  // MODEL(hierarchy) note in config.js); fetch every member and merge results.
  Promise.allSettled(group.members.map(function(m) {
    return adapter.fetchLocation(m.id, []).then(function(loc) {
      return { chargerId: m.id, loc: loc };
    });
  })).then(function(results) {
    connDiv.dataset.loaded = "1";
    var rowsHtml = "";
    var anyConnectors = false;
    results.forEach(function(r) {
      if (r.status !== "fulfilled" || !r.value.loc.connectors) return;
      var chargerId = r.value.chargerId;
      r.value.loc.connectors.forEach(function(c) {
        anyConnectors = true;
        rowsHtml += renderConnectorRow(c, group.cpoKey, chargerId);
      });
    });
    if (!anyConnectors) {
      connDiv.innerHTML = '<div class="discover-loading">' + t("discover-no-connectors-found") + '</div>';
      return;
    }
    connDiv.innerHTML = rowsHtml;

    connDiv.querySelectorAll(".pin-checkbox:not(:disabled)").forEach(function(cb) {
      cb.addEventListener("change", function() {
        var connId = this.dataset.connId;
        var chargerId = this.dataset.chargerId;
        if (this.checked) {
          if (isConnectorPending(chargerId, connId)) return;
          pendingPins.push({
            groupKey: groupKey,
            cpoKey: group.cpoKey,
            chargerId: chargerId,
            stationName: group.name,
            address: group.address,
            lat: group.lat,
            lon: group.lon,
            groupMembers: group.members.map(function(m) { return m.id; }), // already sorted by computeStationGroups
            connectorId: connId,
            displayName: this.dataset.displayName
          });
        } else {
          pendingPins = pendingPins.filter(function(p) {
            return !(p.groupKey === groupKey && p.chargerId === chargerId && p.connectorId === connId);
          });
        }
        updateAddButton();
      });
    });
  });
}

function renderConnectorRow(c, cpoKey, chargerId) {
  var statusCls = STATUS_CLASSES[c.status] || "status-unknown";
  var statusLabel = statusLabelFor(c.status);
  // rawStatus is only set when a provider sends a status code we can't map
  // (see evcharge.js) — show it for visibility. A literal "UNKNOWN" status
  // (e.g. Electromaps reporting it lost live data for a connector) has no
  // raw value to show and just uses the plain "Unknown" label above.
  if (c.status === "UNKNOWN" && c.rawStatus) statusLabel = "? " + c.rawStatus;
  var typeLabel = CONNECTOR_TYPE_LABELS[c.type] || c.type;
  var displayName = c.visualRef || typeLabel;
  var kwText = c.kw != null ? c.kw + " kW" : "? kW";
  var alreadyAdded = isConnectorConfigured(cpoKey, chargerId, String(c.id));
  var isPending = !alreadyAdded && isConnectorPending(chargerId, String(c.id));
  return '<div class="discover-connector' + (alreadyAdded ? ' discover-connector-added' : '') + '">' +
    '<input type="checkbox" class="s-checkbox pin-checkbox"' +
      (alreadyAdded ? ' checked disabled title="' + esc(t("discover-already-added")) + '"' : (isPending ? ' checked' : '')) +
      ' data-conn-id="' + esc(c.id) + '"' +
      ' data-charger-id="' + esc(chargerId) + '"' +
      ' data-display-name="' + esc(displayName) + '">' +
    '<div class="discover-connector-info">' +
      '<span style="font-size:15px;font-weight:600;color:var(--text-primary)">' + esc(displayName) + '</span>' +
      '<span class="connector-type">' + esc(typeLabel) + ' · ' + kwText + '</span>' +
    '</div>' +
    '<span class="status-badge ' + statusCls + '" style="font-size:14px;min-width:100px;min-height:36px;padding:6px 12px">' +
      statusLabel +
    '</span>' +
  '</div>';
}

// ── Add button ────────────────────────────────────────────────────────────

function updateAddButton() {
  var btn = document.getElementById("add-pins-btn");
  if (pendingPins.length === 0) {
    btn.style.display = "none";
  } else {
    btn.style.display = "block";
    btn.textContent = t("discover-add-button", { count: pendingPins.length });
  }
}

// ── Pin / save ────────────────────────────────────────────────────────────

function pinSelected() {
  if (pendingPins.length === 0) return;

  var cfg = getConfig() || defaultConfig();

  // Group pins by site, not by individual charger — multiple pins from
  // different chargers at the same site must collapse into ONE Location
  // entry (see computeStationGroups above).
  var byGroup = {};
  pendingPins.forEach(function(pin) {
    var key = pin.cpoKey + ":" + pin.groupKey;
    if (!byGroup[key]) byGroup[key] = { pin: pin, connectors: [] };
    byGroup[key].connectors.push({ id: pin.connectorId, displayName: pin.displayName, chargerId: pin.chargerId });
  });

  Object.keys(byGroup).forEach(function(key) {
    var group = byGroup[key];
    var pin = group.pin;

    // Find an existing config Location for this site: matches if its primary
    // id, OR any of its connectors' effective charger id, is one of this
    // site's known member ids. Correctly finds a previously solo-pinned
    // charger (e.g. existing loc.id === "10511") even though "groups" didn't
    // exist yet when it was first pinned.
    var existing = null;
    for (var i = 0; i < cfg.locations.length; i++) {
      var loc = cfg.locations[i];
      if (loc.cpo !== pin.cpoKey) continue;
      var matches = pin.groupMembers.indexOf(loc.id) >= 0 ||
        loc.connectors.some(function(c) { return pin.groupMembers.indexOf(c.chargerId || loc.id) >= 0; });
      if (matches) { existing = loc; break; }
    }

    if (existing) {
      // Never reassign existing.id — preserves accumulated rules/hidden/
      // autoRefresh/displayName tied to that primary charger id.
      group.connectors.forEach(function(c) {
        var incomingCharger = (c.chargerId === existing.id) ? existing.id : c.chargerId;
        var dup = existing.connectors.some(function(ec) {
          return ec.id === c.id && (ec.chargerId || existing.id) === incomingCharger;
        });
        if (dup) return;
        var newConn = { id: c.id, displayName: c.displayName };
        if (incomingCharger !== existing.id) newConn.chargerId = incomingCharger;
        existing.connectors.push(newConn);
      });
    } else {
      // Deterministic primary regardless of which checkbox the user happened
      // to click first within this one pinSelected() call.
      var primaryId = pin.groupMembers.slice().sort(function(a, b) {
        return String(a).localeCompare(String(b), undefined, { numeric: true });
      })[0];
      var newConnectors = group.connectors.map(function(c) {
        var newConn = { id: c.id, displayName: c.displayName };
        if (c.chargerId !== primaryId) newConn.chargerId = c.chargerId;
        return newConn;
      });
      cfg.locations.push({
        id: primaryId,
        cpo: pin.cpoKey,
        displayName: pin.stationName,
        address: pin.address != null ? pin.address : null,
        lat: pin.lat != null ? pin.lat : null,
        lon: pin.lon != null ? pin.lon : null,
        rules: null,
        connectors: newConnectors
      });
    }
  });

  setConfig(cfg);
  window.location.href = "settings.html";
}

// ── Helpers ───────────────────────────────────────────────────────────────

function clearStationMarkers() {
  stationMarkers.forEach(function(m) { m.remove(); });
  stationMarkers = [];
  stationMarkersByKey = {};
  openStationKeys = {};
}

function stationKey(cpoKey, idOrSiteKey) {
  return cpoKey + ":" + idOrSiteKey;
}

function findCard(groupKey) {
  return document.querySelector('.discover-station[data-gkey="' + groupKey + '"]');
}

function baseMarkerStyle(key) {
  return openStationKeys[key] ? MARKER_OPEN : MARKER_DEFAULT;
}

function updateMarkerStyle(key) {
  var marker = stationMarkersByKey[key];
  if (marker) marker.setStyle(baseMarkerStyle(key));
}

function loadExistingLocations() {
  var cfg = getConfig();
  if (cfg && cfg.locations) return cfg.locations;
  return (typeof LOCATIONS !== "undefined") ? LOCATIONS : [];
}

// Checks whether a given (charger, connector) pair is already configured
// under any existing Location, whether as that Location's primary charger
// (loc.id, see MODEL(hierarchy) note in config.js) or a merged-in sibling.
function isConnectorConfigured(cpoKey, chargerId, connectorId) {
  for (var i = 0; i < existingLocations.length; i++) {
    var loc = existingLocations[i];
    if (loc.cpo !== cpoKey) continue;
    var belongs = String(loc.id) === String(chargerId) ||
      loc.connectors.some(function(c) { return String(c.chargerId || loc.id) === String(chargerId); });
    if (!belongs) continue;
    for (var j = 0; j < loc.connectors.length; j++) {
      var c = loc.connectors[j];
      var connChargerId = String(c.chargerId || loc.id);
      if (connChargerId === String(chargerId) && String(c.id) === connectorId) return true;
    }
  }
  return false;
}

function isConnectorPending(chargerId, connectorId) {
  return pendingPins.some(function(p) {
    return p.chargerId === chargerId && p.connectorId === connectorId;
  });
}

function setStatus(msg, isError) {
  var cls = "discover-status" + (isError ? " error" : "");
  var el1 = document.getElementById("geo-status");
  var el2 = document.getElementById("geo-status-inline");
  if (el1) { el1.textContent = msg; el1.className = cls; }
  if (el2) { el2.textContent = msg; el2.className = cls; }
}

function setBanner(show) {
  var banner = document.getElementById("geo-banner");
  var inline = document.getElementById("geo-status-inline");
  if (banner) banner.style.display = show ? "block" : "none";
  if (inline) inline.style.display = show ? "none" : "block";
}

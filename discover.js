var map = null;
var stations = [];
// TODO(hierarchy): the real model here is Location (site) -> Charger/
// ChargePoint (one physical cabinet, e.g. evcharge's id_charger) -> Connector
// (one physical plug). `stations` is still a flat list of individual
// chargers; `stationGroups` below groups them by site so multiple chargers
// at one address collapse into one Location entry. This app still doesn't
// model a distinct EVSE level (a ChargePoint can house any number of EVSEs
// and any number of connectors independently of each other) — everything
// under a Charger is treated as a flat connector list. Electromaps exposes
// no analogous multi-charger-per-site signal, so its locations stay 1:1
// with chargers here; only evcharge groups.
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

var CONNECTOR_TYPE_LABELS = {
  IEC_62196_T2: "Type 2",
  IEC_62196_T2_COMBO: "CCS",
  CHADEMO: "CHAdeMO",
  DOMESTIC_E: "Schuko"
};

var STATUS_LABELS = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  CONNECTED_NOT_CHARGING: "Connected",
  OUT_OF_SERVICE: "Out of service",
  WORKING: "Working",
  UNKNOWN: "Unknown"
};

var STATUS_CLASSES = {
  AVAILABLE: "status-available",
  OCCUPIED: "status-occupied",
  CONNECTED_NOT_CHARGING: "status-occupied",
  OUT_OF_SERVICE: "status-oos",
  WORKING: "status-unknown",
  UNKNOWN: "status-unknown"
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Init ──────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function() {
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
  setStatus("Finding your location…");
  if (!navigator.geolocation) {
    setStatus("Geolocation is not supported by this browser.", true);
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
      }).addTo(map).bindPopup("You are here");
    },
    function(err) {
      setStatus("Location blocked: " + err.message + ". Tap to retry.", true);
      setBanner(true);
    },
    { timeout: 20000, enableHighAccuracy: false, maximumAge: 60000 }
  );
}

// ── Search ────────────────────────────────────────────────────────────────

function searchAll(lat, lon, bounds) {
  setStatus("Searching…");
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
    stations = [];
    results.forEach(function(arr) {
      arr.forEach(function(s) { stations.push(s); });
    });
    stations.sort(function(a, b) { return a.distanceM - b.distanceM; });
    stationGroups = computeStationGroups(stations);
    renderResults();
    var errMsg = adapterErrors.length ? " (" + adapterErrors.join("; ") + ")" : "";
    setStatus(stations.length + " charger" + (stations.length !== 1 ? "s" : "") + " found" + errMsg, adapterErrors.length > 0);
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
    container.innerHTML = '<p class="s-hint" style="text-align:center;padding:32px">No chargers found nearby</p>';
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
    ? '<span class="cpo-badge" title="Multiple chargers at this site">' + g.members.length + ' chargers</span>'
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
        '<span class="dist-chip">' + formatDist(g.distanceM) + '</span>' +
        '<span class="discover-chevron">›</span>' +
      '</div>' +
    '</div>' +
    '<div class="discover-connectors" id="dc-' + gi + '"></div>' +
  '</div>';
}

function formatDist(m) {
  return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(1) + " km";
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

  connDiv.innerHTML = '<div class="discover-loading">Loading connectors…</div>';
  card.classList.add("open");
  openStationKeys[groupKey] = true;
  updateMarkerStyle(groupKey);

  var adapter = window.ADAPTERS && window.ADAPTERS[group.cpoKey];
  if (!adapter) {
    connDiv.innerHTML = '<div class="s-error" style="padding:12px">No adapter for ' + esc(group.cpoKey) + '</div>';
    connDiv.dataset.loaded = "1";
    return;
  }

  // TODO(hierarchy): each group.members[i] is one Charger/ChargePoint at this
  // Location; fetching every member individually and merging the results
  // here (and again in app.js's fetchLocation, for already-pinned locations)
  // is the Location->Charger grouping this app was missing. Still no
  // distinct EVSE level between Charger and Connector.
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
      connDiv.innerHTML = '<div class="discover-loading">No connectors found</div>';
      return;
    }
    connDiv.innerHTML = rowsHtml;

    connDiv.querySelectorAll(".pin-checkbox:not(:disabled)").forEach(function(cb) {
      cb.addEventListener("change", function() {
        var connId = this.dataset.connId;
        var chargerId = this.dataset.chargerId;
        if (this.checked) {
          pendingPins.push({
            groupKey: groupKey,
            cpoKey: group.cpoKey,
            chargerId: chargerId,
            stationName: group.name,
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
  var statusLabel = STATUS_LABELS[c.status] || c.status;
  // rawStatus is only set when a provider sends a status code we can't map
  // (see evcharge.js) — show it for visibility. A literal "UNKNOWN" status
  // (e.g. Electromaps reporting it lost live data for a connector) has no
  // raw value to show and just uses the plain "Unknown" label above.
  if (c.status === "UNKNOWN" && c.rawStatus) statusLabel = "? " + c.rawStatus;
  var typeLabel = CONNECTOR_TYPE_LABELS[c.type] || c.type;
  var displayName = c.visualRef || typeLabel;
  var kwText = c.kw != null ? c.kw + " kW" : "? kW";
  var alreadyAdded = isConnectorConfigured(cpoKey, chargerId, String(c.id));
  return '<div class="discover-connector' + (alreadyAdded ? ' discover-connector-added' : '') + '">' +
    '<input type="checkbox" class="s-checkbox pin-checkbox"' +
      (alreadyAdded ? ' checked disabled title="Already added to My Stations"' : '') +
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
    var n = pendingPins.length;
    btn.textContent = "Add " + n + " connector" + (n !== 1 ? "s" : "") + " to My Stations";
  }
}

// ── Pin / save ────────────────────────────────────────────────────────────

function pinSelected() {
  if (pendingPins.length === 0) return;

  var stored = localStorage.getItem("evse_config");
  var cfg;
  try { cfg = stored ? JSON.parse(stored) : null; } catch (e) { cfg = null; }
  if (!cfg) {
    cfg = {
      handedness: (typeof HANDEDNESS !== "undefined") ? HANDEDNESS : "right",
      locations: (typeof LOCATIONS !== "undefined") ? JSON.parse(JSON.stringify(LOCATIONS)) : []
    };
  }

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
        lat: pin.lat != null ? pin.lat : null,
        lon: pin.lon != null ? pin.lon : null,
        rules: null,
        connectors: newConnectors
      });
    }
  });

  localStorage.setItem("evse_config", JSON.stringify(cfg));
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
  try {
    var stored = localStorage.getItem("evse_config");
    var cfg = stored ? JSON.parse(stored) : null;
    if (cfg && cfg.locations) return cfg.locations;
  } catch (e) {}
  return (typeof LOCATIONS !== "undefined") ? LOCATIONS : [];
}

// TODO(hierarchy): loc.id is really a Charger id, not a Location/site id (see
// top-of-file note). This checks whether a given (charger, connector) pair
// is already configured under any existing Location, whether as that
// Location's primary charger or one of its merged-in siblings.
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

var map = null;
var stations = [];
var pendingPins = [];
var stationMarkers = [];
var searchDebounce = null;

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
      map.setView([lat, lon], 14);
      clearTimeout(searchDebounce); // setView fires moveend — don't let it trigger a re-search
      L.circleMarker([lat, lon], {
        radius: 9, fillColor: "#3b82f6", color: "#fff", weight: 3, fillOpacity: 1
      }).addTo(map).bindPopup("You are here");
      searchAll(lat, lon);
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
    renderResults();
    var errMsg = adapterErrors.length ? " (" + adapterErrors.join("; ") + ")" : "";
    setStatus(stations.length + " charger" + (stations.length !== 1 ? "s" : "") + " found" + errMsg, adapterErrors.length > 0);
  });
}

// ── Render list + map markers ─────────────────────────────────────────────

function renderResults() {
  var container = document.getElementById("results");
  if (stations.length === 0) {
    container.innerHTML = '<p class="s-hint" style="text-align:center;padding:32px">No chargers found nearby</p>';
    return;
  }

  container.innerHTML = stations.map(function(s) { return renderStation(s); }).join("");

  stations.forEach(function(s) {
    if (!isNaN(s.lat) && !isNaN(s.lon)) {
      var marker = L.circleMarker([s.lat, s.lon], {
        radius: 7, fillColor: "#1e293b", color: "#3b82f6", weight: 2, fillOpacity: 0.95
      }).addTo(map).bindPopup("<b>" + esc(s.name) + "</b><br>" + formatDist(s.distanceM));
      stationMarkers.push(marker);

      marker.on("click", function() {
        var card = document.querySelector('.discover-station[data-sid="' + s.id + '"][data-cpo="' + s.cpoKey + '"]');
        if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); }
      });
    }
  });

  container.querySelectorAll(".discover-station-header").forEach(function(header) {
    header.addEventListener("click", function() {
      var card = this.closest(".discover-station");
      toggleStation(card.dataset.sid, card.dataset.cpo);
    });
  });
}

function renderStation(s) {
  return '<div class="discover-station" data-sid="' + esc(s.id) + '" data-cpo="' + esc(s.cpoKey) + '">' +
    '<div class="discover-station-header">' +
      '<div class="discover-station-meta">' +
        '<span class="connector-name">' + esc(s.name) + '</span>' +
        (s.address ? '<span class="connector-type">' + esc(s.address) + '</span>' : '') +
      '</div>' +
      '<div class="discover-station-aside">' +
        '<span class="cpo-badge">' + esc(s.cpoKey) + '</span>' +
        '<span class="dist-chip">' + formatDist(s.distanceM) + '</span>' +
        '<span class="discover-chevron">›</span>' +
      '</div>' +
    '</div>' +
    '<div class="discover-connectors" id="dc-' + esc(s.cpoKey) + '-' + esc(s.id) + '"></div>' +
  '</div>';
}

function formatDist(m) {
  return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(1) + " km";
}

// ── Expand station ────────────────────────────────────────────────────────

function toggleStation(stationId, cpoKey) {
  var card = document.querySelector('.discover-station[data-sid="' + stationId + '"][data-cpo="' + cpoKey + '"]');
  var connDiv = document.getElementById("dc-" + cpoKey + "-" + stationId);
  if (!card || !connDiv) return;

  if (connDiv.dataset.loaded === "1") {
    card.classList.toggle("open");
    return;
  }

  connDiv.innerHTML = '<div class="discover-loading">Loading connectors…</div>';
  card.classList.add("open");

  var adapter = window.ADAPTERS && window.ADAPTERS[cpoKey];
  if (!adapter) {
    connDiv.innerHTML = '<div class="s-error" style="padding:12px">No adapter for ' + esc(cpoKey) + '</div>';
    connDiv.dataset.loaded = "1";
    return;
  }

  adapter.fetchLocation(stationId, []).then(function(location) {
    connDiv.dataset.loaded = "1";
    if (!location.connectors || location.connectors.length === 0) {
      connDiv.innerHTML = '<div class="discover-loading">No connectors found</div>';
      return;
    }
    connDiv.innerHTML = location.connectors.map(function(c) {
      return renderConnectorRow(c);
    }).join("");

    connDiv.querySelectorAll(".pin-checkbox").forEach(function(cb) {
      cb.addEventListener("change", function() {
        var connId = this.dataset.connId;
        if (this.checked) {
          var station = stations.find(function(s) { return s.id === stationId && s.cpoKey === cpoKey; });
          pendingPins.push({
            stationId: stationId,
            cpoKey: cpoKey,
            stationName: location.name || stationId,
            lat: station ? station.lat : null,
            lon: station ? station.lon : null,
            connectorId: connId,
            displayName: this.dataset.displayName
          });
        } else {
          pendingPins = pendingPins.filter(function(p) {
            return !(p.stationId === stationId && p.cpoKey === cpoKey && p.connectorId === connId);
          });
        }
        updateAddButton();
      });
    });
  }).catch(function(e) {
    connDiv.dataset.loaded = "1";
    connDiv.innerHTML = '<div class="s-error" style="padding:12px">Failed to load: ' + esc(e.message) + '</div>';
  });
}

function renderConnectorRow(c) {
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
  return '<div class="discover-connector">' +
    '<input type="checkbox" class="s-checkbox pin-checkbox"' +
      ' data-conn-id="' + esc(c.id) + '"' +
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

  // Group pins by station
  var byStation = {};
  pendingPins.forEach(function(pin) {
    var key = pin.cpoKey + ":" + pin.stationId;
    if (!byStation[key]) byStation[key] = { pin: pin, connectors: [] };
    byStation[key].connectors.push({ id: pin.connectorId, displayName: pin.displayName });
  });

  Object.keys(byStation).forEach(function(key) {
    var group = byStation[key];
    var existing = null;
    for (var i = 0; i < cfg.locations.length; i++) {
      if (cfg.locations[i].id === group.pin.stationId && cfg.locations[i].cpo === group.pin.cpoKey) {
        existing = cfg.locations[i];
        break;
      }
    }
    if (existing) {
      group.connectors.forEach(function(c) {
        var dup = false;
        for (var j = 0; j < existing.connectors.length; j++) {
          if (existing.connectors[j].id === c.id) { dup = true; break; }
        }
        if (!dup) existing.connectors.push(c);
      });
    } else {
      cfg.locations.push({
        id: group.pin.stationId,
        cpo: group.pin.cpoKey,
        displayName: group.pin.stationName,
        lat: group.pin.lat != null ? group.pin.lat : null,
        lon: group.pin.lon != null ? group.pin.lon : null,
        rules: null,
        connectors: group.connectors
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

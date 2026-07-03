var REFRESH_INTERVAL = 60;  // seconds
var refreshTimer = null;
var countdown = REFRESH_INTERVAL;
var countdownTimer = null;
var globalEnabled = true;
var locationResults = [];

var CONNECTOR_TYPE_LABELS = {
  IEC_62196_T2: "Type 2",
  IEC_62196_T2_COMBO: "CCS",
  CHADEMO: "CHAdeMO",
  DOMESTIC_E: "Schuko"
};

var STATUS_LABELS = {
  AVAILABLE:              "Available",
  PREPARING:              "Preparing",
  OCCUPIED:               "Occupied",
  CONNECTED_NOT_CHARGING: "Connected",
  FINISHING:              "Finishing",
  RESERVED:               "Reserved",
  OUT_OF_SERVICE:         "Out of service",
  WORKING:                "Working",
  UNKNOWN:                "Unknown"
};

var STATUS_CLASSES = {
  AVAILABLE:              "status-available",
  PREPARING:              "status-preparing",
  OCCUPIED:               "status-occupied",
  CONNECTED_NOT_CHARGING: "status-occupied",
  FINISHING:              "status-finishing",
  RESERVED:               "status-reserved",
  OUT_OF_SERVICE:         "status-oos",
  WORKING:                "status-unknown",
  UNKNOWN:                "status-unknown"
};

function computeLimits(connector, rules, capabilities) {
  var limits = [];
  if (!rules || !capabilities) return limits;

  if (rules.mustLeaveWhenNotCharging &&
      capabilities.indexOf("CONNECTED_NOT_CHARGING") >= 0 &&
      connector.status === "CONNECTED_NOT_CHARGING") {
    limits.push({
      type: "mustLeaveWhenNotCharging",
      deadline: 0,
      sessionMinutes: connector.sessionMinutes || null,
      sessionEnergyWh: connector.sessionEnergyWh || null,
      sessionUserName: connector.sessionUserName || null
    });
  }

  if (rules.maxChargeDuration &&
      capabilities.indexOf("CHARGE_START_TIME") >= 0 &&
      connector.status === "OCCUPIED" &&
      connector.statusUpdatedAt) {
    var deadline = new Date(connector.statusUpdatedAt).getTime() +
                   rules.maxChargeDuration.hours * 3600000;
    limits.push({ type: "maxChargeDuration", deadline: deadline });
  }

  return limits;
}

function renderLimitBadge(limit) {
  var remaining = limit.deadline - Date.now();
  if (remaining <= 0) {
    var overdueMins = Math.floor(-remaining / 60000);
    var overdueHours = Math.floor(overdueMins / 60);
    overdueMins = overdueMins % 60;
    var overdueText = overdueHours > 0
      ? "Should have left " + overdueHours + "h " + (overdueMins < 10 ? "0" : "") + overdueMins + "m ago"
      : "Should have left " + overdueMins + "m ago";
    var lines = [];
    if (limit.sessionUserName) lines.push(limit.sessionUserName);
    if (limit.sessionMinutes != null) {
      var h = Math.floor(limit.sessionMinutes / 60);
      var m = limit.sessionMinutes % 60;
      var timeStr = h > 0 ? h + "h " + (m < 10 ? "0" : "") + m + "m" : m + "m";
      var kwh = limit.sessionEnergyWh != null ? " · " + (limit.sessionEnergyWh / 1000).toFixed(1) + " kWh" : "";
      lines.push(timeStr + kwh);
    }
    return '<div class="limit-badge-wrap">' +
      '<span class="limit-badge limit-overdue">' + overdueText + '</span>' +
      lines.map(function(l) { return '<span class="limit-detail">' + l + '</span>'; }).join("") +
    '</div>';
  }
  var mins = Math.floor(remaining / 60000);
  var hours = Math.floor(mins / 60);
  mins = mins % 60;
  var text = hours > 0
    ? "Should leave in " + hours + "h " + (mins < 10 ? "0" : "") + mins + "m"
    : "Should leave in " + mins + "m";
  var cls = remaining < 30 * 60000 ? "limit-urgent" : "limit-ok";
  return '<span class="limit-badge ' + cls + '">' + text + '</span>';
}

function formatRelativeTime(isoString) {
  if (!isoString) return "unknown";
  var diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return diff + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function getAdapter(cpo) {
  return window.ADAPTERS && window.ADAPTERS[cpo];
}

async function fetchLocation(locConfig) {
  var adapter = getAdapter(locConfig.cpo);
  if (!adapter) throw new Error("No adapter for CPO: " + locConfig.cpo);

  var data = await adapter.fetchLocation(
    locConfig.id,
    locConfig.connectors.map(function(c) { return c.id; })
  );

  var displayNameMap = {};
  locConfig.connectors.forEach(function(c) { displayNameMap[c.id] = c.displayName; });

  return {
    displayName: locConfig.displayName,
    id: data.id,
    cpoKey: locConfig.cpo,
    cpo: data.cpo,
    address: data.address,
    realtime: data.realtime,
    updatedAt: data.updatedAt,
    rules: locConfig.rules || null,
    error: null,
    connectors: data.connectors.map(function(c) {
      return Object.assign({}, c, {
        displayName: displayNameMap[c.id] || c.visualRef || c.id
      });
    })
  };
}

function renderConnector(connector, context, isOos) {
  var statusClass = STATUS_CLASSES[connector.status] || "status-unknown";
  var statusLabel = STATUS_LABELS[connector.status] || connector.status;
  var typeLabel = CONNECTOR_TYPE_LABELS[connector.type] || connector.type;
  var notLive = connector.realtime === false
    ? '<span class="not-live" title="Status not updated in real time">not live</span>'
    : "";

  var limitBadgesHtml = "";
  if (context) {
    var limits = computeLimits(connector, context.rules, context.capabilities);
    limitBadgesHtml = limits.map(renderLimitBadge).join("");
  }

  // DOM order inside .connector-status (flex-direction: row-reverse reverses visual order):
  // DOM: [status-badge][not-live?][time][limit-badge]
  // Visual: [limit-badge][time][not-live?][status-badge]
  return '<div class="connector' + (isOos ? ' connector-oos' : '') + '">' +
    '<div class="connector-info">' +
      '<span class="connector-name">' + connector.displayName + '</span>' +
      '<span class="connector-type">' + typeLabel + (connector.kw != null ? ' &middot; ' + connector.kw + ' kW' : '') + '</span>' +
    '</div>' +
    '<div class="connector-status">' +
      '<span class="status-badge ' + statusClass + '">' + statusLabel + '</span>' +
      notLive +
      (connector.statusUpdatedAt ? '<span class="status-time">' + formatRelativeTime(connector.statusUpdatedAt) + '</span>' : '') +
      limitBadgesHtml +
    '</div>' +
  '</div>';
}

function renderCardSkeleton(loc) {
  var connSkeleton = loc.connectors.map(function(c) {
    return '<div class="connector">' +
      '<div class="connector-info">' +
        '<span class="connector-name">' + (c.displayName || c.id) + '</span>' +
        '<span class="skeleton-line" style="width:90px"></span>' +
      '</div>' +
      '<div class="connector-status">' +
        '<span class="skeleton-badge"></span>' +
      '</div>' +
    '</div>';
  }).join('');
  return '<div class="card">' +
    '<div class="card-header">' +
      '<span class="location-name">' + loc.displayName + '</span>' +
      '<span class="cpo-badge">' + loc.cpo + '</span>' +
    '</div>' +
    '<div class="location-address"><span class="skeleton-line" style="width:140px"></span></div>' +
    '<div class="connectors">' + connSkeleton + '</div>' +
  '</div>';
}

function renderCard(location, index) {
  if (location.error) {
    return '<div class="card card-error">' +
      '<div class="card-header"><span class="location-name">' + location.displayName + '</span></div>' +
      '<div class="card-error-msg">' + location.error + '</div>' +
    '</div>';
  }

  var active = location.connectors.filter(function(c) { return c.status !== "OUT_OF_SERVICE"; });
  if (active.length === 0) return '';

  var adapter = getAdapter(location.cpoKey) || {};
  var context = { rules: location.rules, capabilities: adapter.capabilities || [] };
  var connectorsHtml = active.map(function(c) { return renderConnector(c, context); }).join('');

  var refreshIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var refreshBtn = index != null
    ? '<button class="btn btn-ghost btn-icon refresh-loc-btn" data-loc-index="' + index + '">' + refreshIcon + '</button>'
    : '';

  return '<div class="card">' +
    '<div class="card-header">' +
      refreshBtn +
      '<span class="location-name">' + location.displayName + '</span>' +
      '<span class="cpo-badge">' + (location.cpo || "Unknown") + '</span>' +
    '</div>' +
    (location.address ? '<div class="location-address">' + location.address + '</div>' : '') +
    '<div class="connectors">' + connectorsHtml + '</div>' +
  '</div>';
}

function renderOosCard(location) {
  var adapter = getAdapter(location.cpoKey) || {};
  var context = { rules: location.rules, capabilities: adapter.capabilities || [] };
  var oos = location.connectors.filter(function(c) { return c.status === "OUT_OF_SERVICE"; });
  var connectorsHtml = oos.map(function(c) { return renderConnector(c, context); }).join('');

  return '<div class="card card-oos">' +
    '<div class="card-header">' +
      '<span class="location-name">' + location.displayName + '</span>' +
      '<span class="cpo-badge">' + (location.cpo || "Unknown") + '</span>' +
    '</div>' +
    (location.address ? '<div class="location-address">' + location.address + '</div>' : '') +
    '<div class="connectors">' + connectorsHtml + '</div>' +
  '</div>';
}

function renderOosSection() {
  var el = document.getElementById("oos-section");
  if (!el) return;
  var oosLocations = locationResults.filter(function(r) {
    return r && !r.error && r.connectors.some(function(c) { return c.status === "OUT_OF_SERVICE"; });
  });
  if (oosLocations.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML =
    '<details class="oos-page-section">' +
      '<summary class="oos-page-summary">Out of service (' + oosLocations.length + ')</summary>' +
      '<div class="oos-cards">' +
        oosLocations.map(renderOosCard).join('') +
      '</div>' +
    '</details>';
}

function setLoading(isLoading) {
  var btn = document.getElementById("refresh-btn");
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Refreshing…" : "Refresh now";
}

function updateCountdown() {
  var toggle = document.getElementById("countdown-toggle");
  if (!toggle) return;
  if (globalEnabled) {
    toggle.classList.remove("is-off");
    var el = document.getElementById("countdown");
    if (el) {
      el.textContent = countdown;
    } else {
      toggle.innerHTML = 'Next refresh in <span id="countdown">' + countdown + '</span>s';
    }
  } else {
    toggle.classList.add("is-off");
    toggle.textContent = "Auto-refresh off — tap to resume";
  }
}

function startCountdown() {
  countdown = REFRESH_INTERVAL;
  updateCountdown();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(function() {
    countdown = Math.max(0, countdown - 1);
    updateCountdown();
  }, 1000);
}

function setGlobalEnabled(value) {
  globalEnabled = value;
  var stored = localStorage.getItem("evse_config");
  var cfg;
  try { cfg = stored ? JSON.parse(stored) : {}; } catch (e) { cfg = {}; }
  if (!cfg.refresh) cfg.refresh = {};
  cfg.refresh.globalEnabled = value;
  localStorage.setItem("evse_config", JSON.stringify(cfg));
}

async function refreshSingleLocation(i) {
  var loc = window.LOCATIONS[i];
  var slot = document.getElementById("card-slot-" + i);
  if (!slot) return;
  slot.style.opacity = "0.5";
  try {
    var result = await fetchLocation(loc);
    locationResults[i] = result;
    var html = renderCard(result, i);
    slot.innerHTML = html;
    slot.style.display = html ? "" : "none";
    slot.style.opacity = "";
  } catch (e) {
    var errResult = { displayName: loc.displayName, id: loc.id, error: e.message, connectors: [] };
    locationResults[i] = errResult;
    slot.innerHTML = renderCard(errResult, i);
    slot.style.display = "";
    slot.style.opacity = "";
  }
  renderOosSection();
  if (globalEnabled) {
    clearTimeout(refreshTimer);
    startCountdown();
    refreshTimer = setTimeout(refresh, REFRESH_INTERVAL * 1000);
  } else {
    updateCountdown();
  }
}

async function refresh() {
  setLoading(true);
  clearInterval(countdownTimer);

  var container = document.getElementById("cards");
  var isFirstLoad = !document.getElementById("card-slot-0");

  if (isFirstLoad) {
    // First load: render skeletons so the page isn't blank
    container.innerHTML = LOCATIONS.map(function(loc, i) {
      return '<div id="card-slot-' + i + '">' + renderCardSkeleton(loc) + '</div>';
    }).join("");
  } else {
    // Re-refresh: ensure slots exist and dim existing cards to signal staleness
    LOCATIONS.forEach(function(loc, i) {
      var slot = document.getElementById("card-slot-" + i);
      if (!slot) {
        var div = document.createElement("div");
        div.id = "card-slot-" + i;
        div.innerHTML = renderCardSkeleton(loc);
        container.appendChild(div);
      } else {
        slot.style.opacity = "0.5";
      }
    });
  }

  var pending = LOCATIONS.length;
  function oneDone() {
    pending--;
    if (pending === 0) {
      document.getElementById("last-updated-time").textContent = new Date().toLocaleTimeString();
      setLoading(false);
      if (globalEnabled) {
        startCountdown();
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, REFRESH_INTERVAL * 1000);
      } else {
        updateCountdown();
      }
    }
  }

  LOCATIONS.forEach(function(loc, i) {
    fetchLocation(loc).then(function(result) {
      locationResults[i] = result;
      var slot = document.getElementById("card-slot-" + i);
      if (slot) {
        var html = renderCard(result, i);
        slot.innerHTML = html;
        slot.style.display = html ? "" : "none";
        slot.style.opacity = "";
      }
      renderOosSection();
      oneDone();
    }).catch(function(e) {
      var errResult = { displayName: loc.displayName, id: loc.id, error: e.message, connectors: [] };
      locationResults[i] = errResult;
      var slot = document.getElementById("card-slot-" + i);
      if (slot) { slot.innerHTML = renderCard(errResult, i); slot.style.display = ""; slot.style.opacity = ""; }
      renderOosSection();
      oneDone();
    });
  });
}

document.addEventListener("DOMContentLoaded", function() {
  var stored = localStorage.getItem("evse_config");
  if (stored) {
    try {
      var cfg = JSON.parse(stored);
      if (cfg.handedness) HANDEDNESS = cfg.handedness;
      if (cfg.locations)  LOCATIONS  = cfg.locations;
      globalEnabled = (cfg && cfg.refresh && cfg.refresh.globalEnabled === false) ? false : true;
    } catch (e) {}
  }

  if (typeof HANDEDNESS !== "undefined" && HANDEDNESS === "left") {
    document.body.classList.add("left-handed");
  }

  document.body.setAttribute("data-theme", (cfg && cfg.theme) ? cfg.theme : "light");

  updateCountdown();

  document.getElementById("refresh-btn").addEventListener("click", function() {
    clearTimeout(refreshTimer);
    refresh();
  });

  document.getElementById("cards").addEventListener("click", function(e) {
    var btn = e.target.closest(".refresh-loc-btn");
    if (!btn) return;
    refreshSingleLocation(parseInt(btn.getAttribute("data-loc-index"), 10));
  });

  document.getElementById("countdown-toggle").addEventListener("click", function() {
    var enabling = !globalEnabled;
    setGlobalEnabled(enabling);
    if (enabling) {
      startCountdown();
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, REFRESH_INTERVAL * 1000);
    } else {
      clearTimeout(refreshTimer);
      clearInterval(countdownTimer);
      updateCountdown();
    }
  });

  refresh();
});

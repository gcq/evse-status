var REFRESH_INTERVAL = 60;  // seconds
var refreshTimer = null;
var countdown = REFRESH_INTERVAL;
var countdownTimer = null;
var globalEnabled = true;
var missedRefreshWhileHidden = false;
// Wall-clock deadline for the next auto-refresh. The displayed countdown is
// derived from this on every tick instead of being decremented by hand, so it
// stays accurate even when the interval's ticks get throttled while hidden.
var refreshDeadlineMs = null;
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

  if (index != null && window.LOCATIONS[index] && window.LOCATIONS[index].hidden) return '';

  var active = location.connectors.filter(function(c) { return c.status !== "OUT_OF_SERVICE"; });
  if (active.length === 0) return '';

  var adapter = getAdapter(location.cpoKey) || {};
  var context = { rules: location.rules, capabilities: adapter.capabilities || [] };
  var connectorsHtml = active.map(function(c) { return renderConnector(c, context); }).join('');

  var refreshIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var refreshBtn = index != null
    ? '<button class="btn btn-ghost btn-icon refresh-loc-btn" data-loc-index="' + index + '">' + refreshIcon + '</button>'
    : '';

  var autoIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>';
  var isAutoOnly = index != null && window.LOCATIONS[index] && window.LOCATIONS[index].autoRefresh;
  var autoBtn = index != null
    ? '<button class="btn btn-ghost btn-icon auto-refresh-loc-btn' + (isAutoOnly ? ' active' : '') + '" data-loc-index="' + index + '" title="Auto-refresh only this location">' + autoIcon + '</button>'
    : '';

  var eyeIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
  var hideBtn = index != null
    ? '<button class="btn btn-ghost btn-icon hide-loc-btn" data-loc-index="' + index + '" title="Hide this location">' + eyeIcon + '</button>'
    : '';

  return '<div class="card">' +
    '<div class="card-header">' +
      refreshBtn +
      autoBtn +
      hideBtn +
      '<span class="location-name">' + location.displayName + '</span>' +
      '<span class="cpo-badge">' + (location.cpo || "Unknown") + '</span>' +
    '</div>' +
    (location.address ? '<div class="location-address">' + location.address + '</div>' : '') +
    '<div class="connectors">' + connectorsHtml + '</div>' +
  '</div>';
}

function renderHiddenCard(location, index) {
  var active = location.connectors.filter(function(c) { return c.status !== "OUT_OF_SERVICE"; });
  var adapter = getAdapter(location.cpoKey) || {};
  var context = { rules: location.rules, capabilities: adapter.capabilities || [] };
  var connectorsHtml = active.map(function(c) { return renderConnector(c, context); }).join('');

  var closedEyeIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-6.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

  return '<div class="card">' +
    '<div class="card-header">' +
      '<button class="btn btn-ghost btn-icon unhide-loc-btn" data-loc-index="' + index + '" title="Show this location">' + closedEyeIcon + '</button>' +
      '<span class="location-name">' + location.displayName + '</span>' +
      '<span class="cpo-badge">' + (location.cpo || "Unknown") + '</span>' +
    '</div>' +
    (location.address ? '<div class="location-address">' + location.address + '</div>' : '') +
    '<div class="connectors">' + connectorsHtml + '</div>' +
  '</div>';
}

function renderHiddenSection() {
  var el = document.getElementById("hidden-section");
  if (!el) return;
  var hiddenLocations = [];
  locationResults.forEach(function(r, i) {
    if (r && !r.error && LOCATIONS[i] && LOCATIONS[i].hidden) hiddenLocations.push({ result: r, index: i });
  });
  if (hiddenLocations.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML =
    '<details class="oos-page-section">' +
      '<summary class="oos-page-summary">Hidden (' + hiddenLocations.length + ')</summary>' +
      '<div class="oos-cards">' +
        hiddenLocations.map(function(h) { return renderHiddenCard(h.result, h.index); }).join('') +
      '</div>' +
    '</details>';
}

function setLocationHidden(i, value) {
  LOCATIONS[i].hidden = value;
  persistLocations();
  var slot = document.getElementById("card-slot-" + i);
  if (slot) {
    var result = locationResults[i];
    var html = result ? renderCard(result, i) : '';
    slot.innerHTML = html;
    slot.style.display = html ? "" : "none";
  }
  renderHiddenSection();
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
  if (isLoading) {
    btn.textContent = "Refreshing…";
  } else {
    updateRefreshUI();
  }
}

// Keeps the mode button (all / selected / off, with matching color) and the
// separate countdown label in sync with current state.
function updateRefreshUI() {
  var btn = document.getElementById("refresh-btn");
  if (btn && !btn.disabled) {
    if (globalEnabled) {
      btn.textContent = "Auto refresh active";
      btn.className = "mode-all";
    } else if (LOCATIONS.some(function(loc) { return loc.autoRefresh; })) {
      btn.textContent = "Selective refresh active";
      btn.className = "mode-selective";
    } else {
      btn.textContent = "Auto refresh disabled";
      btn.className = "mode-off";
    }
  }

  var label = document.getElementById("countdown-label");
  if (!label) return;
  if (anyAutoRefreshActive() && refreshDeadlineMs != null) {
    countdown = Math.max(0, Math.ceil((refreshDeadlineMs - Date.now()) / 1000));
    var el = document.getElementById("countdown");
    if (el) {
      el.textContent = countdown;
    } else {
      label.innerHTML = 'Next refresh in <span id="countdown">' + countdown + '</span>s';
    }
    label.style.display = "";
  } else {
    label.style.display = "none";
  }
}

function startCountdown() {
  refreshDeadlineMs = Date.now() + REFRESH_INTERVAL * 1000;
  updateRefreshUI();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(updateRefreshUI, 1000);
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

function persistLocations() {
  var stored = localStorage.getItem("evse_config");
  var cfg;
  try { cfg = stored ? JSON.parse(stored) : {}; } catch (e) { cfg = {}; }
  cfg.locations = LOCATIONS;
  localStorage.setItem("evse_config", JSON.stringify(cfg));
}

// Auto-refresh runs in one of three modes: "all" (globalEnabled), "selected"
// (globalEnabled off but one or more locations opted in), or fully off.
function anyAutoRefreshActive() {
  return globalEnabled || LOCATIONS.some(function(loc) { return loc.autoRefresh; });
}

function setLocationAutoRefresh(i, value) {
  LOCATIONS[i].autoRefresh = value;
  persistLocations();
  var btn = document.querySelector('.auto-refresh-loc-btn[data-loc-index="' + i + '"]');
  if (btn) btn.classList.toggle("active", value);
  if (value) {
    // Enabling a location's own auto-refresh always takes it out of the
    // "all locations" cycle — only the selected ones keep refreshing.
    setGlobalEnabled(false);
    refreshSingleLocation(i);
  } else {
    scheduleNextRefresh();
  }
}

// Single place that decides whether/when the next automatic refresh happens.
function scheduleNextRefresh() {
  if (!anyAutoRefreshActive()) {
    updateRefreshUI();
    return;
  }
  startCountdown();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(autoRefreshTick, REFRESH_INTERVAL * 1000);
}

function snapCountdownToZero() {
  clearInterval(countdownTimer);
  countdown = 0;
  var countdownEl = document.getElementById("countdown");
  if (countdownEl) countdownEl.textContent = 0;
}

// The automatic timer's entry point: refreshes everyone in "all" mode, or
// just the opted-in locations in "selected" mode.
async function autoRefreshTick() {
  if (document.hidden) {
    // Keep the timer loop alive in the background, but don't do any fetching
    // until the page is visible again — visibilitychange will catch up then.
    missedRefreshWhileHidden = true;
    refreshDeadlineMs = Date.now() + REFRESH_INTERVAL * 1000;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(autoRefreshTick, REFRESH_INTERVAL * 1000);
    return;
  }

  if (globalEnabled) {
    await refresh();
    return;
  }

  var targets = [];
  LOCATIONS.forEach(function(loc, i) { if (loc.autoRefresh) targets.push(i); });
  if (targets.length === 0) {
    scheduleNextRefresh();
    return;
  }
  snapCountdownToZero();
  await Promise.all(targets.map(updateLocationCard));
  scheduleNextRefresh();
}

async function updateLocationCard(i) {
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
  renderHiddenSection();
}

async function refreshSingleLocation(i) {
  await updateLocationCard(i);
  scheduleNextRefresh();
}

async function refresh() {
  setLoading(true);
  snapCountdownToZero();

  var container = document.getElementById("cards");
  var isFirstLoad = !document.getElementById("card-slot-0");

  if (isFirstLoad) {
    // First load: render skeletons so the page isn't blank
    container.innerHTML = LOCATIONS.map(function(loc, i) {
      var style = loc.hidden ? ' style="display:none"' : '';
      return '<div id="card-slot-' + i + '"' + style + '>' + renderCardSkeleton(loc) + '</div>';
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
      scheduleNextRefresh();
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
      renderHiddenSection();
      oneDone();
    }).catch(function(e) {
      var errResult = { displayName: loc.displayName, id: loc.id, error: e.message, connectors: [] };
      locationResults[i] = errResult;
      var slot = document.getElementById("card-slot-" + i);
      if (slot) { slot.innerHTML = renderCard(errResult, i); slot.style.display = ""; slot.style.opacity = ""; }
      renderOosSection();
      renderHiddenSection();
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
      // Defensive: "all locations" mode and per-location auto-refresh are
      // mutually exclusive — don't trust stale/hand-edited config to agree.
      if (globalEnabled) LOCATIONS.forEach(function(loc) { loc.autoRefresh = false; });
    } catch (e) {}
  }

  if (typeof HANDEDNESS !== "undefined" && HANDEDNESS === "left") {
    document.body.classList.add("left-handed");
  }

  document.body.setAttribute("data-theme", (cfg && cfg.theme) ? cfg.theme : "light");

  updateRefreshUI();

  document.getElementById("cards").addEventListener("click", function(e) {
    var refreshBtn = e.target.closest(".refresh-loc-btn");
    if (refreshBtn) {
      refreshSingleLocation(parseInt(refreshBtn.getAttribute("data-loc-index"), 10));
      return;
    }
    var autoBtn = e.target.closest(".auto-refresh-loc-btn");
    if (autoBtn) {
      var i = parseInt(autoBtn.getAttribute("data-loc-index"), 10);
      setLocationAutoRefresh(i, !LOCATIONS[i].autoRefresh);
      return;
    }
    var hideBtn = e.target.closest(".hide-loc-btn");
    if (hideBtn) {
      setLocationHidden(parseInt(hideBtn.getAttribute("data-loc-index"), 10), true);
    }
  });

  document.getElementById("hidden-section").addEventListener("click", function(e) {
    var unhideBtn = e.target.closest(".unhide-loc-btn");
    if (unhideBtn) {
      setLocationHidden(parseInt(unhideBtn.getAttribute("data-loc-index"), 10), false);
    }
  });

  document.getElementById("refresh-btn").addEventListener("click", function() {
    var enabling = !globalEnabled;
    setGlobalEnabled(enabling);
    if (enabling) {
      LOCATIONS.forEach(function(loc) { loc.autoRefresh = false; });
      persistLocations();
      document.querySelectorAll(".auto-refresh-loc-btn.active").forEach(function(btn) {
        btn.classList.remove("active");
      });
      scheduleNextRefresh();
    } else {
      refreshDeadlineMs = null;
      clearTimeout(refreshTimer);
      clearInterval(countdownTimer);
      updateRefreshUI();
    }
  });

  document.addEventListener("visibilitychange", function() {
    if (document.hidden) return;
    updateRefreshUI();
    if (missedRefreshWhileHidden) {
      missedRefreshWhileHidden = false;
      clearTimeout(refreshTimer);
      autoRefreshTick();
    }
  });

  refresh();
});

var REFRESH_INTERVAL = 60;  // seconds
var FETCH_TIMEOUT_MS = 10000; // drop a location's refresh if it takes longer than this
var refreshTimer = null;
var countdown = REFRESH_INTERVAL;
var countdownTimer = null;
var globalEnabled = true;
var flashOnAvailableEnabled = true;
var missedRefreshWhileHidden = false;
// Wall-clock deadline for the next auto-refresh. The displayed countdown is
// derived from this on every tick instead of being decremented by hand, so it
// stays accurate even when the interval's ticks get throttled while hidden.
var refreshDeadlineMs = null;
var locationResults = [];
var locationLastUpdated = []; // ISO timestamp per location, set on each successful fetch
var locationUpdateFailed = []; // true when the most recent refresh timed out, parallel to locationResults

// WebKit's fetch() rejects aborted requests with a generic AbortError rather
// than surfacing the signal's abort reason (Chrome/Firefox do) — so timeout
// detection has to check the signal itself, not the caught error's name.
function isTimeoutSignal(signal) {
  return !!(signal && signal.aborted && signal.reason && signal.reason.name === "TimeoutError");
}

var locationOrder = "config"; // "config" (default) or "distance" — opt-in via Settings
var maxDistanceKm = null;
var currentPosition = null;   // { lat, lon } once geolocation resolves, else null
var locationDistances = [];   // meters, parallel to LOCATIONS; null = unknown
var gpsStatus = "locating";   // "locating" | "fixed" | "unavailable" — surfaced in the header
var gpsFixAt = null;          // ISO timestamp of the last successful fix

// "HH:MM"-"HH:MM" window, e.g. 22:00-08:00 crosses midnight — handled by
// wrapping the comparison when start > end.
function isWithinFreeWindow(freeCharging) {
  var now = new Date();
  var nowMin = now.getHours() * 60 + now.getMinutes();
  var startParts = freeCharging.start.split(":");
  var endParts = freeCharging.end.split(":");
  var startMin = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
  var endMin = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);
  if (startMin <= endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

function computeLimits(connector, rules, capabilities) {
  var limits = [];
  if (!rules || !capabilities) return limits;
  if (rules.freeCharging && isWithinFreeWindow(rules.freeCharging)) return limits;

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
  if (limit.type === "mustLeaveWhenNotCharging") {
    // deadline is a fixed sentinel (0) meaning "always immediately due" —
    // it's not a real point in time, so it must never be fed through the
    // elapsed-since-deadline math below (that measures time since the Unix
    // epoch, ~56 years, and used to render as e.g. "Should have left
    // 495356h 42m ago" once the overdue text started showing computed
    // durations instead of a fixed "MUST LEAVE" string).
    var lines = [];
    if (limit.sessionUserName) lines.push(esc(limit.sessionUserName));
    if (limit.sessionMinutes != null) {
      var h = Math.floor(limit.sessionMinutes / 60);
      var m = limit.sessionMinutes % 60;
      var timeStr = h > 0 ? h + "h " + (m < 10 ? "0" : "") + m + "m" : m + "m";
      var kwh = limit.sessionEnergyWh != null ? " · " + (limit.sessionEnergyWh / 1000).toFixed(1) + " kWh" : "";
      lines.push(timeStr + kwh);
    }
    return '<div class="limit-badge-wrap">' +
      '<span class="limit-badge limit-overdue">' + t("limit-should-leave-now") + '</span>' +
      lines.map(function(l) { return '<span class="limit-detail">' + l + '</span>'; }).join("") +
    '</div>';
  }

  // h/m units aren't translated — they're passed as a pre-formatted duration
  // argument so each locale's message can still control word order around it
  // (e.g. "ago"/"in" trail in English but lead as "hace"/"fa"/"en" in
  // Spanish/Catalan).
  var remaining = limit.deadline - Date.now();
  if (remaining <= 0) {
    var overdueMins = Math.floor(-remaining / 60000);
    var overdueHours = Math.floor(overdueMins / 60);
    overdueMins = overdueMins % 60;
    var overdueDuration = overdueHours > 0
      ? overdueHours + "h " + (overdueMins < 10 ? "0" : "") + overdueMins + "m"
      : overdueMins + "m";
    var overdueText = t("limit-should-have-left", { duration: overdueDuration });
    return '<span class="limit-badge limit-overdue">' + overdueText + '</span>';
  }
  var mins = Math.floor(remaining / 60000);
  var hours = Math.floor(mins / 60);
  mins = mins % 60;
  var duration = hours > 0
    ? hours + "h " + (mins < 10 ? "0" : "") + mins + "m"
    : mins + "m";
  var text = t("limit-should-leave-in", { duration: duration });
  var cls = remaining < 30 * 60000 ? "limit-urgent" : "limit-ok";
  return '<span class="limit-badge ' + cls + '">' + text + '</span>';
}

function formatRelativeTime(isoString) {
  if (!isoString) return t("relative-time-unknown");
  var diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return t("relative-time-ago", { n: diff, unit: "s" });
  if (diff < 3600) return t("relative-time-ago", { n: Math.floor(diff / 60), unit: "m" });
  if (diff < 86400) return t("relative-time-ago", { n: Math.floor(diff / 3600), unit: "h" });
  return t("relative-time-ago", { n: Math.floor(diff / 86400), unit: "d" });
}

function getAdapter(cpo) {
  return window.ADAPTERS && window.ADAPTERS[cpo];
}

function uniq(arr) {
  var seen = {};
  var out = [];
  arr.forEach(function(v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
  return out;
}

// locConfig.id is really a Charger id, not a Location id (see MODEL(hierarchy)
// note in config.js) — merges every charger under locConfig's connectors.
async function fetchLocation(locConfig, signal) {
  var adapter = getAdapter(locConfig.cpo);
  if (!adapter) throw new Error("No adapter for CPO: " + locConfig.cpo);

  var displayNameMap = {};
  locConfig.connectors.forEach(function(c) { displayNameMap[c.id] = c.displayName; });

  var chargerIds = uniq(locConfig.connectors.map(function(c) { return c.chargerId || locConfig.id; }));
  if (chargerIds.indexOf(locConfig.id) < 0) chargerIds.push(locConfig.id);

  if (chargerIds.length === 1) {
    // ── Single-charger location: today's exact behavior, unchanged. ────────
    var data = await adapter.fetchLocation(
      locConfig.id,
      locConfig.connectors.map(function(c) { return c.id; }),
      signal
    );

    // TODO(remove): migration shim only, for locations pinned before lat/lon
    // was captured at pin time (discover.js's pinSelected() now sets it
    // directly). Safe to delete once existing users' configs have all been
    // backfilled once — new locations never need this.
    if ((locConfig.lat == null || locConfig.lon == null) && data.lat != null && data.lon != null) {
      locConfig.lat = data.lat;
      locConfig.lon = data.lon;
      persistLocations();
      if (currentPosition) computeDistances();
    }

    // TODO(remove): same migration shim as above, for address — safe to
    // delete once existing users' configs have all been backfilled once.
    if (locConfig.address == null && data.address != null) {
      locConfig.address = data.address;
      persistLocations();
    }

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

  // ── Merged site: fetch every underlying charger, combine connectors. ────
  var settled = await Promise.allSettled(chargerIds.map(function(cid) {
    var wanted = locConfig.connectors
      .filter(function(c) { return (c.chargerId || locConfig.id) === cid; })
      .map(function(c) { return c.id; });
    return adapter.fetchLocation(cid, wanted, signal);
  }));

  var primaryIdx = chargerIds.indexOf(locConfig.id);
  var primaryResult = settled[primaryIdx];
  if (primaryResult.status === "rejected") {
    // Primary charger failing fails the whole card, same as the
    // single-charger path above.
    throw primaryResult.reason;
  }
  var primaryData = primaryResult.value;

  if ((locConfig.lat == null || locConfig.lon == null) && primaryData.lat != null && primaryData.lon != null) {
    locConfig.lat = primaryData.lat;
    locConfig.lon = primaryData.lon;
    persistLocations();
    if (currentPosition) computeDistances();
  }

  if (locConfig.address == null && primaryData.address != null) {
    locConfig.address = primaryData.address;
    persistLocations();
  }

  var mergedConnectors = [];
  var anySiblingFailed = false;
  settled.forEach(function(r) {
    if (r.status === "rejected") { anySiblingFailed = true; return; }
    r.value.connectors.forEach(function(c) { mergedConnectors.push(c); });
  });

  return {
    displayName: locConfig.displayName,
    id: primaryData.id,
    cpoKey: locConfig.cpo,
    cpo: primaryData.cpo,
    address: primaryData.address,
    realtime: primaryData.realtime,
    updatedAt: primaryData.updatedAt,
    rules: locConfig.rules || null,
    error: null,
    warning: anySiblingFailed ? t("addr-partial-warning") : null,
    connectors: mergedConnectors.map(function(c) {
      return Object.assign({}, c, {
        displayName: displayNameMap[c.id] || c.visualRef || c.id
      });
    })
  };
}

function renderConnector(connector, context, isOos) {
  var statusClass = STATUS_CLASSES[connector.status] || "status-unknown";
  var statusLabel = esc(statusLabelFor(connector.status));
  var typeLabel = esc(CONNECTOR_TYPE_LABELS[connector.type] || connector.type);
  var notLive = connector.realtime === false
    ? '<span class="not-live" title="' + esc(t("connector-not-live-title")) + '">' + esc(t("connector-not-live")) + '</span>'
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
      '<span class="connector-name">' + esc(connector.displayName) + '</span>' +
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
        '<span class="connector-name">' + esc(c.displayName || c.id) + '</span>' +
        '<span class="skeleton-line" style="width:90px"></span>' +
      '</div>' +
      '<div class="connector-status">' +
        '<span class="skeleton-badge"></span>' +
      '</div>' +
    '</div>';
  }).join('');
  return '<div class="card">' +
    '<div class="card-header">' +
      '<span class="location-name">' + esc(loc.displayName) + '</span>' +
      '<span class="cpo-badge">' + esc(loc.cpo) + '</span>' +
    '</div>' +
    '<div class="location-address"><span class="skeleton-line" style="width:140px"></span></div>' +
    '<div class="connectors">' + connSkeleton + '</div>' +
  '</div>';
}

function activeConnectors(location) {
  return location.connectors.filter(function(c) { return c.status !== "OUT_OF_SERVICE"; });
}

// Shared body for every non-error card variant (main list, hidden section,
// out-of-range section, out-of-service section) — they differ only in which
// connectors they show and what buttons sit in the header.
function renderCardBody(location, index, connectors, headerButtonsHtml, extraClass) {
  var adapter = getAdapter(location.cpoKey) || {};
  var context = { rules: location.rules, capabilities: adapter.capabilities || [] };
  var connectorsHtml = connectors.map(function(c) { return renderConnector(c, context); }).join('');

  return '<div class="card' + (extraClass ? ' ' + extraClass : '') + '">' +
    '<div class="card-header">' +
      headerButtonsHtml +
      '<span class="location-name">' + esc(location.displayName) + '</span>' +
      '<span class="cpo-badge">' + esc(location.cpo || t("status-unknown")) + '</span>' +
    '</div>' +
    renderAddressLine(location, index) +
    '<div class="connectors">' + connectorsHtml + '</div>' +
  '</div>';
}

function renderCard(location, index) {
  if (location.error) {
    return '<div class="card card-error">' +
      '<div class="card-header"><span class="location-name">' + esc(location.displayName) + '</span></div>' +
      '<div class="card-error-msg">' + esc(location.error) + '</div>' +
    '</div>';
  }

  if (index != null && window.LOCATIONS[index] && window.LOCATIONS[index].hidden) return '';
  if (index != null && isOutOfRange(index)) return '';

  var active = activeConnectors(location);
  if (active.length === 0) return '';

  var refreshBtn = index != null
    ? '<button class="btn btn-ghost btn-icon refresh-loc-btn" data-loc-index="' + index + '" title="' + esc(t("btn-refresh-location")) + '" aria-label="' + esc(t("btn-refresh-location")) + '">' + ICONS.refresh + '</button>'
    : '';

  var isAutoOnly = index != null && window.LOCATIONS[index] && window.LOCATIONS[index].autoRefresh;
  var autoBtn = index != null
    ? '<button class="btn btn-ghost btn-icon auto-refresh-loc-btn' + (isAutoOnly ? ' active' : '') + '" data-loc-index="' + index + '" title="' + esc(t("btn-auto-refresh-location")) + '" aria-label="' + esc(t("btn-auto-refresh-location")) + '">' + ICONS.auto + '</button>'
    : '';

  var hideBtn = index != null
    ? '<button class="btn btn-ghost btn-icon hide-loc-btn" data-loc-index="' + index + '" title="' + esc(t("btn-hide-location")) + '" aria-label="' + esc(t("btn-hide-location")) + '">' + ICONS.eye + '</button>'
    : '';

  return renderCardBody(location, index, active, refreshBtn + autoBtn + hideBtn);
}

function renderAddressLine(location, index) {
  var distM = index != null ? locationDistances[index] : null;
  var lastUpdated = index != null ? locationLastUpdated[index] : null;
  var updateFailed = index != null && locationUpdateFailed[index];
  var parts = [];
  // Address/warning are unbounded-length text — left able to wrap normally
  // instead of forced onto one line, since a long one could otherwise
  // overflow the card (which clips instead of scrolling). The short
  // distance/updated phrases are wrapped as a single atomic unit so e.g.
  // "Updated" and "5m ago" don't get split across lines.
  if (location.address) parts.push(esc(location.address));
  if (distM != null) parts.push('<span class="addr-atom">' + t("addr-away", { distance: formatDistance(distM) }) + '</span>');
  if (updateFailed) {
    parts.push('<span class="addr-atom last-updated-failed">' + t("addr-update-failed") + '</span>');
  } else if (lastUpdated) {
    var liveTimeSpan = '<span class="last-updated-text" data-updated-at="' + lastUpdated + '">' +
      formatRelativeTime(lastUpdated) + '</span>';
    parts.push('<span class="addr-atom">' + t("addr-updated", { time: liveTimeSpan }) + '</span>');
  }
  // Soft signal for a merged multi-charger location where one sibling
  // charger's fetch failed but others succeeded — not the hard red
  // card-error state, since most of the location is still showing live data.
  if (location.warning) parts.push('<span class="location-warning">' + esc(location.warning) + '</span>');
  var joined = parts.join(" · ");
  return parts.length ? '<div class="location-address">' + joined + '</div>' : '';
}

// Ticks the "Updated Xs ago" text on every card without a full re-render,
// so it doesn't visibly freeze at "0s ago" between refreshes.
function tickLastUpdatedTexts() {
  document.querySelectorAll(".last-updated-text").forEach(function(el) {
    el.textContent = formatRelativeTime(el.dataset.updatedAt);
  });
}

function renderHiddenCard(location, index) {
  var unhideBtn = '<button class="btn btn-ghost btn-icon unhide-loc-btn" data-loc-index="' + index + '" title="' + esc(t("btn-show-location")) + '" aria-label="' + esc(t("btn-show-location")) + '">' + ICONS.eyeOff + '</button>';

  return renderCardBody(location, index, activeConnectors(location), unhideBtn);
}

function renderCollapsedSection(elId, title, filterFn, renderItemFn) {
  var el = document.getElementById(elId);
  if (!el) return;
  var items = [];
  locationResults.forEach(function(r, i) {
    if (r && !r.error && filterFn(r, i)) items.push({ result: r, index: i });
  });
  if (items.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML =
    '<details class="oos-page-section">' +
      '<summary class="oos-page-summary">' + title + ' (' + items.length + ')</summary>' +
      '<div class="oos-cards">' +
        items.map(function(it) { return renderItemFn(it.result, it.index); }).join('') +
      '</div>' +
    '</details>';
}

function renderHiddenSection() {
  renderCollapsedSection("hidden-section", t("section-hidden"), function(r, i) {
    return LOCATIONS[i] && LOCATIONS[i].hidden;
  }, renderHiddenCard);
}

function rerenderCardSlot(i) {
  var slot = document.getElementById("card-slot-" + i);
  if (!slot) return;
  var result = locationResults[i];
  var html = result ? renderCard(result, i) : '';
  slot.innerHTML = html;
  slot.style.display = html ? "" : "none";
}

function setLocationHidden(i, value) {
  LOCATIONS[i].hidden = value;
  persistLocations();
  rerenderCardSlot(i);
  renderHiddenSection();
  renderOutOfRangeSection();
}

function isOutOfRange(i) {
  return locationDistances[i] != null && !!maxDistanceKm && locationDistances[i] > maxDistanceKm * 1000;
}

function computeDistances() {
  LOCATIONS.forEach(function(loc, i) {
    locationDistances[i] = (currentPosition && loc.lat != null && loc.lon != null)
      ? haversineM(currentPosition.lat, currentPosition.lon, loc.lat, loc.lon)
      : null;
  });
}

function reorderCardsByDistance() {
  var container = document.getElementById("cards");
  if (!container) return;
  var indices = LOCATIONS.map(function(_, i) { return i; });
  indices.sort(function(a, b) {
    var da = locationDistances[a], db = locationDistances[b];
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  });
  indices.forEach(function(i) {
    var slot = document.getElementById("card-slot-" + i);
    if (slot) container.appendChild(slot);
  });
}

function renderOutOfRangeCard(location, index) {
  // Shows every connector, OOS included: out-of-range "wins" over
  // out-of-service, so a location that's both isn't split across two
  // sections — it lives here alone, OOS status and all.
  return renderCardBody(location, index, location.connectors, '');
}

function renderOutOfRangeSection() {
  renderCollapsedSection("out-of-range-section", t("section-out-of-range"), function(r, i) {
    return LOCATIONS[i] && !LOCATIONS[i].hidden && isOutOfRange(i);
  }, renderOutOfRangeCard);
}

function applyDistanceLayout() {
  LOCATIONS.forEach(function(loc, i) {
    if (locationResults[i]) {
      rerenderCardSlot(i);
      return;
    }
    // Still loading (no fetch result yet) — but distance alone is enough to
    // know it belongs in the collapsed Out of range section, so hide its
    // skeleton immediately instead of leaving it visible until its own
    // fetch happens to finish (which made out-of-range cards disappear one
    // at a time, staggered by fetch timing, instead of all together the
    // moment the GPS fix landed).
    var slot = document.getElementById("card-slot-" + i);
    if (slot) slot.style.display = isOutOfRange(i) ? "none" : "";
  });
  reorderCardsByDistance();
  renderOutOfRangeSection();
}

function renderOosCard(location, index) {
  var oos = location.connectors.filter(function(c) { return c.status === "OUT_OF_SERVICE"; });
  return renderCardBody(location, index, oos, '', 'card-oos');
}

function renderOosSection() {
  renderCollapsedSection("oos-section", t("section-out-of-service"), function(r, i) {
    // Out-of-range locations are excluded here even if they have OOS
    // connectors — those show up in the out-of-range section instead.
    return !isOutOfRange(i) && r.connectors.some(function(c) { return c.status === "OUT_OF_SERVICE"; });
  }, renderOosCard);
}

function setLoading(isLoading) {
  var btn = document.getElementById("refresh-btn");
  btn.disabled = isLoading;
  if (isLoading) {
    btn.textContent = t("refresh-loading");
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
      btn.textContent = t("refresh-active");
      btn.className = "mode-all";
    } else if (LOCATIONS.some(function(loc) { return loc.autoRefresh; })) {
      btn.textContent = t("refresh-selective");
      btn.className = "mode-selective";
    } else {
      btn.textContent = t("refresh-off");
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
      label.innerHTML = t("countdown-prefix") + ' <span id="countdown">' + countdown + '</span>s';
    }
    label.style.display = "";
  } else {
    label.style.display = "none";
  }
}

var GPS_FIX_FRESH_MS = 15000; // how long a fix counts as "live" before it's flagged stale

// Shown only when the out-of-range cutoff is actually in play (distance
// ordering + a max distance set) — that's the only time cards' visibility
// depends on GPS, so it's the only time staleness is worth surfacing. Once
// a fix ages past GPS_FIX_FRESH_MS it's flagged "Stale" rather than hidden,
// since a stale fix is exactly when the out-of-range cutoff is most likely
// to be wrong.
function updateGpsStatusUI() {
  var el = document.getElementById("gps-status-label");
  if (!el) return;
  el.classList.remove("gps-fixed", "gps-stale", "gps-searching", "gps-unavailable");
  if (locationOrder !== "distance" || !maxDistanceKm) {
    el.style.display = "none";
    return;
  }
  if (gpsStatus === "fixed") {
    var staleMs = Date.now() - new Date(gpsFixAt).getTime();
    el.style.display = "inline-block";
    if (staleMs >= GPS_FIX_FRESH_MS) {
      el.classList.add("gps-stale");
      el.textContent = t("gps-stale");
    } else {
      el.classList.add("gps-fixed");
      el.textContent = t("gps-live");
    }
  } else if (gpsStatus === "unavailable") {
    el.style.display = "inline-block";
    el.classList.add("gps-unavailable");
    el.textContent = t("gps-unavailable");
  } else {
    el.style.display = "inline-block";
    el.classList.add("gps-searching");
    el.textContent = t("gps-locating");
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
  var cfg = getConfig() || {};
  if (!cfg.refresh) cfg.refresh = {};
  cfg.refresh.globalEnabled = value;
  setConfig(cfg);
}

function persistLocations() {
  var cfg = getConfig() || {};
  cfg.locations = LOCATIONS;
  setConfig(cfg);
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
  LOCATIONS.forEach(function(loc, i) { if (loc.autoRefresh && !isOutOfRange(i)) targets.push(i); });
  if (targets.length === 0) {
    scheduleNextRefresh();
    return;
  }
  snapCountdownToZero();
  await Promise.all(targets.map(updateLocationCard));
  scheduleNextRefresh();
}

// Fetches one location, updates its card slot (if present) and the global
// out-of-service/hidden/out-of-range sections. Never throws — a fetch
// failure becomes an error-state result like any other, since callers just
// need to know when this location is done, not whether it succeeded.
// True if any connector present in both results moved from some other status
// into AVAILABLE — the signal that's worth flashing the card for. Connectors
// with no known prior status (first load, or newly appeared) don't count:
// there's nothing to say they "became" available from.
function hasNewlyAvailableConnector(prevResult, newResult) {
  if (!prevResult || !newResult) return false;
  var prevStatusById = {};
  (prevResult.connectors || []).forEach(function(c) { prevStatusById[c.id] = c.status; });
  return (newResult.connectors || []).some(function(c) {
    var prevStatus = prevStatusById[c.id];
    return prevStatus != null && prevStatus !== "AVAILABLE" && c.status === "AVAILABLE";
  });
}

// Restartable even if a previous flash on this card hasn't finished yet
// (e.g. two connectors free up back-to-back) — the reflow forces the browser
// to notice the class was removed before it's re-added.
function flashCard(slot) {
  var card = slot.querySelector(".card");
  if (!card) return;
  card.classList.remove("card-flash");
  void card.offsetWidth;
  card.classList.add("card-flash");
  card.addEventListener("animationend", function handler() {
    card.classList.remove("card-flash");
    card.removeEventListener("animationend", handler);
  });
}

async function fetchAndRenderLocation(i) {
  var loc = window.LOCATIONS[i];
  var priorResult = locationResults[i];
  var hadPriorResult = !!(priorResult && !priorResult.error);
  var signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  var result;
  var timedOut = false;
  try {
    result = await fetchLocation(loc, signal);
    locationLastUpdated[i] = new Date().toISOString();
    locationUpdateFailed[i] = false;
  } catch (e) {
    if (isTimeoutSignal(signal) && hadPriorResult) {
      // The request was actually cancelled at the network level (not just
      // ignored) — keep showing the last-known-good card data (dimmed, as if
      // still loading) instead of replacing it with an error.
      timedOut = true;
      locationUpdateFailed[i] = true;
      result = locationResults[i];
    } else {
      result = {
        displayName: loc.displayName,
        id: loc.id,
        error: isTimeoutSignal(signal) ? "Update timed out" : e.message,
        connectors: []
      };
      locationUpdateFailed[i] = false;
    }
  }
  // Also fires after a catch-up refresh triggered by the tab regaining
  // visibility, since that goes through this same function/comparison — a
  // status change while backgrounded still gets flashed once it's visible.
  var justBecameAvailable = !timedOut && hadPriorResult && hasNewlyAvailableConnector(priorResult, result);
  locationResults[i] = result;

  var slot = document.getElementById("card-slot-" + i);
  if (slot) {
    var html = renderCard(result, i);
    slot.innerHTML = html;
    slot.style.display = html ? "" : "none";
    slot.style.opacity = timedOut ? "0.5" : "";
    if (justBecameAvailable && flashOnAvailableEnabled) flashCard(slot);
  }

  renderOosSection();
  renderHiddenSection();
  renderOutOfRangeSection();
}

async function updateLocationCard(i) {
  var slot = document.getElementById("card-slot-" + i);
  if (!slot) return;
  slot.style.opacity = "0.5";
  await fetchAndRenderLocation(i);
}

async function refreshSingleLocation(i) {
  await updateLocationCard(i);
  scheduleNextRefresh();
}

async function refresh() {
  setLoading(true);
  snapCountdownToZero();

  if (LOCATIONS.length === 0) {
    document.getElementById("cards").innerHTML =
      '<p class="s-hint" style="text-align:center;padding:32px">' + t("empty-state") + '</p>';
    setLoading(false);
    return;
  }

  var container = document.getElementById("cards");
  var isFirstLoad = !document.getElementById("card-slot-0");

  // First load fetches every location once (you need the info now, even for
  // out-of-range ones) but dispatches in-range/unknown-distance locations
  // first so they land before a slow network finishes the out-of-range ones.
  // Subsequent automatic refreshes skip out-of-range locations entirely —
  // their status is unlikely to have changed and it's not worth the
  // request. Out-of-service doesn't factor in: an out-of-range+OOS location
  // is still skipped, same as any other out-of-range one.
  var indices = LOCATIONS.map(function(_, i) { return i; });
  if (!isFirstLoad) {
    indices = indices.filter(function(i) { return !isOutOfRange(i); });
  }
  indices.sort(function(a, b) { return isOutOfRange(a) - isOutOfRange(b); });
  var willFetch = {};
  indices.forEach(function(i) { willFetch[i] = true; });

  if (isFirstLoad) {
    // First load: render skeletons so the page isn't blank
    container.innerHTML = LOCATIONS.map(function(loc, i) {
      var style = loc.hidden ? ' style="display:none"' : '';
      return '<div id="card-slot-' + i + '"' + style + '>' + renderCardSkeleton(loc) + '</div>';
    }).join("");
  } else {
    // Re-refresh: ensure slots exist and dim only the ones about to be
    // re-fetched, so skipped out-of-range cards don't stay dimmed forever.
    LOCATIONS.forEach(function(loc, i) {
      var slot = document.getElementById("card-slot-" + i);
      if (!slot) {
        var div = document.createElement("div");
        div.id = "card-slot-" + i;
        div.innerHTML = renderCardSkeleton(loc);
        container.appendChild(div);
      } else if (willFetch[i]) {
        slot.style.opacity = "0.5";
      }
    });
  }

  var pending = indices.length;
  if (pending === 0) {
    setLoading(false);
    scheduleNextRefresh();
    return;
  }
  function oneDone() {
    pending--;
    if (pending === 0) {
      setLoading(false);
      scheduleNextRefresh();
    }
  }

  indices.forEach(function(i) {
    fetchAndRenderLocation(i).then(oneDone);
  });
}

document.addEventListener("DOMContentLoaded", async function() {
  await initL10n();
  renderDeployInfo("deploy-info");
  document.documentElement.lang = l10nActiveLocale;
  document.title = t("header-title");
  var h1 = document.querySelector("header h1");
  if (h1) h1.textContent = t("header-title");
  var settingsLink = document.getElementById("settings-link");
  if (settingsLink) settingsLink.textContent = t("nav-settings");

  var cfg = getConfig();
  if (cfg) {
    if (cfg.handedness) HANDEDNESS = cfg.handedness;
    if (cfg.locations)  LOCATIONS  = cfg.locations;
    if (cfg.maxDistanceKm) maxDistanceKm = cfg.maxDistanceKm;
    if (cfg.locationOrder === "distance") locationOrder = "distance";
    globalEnabled = (cfg.refresh && cfg.refresh.globalEnabled === false) ? false : true;
    flashOnAvailableEnabled = cfg.flashOnAvailable === false ? false : true;
    // Defensive: "all locations" mode and per-location auto-refresh are
    // mutually exclusive — don't trust stale/hand-edited config to agree.
    if (globalEnabled) LOCATIONS.forEach(function(loc) { loc.autoRefresh = false; });
  }

  if (typeof HANDEDNESS !== "undefined" && HANDEDNESS === "left") {
    document.body.classList.add("left-handed");
  }

  document.body.setAttribute("data-theme", (cfg && cfg.theme) ? cfg.theme : "auto");

  updateRefreshUI();
  updateGpsStatusUI();

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

  if (locationOrder === "distance" && navigator.geolocation) {
    // Distance ordering is opt-in (Settings > Location order) since it needs
    // high-accuracy GPS to be useful while driving, which costs battery.
    // watchPosition subscribes to ongoing updates (as the device moves),
    // instead of a one-shot getCurrentPosition check on load — so distances
    // and the out-of-range section stay live while the page stays open.
    navigator.geolocation.watchPosition(
      function(position) {
        currentPosition = { lat: position.coords.latitude, lon: position.coords.longitude };
        gpsStatus = "fixed";
        gpsFixAt = new Date().toISOString();
        updateGpsStatusUI();
        computeDistances();
        applyDistanceLayout();
      },
      function() {
        // denied/unavailable — fall back to config order, no error shown
        // beyond the header status label
        gpsStatus = "unavailable";
        updateGpsStatusUI();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  } else if (locationOrder === "distance") {
    gpsStatus = "unavailable";
    updateGpsStatusUI();
  }

  // Ticks on a fixed schedule anchored to page load, independent of when any
  // given location last refreshed (they can refresh at different times via
  // per-location/selective auto-refresh). A 1s period left "Xs ago" stuck at
  // the old value for up to just-under-2s after a refresh, depending on
  // where in the cycle the refresh happened to land — a shorter period
  // bounds that worst case tightly without needing per-refresh realignment.
  setInterval(function() {
    if (!document.hidden) {
      tickLastUpdatedTexts();
      if (gpsStatus === "fixed") updateGpsStatusUI();
    }
  }, 250);

  refresh();
});

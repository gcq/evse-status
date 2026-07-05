var STORAGE_KEY = "evse_config";
var state = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────

function init() {
  state = loadConfig();
  render();
  document.getElementById("save-btn").addEventListener("click", save);
  document.getElementById("reset-btn").addEventListener("click", resetToDefaults);
}

function loadConfig() {
  var stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try { return JSON.parse(stored); } catch (e) {}
  }
  return defaultConfig();
}

function defaultConfig() {
  return {
    handedness: (typeof HANDEDNESS !== "undefined") ? HANDEDNESS : "right",
    theme: "light",
    locationOrder: "config",
    maxDistanceKm: null,
    locations: (typeof LOCATIONS !== "undefined")
      ? JSON.parse(JSON.stringify(LOCATIONS))
      : []
  };
}

// ── HTML helpers ──────────────────────────────────────────────────────────

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function field(id, label, inputHtml, hint) {
  return '<div class="s-field">' +
    '<label class="s-label">' + label + '</label>' +
    inputHtml +
    (hint ? '<span class="s-hint">' + esc(hint) + '</span>' : '') +
    '<span class="s-error" data-err="' + id + '"></span>' +
  '</div>';
}

function input(id, value, opts) {
  opts = opts || {};
  return '<input class="s-input" type="' + (opts.type || "text") + '"' +
    ' data-fid="' + id + '"' +
    ' value="' + esc(value) + '"' +
    (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
    (opts.min !== undefined ? ' min="' + opts.min + '"' : '') +
    (opts.max !== undefined ? ' max="' + opts.max + '"' : '') +
    (opts.step ? ' step="' + opts.step + '"' : '') +
    (opts.readonly ? ' readonly' : '') +
    '>';
}

function getCpoOptions(selected) {
  var adapters = window.ADAPTERS || {};
  return Object.keys(adapters).map(function(key) {
    var label = key.charAt(0).toUpperCase() + key.slice(1);
    return '<option value="' + esc(key) + '"' + (key === selected ? " selected" : "") + '>' + esc(label) + '</option>';
  }).join("");
}

function hasCapability(cpo, cap) {
  var adapter = window.ADAPTERS && window.ADAPTERS[cpo];
  return adapter && adapter.capabilities && adapter.capabilities.indexOf(cap) >= 0;
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  document.body.classList.toggle("left-handed", state.handedness === "left");
  document.body.setAttribute("data-theme", state.theme || "light");
  document.getElementById("form-root").innerHTML = buildGlobal() + buildLocations();
  bindFormEvents();
}

function segmentedControl(id, options, selected) {
  var segments = options.map(function(o) {
    return '<button type="button" class="s-segment' + (o.value === selected ? " active" : "") + '" data-value="' + o.value + '">' + o.label + '</button>';
  }).join("");
  return '<div class="s-segmented" id="' + id + '" data-value="' + selected + '">' + segments + '</div>';
}

function buildGlobal() {
  var distanceRelatedFields = (state.locationOrder === "distance")
    ? field("g-max-distance", "Max distance (km)",
        input("g-max-distance", state.maxDistanceKm != null ? state.maxDistanceKm : "", { type: "number", step: "any", min: 0, placeholder: "e.g. 30" }),
        "Leave blank for no cutoff — locations further than this move to a collapsed \"Out of range\" section")
    : "";

  return '<section class="s-section">' +
    '<h2 class="s-section-title">Display</h2>' +
    '<div class="s-field-row">' +
      '<div class="s-field">' +
        '<label class="s-label">Theme</label>' +
        segmentedControl("g-theme", [
          { value: "auto",  label: "Auto" },
          { value: "dark",  label: "Dark" },
          { value: "light", label: "Light" }
        ], state.theme || "auto") +
        '<span class="s-hint" id="system-theme-hint">' + systemThemeHint() + '</span>' +
      '</div>' +
      '<div class="s-field">' +
        '<label class="s-label">Driving side</label>' +
        segmentedControl("g-handedness", [
          { value: "right", label: "Right" },
          { value: "left",  label: "Left" }
        ], state.handedness || "right") +
        '<span class="s-hint">Controls move to the opposite side, near your hand</span>' +
      '</div>' +
      '<div class="s-field">' +
        '<label class="s-label">Location order</label>' +
        segmentedControl("g-location-order", [
          { value: "config",   label: "Manual" },
          { value: "distance", label: "Distance" }
        ], state.locationOrder || "config") +
        '<span class="s-hint">Distance mode uses your live location (high-accuracy GPS) to sort</span>' +
      '</div>' +
    '</div>' +
    distanceRelatedFields +
  '</section>';
}

function buildLocations() {
  var locCards = state.locations.map(buildLocation).join("");
  var noLocError = '<span class="s-error" data-err="no-locations"></span>';
  return '<section class="s-section">' +
    '<div class="s-section-header">' +
      '<h2 class="s-section-title">Locations</h2>' +
      '<button class="btn btn-primary" id="add-loc-btn">Find nearby</button>' +
    '</div>' +
    noLocError +
    locCards +
  '</section>';
}

function buildLocation(loc, li) {
  var rules = loc.rules || {};
  var maxDur = rules.maxChargeDuration || null;
  var notCharging = !!rules.mustLeaveWhenNotCharging;
  var freeChg = rules.freeCharging || null;
  var notChargingCapWarning = !hasCapability(loc.cpo, "CONNECTED_NOT_CHARGING")
    ? '<span class="s-cap-warn">not supported by ' + esc(loc.cpo) + '</span>' : "";

  var leftCol =
    field("loc-" + li + "-displayName", "Display name",
      input("loc-" + li + "-displayName", loc.displayName, { placeholder: "e.g. Moli" })) +

    '<div class="s-field-row">' +
      '<div class="s-field">' +
        '<label class="s-label">CPO</label>' +
        '<select class="s-input s-select" data-fid="loc-' + li + '-cpo" disabled>' +
          getCpoOptions(loc.cpo) +
        '</select>' +
        '<span class="s-error" data-err="loc-' + li + '-cpo"></span>' +
      '</div>' +
      '<div class="s-field">' +
        field("loc-" + li + "-id", "Location ID",
          input("loc-" + li + "-id", loc.id, { placeholder: "e.g. 42479", readonly: true })) +
      '</div>' +
    '</div>' +

    '<div class="s-field-row">' +
      '<div class="s-field">' +
        field("loc-" + li + "-lat", "Latitude",
          input("loc-" + li + "-lat", loc.lat != null ? loc.lat : "", { type: "number", step: "any", placeholder: "e.g. 41.4036", readonly: true })) +
      '</div>' +
      '<div class="s-field">' +
        field("loc-" + li + "-lon", "Longitude",
          input("loc-" + li + "-lon", loc.lon != null ? loc.lon : "", { type: "number", step: "any", placeholder: "e.g. 2.1744", readonly: true })) +
      '</div>' +
    '</div>' +

    '<label class="s-rule-label" style="margin:8px 0;display:block">' +
      '<input class="s-checkbox loc-hidden-toggle" type="checkbox" data-li="' + li + '"' + (loc.hidden ? " checked" : "") + '> ' +
      'Hidden from main list' +
    '</label>' +

    '<h4 class="s-subsection-title">Rules</h4>' +

    '<div class="s-rule-row' + (maxDur ? " enabled" : "") + '" data-rule="maxChargeDuration">' +
      '<label class="s-rule-label">' +
        '<input class="s-checkbox rule-toggle" type="checkbox"' + (maxDur ? " checked" : "") + '> ' +
        'Max charge duration' +
      '</label>' +
      '<div class="s-rule-inputs">' +
        '<input class="s-input s-input-narrow" type="number" data-fid="loc-' + li + '-maxDuration-hours"' +
          ' value="' + esc(maxDur ? maxDur.hours : 4) + '" min="0.5" step="0.5" placeholder="hrs">' +
        '<span class="s-unit">h</span>' +
        '<span class="s-error" data-err="loc-' + li + '-maxDuration-hours"></span>' +
      '</div>' +
    '</div>' +

    '<div class="s-rule-subrow' + (freeChg ? " enabled" : "") + '" data-rule="freeCharging">' +
      '<label class="s-rule-label">' +
        '<input class="s-checkbox rule-toggle" type="checkbox"' + (freeChg ? " checked" : "") + '> ' +
        'No limit during:' +
      '</label>' +
      '<div class="s-rule-inputs">' +
        '<input class="s-input s-input-time" type="time" data-fid="loc-' + li + '-freeStart"' +
          ' value="' + esc(freeChg ? freeChg.start : "22:00") + '">' +
        '<span class="s-unit">to</span>' +
        '<input class="s-input s-input-time" type="time" data-fid="loc-' + li + '-freeEnd"' +
          ' value="' + esc(freeChg ? freeChg.end : "08:00") + '">' +
        '<span class="s-error" data-err="loc-' + li + '-freeCharging"></span>' +
      '</div>' +
    '</div>' +

    '<div class="s-rule-row' + (notCharging ? " enabled" : "") + '" data-rule="mustLeaveWhenNotCharging">' +
      '<label class="s-rule-label">' +
        '<input class="s-checkbox rule-toggle" type="checkbox"' + (notCharging ? " checked" : "") + '> ' +
        'Must leave when not charging' +
      '</label>' +
      notChargingCapWarning +
    '</div>';

  var rightCol =
    '<span class="s-error" data-err="loc-' + li + '-connectors"></span>' +
    buildConnectors(loc, li);

  var total = state.locations.length;
  return '<div class="s-card loc-card" data-li="' + li + '">' +
    '<div class="s-card-header">' +
      '<h3 class="s-card-title">Location ' + (li + 1) + '</h3>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<button class="btn btn-ghost btn-icon move-up-btn" data-li="' + li + '" ' + (li === 0 ? 'disabled' : '') + '>↑</button>' +
        '<button class="btn btn-ghost btn-icon move-down-btn" data-li="' + li + '" ' + (li === total - 1 ? 'disabled' : '') + '>↓</button>' +
        '<button class="btn btn-danger remove-loc-btn" data-li="' + li + '">Remove</button>' +
      '</div>' +
    '</div>' +
    '<div class="loc-columns">' +
      '<div class="loc-col-settings">' + leftCol + '</div>' +
      '<div class="loc-col-connectors">' +
        '<h4 class="s-subsection-title" style="margin-top:0">Connectors</h4>' +
        rightCol +
      '</div>' +
    '</div>' +
  '</div>';
}

function buildConnectors(loc, li) {
  return loc.connectors.map(function(conn, ci) {
    return buildConnector(conn, li, ci);
  }).join("");
}

function buildConnector(conn, li, ci) {
  return '<div class="s-conn-row conn-row" data-li="' + li + '" data-ci="' + ci + '">' +
    '<div class="s-field">' +
      '<label class="s-label">Connector ID</label>' +
      input("loc-" + li + "-conn-" + ci + "-id", conn.id, { placeholder: "e.g. 114172", readonly: true }) +
      '<span class="s-error" data-err="loc-' + li + '-conn-' + ci + '-id"></span>' +
    '</div>' +
    '<div class="s-field">' +
      '<label class="s-label">Display name</label>' +
      input("loc-" + li + "-conn-" + ci + "-name", conn.displayName, { placeholder: "e.g. Charger 1 plug B" }) +
      '<span class="s-error" data-err="loc-' + li + '-conn-' + ci + '-name"></span>' +
    '</div>' +
    '<button class="btn btn-danger btn-icon remove-conn-btn" data-li="' + li + '" data-ci="' + ci + '">×</button>' +
  '</div>';
}

function systemThemeHint() {
  if (typeof window.matchMedia !== "function") return "System theme: not supported by this browser";
  if (window.matchMedia("(prefers-color-scheme: dark)").matches)  return "System theme: dark";
  if (window.matchMedia("(prefers-color-scheme: light)").matches) return "System theme: light";
  return "System theme: no preference reported";
}

// ── Events ────────────────────────────────────────────────────────────────

function bindFormEvents() {
  document.querySelectorAll(".s-segmented").forEach(function(group) {
    group.querySelectorAll(".s-segment").forEach(function(btn) {
      btn.addEventListener("click", function() {
        group.querySelectorAll(".s-segment").forEach(function(b) { b.classList.remove("active"); });
        btn.classList.add("active");
        group.dataset.value = btn.dataset.value;

        if (group.id === "g-theme") {
          state.theme = btn.dataset.value;
          document.body.setAttribute("data-theme", btn.dataset.value);
        } else if (group.id === "g-handedness") {
          state.handedness = btn.dataset.value;
          document.body.classList.toggle("left-handed", btn.dataset.value === "left");
        } else if (group.id === "g-location-order") {
          collectIntoState();
          state.locationOrder = btn.dataset.value;
          render();
        }
      });
    });
  });

  if (typeof window.matchMedia === "function") {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function() {
      var hint = document.getElementById("system-theme-hint");
      if (hint) hint.textContent = systemThemeHint();
    });
  }

  document.getElementById("add-loc-btn").addEventListener("click", function() {
    collectIntoState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.location.href = "discover.html";
  });

  document.querySelectorAll(".remove-loc-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var li = +this.dataset.li;
      collectIntoState();
      state.locations.splice(li, 1);
      render();
    });
  });

  document.querySelectorAll(".move-up-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var li = +this.dataset.li;
      if (li === 0) return;
      collectIntoState();
      var tmp = state.locations[li - 1];
      state.locations[li - 1] = state.locations[li];
      state.locations[li] = tmp;
      render();
    });
  });

  document.querySelectorAll(".move-down-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var li = +this.dataset.li;
      if (li >= state.locations.length - 1) return;
      collectIntoState();
      var tmp = state.locations[li + 1];
      state.locations[li + 1] = state.locations[li];
      state.locations[li] = tmp;
      render();
    });
  });

  document.querySelectorAll(".remove-conn-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var li = +this.dataset.li;
      var ci = +this.dataset.ci;
      collectIntoState();
      state.locations[li].connectors.splice(ci, 1);
      render();
    });
  });

  document.querySelectorAll(".rule-toggle").forEach(function(cb) {
    cb.addEventListener("change", function() {
      var row = this.closest(".s-rule-row") || this.closest(".s-rule-subrow");
      row.classList.toggle("enabled", this.checked);
    });
  });
}

// ── Collect form → state ──────────────────────────────────────────────────

function collectIntoState() {
  var themeEl = document.getElementById("g-theme");
  if (themeEl) state.theme = themeEl.dataset.value;
  var handEl = document.getElementById("g-handedness");
  if (handEl) state.handedness = handEl.dataset.value;
  var orderEl = document.getElementById("g-location-order");
  if (orderEl) state.locationOrder = orderEl.dataset.value;
  var maxDistEl = document.querySelector('[data-fid="g-max-distance"]');
  if (maxDistEl) {
    var maxDist = parseFloat(maxDistEl.value);
    state.maxDistanceKm = maxDistEl.value.trim() && !isNaN(maxDist) ? maxDist : null;
  }

  document.querySelectorAll(".loc-card").forEach(function(card) {
    var li = +card.dataset.li;
    var loc = state.locations[li];
    if (!loc) return;

    loc.displayName = card.querySelector('[data-fid="loc-' + li + '-displayName"]').value;
    loc.cpo = card.querySelector('[data-fid="loc-' + li + '-cpo"]').value;
    loc.id = card.querySelector('[data-fid="loc-' + li + '-id"]').value;
    var latVal = card.querySelector('[data-fid="loc-' + li + '-lat"]').value;
    var lonVal = card.querySelector('[data-fid="loc-' + li + '-lon"]').value;
    loc.lat = latVal.trim() !== "" && !isNaN(parseFloat(latVal)) ? parseFloat(latVal) : null;
    loc.lon = lonVal.trim() !== "" && !isNaN(parseFloat(lonVal)) ? parseFloat(lonVal) : null;
    loc.hidden = card.querySelector(".loc-hidden-toggle").checked;

    var rules = {};

    var maxDurRow = card.querySelector('.s-rule-row[data-rule="maxChargeDuration"]');
    if (maxDurRow && maxDurRow.classList.contains("enabled")) {
      var h = parseFloat(card.querySelector('[data-fid="loc-' + li + '-maxDuration-hours"]').value);
      rules.maxChargeDuration = { hours: isNaN(h) ? 0 : h };
    }
    var freeChgRow = card.querySelector('.s-rule-subrow[data-rule="freeCharging"]');
    if (freeChgRow && freeChgRow.classList.contains("enabled")) {
      rules.freeCharging = {
        start: card.querySelector('[data-fid="loc-' + li + '-freeStart"]').value || "22:00",
        end:   card.querySelector('[data-fid="loc-' + li + '-freeEnd"]').value || "08:00"
      };
    }
    var notChargingRow = card.querySelector('.s-rule-row[data-rule="mustLeaveWhenNotCharging"]');
    if (notChargingRow && notChargingRow.classList.contains("enabled")) {
      rules.mustLeaveWhenNotCharging = true;
    }
    loc.rules = Object.keys(rules).length > 0 ? rules : null;

    loc.connectors = [];
    card.querySelectorAll(".conn-row").forEach(function(row, ci) {
      loc.connectors.push({
        id:          card.querySelector('[data-fid="loc-' + li + '-conn-' + ci + '-id"]').value,
        displayName: card.querySelector('[data-fid="loc-' + li + '-conn-' + ci + '-name"]').value
      });
    });
  });
}

// ── Validation ────────────────────────────────────────────────────────────

function validate(cfg) {
  var errors = {};

  if (cfg.locations.length === 0) {
    errors["no-locations"] = "At least one location is required";
    return errors;
  }

  cfg.locations.forEach(function(loc, li) {
    if (!loc.displayName.trim())
      errors["loc-" + li + "-displayName"] = "Required";
    if (!loc.id.trim())
      errors["loc-" + li + "-id"] = "Required";

    if (loc.connectors.length === 0)
      errors["loc-" + li + "-connectors"] = "At least one connector required";

    loc.connectors.forEach(function(conn, ci) {
      if (!conn.id.trim())
        errors["loc-" + li + "-conn-" + ci + "-id"] = "Required";
      if (!conn.displayName.trim())
        errors["loc-" + li + "-conn-" + ci + "-name"] = "Required";
    });

    if (loc.rules) {
      if (loc.rules.maxChargeDuration) {
        var h = loc.rules.maxChargeDuration.hours;
        if (!h || h <= 0)
          errors["loc-" + li + "-maxDuration-hours"] = "Must be greater than 0";
      }
      if (loc.rules.freeCharging) {
        var timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
        var s = loc.rules.freeCharging.start;
        var e = loc.rules.freeCharging.end;
        if (!timeRe.test(s) || !timeRe.test(e))
          errors["loc-" + li + "-freeCharging"] = "Enter valid times (HH:MM)";
        else if (s === e)
          errors["loc-" + li + "-freeCharging"] = "Start and end must differ";
      }
    }
  });

  return errors;
}

function showErrors(errors) {
  Object.keys(errors).forEach(function(key) {
    var errEl = document.querySelector('[data-err="' + key + '"]');
    if (errEl) errEl.textContent = errors[key];
    var fieldEl = document.querySelector('[data-fid="' + key + '"]');
    if (fieldEl) fieldEl.classList.add("field-error");
  });

  var first = document.querySelector(".s-error:not(:empty)");
  if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearErrors() {
  document.querySelectorAll(".s-error").forEach(function(el) { el.textContent = ""; });
  document.querySelectorAll(".field-error").forEach(function(el) { el.classList.remove("field-error"); });
}

// ── Save / reset ──────────────────────────────────────────────────────────

function save() {
  collectIntoState();
  clearErrors();
  var errors = validate(state);
  if (Object.keys(errors).length > 0) {
    showErrors(errors);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.location.href = "index.html";
}

function resetToDefaults() {
  if (!confirm("Reset all settings to the built-in defaults from config.js?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = defaultConfig();
  render();
}

document.addEventListener("DOMContentLoaded", init);

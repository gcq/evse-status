var state = null;

function swapInPlace(arr, i, j) {
  var t = arr[i];
  arr[i] = arr[j];
  arr[j] = t;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

function init() {
  state = loadConfig();
  render();
  document.getElementById("save-btn").addEventListener("click", save);
  document.getElementById("reset-btn").addEventListener("click", resetToDefaults);
}

function loadConfig() {
  return getConfig() || defaultConfig();
}

// ── HTML helpers ──────────────────────────────────────────────────────────

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
    (opts.disabled ? ' disabled' : '') +
    '>';
}

function staticField(label, value, opts) {
  opts = opts || {};
  return '<div class="s-static">' +
    '<div class="s-static-row">' +
      '<span class="s-static-label">' + label + '</span>' +
      '<span class="s-static-value">' + esc(value) + '</span>' +
    '</div>' +
    (opts.hint ? '<span class="s-hint">' + esc(opts.hint) + '</span>' : '') +
    (opts.errId ? '<span class="s-error" data-err="' + opts.errId + '"></span>' : '') +
  '</div>';
}

function cpoLabel(cpo) {
  return cpo ? cpo.charAt(0).toUpperCase() + cpo.slice(1) : "";
}

function hasCapability(cpo, cap) {
  var adapter = window.ADAPTERS && window.ADAPTERS[cpo];
  return adapter && adapter.capabilities && adapter.capabilities.indexOf(cap) >= 0;
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  document.body.classList.toggle("left-handed", state.handedness === "left");
  document.body.setAttribute("data-theme", state.theme || "auto");
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
          { value: "left",  label: "Left" },
          { value: "right", label: "Right" }
        ], state.handedness || "right") +
        '<span class="s-hint">Controls move to the opposite side, near your hand</span>' +
      '</div>' +
      '<div class="s-field">' +
        '<label class="s-label">Location order</label>' +
        segmentedControl("g-location-order", [
          { value: "config",   label: "Manual" },
          { value: "distance", label: "Distance" }
        ], state.locationOrder || "config") +
        '<span class="s-hint">Distance mode uses your live location to sort</span>' +
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
  var supportsNotCharging = hasCapability(loc.cpo, "CONNECTED_NOT_CHARGING");

  var coords = (loc.lat != null && loc.lon != null) ? (loc.lat.toFixed(5) + ", " + loc.lon.toFixed(5)) : "—";

  var leftCol =
    '<div class="s-field-row">' +
      '<div class="s-field s-field-inline">' +
        '<div class="s-field-inline-row">' +
          '<label class="s-label">Name</label>' +
          input("loc-" + li + "-displayName", loc.displayName, { placeholder: "e.g. Moli" }) +
        '</div>' +
        '<span class="s-error" data-err="loc-' + li + '-displayName"></span>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-icon loc-hidden-toggle-btn' + (loc.hidden ? " active" : "") + '" data-li="' + li + '" title="' + (loc.hidden ? "Show on main list" : "Hide from main list") + '">' +
        (loc.hidden ? ICONS.eyeOff : ICONS.eye) +
      '</button>' +
    '</div>' +

    '<div class="s-field-row">' +
      staticField("CPO", cpoLabel(loc.cpo)) +
      staticField("Location ID", loc.id, { hint: mergedChargerHint(loc) }) +
      staticField("Coordinates", coords) +
    '</div>' +

    '<h4 class="s-subsection-title">Rules</h4>' +

    '<div class="s-rules">' +

    '<div class="s-rule-row' + (maxDur ? " enabled" : "") + '" data-rule="maxChargeDuration">' +
      '<label class="s-rule-label">' +
        '<input class="s-checkbox rule-toggle" type="checkbox"' + (maxDur ? " checked" : "") + '> ' +
        'Max charge duration' +
      '</label>' +
      '<div class="s-rule-inputs">' +
        '<input class="s-input s-input-narrow" type="number" data-fid="loc-' + li + '-maxDuration-hours"' +
          ' value="' + esc(maxDur ? maxDur.hours : 4) + '" min="0.5" step="0.5" placeholder="hrs"' + (maxDur ? "" : " disabled") + '>' +
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
          ' value="' + esc(freeChg ? freeChg.start : "22:00") + '"' + (freeChg ? "" : " disabled") + '>' +
        '<span class="s-unit">to</span>' +
        '<input class="s-input s-input-time" type="time" data-fid="loc-' + li + '-freeEnd"' +
          ' value="' + esc(freeChg ? freeChg.end : "08:00") + '"' + (freeChg ? "" : " disabled") + '>' +
        '<span class="s-error" data-err="loc-' + li + '-freeCharging"></span>' +
      '</div>' +
    '</div>' +

    (supportsNotCharging ?
      '<div class="s-rule-row' + (notCharging ? " enabled" : "") + '" data-rule="mustLeaveWhenNotCharging">' +
        '<label class="s-rule-label">' +
          '<input class="s-checkbox rule-toggle" type="checkbox"' + (notCharging ? " checked" : "") + '> ' +
          'Must leave when not charging' +
        '</label>' +
      '</div>'
    : "") +

    '</div>';

  var rightCol =
    buildConnectors(loc, li) +
    '<span class="s-error" data-err="loc-' + li + '-connectors"></span>';

  var total = state.locations.length;
  var footer =
    '<div class="s-card-footer">' +
      '<button class="btn btn-ghost btn-icon move-up-btn" data-li="' + li + '" ' + (li === 0 ? 'disabled' : '') + '>↑</button>' +
      '<button class="btn btn-ghost btn-icon move-down-btn" data-li="' + li + '" ' + (li === total - 1 ? 'disabled' : '') + '>↓</button>' +
      '<button class="btn btn-danger remove-loc-btn" data-li="' + li + '">Remove</button>' +
    '</div>';

  return '<div class="s-card loc-card" data-li="' + li + '">' +
    '<div class="loc-columns">' +
      '<div class="loc-col-settings">' + leftCol + '</div>' +
      '<div class="loc-col-connectors">' +
        '<h4 class="s-subsection-title" style="margin-top:0">Connectors</h4>' +
        rightCol +
        footer +
      '</div>' +
    '</div>' +
  '</div>';
}

function buildConnectors(loc, li) {
  var total = loc.connectors.length;
  return loc.connectors.map(function(conn, ci) {
    return buildConnector(conn, li, ci, total);
  }).join("");
}

function buildConnector(conn, li, ci, total) {
  var chargerBadge = conn.chargerId ? " (charger " + esc(conn.chargerId) + ")" : "";
  return '<div class="s-conn-row conn-row" data-li="' + li + '" data-ci="' + ci + '">' +
    staticField("ID" + chargerBadge, conn.id) +
    '<div class="s-field s-field-inline">' +
      '<div class="s-field-inline-row">' +
        '<label class="s-label">Name</label>' +
        input("loc-" + li + "-conn-" + ci + "-name", conn.displayName, { placeholder: "e.g. Charger 1 plug B" }) +
      '</div>' +
      '<span class="s-error" data-err="loc-' + li + '-conn-' + ci + '-name"></span>' +
    '</div>' +
    '<div class="s-conn-move">' +
      '<button type="button" class="btn btn-ghost btn-icon move-conn-up-btn" data-li="' + li + '" data-ci="' + ci + '" ' + (ci === 0 ? "disabled" : "") + '>↑</button>' +
      '<button type="button" class="btn btn-ghost btn-icon move-conn-down-btn" data-li="' + li + '" data-ci="' + ci + '" ' + (ci === total - 1 ? "disabled" : "") + '>↓</button>' +
    '</div>' +
    '<button class="btn btn-danger btn-icon remove-conn-btn" data-li="' + li + '" data-ci="' + ci + '">×</button>' +
  '</div>';
}

// Derived on the fly rather than stored (see MODEL(hierarchy) note in
// config.js), so it can never drift out of sync with the connectors array —
// e.g. removing a sibling's connectors here automatically "unmerges" it.
function mergedChargerIds(loc) {
  var extra = {};
  loc.connectors.forEach(function(c) {
    if (c.chargerId && c.chargerId !== loc.id) extra[c.chargerId] = true;
  });
  return Object.keys(extra);
}

function mergedChargerHint(loc) {
  var extraIds = mergedChargerIds(loc);
  if (extraIds.length === 0) return undefined;
  return "Also covers charger" + (extraIds.length > 1 ? "s" : "") + " " + extraIds.join(", ");
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
    setConfig(state);
    window.location.href = "discover.html";
  });

  document.querySelectorAll(".loc-hidden-toggle-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var li = +this.dataset.li;
      collectIntoState();
      state.locations[li].hidden = !state.locations[li].hidden;
      render();
    });
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
      swapInPlace(state.locations, li - 1, li);
      render();
    });
  });

  document.querySelectorAll(".move-down-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var li = +this.dataset.li;
      if (li >= state.locations.length - 1) return;
      collectIntoState();
      swapInPlace(state.locations, li, li + 1);
      render();
    });
  });

  document.querySelectorAll(".move-conn-up-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var li = +this.dataset.li;
      var ci = +this.dataset.ci;
      if (ci === 0) return;
      collectIntoState();
      swapInPlace(state.locations[li].connectors, ci - 1, ci);
      render();
    });
  });

  document.querySelectorAll(".move-conn-down-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var li = +this.dataset.li;
      var ci = +this.dataset.ci;
      collectIntoState();
      var conns = state.locations[li].connectors;
      if (ci >= conns.length - 1) return;
      swapInPlace(conns, ci, ci + 1);
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
      row.querySelectorAll(".s-rule-inputs .s-input").forEach(function(input) {
        input.disabled = !cb.checked;
      });
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
    // cpo, id, lat, lon, hidden are read-only here (no form field) — loc
    // already holds the correct values since it's the same object reference
    // as state.locations[li]; hidden is toggled directly by its button.

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

    // Snapshot before resetting — loc IS state.locations[li] (same
    // reference), so `loc.connectors = []` below would otherwise wipe out
    // id/chargerId before we get a chance to carry them forward. Neither is
    // user-editable (no form field for either), so this is the only way to
    // preserve them through a save.
    var prevConnectors = loc.connectors || [];
    loc.connectors = [];
    card.querySelectorAll(".conn-row").forEach(function(row, ci) {
      var newConn = {
        id:          prevConnectors[ci] ? prevConnectors[ci].id : "",
        displayName: card.querySelector('[data-fid="loc-' + li + '-conn-' + ci + '-name"]').value
      };
      if (prevConnectors[ci] && prevConnectors[ci].chargerId) newConn.chargerId = prevConnectors[ci].chargerId;
      loc.connectors.push(newConn);
    });
  });
}

// ── Validation ────────────────────────────────────────────────────────────

function validate(cfg) {
  var errors = {};

  if (cfg.maxDistanceKm != null && cfg.maxDistanceKm < 0)
    errors["g-max-distance"] = "Must be 0 or greater";

  if (cfg.locations.length === 0) {
    errors["no-locations"] = "At least one location is required";
    return errors;
  }

  cfg.locations.forEach(function(loc, li) {
    if (!loc.displayName.trim())
      errors["loc-" + li + "-displayName"] = "Required";

    if (loc.connectors.length === 0)
      errors["loc-" + li + "-connectors"] = "At least one connector required";

    loc.connectors.forEach(function(conn, ci) {
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
  setConfig(state);
  window.location.href = "index.html";
}

function resetToDefaults() {
  if (!confirm("Reset all settings to the built-in defaults from config.js?")) return;
  localStorage.removeItem(CONFIG_STORAGE_KEY);
  state = defaultConfig();
  render();
}

document.addEventListener("DOMContentLoaded", init);

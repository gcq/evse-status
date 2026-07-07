// MODEL(hierarchy): the real-world model is Location (site) -> Charger/
// ChargePoint (one physical cabinet, e.g. evcharge's id_charger) -> Connector
// (one physical plug). A `Location` config entry's `id` is really a Charger
// id, not a true Location/site id — an entry only spans multiple chargers
// when some of its connectors carry a `chargerId` that differs from `id`
// (set by discover.js's pinSelected() when merging chargers at one evcharge
// site; app.js's fetchLocation() and settings.js's mergedChargerIds() both
// derive the grouping from that field rather than storing it separately).
// This app still doesn't model a distinct EVSE level — a ChargePoint can
// house any number of EVSEs and any number of connectors independently of
// each other, but everything under a Charger here is a flat connector list.
// Electromaps exposes no multi-charger-per-site signal, so its locations
// stay 1:1 with chargers; only evcharge groups.

// "right" = right-handed (controls on LEFT, near right thumb) | "left" = left-handed (controls on RIGHT, near left thumb)
var HANDEDNESS = "right";

// Shared across app.js/discover.js/settings.js so labels and CSS classes for
// a given CPO status never drift out of sync between views.
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

// Layers translation (via l10n.js's t(), used by app.js and discover.js) on
// top of the English STATUS_LABELS map above, falling back to English if a
// status code has no message (e.g. a status this app hasn't seen yet).
var STATUS_MESSAGE_IDS = {
  AVAILABLE:              "status-available",
  PREPARING:              "status-preparing",
  OCCUPIED:               "status-occupied",
  CONNECTED_NOT_CHARGING: "status-connected",
  FINISHING:              "status-finishing",
  RESERVED:               "status-reserved",
  OUT_OF_SERVICE:         "status-out-of-service",
  WORKING:                "status-working",
  UNKNOWN:                "status-unknown"
};

function statusLabelFor(code) {
  var id = STATUS_MESSAGE_IDS[code];
  if (!id) return STATUS_LABELS[code] || code;
  var label = t(id);
  return label !== id ? label : (STATUS_LABELS[code] || code);
}

var LOCATIONS = [
  {
    id: "42479",
    cpo: "electromaps",
    displayName: "Moli",
    rules: {
      maxChargeDuration: { hours: 4 }
    },
    connectors: [
      { id: "114172", displayName: "Charger 1 plug B" },
      { id: "114174", displayName: "Charger 2 plug B" }
    ]
  }
];

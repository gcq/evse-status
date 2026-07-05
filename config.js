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

var ADAPTERS = window.ADAPTERS || {};

ADAPTERS.evcharge = {
  capabilities: ["CONNECTED_NOT_CHARGING", "SEARCH_NEARBY", "CHARGE_START_TIME"],

  BASE_URL: "https://etecnic.net",
  GUEST_TOKEN: "bb4b5e862ff44ccdb6652c77c5a24c35",
  HEADERS: {
    "Authorization": 'Token token="09c3b1d5e4604b56917e3ff16f10142d"',
    "APP-ETECNIC": "EvCharge_Etecnic",
    "APP-CODE": "ETECNIC",
    "APP-DOMAIN": "5",
    "API-VERSION": "5"
  },

  // From APK source: socketStatus[id_status] maps these values.
  // id_status is the reliable field; runtime_status strings vary by charger type.
  ID_STATUS_MAP: {
    "0": "AVAILABLE",
    "1": "OCCUPIED",
    "2": "WORKING",   // Reserved
    "3": "OUT_OF_SERVICE",
    "9": "OUT_OF_SERVICE"
  },

  // runtime_status strings confirmed from live API (take priority over id_status).
  // "Suspended EV" (with space, runtime_status_id=23): car plugged in but BMS paused session.
  RUNTIME_STATUS_MAP: {
    "Available":      "AVAILABLE",
    "Preparing":      "PREPARING",
    "Charging":       "OCCUPIED",
    "Suspended EV":   "CONNECTED_NOT_CHARGING",
    "Suspended EVSE": "CONNECTED_NOT_CHARGING",
    "Finishing":      "FINISHING",
    "Reserved":       "RESERVED",
    "Out of service": "OUT_OF_SERVICE",
    "Faulted":        "OUT_OF_SERVICE",
    "Unavailable":    "OUT_OF_SERVICE",
    "Error":          "OUT_OF_SERVICE"
  },

  CONNECTOR_TYPE_MAP: {
    "CCS":       "IEC_62196_T2_COMBO",
    "CHADEMO":   "CHADEMO",
    "TYPE-2-F":  "IEC_62196_T2",
    "SCHUKO":    "DOMESTIC_E"
  },

  async searchNearby(lat, lon, bounds) {
    var url = this.BASE_URL + "/api/v1/etecnic/charger/list_map" +
      "?token_user=" + this.GUEST_TOKEN +
      "&lat=" + lat + "&lon=" + lon;
    var resp = await fetch(url, { headers: this.HEADERS });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var data = await resp.json();
    if (data && data.error_code) throw new Error("EVcharge error: " + data.status_message);
    var items = Array.isArray(data) ? data : (data.chargers || []);
    return items
      .filter(function(ch) {
        return ch.id_charger && ch.location_latitude && ch.location_longitude;
      })
      .map(function(ch) {
        var cLat = parseFloat(ch.location_latitude);
        var cLon = parseFloat(ch.location_longitude);
        var dist = ch.distance != null ? ch.distance * 1000 : haversineM(lat, lon, cLat, cLon);
        return {
          id: String(ch.id_charger),
          cpoKey: "evcharge",
          name: ch.name || ("Charger " + ch.id_charger),
          address: null,
          lat: cLat,
          lon: cLon,
          distanceM: dist
        };
      })
      .filter(function(s) {
        if (bounds) {
          return s.lat >= bounds.latSW && s.lat <= bounds.latNE &&
                 s.lon >= bounds.lngSW && s.lon <= bounds.lngNE;
        }
        return s.distanceM <= 5000;
      });
  },

  async fetchSocketTiming(chargerId, socketNumber) {
    var url = this.BASE_URL + "/api/v1/etecnic/socket/status" +
      "?idcharger=" + chargerId + "&socket=" + socketNumber +
      "&token_user=" + this.GUEST_TOKEN;
    try {
      var resp = await fetch(url, { headers: this.HEADERS });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      return null;
    }
  },

  async fetchLocation(locationId, connectorIds) {
    var url = this.BASE_URL + "/api/v1/etecnic/charger/show/" + locationId +
              "?new_api=true&token_user=" + this.GUEST_TOKEN;
    var resp = await fetch(url, { headers: this.HEADERS });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var data = await resp.json();
    if (data.error_code) throw new Error("EVcharge error " + data.error_code + ": " + data.status_message);

    var wanted = connectorIds && connectorIds.length ? new Set(connectorIds.map(String)) : null;
    var self = this;

    var sockets = data.charger_sockets
      .filter(function(s) { return !wanted || wanted.has(String(s.id_socket)); });

    // Fetch timing in parallel for charging sockets only
    var timingPromises = sockets.map(function(s) {
      return String(s.id_status) === "1"
        ? self.fetchSocketTiming(data.id_charger, s.socket_number)
        : Promise.resolve(null);
    });
    var timings = await Promise.all(timingPromises);

    return {
      id: String(data.id_charger),
      name: data.name,
      address: [data.address, data.city].filter(Boolean).join(", ") || null,
      cpo: "EVcharge",
      realtime: true,
      updatedAt: null,
      connectors: sockets.map(function(s, i) {
        var timing = timings[i];
        var mins = timing ? parseInt(timing.last_charge_time_minutes) : 0;
        var statusUpdatedAt = (mins > 0)
          ? new Date(Date.now() - mins * 60000).toISOString()
          : null;
        var mappedStatus = self.RUNTIME_STATUS_MAP[s.runtime_status] ||
                           self.ID_STATUS_MAP[String(s.id_status)] ||
                           null;
        var energyWh = timing ? parseInt(timing.last_charge_energy_Wh) : 0;
        var userName = timing ? (timing.last_charge_user_name || "").trim() : "";
        return {
          id: String(s.id_socket),
          type: self.CONNECTOR_TYPE_MAP[s.connector_type_code] || s.connector_type_code,
          kw: parseFloat(s.max_electric_power) || null,
          status: mappedStatus || "UNKNOWN",
          rawStatus: mappedStatus ? null : (s.runtime_status || String(s.id_status)),
          realtime: true,
          statusUpdatedAt: statusUpdatedAt,
          sessionMinutes: mins > 0 ? mins : null,
          sessionEnergyWh: energyWh > 0 ? energyWh : null,
          sessionUserName: userName || null,
          visualRef: "Socket " + s.socket_number
        };
      })
    };
  }
};

window.ADAPTERS = ADAPTERS;

function haversineM(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
  var dphi = (lat2 - lat1) * Math.PI / 180;
  var dlam = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dphi / 2) * Math.sin(dphi / 2) +
          Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) * Math.sin(dlam / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

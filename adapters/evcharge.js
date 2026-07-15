var ADAPTERS = window.ADAPTERS || {};

ADAPTERS.evcharge = {
  capabilities: ["CONNECTED_NOT_CHARGING", "SEARCH_NEARBY", "CHARGE_START_TIME", "REMOTE_START"],

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
          distanceM: dist,
          // Exact match across every charger/ChargePoint at the same physical
          // site (confirmed live: e.g. id_charger 10511 & 10512 share this
          // pair) — from the RAW strings, not the parsed cLat/cLon above, so
          // equality is exact rather than incidentally relying on parseFloat
          // determinism. Lets discover.js group multiple chargers into one
          // Location card. See MODEL(hierarchy) note in config.js.
          //
          // TODO(hierarchy): this exact-string match misses real-world
          // duplicates when the provider itself never assigned a shared site
          // anchor — confirmed live with id_charger 5671 vs 2067, same
          // address/city/postal code (Sant Vicenç dels Horts, Carrer
          // Claverol 6) but different location_latitude/location_longitude
          // (41.38820545,2.00799539 vs 41.3881885,2.0079744 — ~2m apart) AND
          // different location_id (322433 vs 293923) — i.e. the provider's
          // own backend has two undeduplicated location records for one
          // physical site. A distance-tolerance match (e.g. merge under
          // ~5-10m) would catch this at the cost of some false-positive-merge
          // risk for genuinely distinct nearby chargers; not implemented.
          siteKey: ch.location_latitude + "," + ch.location_longitude
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

  // Mirrors the app's own free-connector path (payments/create-payment with
  // amount=0 — no Stripe confirmation step, see adapters/evcharge.md). Wired
  // to the Start button's click (app.js's startCharge()) — the only actual
  // guard against starting a paid connector is the isFree check in
  // app.js's renderConnector; whether evcharge's own backend also rejects
  // amount=0 against a non-free socket server-side is still unconfirmed.
  // `account` is { userId, cardCode, email } from settings.
  async startFreeCharge(account, socketId, chargingTime, chargingEnergy, priceTimeMin, priceEnergyKwh) {
    var params = new URLSearchParams();
    params.append("socketId", socketId);
    params.append("cardCode", account.cardCode);
    params.append("title", "AppPayment");
    params.append("currency", "EUR"); // unconfirmed — app reads this from utils.CURRENCY_CODE, not seen live
    params.append("paymentType", "STRIPE");
    params.append("paymentToken", "");
    params.append("paymentCapture", "false");
    params.append("chargingTime", chargingTime || "");
    params.append("chargingEnergy", chargingEnergy || "");
    params.append("priceTimeMin", priceTimeMin || "");
    params.append("priceEnergyKwh", priceEnergyKwh || "");
    params.append("amount", "0");
    params.append("stripeEmail", account.email);
    params.append("userId", account.userId);

    var url = this.BASE_URL + "/api/v1/etecnic/payments/create-payment?" + params.toString();
    var resp = await fetch(url, { method: "POST", headers: this.HEADERS });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var data = await resp.json();
    if (data.error_code) throw new Error("EVcharge error " + data.error_code + ": " + data.status_message);
    return data;
  },

  async fetchSocketTiming(chargerId, socketNumber, signal) {
    var url = this.BASE_URL + "/api/v1/etecnic/socket/status" +
      "?idcharger=" + chargerId + "&socket=" + socketNumber +
      "&token_user=" + this.GUEST_TOKEN;
    try {
      var resp = await fetch(url, { headers: this.HEADERS, signal: signal });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      // A timed-out signal should fail the whole location fetch (same as the
      // main request), not silently degrade to missing session timing —
      // everything else here (HTTP errors, network errors) stays swallowed.
      if (signal && signal.aborted) throw e;
      return null;
    }
  },

  async fetchLocation(locationId, connectorIds, signal) {
    var url = this.BASE_URL + "/api/v1/etecnic/charger/show/" + locationId +
              "?new_api=true&token_user=" + this.GUEST_TOKEN;
    var resp = await fetch(url, { headers: this.HEADERS, signal: signal });
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
        ? self.fetchSocketTiming(data.id_charger, s.socket_number, signal)
        : Promise.resolve(null);
    });
    var timings = await Promise.all(timingPromises);

    return {
      id: String(data.id_charger),
      name: data.name,
      address: [data.address, data.city].filter(Boolean).join(", ") || null,
      cpo: "EVcharge",
      lat: data.latitude != null ? parseFloat(data.latitude) : null,
      lon: data.longitude != null ? parseFloat(data.longitude) : null,
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
          visualRef: "Socket " + s.socket_number,
          // Empty rates == no charge rate configured on this socket == free to
          // use (confirmed live: charger 10511/socket 27834 vs. paid sockets
          // that carry a non-empty rates[] with a real €/kWh price_base).
          isFree: !s.rates || s.rates.length === 0
        };
      })
    };
  }
};

window.ADAPTERS = ADAPTERS;

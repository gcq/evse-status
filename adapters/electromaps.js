var ADAPTERS = window.ADAPTERS || {};

ADAPTERS.electromaps = {
  capabilities: ["CHARGE_START_TIME", "SEARCH_NEARBY"],
  BASE_URL: "https://www.electromaps.com/mapi/v2",

  async searchNearby(lat, lon, bounds) {
    var d = 0.018; // ~2 km fallback half-side when no bounds given
    var latNE = bounds ? bounds.latNE : lat + d;
    var lngNE = bounds ? bounds.lngNE : lon + d;
    var latSW = bounds ? bounds.latSW : lat - d;
    var lngSW = bounds ? bounds.lngSW : lon - d;
    var url = this.BASE_URL + "/locations?" +
      "latNE=" + latNE + "&lngNE=" + lngNE +
      "&latSW=" + latSW + "&lngSW=" + lngSW +
      "&realtime=true";
    var resp = await fetch(url);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var data = await resp.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(function(loc) {
        // double-check: skip any non-realtime that slipped through
        if (loc.marker && loc.marker.realtime === false) return false;
        return true;
      })
      .map(function(loc) {
      var locLat = parseFloat(loc.latitude);
      var locLon = parseFloat(loc.longitude);
      return {
        id: String(loc.id),
        cpoKey: "electromaps",
        name: loc.name || ("Station " + loc.id),
        address: loc.address || null,
        lat: locLat,
        lon: locLon,
        distanceM: haversineM(lat, lon, locLat, locLon)
      };
    });
  },

  async fetchLocation(locationId, connectorIds) {
    var resp = await fetch(this.BASE_URL + "/locations/" + locationId);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var data = await resp.json();

    var wanted = connectorIds && connectorIds.length ? new Set(connectorIds.map(String)) : null;
    return {
      id: String(data.id),
      name: data.name,
      address: data.address ? data.address.address : null,
      cpo: data.cpo ? data.cpo.name : "Electromaps",
      lat: data.latitude != null ? data.latitude : null,
      lon: data.longitude != null ? data.longitude : null,
      realtime: data.realtime,
      updatedAt: data.updated_at,
      connectors: data.connectors
        .filter(function(c) { return !wanted || wanted.has(String(c.id)); })
        .map(function(c) {
          return {
            id: String(c.id),
            type: c.type,
            kw: c.kw,
            status: c.status,
            realtime: c.realtime,
            statusUpdatedAt: c.status_updated_at,
            visualRef: c.visualRef
          };
        })
    };
  }
};

window.ADAPTERS = ADAPTERS;

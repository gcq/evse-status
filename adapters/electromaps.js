var ADAPTERS = window.ADAPTERS || {};

ADAPTERS.electromaps = {
  capabilities: ["CHARGE_START_TIME", "SEARCH_NEARBY", "REMOTE_START"],
  BASE_URL: "https://www.electromaps.com/mapi/v2",
  BASE_URL_V1: "https://www.electromaps.com/mapi/v1",

  // Cognito Hosted UI token endpoint + this app's public client ID (both
  // baked into the APK's prodamplifyconfiguration.json — see
  // adapters/electromaps.md's "Getting a token pair" section). No client
  // secret: same public mobile-client flow the app itself uses.
  TOKEN_URL: "https://idp.electromaps.com/oauth2/token",
  CLIENT_ID: "e2582mkf7dvklnd3d91mpfrr0",

  // In-memory access/id token cache, keyed by nothing (single account) —
  // refreshed lazily whenever a call needs auth and the cache is missing or
  // past its expiry. Never persisted: only the long-lived refreshToken is
  // stored in Settings (config.electromaps.refreshToken), same as evcharge's
  // account fields — see adapters/electromaps.md for how to obtain it.
  _tokenCache: null, // { accessToken, idToken, expiresAt } or null

  async _getTokens(refreshToken) {
    if (this._tokenCache && this._tokenCache.expiresAt > Date.now()) {
      return this._tokenCache;
    }
    var params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("client_id", this.CLIENT_ID);
    params.append("refresh_token", refreshToken);
    var resp = await fetch(this.TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error("Electromaps auth error: " + (data.error || resp.status));
    // expires_in is seconds-until-expiry from issuance; subtract a minute of
    // slack so a call started right before expiry doesn't race the server's
    // own clock.
    this._tokenCache = {
      accessToken: data.access_token,
      idToken: data.id_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000
    };
    return this._tokenCache;
  },

  async _authHeaders(refreshToken) {
    var tokens = await this._getTokens(refreshToken);
    return {
      "X-Em-Oidc-Data": tokens.idToken,
      "X-Em-Oidc-Accesstoken": tokens.accessToken,
      "App-Platform": "android"
    };
  },

  // GET mapi/v1/remote/start/{idtoma} — confirmed live in the Android app's
  // Retrofit interface (decompiled APK, see the "Remote-start investigation"
  // section in adapters/electromaps.md), not exposed anywhere on the web
  // app. `idtoma` is the connector id (electromaps' "toma" = socket/outlet).
  // `account` is { refreshToken } from settings.
  //
  // Unconfirmed whether the endpoint itself refuses to start a paid
  // connector server-side — the UI-level isFree/AVAILABLE/withinStartRange
  // gating in app.js's renderConnector is the only actual guard. Wired to
  // the Start button's click (app.js's startCharge()) despite that being
  // unconfirmed — same caution as evcharge's startFreeCharge().
  async startFreeCharge(account, connectorId) {
    var headers = await this._authHeaders(account.refreshToken);
    var resp = await fetch(this.BASE_URL_V1 + "/remote/start/" + connectorId, { headers: headers });
    var data = await resp.json();
    if (!resp.ok || data.error) throw new Error("Electromaps error: " + (data.error || resp.status));
    return data;
  },

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

  async fetchLocation(locationId, connectorIds, signal) {
    var resp = await fetch(this.BASE_URL + "/locations/" + locationId, { signal: signal });
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
            visualRef: c.visualRef,
            // "FREE" | "PAYMENT" per connector, confirmed live (see
            // adapters/electromaps.md) — mirrors evcharge's isFree flag.
            isFree: c.cost === "FREE"
          };
        })
    };
  }
};

window.ADAPTERS = ADAPTERS;

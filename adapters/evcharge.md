# EVcharge (Etecnic) API — Reverse-Engineered Reference

**Discovered by**: Static analysis of `EVcharge+2023_3.1.17_APKPure.xapk`  
**App package**: `com.etecnic.evcharge`  
**App type**: Ionic/Capacitor — entire app logic is readable JS in `assets/www/`  
**Date**: 2026-06-19

---

## How this was reverse-engineered

1. Unzipped the `.xapk` (it's a ZIP containing `com.etecnic.evcharge.apk` + split APKs)
2. Unzipped the base APK (also a ZIP) to get `assets/www/*.js`
3. Grepped for quoted strings containing `etecnic` to enumerate all endpoint paths
4. Found `initializeUrls()` in `main.cf2a4c4b7924be92.js` — assigns every URL constant
5. Confirmed live with `curl` — all endpoints responding at `etecnic.net`

**To re-run after an app update**:
```bash
unzip EVcharge.xapk -d xapk_contents
unzip xapk_contents/com.etecnic.evcharge.apk -d apk_contents
grep -roh '"[^"]*etecnic[^"]*"' apk_contents/assets/www/ --include="*.js" | sort -u
# Then find initializeUrls in main.*.js to extract all URL constants
```

---

## Base URL and auth

**Base URL**: `https://etecnic.net`  
**CORS**: `Access-Control-Allow-Origin: *` — browser-callable directly, no proxy needed  
**Confirmed live**: yes (2026-06-19)

### Required headers (all requests)
```
Authorization: Token token="09c3b1d5e4604b56917e3ff16f10142d"
APP-ETECNIC: EvCharge_Etecnic
APP-CODE: ETECNIC
APP-DOMAIN: 5
API-VERSION: 5
```

### Tokens
| Token | Value | Purpose |
|-------|-------|---------|
| App token | `09c3b1d5e4604b56917e3ff16f10142d` | Goes in `Authorization` header — all requests |
| Guest token | `bb4b5e862ff44ccdb6652c77c5a24c35` | Pass as `token_user=` query param — no login needed |
| User token | obtained via login endpoints | Replaces guest token for authenticated operations |

The app token is hardcoded in the JS bundle (`main.*.js`, search for `this.TOKEN=`).  
The guest token comes from `get_app_parameters` response (`token_api_guest` field).

---

## Bootstrap endpoint

Must be called first to get the real `host` and `protocol` (though both default to `etecnic.net` / `https`):

```
GET /api/v1/etecnic/get_app_parameters?app_code=ETECNIC
```

Response includes: `host`, `protocol`, `token_api`, `token_api_guest`, `domain_id`, `min_version`, `socket_status_available` (comma-separated `runtime_status_id` values that mean "available" — confirmed `"1,20"`), theme colors, S3 image URLs, and Firebase config.

---

## Public endpoints (app token only — no user login needed)

### `GET /api/v1/etecnic/charger/show/{id_charger}`

**The primary endpoint for the adapter.** Returns full charger detail including all sockets with their real-time statuses in a single call.

**Query params**:
| Param | Value | Notes |
|-------|-------|-------|
| `new_api` | `true` | Required |
| `token_user` | guest or user token | Required |
| `lat` | latitude | Optional, for distance calculation |
| `lon` | longitude | Optional, for distance calculation |

**Example**: `GET /api/v1/etecnic/charger/show/10504?new_api=true&token_user=bb4b5e862ff44ccdb6652c77c5a24c35`

**Response shape** (top-level fields relevant to the adapter):
```json
{
  "id_charger": "10504",
  "name": "AMB FL002 - CIRCUTOR EdRSR 2 (10504)",
  "domain_name": "AMB - FL002",
  "address": "Carrer Iglesias, 6",
  "city": "Sant Andreu de la Barca",
  "latitude": "41.4463102",
  "longitude": "1.9739711",
  "connection_status": true,
  "id_status": "1",
  "status": "Charging",
  "charger_type": "CIRCUTOR",
  "charger_sockets": [ ... ]
}
```

**Socket object** (inside `charger_sockets[]`):
```json
{
  "id_socket": "27832",
  "socket_number": "1",
  "connector_type_name": "Type-2 F",
  "connector_type_code": "TYPE-2-F",
  "max_electric_power": "22.0",
  "id_status": "1",
  "status": "Charging",
  "runtime_status_id": 23,
  "runtime_status": "Suspended EV",
  "socket_image": "assets/imgs/etecnic_app_icono_azul_04.png",
  "rates": [ ... ]
}
```

**Status values** (confirmed from live API sampling 2026-06-19):
| `id_status` | `runtime_status_id` | `runtime_status` | Adapter status | Meaning |
|-------------|---------------------|-----------------|----------------|---------|
| `0` (str) | `1` | `"Available"` | `AVAILABLE` | Free to use |
| `1` (str) | `21` | `"Charging"` | `OCCUPIED` | Car actively charging |
| `1` (str) | `23` | `"Suspended EV"` | `CONNECTED_NOT_CHARGING` | Car plugged in, BMS paused session |
| `2` (str) | `2` | `"Reserved"` | `WORKING` | Slot reserved |
| `3` (int or str) | `3` | `"Out of service"` | `OUT_OF_SERVICE` | Hardware fault / offline |
| `9` (str) | `9` | `"Error"` | `OUT_OF_SERVICE` | Unknown/error state |

**Critical notes on status parsing:**
- `id_status` can be an integer or a string depending on charger type — always coerce with `String()`.
- `runtime_status` is more granular than `id_status`: Charging and Suspended EV both have `id_status=1` but different `runtime_status`. **Always prefer `runtime_status`; fall back to `id_status`.**
- `"Suspended EV"` has a space — not camelCase. Confirmed from charger 10504.
- `"Out of service"` has a space — not camelCase.
- `runtime_status_id=20` exists (second available state from `socket_status_available: "1,20"`) but its `runtime_status` string is unconfirmed. Covered by `id_status` fallback.
- There is **no status-change timestamp** in `charger/show`. Use `socket/status` for session timing.
- `"SuspendedEV"` (no space) appears in `socket/status` as `runtime_status_name` — a different field with a different string. Do not confuse.

---

### `GET /api/v1/etecnic/socket/status`

Per-socket real-time session detail. Used to get session timing and user info for active charging sockets.

**Query params**: `idcharger={id_charger}&socket={socket_number}&token_user={guest}`  
Note: `socket` is `socket_number` (1, 2, 3…), **not** `id_socket`.

**When to call**: Only for sockets where `id_status === "1"` (actively charging or suspended). Returns `last_charge_time_minutes=0` for available sockets — there is **no "available since" timestamp** in this API.

**Response** (charger 10504, socket 1, Suspended EV state):
```json
{
  "socket_id": "27832",
  "charger_id": "10504",
  "socket_number": "1",
  "id_status": "1",
  "status": "Charging",
  "runtime_status_id": "23",
  "runtime_status_name": "SuspendedEV",
  "max_power": "22",
  "power": "22",
  "average_power_w": "3779",
  "runtime_power_w": "6790",
  "last_charge_user_code": "71A506FE",
  "last_charge_user_name": "Ricardo Jiménez Muñoz",
  "last_charge_time_minutes": "339",
  "last_charge_energy_Wh": "21358"
}
```

**Fields used by the adapter:**
| Field | Use |
|-------|-----|
| `last_charge_time_minutes` | Compute `statusUpdatedAt = Date.now() - minutes * 60000` |
| `last_charge_energy_Wh` | Show energy added in MUST LEAVE badge (`/ 1000` → kWh) |
| `last_charge_user_name` | Show user name in MUST LEAVE badge |

---

### `GET /api/v1/etecnic/charger/list_map`

Charger discovery. **Returns ALL ~1892 chargers globally** sorted by proximity — no server-side distance filter. Must filter client-side by map bounds or distance.

**Query params**: `token_user={guest}&lat={lat}&lon={lon}`

**Response** (wrapped in `{ chargers: [...] }`, not a plain array):
```json
{
  "chargers": [
    {
      "id_charger": 10869,
      "name": "Avinguda del Paral·lel, 55",
      "status": 0,
      "power_max_kW": 86.6,
      "location_latitude": "41.374791",
      "location_longitude": "2.171084",
      "distance": 0.54
    }
  ]
}
```

`distance` is in km and can be `null` — compute haversine client-side when null.  
`status` is `id_status` integer (0=Available, 1=Charging). Use `charger/show` for socket-level detail.

---

### `GET /api/v1/etecnic/charger/list_distance.json`

Full charger list with distance, sorted by proximity. Paginated.

**Query params**: `new_api=true&token_user={guest}&lat={lat}&lon={lon}&offset=0&limit=20`

Response includes `chargers[]` array and `limit_distance` (server-imposed max distance).

---

## Adapter capabilities

| Capability | Supported | Notes |
|------------|-----------|-------|
| `SEARCH_NEARBY` | ✅ | Via `list_map`, client-side filtered |
| `CHARGE_START_TIME` | ✅ | Via `socket/status` → `last_charge_time_minutes`, only for `id_status=1` sockets |
| `CONNECTED_NOT_CHARGING` | ✅ | Via `runtime_status="Suspended EV"` (confirmed from live API) |

---

## Connector type codes

| `connector_type_code` | `connector_type_name` | Normalized type |
|-----------------------|-----------------------|-----------------|
| `CCS` | CCS Combo (DC) | `IEC_62196_T2_COMBO` |
| `CHADEMO` | CHAdeMO (DC) | `CHADEMO` |
| `TYPE-2-F` | Type-2 F | `IEC_62196_T2` |
| `SCHUKO` | Schuko (EU Plug) | `DOMESTIC_E` |

---

## Finding charger and socket IDs

1. **By coordinates** — call `list_map` near your location to get `id_charger` values.
2. **By charger detail** — call `charger/show/{id_charger}` and read `charger_sockets[].id_socket` and `socket_number`.
3. **Use `socket_number` not `id_socket`** for `socket/status` calls (confirmed from live test).

```bash
curl -s "https://etecnic.net/api/v1/etecnic/charger/list_map?token_user=bb4b5e862ff44ccdb6652c77c5a24c35&lat=41.37&lon=2.17" \
  -H 'Authorization: Token token="09c3b1d5e4604b56917e3ff16f10142d"' \
  -H 'APP-ETECNIC: EvCharge_Etecnic' -H 'APP-CODE: ETECNIC' \
  -H 'APP-DOMAIN: 5' -H 'API-VERSION: 5' | python3 -m json.tool
```

---

## Auth-required endpoints (user token needed)

Not used by the adapter — listed for completeness.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/etecnic/users/create?` | Register |
| `GET` | `/api/v1/etecnic/users/check-authenticated?` | Email login |
| `GET` | `/api/v1/etecnic/users/check-authenticated_gmail?` | Google login |
| `GET` | `/api/v1/etecnic/users/check-authenticated_apple?` | Apple login |
| `POST` | `/api/v1/etecnic/socket/start?` | Start a charge session |
| `POST` | `/api/v1/etecnic/socket/stop?` | Stop a charge session |
| `GET` | `/api/v1/etecnic/socket/charges?` | Active charge session detail |

---

## Firebase

The app uses Firebase Realtime Database at `https://evcharge-dfa7d.firebaseio.com`. Likely for push notifications only — status is polled via the REST API.

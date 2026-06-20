# Electromaps API Reference

Reverse-engineered on 2026-06-19 via Playwright WebKit traffic interception and JS bundle analysis of `map.electromaps.com`.

## Base URLs

| Version | URL | Notes |
|---------|-----|-------|
| v2 | `https://www.electromaps.com/mapi/v2` | Main API, no auth required for read endpoints |
| v1 | `https://www.electromaps.com/mapi/v1` | Older API, used only for auth-required connector detail |

**CORS:** `Access-Control-Allow-Origin: *` — browser-callable directly, no proxy needed.

## Authentication

Auth-required endpoints use AWS Cognito JWT tokens via two headers:
- `X-Em-Oidc-Accesstoken`: access token
- `X-Em-Oidc-Data`: ID token

Cognito pool: `eu-west-1_H7LsQnxSb` (EU West 1 region)

## Public Endpoints (no auth)

### `GET /locations`

Search chargers in a bounding box. Used by the map to populate markers.

**Query parameters:**

| Param | Example | Notes |
|-------|---------|-------|
| `latNE` | `41.42` | Bounding box north-east latitude |
| `lngNE` | `2.20` | Bounding box north-east longitude |
| `latSW` | `41.36` | Bounding box south-west latitude |
| `lngSW` | `2.11` | Bounding box south-west longitude |
| `realtime` | `true` | Filter to chargers with live status data |
| `connectors` | `` | Connector type filter (empty = all) |
| `types` | `ON_STREET,PARKING,AIRPORT,CAMPING,HOTEL,RESTAURANT,SHOP,WORKSHOP,FUEL_STATION,CAR_DEALER,MALL,TAXI` | Location type filter |
| `power` | `3` | Minimum power |
| `app` | `false` | App-only chargers |
| `rfid` | `false` | RFID-required filter |
| `favorites` | `false` | Show only user favourites |
| `skipAuthTokenValidation` | `true` | Use for anonymous access |

**Response:** array of `{ id, name, latitude, longitude, marker }`

> Note: `marker` (e.g. `"2.0.3"`) encodes the map pin icon type — **not** real-time status. Use `GET /locations/{id}` for status.

---

### `GET /locations/{id}`

Full charger detail including per-connector real-time status. The primary endpoint for status monitoring.

**Example response:**
```json
{
  "id": 42479,
  "name": "Càrrega Molins de Rei",
  "url": "https://map.electromaps.com/en/p/42479",
  "latitude": 41.412473739646,
  "longitude": 2.014127862566,
  "type": "ON_STREET",
  "online_status": "OCCUPIED",
  "offline_status": "NOT_WORKING",
  "realtime": true,
  "updated_at": "2026-06-19T13:49:06+0000",
  "cpo": null,
  "address": {
    "address": "Carrer del Molí, 11, 08750 Molins de Rei, Barcelona, Espanya",
    "street": "Carrer del Molí",
    "street_number": "11",
    "postal_code": "08750",
    "city": "Molins de Rei",
    "area_lvl1": "Catalunya",
    "area_lvl2": "Barcelona",
    "country_code": "ES"
  },
  "connectors": [
    {
      "id": 114172,
      "visualRef": "PLUG B",
      "type": "IEC_62196_T2",
      "status": "OUT_OF_SERVICE",
      "realtime": true,
      "voltage": 400,
      "amperage": 32,
      "kw": 22,
      "power_type": "AC_3_PHASE",
      "format": "SOCKET",
      "cost": "FREE",
      "authenticationRfid": true,
      "authenticationRemote": true,
      "status_updated_at": "2026-06-19T08:56:09+0000",
      "reservable": false
    }
  ]
}
```

**`online_status` values:** `AVAILABLE` · `OCCUPIED` · `UNKNOWN`

**`connector.status` values:** `AVAILABLE` · `OCCUPIED` · `OUT_OF_SERVICE` · `WORKING`

**`connector.type` values:** `IEC_62196_T2` · `IEC_62196_T2_COMBO` (CCS) · `CHADEMO` · `DOMESTIC_E`

**`connector.cost` values:** `FREE` · `PAYMENT`

**`connector.status_updated_at`**: ISO 8601 timestamp present on every connector regardless of status. This is a real "status changed at" field — unlike EVcharge which has no equivalent. Shows "available since X" for any state.

> Note: some connectors have `realtime: false` even when the `/locations` query uses `realtime=true`. Always double-check `marker.realtime !== false` client-side.

---

---

## Adapter capabilities

| Capability | Supported | Notes |
|------------|-----------|-------|
| `SEARCH_NEARBY` | ✅ | Via `/locations` bounding box; filter `marker.realtime !== false` client-side |
| `CHARGE_START_TIME` | ✅ | `status_updated_at` on every connector; works for all statuses including AVAILABLE |
| `CONNECTED_NOT_CHARGING` | ❌ | No suspended/connected-not-charging state exposed |

---

### `GET /locations/{id}/comments`

User comments for a charger.

### `GET /locations/{id}/images`

Photos of a charger.

### `GET /near-locations`

Chargers near a lat/lng (query params TBD — not used by webapp).

### `GET /geosearch`

Search chargers by name or address string.

### `GET /reversegeocoding`

Reverse geocode a coordinate.

---

## Auth-Required Endpoints

### Account / profile
- `GET /user/profile`
- `PUT /user/profile`
- `PATCH /user/profile`
- `GET /user/subscriptions`
- `PUT /users/{id}/email`
- `PUT /users/password`
- `POST /users/{id}/accept-terms-conditions`
- `POST /users/{id}/email/verify`

### Favourites
- `GET /favorite-locations`
- `POST /locations/{id}/favorite`

### Charger management (authenticated users)
- `POST /locations` — create a new charger listing
- `POST /locations/{id}/comments`
- `POST /locations/{id}/images`

### RFID cards
- `GET /rfids`
- `POST /rfids`
- `POST /rfids/{id}`

### Billing
- `GET /billing/clients`
- `PUT /billing/clients`
- `GET /billing/clients/transactions`
- `GET /billing/clients/invoices`
- `GET /billing/clients/payment-methods`
- `GET /billing/clients/promotional-balance`
- `POST /billing/clients/stripe/setup-intent`
- `GET /billing/fleets/transactions`
- `POST /promo-code/clients/redeem-promo-code`

### User groups / subscriptions
- `GET /user-groups/groups`
- `POST /user-groups/group/{id}/subscribe`
- `POST /user-groups/group/{id}/unsubscribe`

### Auth
- `POST /auth/recover`
- `POST /auth/recover/verify`

### Connector detail (v1, auth required)
- `GET /mapi/v1/map/locations/{locationId}/connectors/{connectorId}`
  - Requires `Language` header (e.g. `en`)
  - Returns individual connector detail

---

## How to re-run the investigation

Bundle filenames are content-hashed (Vite build) and rotate on every deploy. The ones analysed on 2026-06-19 were:

| File | Key content |
|------|-------------|
| `index-BFmOXoy8.js` | Base URLs, axios instance definitions, all endpoint calls, Cognito pool ID |
| `MapView-BgiRbOy7.js` | Map view component |
| `Geocoding-bDjYRb_P.js` | Geocoding components |

To re-enumerate after a deploy (requires `pip install playwright && python3 -m playwright install webkit`):

```python
import asyncio, re
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.webkit.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        js_texts = []
        async def on_response(resp):
            if 'map.electromaps.com/assets/' in resp.url and resp.url.endswith('.js'):
                print("Bundle:", resp.url)
                js_texts.append(await resp.text())

        page.on("response", on_response)
        await page.goto("https://map.electromaps.com/en/", wait_until="networkidle", timeout=30000)
        await asyncio.sleep(2)

        all_text = '\n'.join(js_texts)

        # All axios API calls
        print("\n=== API endpoints ===")
        for m in re.finditer(r'\.(get|post|put|delete|patch)\(\s*[`"\']([^`"\']{2,120})[`"\']', all_text):
            path = m.group(2)
            if not any(s in path for s in ['http', '.com', '.svg', '.png', '.js', '.css', 'assets/']):
                print(f"  {m.group(1).upper()} {path}")

        # Base URLs
        print("\n=== Base URLs ===")
        for m in re.finditer(r'mapi', all_text):
            print(all_text[max(0, m.start()-30):m.end()+150])

        await browser.close()

asyncio.run(main())
```

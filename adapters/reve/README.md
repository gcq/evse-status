# REVE (mapareve.es) API Reference

**Not implemented as an adapter yet — this is reference documentation only, so a
future integration doesn't require reverse-engineering the API again.** There is
no `reve.js` in this folder on purpose.

## What REVE is

REVE (`www.mapareve.es`) is the Spanish government's national EV charging point
map, operated by **Red Eléctrica de España (REE)**. It aggregates static and
live/dynamic data from ~140 charge point operators nationwide (~14k sites,
~44k connectors as of 2026-07-07 — see `/stats` below), most of it via OCPI,
plus a smaller set of directly-registered (non-OCPI) points.

Both CPOs this project already talks to are present in REVE's own CPO
directory, confirmed live on 2026-07-07:

| CPO (this project) | REVE `cpo_id` | REVE `source_type` |
|---|---|---|
| Electromaps | `351f3aef-a398-4c39-a374-e24178442476` (name: `ELECTROMAPS SL`) | `OCPI` |
| EVcharge (Etecnic) | `b14275b5-f508-4686-a884-8ba0f06e48e4` (name: `Etecnic Energy & Mobility`) | `OCPI` |

Confirmed the same physical location as this project's config (`config.js`
`id: "42479"`, "Càrrega Molins de Rei", `41.412473, 2.014127`) exists in REVE
as location id `0d507345-513a-418e-84c3-2703e7e6083d`, `owner.name: "ELECTROMAPS SL"`.
REVE reports **4 EVSEs** at that location; this project's config only tracks
2 of its connectors — REVE's EVSE-level granularity is not guaranteed to line
up 1:1 with what a CPO's own consumer app exposes, so any future
location-matching logic should match on name/coordinates, not assume equal
connector counts.

## Reverse-engineered

On 2026-07-07 via Playwright WebKit traffic + bundle interception of
`https://www.mapareve.es/mapa-puntos-recarga` (same method as
`../electromaps.md`), plus direct `curl` probing of the discovered endpoints.

## Base URL

`https://www.mapareve.es/api/public/v1`

There is also `/api/admin` and `/api/admin/auth` (an authenticated back-office
API used by REVE/CPO staff — OCPI backend providers, CPOs, locations, EVSEs,
connectors, tariffs, contact-request management, etc.). Not explored further:
requires auth, out of scope for a public-data adapter.

## Authentication

**None required** for any `/api/public/v1` endpoint — confirmed via plain
`curl` with no auth headers on every endpoint below.

The official frontend sends these extra headers, but they do **not** appear
to be required (endpoints work fine without them in testing) — noting them in
case REVE starts enforcing them later:
- `Accept: application/json`
- `APP-VERSION: <version string>`
- `Accept-Language: <browser locale>`
- `Time-Zone: <IANA tz, e.g. Europe/Madrid>`
- `platform: <web|ios|android>`

## ⚠️ CORS: not browser-callable cross-origin

Unlike Electromaps (`Access-Control-Allow-Origin: *`), REVE's API returns
**no `Access-Control-Allow-Origin` header at all**, even when a cross-origin
`Origin` header is sent:

```
curl -s -D - -o /dev/null "https://www.mapareve.es/api/public/v1/connector_types" \
  -H "Origin: https://example.github.io" | grep -i access-control
# (no output — header absent)
```

A browser `fetch()` from this project's own origin would be **blocked by the
browser's CORS policy**. `curl`/server-side requests work fine (CORS is a
browser-enforced restriction, not server-side auth) — so a real integration
would need a small server-side proxy, or to run outside the browser
(e.g. a build-time backfill script), not a direct client-side `fetch()` the
way `adapters/electromaps.js` and `adapters/evcharge.js` do today.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/connector_types` | Static list of connector standard codes |
| `GET` | `/facilities` | Static list of facility codes (airport, mall, etc.) |
| `GET` | `/payment_methods` | Static list of payment method codes |
| `GET` | `/cpos?per_page=500` | Full CPO directory (paginated) |
| `GET` | `/stats` | National totals (operators/sites/EVSEs/connectors) |
| `POST` | `/markers` | Lightweight map markers (clusters + locations) in a bounding box |
| `GET` | `/locations/{id}` | Full detail for one location (REVE's own UUID) |
| `POST` | `/locations?page=&per_page=` | Paginated, filterable location search — same full detail as above, in bulk |
| `GET` | `/route_planner/parameters` | Default parameter values for the route planner |
| `POST` | `/route_planner` | EV route planning with charging stops (not fully explored — out of scope) |
| `POST` | `/contact_requests` | Public "report an issue" form submission |
| `POST` | `/external_api_requests` | Public "request API access" form (email + reason) — implies a more complete/authenticated API exists on request |

---

### `GET /connector_types`

```json
[{ "code": "CHADEMO", "icon": null }, { "code": "IEC_62196_T2", "icon": null }, ...]
```

Full `code` list observed: `CHADEMO`, `CHAOJI`, `DOMESTIC_A`..`DOMESTIC_O`,
`GBT_AC`, `GBT_DC`, `IEC_60309_2_single_16`, `IEC_60309_2_three_16`,
`IEC_60309_2_three_32`, `IEC_60309_2_three_64`, `IEC_62196_T1`,
`IEC_62196_T1_COMBO`, `IEC_62196_T2`, `IEC_62196_T2_COMBO`, `IEC_62196_T3A`,
`IEC_62196_T3C`, `NEMA_5_20`, `NEMA_6_30`, `NEMA_6_50`, `NEMA_10_30`,
`NEMA_10_50`, `NEMA_14_30`, `NEMA_14_50`, `PANTOGRAPH_BOTTOM_UP`,
`PANTOGRAPH_TOP_DOWN`, `TESLA_R`, `TESLA_S`. These are OCPI's standard
`ConnectorType` values and line up directly with Electromaps'/EVcharge's own
`type`/`connector_type_code` values (e.g. `IEC_62196_T2` is the same string
both places).

### `GET /facilities`

```json
[{ "code": "AIRPORT", "name": "Airport" }, { "code": "MALL", "name": "Mall" }, ...]
```
Full list: `AIRPORT`, `BIKE_SHARING`, `BUS_STOP`, `CAFE`, `CARPOOL_PARKING`,
`FUEL_STATION`, `HOTEL`, `MALL`, `METRO_STATION`, `MUSEUM`, `NATURE`,
`PARKING_LOT`, `RECREATION_AREA`, `RESTAURANT`, `SPORT`, `SUPERMARKET`,
`TAXI_STAND`, `TRAIN_STATION`, `TRAM_STOP`, `WIFI`.

### `GET /payment_methods`

```json
[{ "code": "CREDIT_CARD_PAYABLE", "name": "Credit card payment" }, ...]
```
Full list: `CREDIT_CARD_PAYABLE`, `DEBIT_CARD_PAYABLE`, `RFID_READER`,
`PED_TERMINAL`, `CHIP_CARD_SUPPORT`, `CONTACTLESS_CARD_SUPPORT`.

### `GET /cpos?per_page=500`

```json
{
  "data": [
    { "id": "351f3aef-a398-4c39-a374-e24178442476", "name": "ELECTROMAPS SL", "logo": null, "source_type": "OCPI" },
    { "id": "b14275b5-f508-4686-a884-8ba0f06e48e4", "name": "Etecnic Energy & Mobility", "logo": "https://...", "source_type": "OCPI" },
    ...
  ]
}
```
142 CPOs observed total (53 `OCPI`, rest `RIPREE`). `id` here is what the
`cpo_ids` filter on `/markers` and `/locations` expects. No `pagination` key
was present in this response despite `per_page` being accepted — may just
return everything under the observed volume; not confirmed to paginate.

### `GET /stats`

```json
[
  { "title": "Operadores", "count": 142, "count_ocpi": 53 },
  { "title": "Emplazamientos", "count": 14292, "count_ocpi": 13644 },
  { "title": "Puntos de recarga", "count": 43641, "count_ocpi": 41636 },
  { "title": "Conectores", "count": 48375, "count_ocpi": 45869 }
]
```
"Emplazamientos" = sites/locations, "Puntos de recarga" = EVSEs. `count_ocpi`
is the subset sourced live via OCPI (vs. static `RIPREE` registry entries).

### `POST /markers`

Request body (all keys the frontend sends; only the bounding box is
presumably required):
```json
{
  "latitude_ne": 41.42, "longitude_ne": 2.03,
  "latitude_sw": 41.40, "longitude_sw": 2.00,
  "zoom": 15,
  "cpo_ids": [], "only_ocpi": false, "available": false,
  "connector_types": [], "payment_methods": [], "facilities": [],
  "latitude": 41.4125, "longitude": 2.0141
}
```
Response: flat array mixing two marker shapes, meant for map-pin rendering
(cheap — no EVSE/connector detail):
```json
[
  { "latitude": 41.40, "longitude": 2.02, "type": "cluster", "total_evse": 6 },
  {
    "latitude": 41.412473, "longitude": 2.014127, "type": "location", "total_evse": 4,
    "location": {
      "id": "0d507345-513a-418e-84c3-2703e7e6083d",
      "name": "Càrrega Molins de Rei",
      "latitude": 41.412473, "longitude": 2.014127,
      "status": "CHARGING", "total_evse": 4, "source_type": "OCPI"
    }
  }
]
```
`location.id` here is REVE's own UUID for the location — feed it to
`GET /locations/{id}` for full detail (including `evse_id`).

### `GET /locations/{id}`

`{id}` is REVE's UUID (from `/markers` or `/locations`), not a CPO's own ID.

```json
{
  "id": "0d507345-513a-418e-84c3-2703e7e6083d",
  "name": "Càrrega Molins de Rei",
  "address": "Carrer del Molí",
  "postal_code": "08750",
  "state": null,
  "country": "ESP",
  "owner": { "name": "ELECTROMAPS SL", "website": "www.electromaps.com", "logo": null, "phone": "931574967" },
  "coordinates": { "latitude": "41.412473", "longitude": "2.014127" },
  "facilities": [],
  "evses": [
    {
      "evse_id": "ES*EMP*E000000012456",
      "physical_reference": null,
      "status": "OUTOFORDER",
      "status_updated_at": "2025-10-27T09:39:07.817Z",
      "connectors": [
        {
          "id": "aebdd788-0e6e-4b8c-88fe-515c584c6035",
          "standard": "IEC_62196_T2",
          "format": "SOCKET",
          "tariffs": [
            {
              "human": ["Gratuito"],
              "tariff": { "id": "...", "currency": "EUR", "start_date_time": null, "end_date_time": null, "elements": [] },
              "tariff_alt_url": null
            }
          ],
          "show_tariffs_details": false,
          "max_electric_power": 22080
        }
      ],
      "last_updated": "2025-10-27T09:39:07.833Z",
      "payment_methods": ["Lector RFID"]
    }
  ],
  "distance": null,
  "access_restricted": false,
  "last_updated": "2024-01-18T12:58:45.000Z",
  "source_type": "OCPI",
  "accessibility": null,
  "info_obtained_at": "2026-07-07T14:19:34.938Z"
}
```

**This is the endpoint that has the standardized eMI3 `evse_id`** — one per
EVSE, in `{country_code}*{operator_code}*E{number}[*{subnumber}]` format.
Two variants observed:
- OCPI-sourced (CPO's own eMI3 party ID, 3 characters): `ES*EMP*E000000012456`
  (Electromaps), `ES*REP*E13776*1` (Repsol)
- `RIPREE`-sourced (REE's own registry — numeric operator code instead of a
  3-letter mnemonic): `ES*814*E-02`

### `POST /locations?page=1&per_page=10`

Same filter body as `/markers`, but paginated and returns the **same full
detail** as `GET /locations/{id}` for every result (evses/connectors/tariffs
included) — i.e. this is the bulk equivalent of calling `/locations/{id}` in
a loop. Each location also carries a top-level `status` (aggregate) and
`total_evse` not present on the single-location endpoint.

```json
{
  "data": [ /* same shape as GET /locations/{id}, plus "status" and "total_evse" */ ],
  "pagination": { "page": 1, "per_page": 10, "next": 2, "prev": null, "total_count": 11, "total_pages": 2 }
}
```

This is likely the better endpoint for a bulk backfill job (one paginated
crawl over a bounding box + `cpo_ids: [<electromaps>, <etecnic>]` instead of
one `/locations/{id}` call per already-known location).

### `GET /route_planner/parameters`

```json
{
  "battery_capacity": "60", "max_power": "100", "consumption": "20",
  "soc_origin": "100", "soc_destination": "10", "soc_min": "15", "soc_max": "80",
  "charging_stop_radius_meters": "1000"
}
```
Default form values for `POST /route_planner` (EV trip planning with
charging stops). Not explored further — irrelevant to EVSE status
monitoring.

### `POST /external_api_requests`, `POST /contact_requests`

Public form-submission endpoints (`{ email, reason }` for the API-access
request; contact form has its own admin-side `GET/PATCH /api/admin/contact_requests`
for REE staff to respond). The existence of a "request API access" page
strongly suggests a more complete/documented/authenticated API exists beyond
what's reverse-engineered here — worth actually filling out that form before
building a real integration, rather than relying solely on this undocumented
public surface.

## Enums

**EVSE `status`** (matches OCPI's standard `Status` enum, plus REVE's own
`UNAVAILABLE`): `AVAILABLE`, `BLOCKED`, `CHARGING`, `INOPERATIVE`,
`OUTOFORDER`, `PLANNED`, `REMOVED`, `RESERVED`, `UNKNOWN`, `UNAVAILABLE`.

Location-level `status` (seen on `/markers` and `POST /locations`) uses a
smaller aggregate set: `AVAILABLE`, `CHARGING`, `RESERVED`, `OUTOFORDER`,
`REMOVED` observed.

**`source_type`**: `OCPI` (live, CPO-connected via OCPI roaming) | `RIPREE`
(Red Eléctrica's own static registry — Spain's national charging-point
registration scheme for operators not (yet) OCPI-connected; expect these to
update less often / not be real-time).

**Connector `format`**: `SOCKET` | `CABLE` (both observed).

**Connector `standard`**: see the full `/connector_types` list above.

## Caveats / open questions

- **No CORS support** — see above. Any real integration needs a proxy or a
  non-browser context.
- **Rate limiting**: not observed in any response header; not stress-tested.
  Don't assume it's unlimited.
- **`GET /cpos` pagination**: accepts `per_page` but no `pagination` key was
  returned in testing (142 CPOs all came back at once) — unconfirmed whether
  it truly paginates past some larger CPO count.
- **Matching REVE locations to this project's config**: no shared ID exists
  between REVE and Electromaps/EVcharge's own consumer APIs — matching would
  have to be by name + coordinates (fuzzy), same caveat noted in
  `discover.js`'s own siteKey-matching TODO for merged chargers. REVE's own
  EVSE count for a location is not guaranteed to match the CPO's app 1:1
  (confirmed: 4 EVSEs in REVE vs. 2 tracked connectors in this project's
  config for the same physical site).
- **`POST /route_planner` request body**: not reverse-engineered — only the
  `/parameters` defaults were captured. Out of scope for EVSE status
  monitoring; documented here only because it was discovered along the way.
- The admin API (`/api/admin`, `/api/admin/auth`) exists and covers the same
  entities (OCPI CPOs/locations/EVSEs/connectors/tariffs) with presumably
  richer CRUD access, but requires authentication that wasn't investigated.

## How to re-run this investigation

Requires `pip install playwright && python3 -m playwright install webkit`.

```python
import asyncio, re
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.webkit.launch(headless=True)
        context = await browser.new_context(
            geolocation={"latitude": 41.4125, "longitude": 2.0141},
            permissions=["geolocation"],
        )
        page = await context.new_page()

        # Log every /api/public/v1 request the frontend makes, with body.
        async def on_request(req):
            if "/api/public/" in req.url:
                print(req.method, req.url, "body:", req.post_data)
        page.on("request", on_request)

        # Capture JS bundles to grep for endpoint definitions not triggered
        # by this one page load (e.g. route_planner, cpos, stats).
        js_texts = []
        async def on_response(resp):
            if resp.url.endswith(".js") and "mapareve.es" in resp.url:
                js_texts.append(await resp.text())
        page.on("response", on_response)

        await page.goto("https://www.mapareve.es/mapa-puntos-recarga", wait_until="networkidle", timeout=30000)
        await asyncio.sleep(3)

        all_text = "\n".join(js_texts)
        # axios call sites: Y1/U2 are the public/v1 instances (see baseURL
        # strings in the bundle to reconfirm which minified var name is which
        # instance after any redeploy — these rotate).
        for m in re.finditer(r'\b\w+\.(get|post|put|delete|patch)\([^)]{0,140}', all_text):
            print(m.group(0))

        await browser.close()

asyncio.run(main())
```

Then probe any newly-found path directly with `curl` (no auth needed for
`/api/public/v1/*`) to get real example payloads.

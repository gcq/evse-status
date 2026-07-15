# Electromaps API Reference

Reverse-engineered on 2026-06-19 via Playwright WebKit traffic interception and JS bundle analysis of `map.electromaps.com`.

## Base URLs

| Version | URL | Notes |
|---------|-----|-------|
| v2 | `https://www.electromaps.com/mapi/v2` | Main API, no auth required for read endpoints |
| v1 | `https://www.electromaps.com/mapi/v1` | Older API — used by the web app only for auth-required connector detail, but the Android app also uses it for remote-start/-stop/-reserve (see below) |

**CORS:** `Access-Control-Allow-Origin: *` — browser-callable directly, no proxy needed.

## Authentication

Auth-required endpoints use AWS Cognito JWT tokens via two headers:
- `X-Em-Oidc-Accesstoken`: access token
- `X-Em-Oidc-Data`: ID token

Cognito pool: `eu-west-1_H7LsQnxSb` (EU West 1 region)

**Confirmed 2026-07-15 by decompiling the Android app** (see "Remote-start
investigation" below for how): this same interceptor/header pair is applied
to *every* base URL the app talks to — `mapi/v1`, `mapi/v2`, `mapi/v3`, and
`billing.electromaps.com` all share one `OkHttpClient` with one auth
interceptor. So `mapi/v1` needs no separate auth scheme from `mapi/v2`.

The interceptor also sets three headers not previously documented here
(harmless to omit for the endpoints already in this doc, since they work
without them, but include them if a call behaves unexpectedly):
- `Language`: device locale, e.g. `en`
- `App-Version`: numeric app build/version code
- `App-Platform`: `android`

### Getting a token pair (for testing against your own account)

The app's Cognito config (`res/raw/prodamplifyconfiguration.json` in the
APK) sets `"authenticationFlowType": "USER_PASSWORD_AUTH"` — meaning it *can*
log in with a direct Cognito API call (email + password), not an OAuth
browser redirect, for accounts that have a password. Whether that applies to
*your* account depends on how it was created — see "Google-only accounts"
below before assuming this path works.

**Email + password** (only if your account actually has a password —
see below): `Auth: InitiateAuth` is a plain HTTPS JSON endpoint, no AWS
CLI/SDK needed:

```bash
curl -s -X POST https://cognito-idp.eu-west-1.amazonaws.com/ \
  -H 'Content-Type: application/x-amz-json-1.1' \
  -H 'X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth' \
  -d '{
    "AuthFlow": "USER_PASSWORD_AUTH",
    "ClientId": "e2582mkf7dvklnd3d91mpfrr0",
    "AuthParameters": {
      "USERNAME": "<your electromaps account email>",
      "PASSWORD": "<your electromaps account password>"
    }
  }'
```

Response is JSON with `AuthenticationResult.IdToken`, `.AccessToken`, and
`.RefreshToken`. Map those into the request headers above:
- `IdToken` → `X-Em-Oidc-Data`
- `AccessToken` → `X-Em-Oidc-Accesstoken`

Confirmed CORS-open (`Access-Control-Allow-Origin: *` on both the OPTIONS
preflight and the real POST) — a browser `fetch()` can call this directly,
no proxy needed.

To renew without re-entering the password, call `InitiateAuth` again with
`"AuthFlow": "REFRESH_TOKEN_AUTH"` and `"AuthParameters": {"REFRESH_TOKEN": "<RefreshToken>"}`.

`ClientId` above is a public mobile-app client ID (baked into the APK,
same as the CORS-open REST endpoints) — it has no client secret, same as
any USER_PASSWORD_AUTH mobile flow. This calls Cognito directly with your
own account's credentials; nothing here bypasses electromaps' own login.

### Google-only accounts (no password path)

**Automated helper:** `python3 adapters/electromaps_auth.py` (requires
`playwright` + `playwright install webkit`, already set up in this project's
dev environment) does everything below except the Google login itself —
generates the PKCE pair, builds the authorize URL, opens a real headed
WebKit window for you to log in, captures the authorization code via
`page.on("response")` (network-level interception, same trick as watching
DevTools' Network tab by hand — it sees the redirect's `Location` header
even though the browser can't follow it to `electromapsandroid://`), runs
the token exchange automatically, and prints the `refresh_token` ready to
paste into Settings. Falls back to a manual paste-the-code prompt if
automatic capture doesn't work for some reason. The manual step-by-step
version is below for reference or if the script breaks.

Confirmed 2026-07-15 against a live Google-linked account: **there is no
way to bootstrap a password for an account that signed up via Google.**
Both app-provided password flows dead-end:
- `ForgotPassword` (logged out) — the app always shows "check your email"
  regardless of outcome (Cognito's standard enumeration-safe behavior: it
  never reveals whether a code was actually deliverable). For a
  Google-only account, no code is ever sent.
- `ChangePassword` (logged in, My account → Account details → Profile) —
  decompiles to Amplify's `updatePassword(oldPassword, newPassword)`, i.e.
  Cognito's `ChangePassword` API, which requires the **current** password
  to authorize the change. No first-time-set variant exists.
- Native sign-up with the same email also fails ("email already taken") —
  Cognito enforces email uniqueness across the pool, so the existing
  Google-linked user blocks a second native account at that address too.

So a Google-only account is genuinely stuck on both sides: can't add a
password, can't create a second account with the same email. The only way
in is Google itself, via Cognito's Hosted UI federation flow:

1. **Confirm the identity provider name.** `identity_provider=Google` is
   not a guess — found `com.amplifyframework.auth.AuthProvider`'s Google
   singleton in the decompiled APK (class `ed8`, `toString() → "Google"`),
   which Amplify sends verbatim as the `identity_provider` query param for
   `signInWithWebUI(AuthProvider.google())`.

2. **Generate a PKCE pair** (Amplify's Cognito plugin uses
   authorization-code+PKCE by default; safe to always include — Cognito
   only enforces it if a challenge was actually sent):
   ```bash
   python3 -c "
   import base64, hashlib, secrets
   v = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b'=').decode()
   c = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b'=').decode()
   print('verifier:', v); print('challenge:', c)
   "
   ```

3. **Open this in a real browser** and complete the Google login:
   ```
   https://idp.electromaps.com/oauth2/authorize?identity_provider=Google&redirect_uri=electromapsandroid%3A%2F%2Fsignin&response_type=code&client_id=e2582mkf7dvklnd3d91mpfrr0&scope=email+openid+aws.cognito.signin.user.admin&code_challenge=<challenge>&code_challenge_method=S256
   ```
   The final redirect target (`electromapsandroid://signin?code=...`) is
   the Android app's deep link — the browser can't navigate there and will
   error, but that's expected. **Do not rely on the address bar** to catch
   the code (confirmed empirically: WebKit silently drops navigation
   attempts to an unhandled custom scheme — no address-bar update, no
   `request`/`framenavigated`/`requestfailed` event, nothing observable
   from a page's JS or from browser automation). Instead, open **DevTools →
   Network tab** *before* completing the Google login: the redirect from
   `idp.electromaps.com` back to the app is a genuine HTTP `302` response
   with a `Location` header, and that response — including the header — is
   captured by the network stack and shown in DevTools even though the
   subsequent navigation to it fails. Copy the `code` param from that
   `Location` value.

4. **Exchange the code for tokens:**
   ```bash
   curl -s -X POST https://idp.electromaps.com/oauth2/token \
     -d 'grant_type=authorization_code' \
     -d 'client_id=e2582mkf7dvklnd3d91mpfrr0' \
     -d 'code=<code from step 3>' \
     -d 'redirect_uri=electromapsandroid://signin' \
     -d 'code_verifier=<verifier from step 2>'
   ```
   Response has lowercase `id_token`/`access_token`/`refresh_token`
   (standard OAuth token-endpoint shape — different casing from
   `InitiateAuth`'s `AuthenticationResult.IdToken` above). Also confirmed
   CORS-open, same as the `InitiateAuth` endpoint.

5. **Store the `refresh_token`** (Settings → Electromaps account in this
   app) and let the app silently exchange it for fresh `access_token`/
   `id_token` pairs on load via `grant_type=refresh_token` against the same
   `/oauth2/token` endpoint.

**No unattended recovery once the refresh token itself expires.** Cognito's
refresh-token TTL for this pool is unknown (app-client-level AWS config we
have no access to; unmodified defaults are commonly 30 days, but could be
anything). Whenever it lapses, steps 2–4 have to be redone by hand — there
is no way to automate the Google login from inside a web app: even setting
aside that this Cognito app client's only registered `redirect_uri` is the
Android deep link (a web app's own callback URL would likely be rejected
outright as `redirect_mismatch`), a web page fundamentally cannot observe a
top-level navigation handed off to an unregistered custom scheme — that's a
hard OS-level security boundary, not something any web API can bridge. This
app (`evse-status`) treats a monthly-ish manual re-auth as an accepted
off-band chore rather than something to solve in-app.

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
| `REMOTE_START` | ✅ | Mobile-app-only, on `mapi/v1` (not `mapi/v2`). See below. |

---

## Remote-start investigation (2026-07-15)

The **web app** (`map.electromaps.com`) exposes no remote-start endpoint —
confirmed by a bundle regex scan (covers every `.get/.post/.put/.delete/.patch(...)`
literal) and by directly probing a dozen guessed REST paths against
`mapi/v2` (all `404`, vs. a known auth-required route's `401` as a control).

The **Android app** does have it, on a different, undocumented-from-the-web
base URL: `mapi/v1` (not `mapi/v2`). Found via jadx-decompiling the APK
(`com.enredats.electromaps`, downloaded via APKPure) and reading the
Retrofit service interfaces directly — the app ships mostly unobfuscated
Kotlin/Java aside from Dagger-generated glue and R8 method renaming, so the
`@GET`/`@POST` annotations and DTO field names are intact.

**Base URL:** `https://www.electromaps.com/mapi/v1/` (separate Retrofit
client/interceptor from the `mapi/v2` client the web app and this adapter
use — same host, different auth path, not yet reverse-engineered).

**Endpoints** (interface `fm4`, all declared as `@GET` despite being
state-changing actions):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `remote/start/{idtoma}` | Start a charge session |
| `GET` | `remote/stop/{idtoma}` | Stop a charge session |
| `GET` | `remote/reserve/{idtoma}` | Reserve a connector |
| `GET` | `transactions/active` | Active charge session(s) for the user |
| `GET` | `rfids` / `POST rfids` / `PUT rfids/{id}` | RFID card (Electropass) management |
| `GET` | `billing/invoices` | Legacy invoice list |

`idtoma` ("toma" = Spanish for socket/outlet) is a **connector ID**, not a
location ID — confirmed via the `idToma` JSON field name on
`HistoricChargeDetailsApiResponse` (Moshi `@Json(name = "idToma")` maps it
to `connectorId` in the Kotlin model). Same numbering as the `connector.id`
already returned by the `mapi/v2` `/locations/{id}` endpoint this adapter
uses — no separate ID lookup needed.

**Not yet confirmed:**
- Whether `remote/start` unconditionally starts a paid session or only
  succeeds when `connector.cost === "FREE"` server-side. Given this is a
  GET with no request body, there's no client-side "confirm you'll pay"
  step visible in the interface signature itself — the adapter's own
  `isFree` check (mirroring evcharge's) is the only guard right now, same
  as evcharge's own unwired state. Worth traffic-capturing a real
  free-connector start before wiring this into the Start button's click.
- Whether starting also requires an active RFID/Electropass card on the
  account (evcharge requires `cardCode` — see `evchargeAccount` in `app.js`).

### Implementation status in this app

Landed 2026-07-15: `REMOTE_START` capability, per-connector `isFree` (from
`cost === "FREE"`), and a `startFreeCharge(account, connectorId)` method on
`adapters/electromaps.js` — same shape as evcharge's, including the token
refresh via `/oauth2/token` (`grant_type=refresh_token`, cached in memory
until near expiry). Settings gained an "Electromaps account" section
(`config.electromaps.refreshToken`, bootstrapped per "Google-only accounts"
above).

Landed 2026-07-15 (same day, second pass): the Start button is now actually
wired to `startFreeCharge()` for both evcharge and electromaps (`app.js`'s
`startCharge()`), with a visible in-flight/result state machine —
disabled+"Starting" while the call is in flight, then green+"Started" or
red+"Error" until the next auto-refresh (dropped to 5s) either confirms the
connector left `AVAILABLE` (button disappears, normal render gate) or shows
it's still `AVAILABLE` (button reverts to enabled, treated as a silent
failure worth retrying). The free-connector confirmation flagged above is
still unconfirmed — this shipped without it, so the only thing standing
between a user and an accidental paid-connector start is the client-side
`isFree` check.

**How this was found:** downloaded the XAPK via Playwright/webkit
(APKPure's real download link is generated client-side and blocks plain
`curl`/`fetch`; a real browser session gets past that), extracted the base
APK, decompiled it with `jadx` inside a throwaway `eclipse-temurin:17-jre`
Docker container (no host installs), then grepped the decompiled sources for
Retrofit `@GET`/`@POST`-annotated interfaces referencing charge/session
types. The interface names are obfuscated (`fm4`, `gm4`, `hm4`, `jm4`) but
fully readable once opened — R8/Pairip only renamed identifiers, it didn't
strip or encrypt the endpoint strings.

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

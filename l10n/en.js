// Fluent-syntax translation source for locale "en", embedded as a
// JS string (rather than fetched as a plain .ftl file) so it loads via a
// normal <script> tag — fetch()/XHR to sibling file:// resources is blocked
// by browsers, which broke local testing by opening index.html directly
// instead of through a server.
window.FTL_SOURCES = window.FTL_SOURCES || {};
window.FTL_SOURCES.en = `
## Header / navigation
# header-title is the app's name/brand, not translated on purpose —
# keep this value identical across every locale file.
header-title = EVSE Status
doc-title-settings = EVSE Settings
nav-settings = Settings
nav-back = Back
nav-save = Save
nav-reset = Reset to defaults

## Refresh button + countdown
refresh-active = Auto refresh active
refresh-selective = Selective refresh active
refresh-off = Auto refresh disabled
refresh-loading = Refreshing…
countdown-prefix = Next refresh in

## GPS badge
gps-locating = Locating…
gps-unavailable = Location unavailable
gps-live = Live location
gps-stale = Stale location

## Collapsible sections
section-hidden = Hidden
section-out-of-range = Out of range
section-out-of-service = Out of service

## Card address line
addr-away = { $distance } away
addr-updated = Updated { $time }
addr-update-failed = Last update failed
addr-partial-warning = Some connectors may be unavailable right now

## Relative time ("5m ago")
relative-time-ago = { $n }{ $unit } ago
relative-time-unknown = unknown

## Connector status
status-available = Available
status-preparing = Preparing
status-occupied = Occupied
status-connected = Connected
status-finishing = Finishing
status-reserved = Reserved
status-out-of-service = Out of service
status-working = Working
status-unknown = Unknown

connector-not-live = not live
connector-not-live-title = Status not updated in real time

btn-refresh-location = Refresh this location
btn-auto-refresh-location = Auto-refresh only this location
btn-hide-location = Hide this location
btn-show-location = Show this location

## Limit badges
limit-should-leave-now = Should leave now
limit-should-leave-in = Should leave in { $duration }
limit-should-have-left = Should have left { $duration } ago

## Empty state
empty-state = No locations configured — add one in Settings

## Settings — Display section
section-display = Display
field-theme = Theme
theme-auto = Auto
theme-dark = Dark
theme-light = Light
system-theme-dark = System theme: dark
system-theme-light = System theme: light
system-theme-none = System theme: no preference reported
system-theme-unsupported = System theme: not supported by this browser

field-flash = Flash on available
flash-off = Off
flash-on = On
flash-hint = Briefly highlight a card when a connector becomes available

field-location-order = Location order
order-manual = Manual
order-distance = Distance
location-order-hint = Distance mode uses your live location to sort

field-max-distance = Max distance (km)
max-distance-placeholder = e.g. 30
max-distance-hint = Leave blank for no cutoff — locations further than this move to a collapsed "Out of range" section

field-driving-side = Driving side
side-left = Left
side-right = Right
driving-side-hint = Controls move to the opposite side, near your hand

field-language = Language
language-auto = Auto
language-en = English
language-es = Español
language-ca = Català
language-auto-hint = Detected language: { $language }

## Settings — Locations section
section-locations = Locations
btn-find-nearby = Find nearby

field-name = Name
name-placeholder = e.g. Moli
btn-show-on-list = Show on main list
btn-hide-from-list = Hide from main list

static-cpo = CPO
static-location-id = Location ID
static-coordinates = Coordinates
static-address = Address

merged-charger-hint =
    { $count ->
        [one] Also covers charger { $ids }
       *[other] Also covers chargers { $ids }
    }

subsection-rules = Rules
rule-max-duration = Max charge duration
rule-no-limit = No limit during:
rule-must-leave = Must leave when not charging
time-range-to = to

subsection-connectors = Connectors
conn-id = ID
conn-id-with-charger = ID (charger { $chargerId })
conn-name-placeholder = e.g. Charger 1 plug B

btn-move-up = Move up
btn-move-down = Move down
btn-remove-connector = Remove connector
btn-remove = Remove

## Validation
err-required = Required
err-must-be-0-or-greater = Must be 0 or greater
err-at-least-one-location = At least one location is required
err-at-least-one-connector = At least one connector required
err-must-be-greater-than-0 = Must be greater than 0
err-invalid-times = Enter valid times (HH:MM)
err-start-end-differ = Start and end must differ

confirm-reset = Reset all settings to the built-in defaults from config.js?

## Footer
deploy-version = Version { $sha }

## Discover page
doc-title-discover = Discover Chargers
discover-title = Discover Chargers
btn-allow-location = Allow location & search
discover-add-to-my-stations = Add to My Stations
discover-finding-location = Finding your location…
discover-geo-unsupported = Geolocation is not supported by this browser.
discover-geo-blocked = Location blocked: { $reason }. Tap to retry.
discover-you-are-here = You are here
discover-searching = Searching…
discover-chargers-found =
    { $count ->
        [one] { $count } charger found
       *[other] { $count } chargers found
    }
discover-no-chargers-nearby = No chargers found nearby
discover-multiple-chargers-title = Multiple chargers at this site
discover-chargers-count-badge =
    { $count ->
        [one] { $count } charger
       *[other] { $count } chargers
    }
discover-loading-connectors = Loading connectors…
discover-no-adapter = No adapter for { $cpo }
discover-no-connectors-found = No connectors found
discover-already-added = Already added to My Stations
discover-add-button =
    { $count ->
        [one] Add { $count } connector to My Stations
       *[other] Add { $count } connectors to My Stations
    }
`;

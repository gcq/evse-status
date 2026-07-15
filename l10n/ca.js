// Fluent-syntax translation source for locale "ca", embedded as a
// JS string (rather than fetched as a plain .ftl file) so it loads via a
// normal <script> tag — fetch()/XHR to sibling file:// resources is blocked
// by browsers, which broke local testing by opening index.html directly
// instead of through a server.
window.FTL_SOURCES = window.FTL_SOURCES || {};
window.FTL_SOURCES.ca = `
## Header / navigation
# header-title is the app's name/brand, not translated on purpose —
# keep this value identical across every locale file.
header-title = EVSE Status
doc-title-settings = Configuració EVSE
nav-settings = Configuració
nav-back = Enrere
nav-save = Desa
nav-reset = Restableix als valors per defecte

## Refresh button + countdown
refresh-active = Actualització automàtica activa
refresh-selective = Actualització selectiva activa
refresh-off = Actualització automàtica desactivada
refresh-loading = Actualitzant…
countdown-prefix = Pròxima actualització en

## GPS badge
gps-locating = Cercant ubicació…
gps-unavailable = Ubicació no disponible
gps-live = Ubicació en temps real
gps-stale = Ubicació desactualitzada

## Collapsible sections
section-hidden = Amagats
section-out-of-range = Fora de rang
section-out-of-service = Fora de servei

## Card address line
addr-away = a { $distance }
addr-updated = Actualitzat { $time }
addr-update-failed = Error en l'última actualització
addr-partial-warning = És possible que alguns connectors no estiguin disponibles ara mateix

## Relative time ("fa 5m")
relative-time-ago = fa { $n }{ $unit }
relative-time-unknown = desconegut

## Connector status
status-available = Disponible
status-preparing = Preparant
status-occupied = Ocupat
status-connected = Connectat
status-finishing = Finalitzant
status-reserved = Reservat
status-out-of-service = Fora de servei
status-working = En funcionament
status-unknown = Desconegut

connector-not-live = no en directe
connector-not-live-title = L'estat no s'actualitza en temps real

btn-refresh-location = Actualitza aquesta ubicació
btn-auto-refresh-location = Actualitza automàticament només aquesta ubicació
btn-hide-location = Amaga aquesta ubicació
btn-show-location = Mostra aquesta ubicació

btn-start-charge = Carrega
btn-start-charging = Iniciant
btn-start-charge-started = Iniciada
btn-start-charge-error = Error

## Limit badges
limit-should-leave-now = Hauria de marxar ja
limit-should-leave-in = Hauria de marxar en { $duration }
limit-should-have-left = Hauria d'haver marxat fa { $duration }

## Empty state
empty-state = No hi ha cap ubicació configurada — afegeix-ne una a Configuració

## Settings — Display section
section-display = Pantalla
field-theme = Tema
theme-auto = Auto
theme-dark = Fosc
theme-light = Clar
system-theme-dark = Tema del sistema: fosc
system-theme-light = Tema del sistema: clar
system-theme-none = Tema del sistema: sense preferència
system-theme-unsupported = Tema del sistema: no compatible amb aquest navegador

field-flash = Parpelleig en quedar disponible
flash-off = Desactivat
flash-on = Activat
flash-hint = Ressalta breument una targeta quan un connector queda disponible

field-location-order = Ordre d'ubicacions
order-manual = Manual
order-distance = Distància
location-order-hint = El mode de distància utilitza la teva ubicació en directe per ordenar

field-max-distance = Distància màxima (km)
max-distance-placeholder = p. ex. 30
max-distance-hint = Deixa-ho en blanc per no aplicar cap límit — les ubicacions més llunyanes passen a una secció plegada de "Fora de rang"

field-driving-side = Costat de conducció
side-left = Esquerra
side-right = Dreta
driving-side-hint = Els controls es mouen al costat oposat, a prop de la teva mà

field-language = Idioma
language-auto = Auto
language-en = English
language-es = Español
language-ca = Català
language-auto-hint = Idioma detectat: { $language }

## Settings — EVcharge account section (needed for the remote-start button)
section-evcharge-account = Compte d'EVcharge
evcharge-account-hint = S'utilitza per iniciar una càrrega remotament en connectors EVcharge gratuïts. No és un inici de sessió — consulta adapters/evcharge.md per saber com obtenir aquestes dades del teu compte.
field-evcharge-userid = ID d'usuari
field-evcharge-cardcode = Codi de targeta
field-evcharge-email = Correu electrònic
field-evcharge-max-start-distance = Distància màxima per iniciar (m)
evcharge-max-start-distance-hint = 0 desactiva el botó completament

## Settings — Electromaps account section (needed for the remote-start button)
section-electromaps-account = Compte d'Electromaps
electromaps-account-hint = S'utilitza per iniciar una càrrega remotament en connectors Electromaps gratuïts. És un token de refresc de Cognito, no un inici de sessió — consulta adapters/electromaps.md per saber com obtenir-lo (els comptes només amb Google necessiten repetir el procés manualment quan caduqui).
field-electromaps-refresh-token = Token de refresc

## Settings — Locations section
section-locations = Ubicacions
btn-find-nearby = Cerca a prop

field-name = Nom
name-placeholder = p. ex. Molí
btn-show-on-list = Mostra a la llista principal
btn-hide-from-list = Amaga de la llista principal

static-cpo = Operador
static-location-id = ID d'ubicació
static-coordinates = Coordenades
static-address = Adreça

merged-charger-hint =
    { $count ->
        [one] També cobreix el carregador { $ids }
       *[other] També cobreix els carregadors { $ids }
    }

subsection-rules = Regles
rule-max-duration = Durada màxima de càrrega
rule-no-limit = Sense límit durant:
rule-must-leave = Ha de marxar si no està carregant
time-range-to = a

subsection-connectors = Connectors
conn-id = ID
conn-id-with-charger = ID (carregador { $chargerId })
conn-name-placeholder = p. ex. Carregador 1 clavilla B

btn-move-up = Puja
btn-move-down = Baixa
btn-remove-connector = Elimina el connector
btn-remove = Elimina

## Validation
err-required = Obligatori
err-must-be-0-or-greater = Ha de ser 0 o més
err-at-least-one-location = Cal almenys una ubicació
err-at-least-one-connector = Cal almenys un connector
err-must-be-greater-than-0 = Ha de ser més gran que 0
err-invalid-times = Introdueix hores vàlides (HH:MM)
err-start-end-differ = Les hores d'inici i fi han de ser diferents

confirm-reset = Vols restablir tots els ajustos als valors per defecte de config.js?

## Footer
deploy-version = Versió { $sha }

## Discover page
doc-title-discover = Descobreix carregadors
discover-title = Descobrir carregadors
btn-allow-location = Permet la ubicació i cerca
discover-add-to-my-stations = Afegeix a Les meves estacions
discover-finding-location = Cercant la teva ubicació…
discover-geo-unsupported = Aquest navegador no admet la geolocalització.
discover-geo-blocked = Ubicació bloquejada: { $reason }. Toca per tornar-ho a provar.
discover-you-are-here = Ets aquí
discover-searching = Cercant…
discover-chargers-found =
    { $count ->
        [one] { $count } carregador trobat
       *[other] { $count } carregadors trobats
    }
discover-no-chargers-nearby = No s'ha trobat cap carregador a prop
discover-multiple-chargers-title = Diversos carregadors en aquest lloc
discover-chargers-count-badge =
    { $count ->
        [one] { $count } carregador
       *[other] { $count } carregadors
    }
discover-loading-connectors = Carregant connectors…
discover-no-adapter = No hi ha cap adaptador per a { $cpo }
discover-no-connectors-found = No s'ha trobat cap connector
discover-already-added = Ja afegit a Les meves estacions
discover-add-button =
    { $count ->
        [one] Afegeix { $count } connector a Les meves estacions
       *[other] Afegeix { $count } connectors a Les meves estacions
    }
`;

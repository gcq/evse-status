// Fluent-syntax translation source for locale "es", embedded as a
// JS string (rather than fetched as a plain .ftl file) so it loads via a
// normal <script> tag — fetch()/XHR to sibling file:// resources is blocked
// by browsers, which broke local testing by opening index.html directly
// instead of through a server.
window.FTL_SOURCES = window.FTL_SOURCES || {};
window.FTL_SOURCES.es = `
## Header / navigation
# header-title is the app's name/brand, not translated on purpose —
# keep this value identical across every locale file.
header-title = EVSE Status
doc-title-settings = Ajustes EVSE
nav-settings = Ajustes
nav-back = Atrás
nav-save = Guardar
nav-reset = Restablecer valores predeterminados

## Refresh button + countdown
refresh-active = Actualización automática activa
refresh-selective = Actualización selectiva activa
refresh-off = Actualización automática desactivada
refresh-loading = Actualizando…
countdown-prefix = Próxima actualización en

## GPS badge
gps-locating = Buscando ubicación…
gps-unavailable = Ubicación no disponible
gps-live = Ubicación en tiempo real
gps-stale = Ubicación desactualizada

## Collapsible sections
section-hidden = Ocultos
section-out-of-range = Fuera de rango
section-out-of-service = Fuera de servicio

## Card address line
addr-away = a { $distance }
addr-updated = Actualizado { $time }
addr-update-failed = Error en la última actualización
addr-partial-warning = Puede que algunos conectores no estén disponibles ahora mismo

## Relative time ("hace 5m")
relative-time-ago = hace { $n }{ $unit }
relative-time-unknown = desconocido

## Connector status
status-available = Disponible
status-preparing = Preparando
status-occupied = Ocupado
status-connected = Conectado
status-finishing = Finalizando
status-reserved = Reservado
status-out-of-service = Fuera de servicio
status-working = En funcionamiento
status-unknown = Desconocido

connector-not-live = no en directo
connector-not-live-title = El estado no se actualiza en tiempo real

btn-refresh-location = Actualizar esta ubicación
btn-auto-refresh-location = Actualizar automáticamente solo esta ubicación
btn-hide-location = Ocultar esta ubicación
btn-show-location = Mostrar esta ubicación

## Limit badges
limit-should-leave-now = Debería irse ya
limit-should-leave-in = Debería irse en { $duration }
limit-should-have-left = Debería haberse ido hace { $duration }

## Empty state
empty-state = No hay ubicaciones configuradas — añade una en Ajustes

## Settings — Display section
section-display = Pantalla
field-theme = Tema
theme-auto = Auto
theme-dark = Oscuro
theme-light = Claro
system-theme-dark = Tema del sistema: oscuro
system-theme-light = Tema del sistema: claro
system-theme-none = Tema del sistema: sin preferencia
system-theme-unsupported = Tema del sistema: no compatible con este navegador

field-flash = Destello al quedar disponible
flash-off = Desactivado
flash-on = Activado
flash-hint = Resalta brevemente una tarjeta cuando un conector queda disponible

field-location-order = Orden de ubicaciones
order-manual = Manual
order-distance = Distancia
location-order-hint = El modo de distancia usa tu ubicación en directo para ordenar

field-max-distance = Distancia máxima (km)
max-distance-placeholder = ej. 30
max-distance-hint = Déjalo en blanco para no aplicar límite — las ubicaciones más lejanas pasan a una sección plegada de "Fuera de rango"

field-driving-side = Lado de conducción
side-left = Izquierda
side-right = Derecha
driving-side-hint = Los controles se mueven al lado opuesto, cerca de tu mano

field-language = Idioma
language-auto = Auto
language-en = English
language-es = Español
language-ca = Català
language-auto-hint = Idioma detectado: { $language }

## Settings — Locations section
section-locations = Ubicaciones
btn-find-nearby = Buscar cercanas

field-name = Nombre
name-placeholder = ej. Molí
btn-show-on-list = Mostrar en la lista principal
btn-hide-from-list = Ocultar de la lista principal

static-cpo = Operador
static-location-id = ID de ubicación
static-coordinates = Coordenadas
static-address = Dirección

merged-charger-hint =
    { $count ->
        [one] También cubre el cargador { $ids }
       *[other] También cubre los cargadores { $ids }
    }

subsection-rules = Reglas
rule-max-duration = Duración máxima de carga
rule-no-limit = Sin límite durante:
rule-must-leave = Debe irse si no está cargando
time-range-to = a

subsection-connectors = Conectores
conn-id = ID
conn-id-with-charger = ID (cargador { $chargerId })
conn-name-placeholder = ej. Cargador 1 clavija B

btn-move-up = Subir
btn-move-down = Bajar
btn-remove-connector = Eliminar conector
btn-remove = Eliminar

## Validation
err-required = Obligatorio
err-must-be-0-or-greater = Debe ser 0 o mayor
err-at-least-one-location = Se requiere al menos una ubicación
err-at-least-one-connector = Se requiere al menos un conector
err-must-be-greater-than-0 = Debe ser mayor que 0
err-invalid-times = Introduce horas válidas (HH:MM)
err-start-end-differ = La hora de inicio y fin deben ser distintas

confirm-reset = ¿Restablecer todos los ajustes a los valores predeterminados de config.js?

## Footer
deploy-version = Versión { $sha }

## Discover page
doc-title-discover = Descubre cargadores
discover-title = Descubrir cargadores
btn-allow-location = Permitir ubicación y buscar
discover-add-to-my-stations = Añadir a Mis estaciones
discover-finding-location = Buscando tu ubicación…
discover-geo-unsupported = La geolocalización no es compatible con este navegador.
discover-geo-blocked = Ubicación bloqueada: { $reason }. Toca para reintentar.
discover-you-are-here = Estás aquí
discover-searching = Buscando…
discover-chargers-found =
    { $count ->
        [one] { $count } cargador encontrado
       *[other] { $count } cargadores encontrados
    }
discover-no-chargers-nearby = No se han encontrado cargadores cercanos
discover-multiple-chargers-title = Varios cargadores en este sitio
discover-chargers-count-badge =
    { $count ->
        [one] { $count } cargador
       *[other] { $count } cargadores
    }
discover-loading-connectors = Cargando conectores…
discover-no-adapter = No hay adaptador para { $cpo }
discover-no-connectors-found = No se han encontrado conectores
discover-already-added = Ya añadido a Mis estaciones
discover-add-button =
    { $count ->
        [one] Añadir { $count } conector a Mis estaciones
       *[other] Añadir { $count } conectores a Mis estaciones
    }
`;

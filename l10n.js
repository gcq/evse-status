// Locale negotiation + Fluent-backed message lookup. Fluent (not a hand-rolled
// key/value swap) is the point: it resolves CLDR plural categories and lets a
// translation reorder a sentence around its placeables (e.g. "ago" trailing
// in English vs. "hace"/"fa" leading in Spanish/Catalan) without any of that
// logic living in app.js/settings.js.
//
// No fallback chain: every l10n/*.js file is required to carry the exact same
// set of message ids (checked by hand when adding one — see the three files'
// matching structure), so there's nothing a fallback would ever catch. That
// means each locale loads exactly one script instead of a chain of them.
var L10N_SUPPORTED_LOCALES = ["ca", "es", "en"];

var l10nBundle = null;
var l10nActiveLocale = "en"; // what actually loaded, as opposed to a possibly-"auto" config value

// What the browser itself reports, ignoring any explicit config override —
// i.e. what "Auto" actually resolves to. Used both by detectLocale() below
// and by Settings' language hint (mirrors how the Theme field's hint always
// shows the OS-level theme regardless of the current selection).
function detectBrowserLocale() {
  var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || "en"];
  for (var i = 0; i < langs.length; i++) {
    var code = langs[i].slice(0, 2).toLowerCase();
    if (L10N_SUPPORTED_LOCALES.indexOf(code) >= 0) return code;
  }
  return "en";
}

// Synchronous and I/O-free by design — called from the inline <script> in
// <head> (alongside the theme lookup) so document.documentElement.lang is
// correct from first paint, well before initL10n()'s network round trip
// (Fluent CDN import + locale script) can resolve.
//
// explicitLocale is only passed by Settings' live language-switch preview
// (initL10n(state.locale), before Save persists it) — it means "the user
// just picked this value right now", so it must win outright, including
// "auto" itself meaning "detect fresh", not "fall back to whatever's still
// saved in localStorage from before this preview". Omitting the argument
// entirely (the normal page-load path) is what defers to the saved config.
function detectLocale(explicitLocale) {
  if (explicitLocale) return explicitLocale === "auto" ? detectBrowserLocale() : explicitLocale;
  var cfg = getConfig();
  if (cfg && cfg.locale && cfg.locale !== "auto") return cfg.locale;
  return detectBrowserLocale();
}

// Injects l10n/{locale}.js, which assigns its Fluent source text into
// window.FTL_SOURCES[locale] — a <script> tag rather than fetch()/XHR, since
// fetching sibling file:// resources is blocked by browsers (which broke
// local testing by opening index.html directly instead of through a
// server), and loaded only for the one locale actually needed. Cache-busted
// with the deployed commit sha (falls back to no cache-busting if that
// lookup fails) rather than something like Date.now() — a real version key
// lets the browser cache this ~5KB file indefinitely between deploys instead
// of re-fetching it on every single page load.
function loadLocaleScript(loc, version) {
  return new Promise(function(resolve) {
    if (window.FTL_SOURCES && window.FTL_SOURCES[loc]) { resolve(); return; }
    var script = document.createElement("script");
    script.src = "l10n/" + loc + ".js" + (version ? ("?v=" + version) : "");
    script.onload = resolve;
    script.onerror = resolve; // missing/broken locale file — t()'s raw-id fallback handles it
    document.head.appendChild(script);
  });
}

async function initL10n(explicitLocale) {
  var locale = detectLocale(explicitLocale);
  var results = await Promise.all([
    import("https://esm.sh/@fluent/bundle@0.19.1"),
    getDeployedVersion() // same lookup the footer uses — memoized, so this costs one network call total
  ]);
  var mod = results[0];
  var version = results[1];
  await loadLocaleScript(locale, version);
  var text = window.FTL_SOURCES && window.FTL_SOURCES[locale];
  var bundle = new mod.FluentBundle(locale, { useIsolating: false });
  if (text) bundle.addResource(new mod.FluentResource(text));
  l10nBundle = bundle;
  l10nActiveLocale = locale;
}

// Falls back to the raw id (not a blank string) if the active bundle has no
// such message, so a missing/misspelled key is obvious in the UI instead of
// silently disappearing.
function t(id, args) {
  if (l10nBundle) {
    var msg = l10nBundle.getMessage(id);
    if (msg && msg.value) return l10nBundle.formatPattern(msg.value, args);
  }
  return id;
}

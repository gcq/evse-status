var CONFIG_STORAGE_KEY = "evse_config";

var ICONS = {
  eye: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-6.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>',
  refresh: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
  auto: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>',
  bolt: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>'
};

function getConfig() {
  var stored = localStorage.getItem(CONFIG_STORAGE_KEY);
  if (!stored) return null;
  try { return JSON.parse(stored); } catch (e) { return null; }
}

function setConfig(cfg) {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg));
}

function defaultConfig() {
  return {
    handedness: (typeof HANDEDNESS !== "undefined") ? HANDEDNESS : "right",
    theme: "auto",
    locale: "auto",
    locationOrder: "config",
    maxDistanceKm: null,
    flashOnAvailable: true,
    // Account identifiers for evcharge's remote-start call. startChargeMaxM
    // (meters) is the proximity threshold shared by every REMOTE_START
    // adapter — 0 disables the Start button entirely. See adapters/evcharge.md.
    evcharge: { userId: "", cardCode: "", email: "", startChargeMaxM: 10 },
    // Cognito refresh token for electromaps' remote-start call — see
    // adapters/electromaps.md's "Getting a token pair" section.
    electromaps: { refreshToken: "" },
    locations: (typeof LOCATIONS !== "undefined")
      ? JSON.parse(JSON.stringify(LOCATIONS))
      : []
  };
}

function haversineM(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
  var dphi = (lat2 - lat1) * Math.PI / 180;
  var dlam = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dphi / 2) * Math.sin(dphi / 2) +
          Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) * Math.sin(dlam / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(m) {
  return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(1) + " km";
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

var deployedVersionPromise = null;

// Fetches the live-deployed commit sha once per page load and memoizes the
// promise, so the footer and l10n.js's cache-busting query param share one
// network call. Time-boxed short since l10n.js awaits this before loading a
// locale — a slow/unreachable GitHub API must fail fast, not stall the app.
function getDeployedVersion() {
  if (!deployedVersionPromise) {
    deployedVersionPromise = fetch(
      "https://api.github.com/repos/gcq/evse-status/deployments?environment=github-pages&per_page=1",
      { signal: AbortSignal.timeout(4000) }
    )
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(deployments) { return (deployments && deployments[0]) ? deployments[0].sha : null; })
      .catch(function() { return null; }); // offline/rate-limited/timed out — caller falls back
  }
  return deployedVersionPromise;
}

// Pages deploys straight from `main` with no build step, and deploys have
// been failing often enough that "what's live" can silently lag `main` —
// this surfaces the actual deployed commit so that's visible at a glance
// instead of having to check GitHub's Environments tab.
function renderDeployInfo(elId) {
  var el = document.getElementById(elId);
  if (!el) return;
  getDeployedVersion().then(function(sha) {
    if (!sha) return;
    el.textContent = t("deploy-version", { sha: sha.slice(0, 7) });
    el.href = "https://github.com/gcq/evse-status/commit/" + sha;
  });
}

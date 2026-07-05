var CONFIG_STORAGE_KEY = "evse_config";

function getConfig() {
  var stored = localStorage.getItem(CONFIG_STORAGE_KEY);
  if (!stored) return null;
  try { return JSON.parse(stored); } catch (e) { return null; }
}

function setConfig(cfg) {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg));
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

/**
 * Location Service
 * Handles geolocation via Google Maps and IP fallback.
 * Note: CoreLocation and WiFi scanning are skipped on macOS Tahoe (26+)
 * due to tightened privacy restrictions. IP-based location is used instead.
 */
const axios = require('axios');
const wifiService = require('./wifi.service');

/**
 * Returns the macOS major version number, or 0 on other platforms.
 */
function getMacOSMajorVersion() {
  if (process.platform !== 'darwin') return 0;
  try {
    const { execSync } = require('child_process');
    const version = execSync('sw_vers -productVersion', { encoding: 'utf8' }).trim();
    return parseInt(version.split('.')[0], 10);
  } catch {
    return 0;
  }
}

const MACOS_MAJOR = getMacOSMajorVersion();
// macOS 26 (Tahoe) blocks CoreLocation and WiFi BSSID scanning for terminal apps
const SKIP_NATIVE = MACOS_MAJOR >= 26;

/**
 * Gets high-precision location on macOS using native CoreLocation via Swift.
 * Only attempted on macOS < 26.
 */
async function getNativeMacLocation() {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    const path = require('path');
    const helperPath = path.join(__dirname, '../LocationHelper.app/Contents/MacOS/LocationHelper');
    
    exec(helperPath, { timeout: 12000 }, (error, stdout) => {
      try {
        const data = JSON.parse(stdout.trim());
        if (data.error) return reject(new Error(data.error));
        resolve({ lat: data.lat, lon: data.lon, accuracy: data.accuracy });
      } catch {
        reject(new Error('Parse failed'));
      }
    });
  });
}

/**
 * Fetches the current location data using WiFi triangulation or IP fallback.
 * @param {Object} config - Agent configuration containing API keys
 * @returns {Promise<Object|null>} Location data { lat, lon, accuracy, method }
 */
async function getCurrentLocation(config) {
  let locationData = null;
  let method = 'Unknown';

  // 0. Try native macOS CoreLocation (only on macOS < 26)
  if (process.platform === 'darwin') {
    try {
      const nativeLoc = await getNativeMacLocation();
      if (nativeLoc) {
        console.log(`[Location Service] Native location success (±${Math.round(nativeLoc.accuracy)}m)`);
        return { ...nativeLoc, method: 'macOS-Native' };
      }
    } catch (err) {
      console.warn(`[Location Service] Native failed, falling back to IP...`);
    }
  }

  // 1. Try Google Geolocation API (skip WiFi scan on macOS 26+ to avoid noise)
  if (config.googleMapsApiKey) {
    try {
      let networks = [];
      if (!SKIP_NATIVE) {
        networks = await wifiService.scan() || [];
      }

      const payload = {
        considerIp: true,
        wifiAccessPoints: networks.map(nw => ({
          macAddress:     nw.mac,
          signalStrength: nw.signal_level,
          channel:        nw.channel
        }))
      };

      const response = await axios.post(
        `https://www.googleapis.com/geolocation/v1/geolocate?key=${config.googleMapsApiKey}`,
        payload
      );

      if (response.data && response.data.location) {
        locationData = {
          lat: response.data.location.lat,
          lon: response.data.location.lng,
          accuracy: response.data.accuracy
        };
        method = networks.length > 0 ? 'Google' : 'Google-IP';
      }
    } catch (err) {
      // silent — fall through to IP
    }
  }

  // 2. IP fallback if Google failed or accuracy too low (>20km)
  if (!locationData || locationData.accuracy > 20000) {
    try {
      const response = await axios.get('https://ipinfo.io/json');
      if (response.data && response.data.loc) {
        const [lat, lon] = response.data.loc.split(',').map(Number);
        locationData = { lat, lon, accuracy: 3000 };
        method = 'IP-ipinfo';
      }
    } catch {
      // try last resort
    }

    if (!locationData) {
      try {
        const response = await axios.get('http://ip-api.com/json');
        if (response.data && response.data.status === 'success') {
          locationData = {
            lat: response.data.lat,
            lon: response.data.lon,
            accuracy: 5000
          };
          method = 'IP-ip-api';
        }
      } catch {
        // all methods exhausted
      }
    }
  }

  if (locationData) {
    return { ...locationData, method };
  }

  return null;
}

module.exports = { getCurrentLocation };
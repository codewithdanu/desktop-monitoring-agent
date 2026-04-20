/**
 * Location Service
 * Handles geolocation via Google Maps and IP fallback.
 */
const axios = require('axios');
const wifiService = require('./wifi.service');

/**
 * Fetches the current location data using WiFi triangulation or IP fallback.
 * @param {Object} config - Agent configuration containing API keys
 * @returns {Promise<Object|null>} Location data { lat, lon, accuracy, method }
 */
async function getCurrentLocation(config) {
  let locationData = null;
  let method = 'Unknown';

  // 1. Try WiFi Triangulation or Google-IP Triangulation
  if (config.googleMapsApiKey) {
    try {
      const networks = await wifiService.scan();
      
      // Even if networks.length is 0, we still ask Google using 'considerIp: true'
      // Google's IP database is much more accurate than free ones
      console.log(`[Location Service] Querying Google Maps (WiFi count: ${networks ? networks.length : 0})...`);
      
      const payload = {
        considerIp: true,
        wifiAccessPoints: (networks || []).map(nw => ({
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
        method = networks && networks.length > 0 ? 'Google' : 'Google-IP';
      }
    } catch (wifiErr) {
      console.warn(`[Location Service] Google triangulation failed: ${wifiErr.message}`);
    }
  }

  // 2. Secondary Fallback to generic IP-based tracking if Google failed or accuracy is too low (>20km)
  if (!locationData || locationData.accuracy > 20000) {
    if (locationData && locationData.accuracy > 20000) {
      console.log(`[Location Service] Google accuracy too low (${Math.round(locationData.accuracy)}m), trying generic IP API...`);
    } else if (!locationData) {
      console.log(`[Location Service] Google failed, trying generic IP API...`);
    }

    try {
      // Use ip-api.com as final fallback
      const response = await axios.get('http://ip-api.com/json');
      if (response.data && response.data.status === 'success') {
        locationData = {
          lat: response.data.lat,
          lon: response.data.lon,
          accuracy: 5000 // Standard IP accuracy
        };
        method = 'IP-Fallback';
      }
    } catch (ipErr) {
      console.warn(`[Location Service] Final IP fallback failed: ${ipErr.message}`);
    }
  }

  if (locationData) {
    return { ...locationData, method };
  }
  
  return null;
}

module.exports = { getCurrentLocation };

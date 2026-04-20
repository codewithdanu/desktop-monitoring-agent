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
  let method = 'IP';

  // 1. Try WiFi Triangulation if Google API Key exists
  if (config.googleMapsApiKey) {
    try {
      const networks = await wifiService.scan();
      
      if (networks && networks.length > 0) {
        console.log(`[Location Service] Sending ${networks.length} WiFi APs to Google Maps...`);
        
        const payload = {
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
          method = 'Google';
        }
      } else {
        console.warn(`[Location Service] No WiFi networks found during scan. Check Location Services permissions.`);
      }
    } catch (wifiErr) {
      console.warn(`[Location Service] WiFi triangulation failed: ${wifiErr.message}`);
    }
  }

  // 2. Fallback to IP-based tracking if WiFi results are missing or highly inaccurate (>20km)
  if (!locationData || locationData.accuracy > 20000) {
    if (locationData && locationData.accuracy > 20000) {
      console.log(`[Location Service] Google accuracy low (${Math.round(locationData.accuracy)}m), using IP fallback.`);
    } else if (!locationData) {
      console.log(`[Location Service] WiFi scan empty, using IP fallback.`);
    }
    
    try {
      const response = await axios.get('http://ip-api.com/json');
      if (response.data && response.data.status === 'success') {
        // Only override if Google was unavailable or completely inaccurate
        if (!locationData) {
          locationData = {
            lat: response.data.lat,
            lon: response.data.lon,
            accuracy: 5000 // IP accuracy is typically 5km radius
          };
          method = 'IP';
        }
      }
    } catch (ipErr) {
      console.warn(`[Location Service] IP fallback failed: ${ipErr.message}`);
    }
  }

  if (locationData) {
    return { ...locationData, method };
  }
  
  return null;
}

module.exports = { getCurrentLocation };

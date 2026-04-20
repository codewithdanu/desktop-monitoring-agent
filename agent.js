/**
 * Desktop Agent — Main Entry Point
 * Connects to server, registers device, sends metrics, handles commands.
 */
const { io } = require('socket.io-client');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const wifi = require('node-wifi');

// Initialize wifi module
wifi.init({
  iface: null // use default interface
});

// Load config
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('[Agent] config.json not found. Run: node register.js');
  process.exit(1);
}
const config = require('./config.json');

const { collectMetrics } = require('./metrics');
const { handleCommand } = require('./commands');

const socket = io(config.serverUrl, {
  reconnection: true,
  reconnectionDelay: 5000,
  reconnectionAttempts: Infinity,
});

let metricsTimer = null;
let locationTimer = null;

// ---- CONNECTION ----
socket.on('connect', () => {
  console.log(`[Agent] Connected to ${config.serverUrl} (id: ${socket.id})`);
  socket.emit('agent:register', {
    deviceId:    config.deviceId,
    deviceToken: config.deviceToken,
  });
});

// ---- REGISTERED ----
socket.on('agent:registered', () => {
  console.log('[Agent] Registered successfully. Starting metrics loop...');

  // Clear existing timer if reconnecting
  if (metricsTimer) clearInterval(metricsTimer);

  // Send first metrics immediately
  sendMetrics();

  // Then send on interval
  metricsTimer = setInterval(sendMetrics, config.metricsIntervalMs || 30000);

  // Start location loop (every 15 minutes by default)
  if (locationTimer) clearInterval(locationTimer);
  sendLocation();
  locationTimer = setInterval(sendLocation, config.locationIntervalMs || 900000);
});

// ---- METRICS ----
async function sendMetrics() {
  try {
    const metrics = await collectMetrics(config.deviceId);
    socket.emit('agent:metrics', metrics);
    console.log(`[Agent] Metrics sent — CPU: ${metrics.cpu_percent}%, RAM: ${metrics.memory_used_mb}MB`);
  } catch (err) {
    console.error('[Agent] Failed to collect metrics:', err.message);
  }
}

// ---- LOCATION ----
async function sendLocation() {
  try {
    let locationData = null;
    let method = 'IP';

    // 1. Try WiFi Triangulation (if token exists)
    if (config.googleMapsApiKey) {
      try {
        console.log(`[Agent] Scanning ALL WiFi access points using netsh...`);
        
        // Use netsh directly to get ALL BSSIDs (more accurate than node-wifi grouping)
        const { exec } = require('child_process');
        const networks = await new Promise((resolve) => {
          exec('netsh wlan show networks mode=bssid', (error, stdout) => {
            if (error) { resolve([]); return; }
            
            const lines = stdout.split('\r\n');
            const bssids = [];
            let currentSsid = '';
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line.startsWith('SSID')) {
                currentSsid = line.split(':')[1]?.trim() || 'Unknown';
              } else if (line.startsWith('BSSID')) {
                const mac = line.split(':')[1]?.trim() + ':' + line.split(':').slice(2).join(':').trim();
                const signalLine = lines[i+1]?.trim() || '';
                const channelLine = lines[i+2]?.trim() || '';
                
                if (signalLine.startsWith('Signal')) {
                  const signalPercent = parseInt(signalLine.split(':')[1]) || 0;
                  const channel = parseInt(channelLine.split(':')[1]) || 0;
                  
                  // Convert % to dBm
                  const dbm = Math.round((signalPercent / 2) - 100);
                  
                  bssids.push({
                    mac: mac,
                    signal_level: dbm,
                    channel: channel,
                    ssid: currentSsid
                  });
                }
              }
            }
            resolve(bssids);
          });
        });

        console.log(`[Agent] WiFi scan complete. Found ${networks.length} access points.`);
        
        if (networks.length > 0) {
          console.log(`[Agent] Sending ${networks.length} WiFi APs to Google maps...`);
          
          const payload = {
            wifiAccessPoints: networks.map(nw => ({
              macAddress:     nw.mac,
              signalStrength: nw.signal_level,
              channel:        nw.channel
            }))
          };

          const response = await axios.post(`https://www.googleapis.com/geolocation/v1/geolocate?key=${config.googleMapsApiKey}`, payload);

          if (response.data && response.data.location) {
            locationData = {
              lat: response.data.location.lat,
              lon: response.data.location.lng,
              accuracy: response.data.accuracy
            };
            method = 'Google';
          }
        } else {
          console.warn('[Agent] No WiFi access points found via netsh.');
        }
      } catch (wifiErr) {
        console.warn('[Agent] WiFi triangulation failed:', wifiErr.message);
      }
    }

    // 2. Fallback to IP-based tracking if WiFi results are missing or highly inaccurate
    // (Note: accuracy > 20000m usually means Google just guessed the city)
    if (!locationData || locationData.accuracy > 20000) {
      try {
        const response = await axios.get('http://ip-api.com/json');
        if (response.data && response.data.status === 'success') {
          // Only replace if Google was really bad or not working at all
          if (!locationData) {
            locationData = {
              lat: response.data.lat,
              lon: response.data.lon,
              accuracy: 5000
            };
            method = 'IP';
          }
        }
      } catch (ipErr) {
        console.warn('[Agent] IP fallback also failed:', ipErr.message);
      }
    }

    if (locationData) {
      socket.emit('agent:location', {
        deviceId:    config.deviceId,
        latitude:    locationData.lat,
        longitude:   locationData.lon,
        accuracy_meters: locationData.accuracy,
        recorded_at: new Date().toISOString()
      });
      
      const acc = locationData.accuracy ? `±${Math.round(locationData.accuracy)}m` : 'Unknown accuracy';
      console.log(`[Agent] Location updated via ${method} (${acc}): ${locationData.lat}, ${locationData.lon}`);
    } else {
      console.error('[Agent] All geolocation methods failed.');
    }
  } catch (err) {
    console.error('[Agent] Failed to fetch geolocation:', err.message);
  }
}

// ---- COMMAND ----
socket.on('command', async (data) => {
  console.log(`[Agent] Command received: ${data.command_type}`);
  const result = await handleCommand(data, config, socket);
  socket.emit('agent:command_result', {
    commandId: data.commandId,
    status:    result.error ? 'FAILED' : 'EXECUTED',
    result,
  });
  console.log(`[Agent] Command result: ${JSON.stringify(result)}`);
});

// ---- DISCONNECT ----
socket.on('disconnect', (reason) => {
  console.log(`[Agent] Disconnected: ${reason}. Will reconnect...`);
  if (metricsTimer) {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }
  if (locationTimer) {
    clearInterval(locationTimer);
    locationTimer = null;
  }
});

socket.on('connect_error', (err) => {
  console.error(`[Agent] Connection error: ${err.message}`);
});

// ---- GRACEFUL SHUTDOWN ----
process.on('SIGINT', () => {
  console.log('\n[Agent] Shutting down gracefully...');
  if (metricsTimer) clearInterval(metricsTimer);
  if (locationTimer) clearInterval(locationTimer);
  socket.disconnect();
  process.exit(0);
});

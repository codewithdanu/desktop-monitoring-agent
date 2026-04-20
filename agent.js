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
    if (config.unwiredLabsToken) {
      try {
        console.log('[Agent] Scanning WiFi networks for triangulation...');
        const networks = await wifi.scan();
        
        if (networks && networks.length > 0) {
          // Format networks for Unwired Labs API
          const wifiList = networks.map(nw => ({
            bssid:  nw.mac,
            signal: nw.signal_level
          }));

          const response = await axios.post('https://us1.unwiredlabs.com/v2/process.php', {
            token: config.unwiredLabsToken,
            wifi:  wifiList,
            address: 1,
            fallback: 'ip'
          });

          if (response.data && response.data.status === 'ok') {
            locationData = {
              lat: response.data.lat,
              lon: response.data.lon,
              accuracy: response.data.accuracy,
              address: response.data.address
            };
            method = 'WiFi';
          }
        }
      } catch (wifiErr) {
        console.warn('[Agent] WiFi triangulation failed, falling back to IP:', wifiErr.message);
      }
    }

    // 2. Fallback to IP-based tracking
    if (!locationData) {
      const response = await axios.get('http://ip-api.com/json');
      if (response.data && response.data.status === 'success') {
        locationData = {
          lat: response.data.lat,
          lon: response.data.lon,
          city: response.data.city,
          accuracy: 5000 // IP accuracy is usually city-level
        };
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
      
      const debugInfo = locationData.address || locationData.city || 'Unknown';
      console.log(`[Agent] Location updated via ${method} (${debugInfo}): ${locationData.lat}, ${locationData.lon}`);
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

/**
 * Desktop Agent — Main Entry Point
 * Orchestrates metrics collection, location tracking, and remote commands.
 */
const { io } = require('socket.io-client');
const path = require('path');
const fs = require('fs');

// Services
const locationService = require('./services/location.service');
const { collectMetrics } = require('./metrics');
const { handleCommand } = require('./commands');

// Load config
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('[Agent] config.json not found. Run: node register.js');
  process.exit(1);
}
const config = require('./config.json');

// Initialize Socket.io
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
  console.log('[Agent] Registered successfully. Starting monitoring loops...');

  // 1. Initial actions
  sendMetrics();
  sendLocation();

  // 2. Start intervals
  if (metricsTimer) clearInterval(metricsTimer);
  metricsTimer = setInterval(sendMetrics, config.metricsIntervalMs || 30000);

  if (locationTimer) clearInterval(locationTimer);
  locationTimer = setInterval(sendLocation, config.locationIntervalMs || 30000); // Fast update for debugging
});

// ---- METRICS ----
async function sendMetrics() {
  try {
    const metrics = await collectMetrics(config.deviceId);
    socket.emit('agent:metrics', metrics);
    console.log(`[Agent] Metrics: CPU ${metrics.cpu_percent}%, RAM ${metrics.memory_used_mb}MB`);
  } catch (err) {
    console.error('[Agent] Metrics error:', err.message);
  }
}

// ---- LOCATION ----
async function sendLocation() {
  try {
    const location = await locationService.getCurrentLocation(config);
    
    if (location) {
      socket.emit('agent:location', {
        deviceId:    config.deviceId,
        latitude:    location.lat,
        longitude:   location.lon,
        accuracy_meters: location.accuracy,
        recorded_at: new Date().toISOString()
      });
      
      const acc = location.accuracy ? `±${Math.round(location.accuracy)}m` : 'Unknown';
      console.log(`[Agent] Location: ${location.method} (${acc}) -> ${location.lat}, ${location.lon}`);
    } else {
      console.error('[Agent] Location tracking failed (all methods).');
    }
  } catch (err) {
    console.error('[Agent] Location error:', err.message);
  }
}

// ---- COMMANDS ----
socket.on('command', async (data) => {
  console.log(`[Agent] Command: ${data.command_type}`);
  const result = await handleCommand(data, config, socket);
  
  socket.emit('agent:command_result', {
    commandId: data.commandId,
    status:    result.error ? 'FAILED' : 'EXECUTED',
    result,
  });
});

// ---- DISCONNECT ----
socket.on('disconnect', (reason) => {
  console.log(`[Agent] Disconnected (${reason}).`);
  if (metricsTimer) clearInterval(metricsTimer);
  if (locationTimer) clearInterval(locationTimer);
});

socket.on('connect_error', (err) => {
  console.error(`[Agent] Connection error: ${err.message}`);
});

// ---- GRACEFUL SHUTDOWN ----
process.on('SIGINT', () => {
  console.log('\n[Agent] Shutting down...');
  socket.disconnect();
  process.exit(0);
});

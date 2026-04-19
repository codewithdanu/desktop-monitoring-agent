/**
 * Desktop Agent — Main Entry Point
 * Connects to server, registers device, sends metrics, handles commands.
 */
const { io } = require('socket.io-client');
const path = require('path');
const fs = require('fs');

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
});

socket.on('connect_error', (err) => {
  console.error(`[Agent] Connection error: ${err.message}`);
});

// ---- GRACEFUL SHUTDOWN ----
process.on('SIGINT', () => {
  console.log('\n[Agent] Shutting down gracefully...');
  if (metricsTimer) clearInterval(metricsTimer);
  socket.disconnect();
  process.exit(0);
});

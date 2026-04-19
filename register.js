/**
 * Device Registration Script
 * Run this once to register this device with the server.
 * Creates config.json with deviceId and deviceToken.
 *
 * Usage:
 *   node register.js
 *
 * Edit the SERVER and USER_TOKEN variables below before running.
 */
require('dotenv').config();
const axios = require('axios');
const os    = require('os');
const fs    = require('fs');
const path  = require('path');

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
// Load values from .env file
const SERVER      = process.env.SERVER_URL   || 'http://localhost:3000';
const USER_TOKEN  = process.env.USER_TOKEN   || '';
const DEVICE_TYPE = process.env.DEVICE_TYPE || 'PC';
const MAC_ADDRESS = process.env.MAC_ADDRESS || '';

// ─────────────────────────────────────────────────────────────────────────────

// Get MAC: Windows → getmac /v /fo list | Linux/Mac → ifconfig | grep ether
// ─────────────────────────────────────────────────────────────────────────────

async function register() {
  try {
    console.log(`[Register] Connecting to ${SERVER}...`);

    const { data } = await axios.post(
      `${SERVER}/api/devices/register`,
      {
        name:        os.hostname(),
        device_type: DEVICE_TYPE,
        os:          `${process.platform} (${os.arch()})`,
        mac_address:  MAC_ADDRESS,
      },
      {
        headers: { Authorization: `Bearer ${USER_TOKEN}` },
        timeout: 10000,
      }
    );

    const config = {
      serverUrl:        SERVER,
      deviceId:         data.deviceId,
      deviceToken:      data.deviceToken,
      deviceType:       DEVICE_TYPE,
      metricsIntervalMs: 30000,
    };

    const configPath = path.join(__dirname, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log('\n✅ Registration successful!');
    console.log(`   Device Name:  ${os.hostname()}`);
    console.log(`   Device ID:    ${data.deviceId}`);
    console.log(`   Device Token: ${data.deviceToken}`);
    console.log(`\n   config.json saved. Now run: node agent.js`);
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    console.error(`\n❌ Registration failed: ${msg}`);
    console.error('\nMake sure:');
    console.error('  1. Server is running');
    console.error('  2. USER_TOKEN is a valid JWT from login');
    console.error('  3. SERVER URL is correct');
    process.exit(1);
  }
}

register();

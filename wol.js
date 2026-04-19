/**
 * Wake-on-LAN Sender
 * Sends a magic packet to wake a device from sleep/shutdown.
 */
const wol = require('wake_on_lan');

/**
 * Send a WoL magic packet.
 * @param {string} macAddress - e.g. "AA:BB:CC:DD:EE:FF"
 * @param {string} broadcastIp - e.g. "255.255.255.255" or "192.168.1.255"
 * @returns {Promise<object>}
 */
function sendWol(macAddress, broadcastIp = '255.255.255.255') {
  if (!macAddress) {
    return Promise.resolve({ error: 'mac_address required' });
  }

  return new Promise((resolve) => {
    wol.wake(macAddress, { address: broadcastIp }, (err) => {
      if (err) {
        resolve({ error: err.message });
      } else {
        resolve({
          message:      `WoL magic packet sent to ${macAddress}`,
          broadcastIp,
        });
      }
    });
  });
}

module.exports = { sendWol };

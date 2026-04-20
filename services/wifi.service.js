/**
 * WiFi Service
 * Handles platform-specific WiFi scanning (Windows, macOS, Linux).
 */
const { exec } = require('child_process');

/**
 * Scans for available WiFi access points and returns a normalized list of BSSIDs.
 * @returns {Promise<Array>} List of { mac, signal_level, channel }
 */
async function scan() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const isLin = process.platform === 'linux';

  return new Promise((resolve) => {
    let command = '';
    if (isWin) {
      command = 'netsh wlan show networks mode=bssid';
    } else if (isMac) {
      // Use system_profiler as it's more reliable on modern macOS (Sonoma/Sequoia)
      command = 'system_profiler SPAirPortDataType';
    } else if (isLin) {
      command = 'nmcli -t -f BSSID,SIGNAL,CHAN dev wifi list';
    } else {
      console.warn(`[WiFi Service] Platform ${process.platform} not supported for WiFi scanning.`);
      resolve([]);
      return;
    }

    exec(command, (error, stdout) => {
      if (error) {
        console.error(`[WiFi Service] Command failed: ${error.message}`);
        resolve([]);
        return;
      }

      const bssids = [];

      try {
        if (isWin) {
          parseWindows(stdout, bssids);
        } else if (isMac) {
          parseMac(stdout, bssids);
        } else if (isLin) {
          parseLinux(stdout, bssids);
        }
      } catch (parseErr) {
        console.error(`[WiFi Service] Parsing error: ${parseErr.message}`);
      }

      resolve(bssids);
    });
  });
}

function parseWindows(stdout, bssids) {
  const lines = stdout.split('\r\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('BSSID')) {
      const mac = line.split(':')[1]?.trim() + ':' + line.split(':').slice(2).join(':').trim();
      const signalLine = lines[i + 1]?.trim() || '';
      const channelLine = lines[i + 2]?.trim() || '';
      if (signalLine.startsWith('Signal')) {
        const signalPercent = parseInt(signalLine.split(':')[1]) || 0;
        const channel = parseInt(channelLine.split(':')[1]) || 0;
        const dbm = Math.round((signalPercent / 2) - 100);
        bssids.push({ mac: mac.toLowerCase(), signal_level: dbm, channel: channel });
      }
    }
  }
}

function parseMac(stdout, bssids) {
  // system_profiler SPAirPortDataType output is structured with indentation
  const lines = stdout.split('\n');
  let currentBssid = null;
  let currentRssi = null;
  let currentChannel = null;

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('BSSID:')) {
      currentBssid = trimmed.split('BSSID:')[1].trim().toLowerCase();
    } else if (trimmed.startsWith('Signal / Noise:')) {
      // Format: "Signal / Noise: -53 dBm / -92 dBm"
      const signalPart = trimmed.split('Signal / Noise:')[1].split('/')[0].trim();
      currentRssi = parseInt(signalPart);
    } else if (trimmed.startsWith('Channel:')) {
      currentChannel = parseInt(trimmed.split('Channel:')[1].trim());
    }

    // When we have a BSSID and RSSI, push it. 
    // In system_profiler, these usually appear together under each network name
    if (currentBssid && currentRssi !== null) {
      bssids.push({
        mac: currentBssid,
        signal_level: currentRssi,
        channel: currentChannel || 0
      });
      // Reset for next block
      currentBssid = null;
      currentRssi = null;
      currentChannel = null;
    }
  }
}

function parseLinux(stdout, bssids) {
  const lines = stdout.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(':');
    if (parts.length >= 8) {
      const chan = parseInt(parts.pop());
      const rssi = parseInt(parts.pop());
      const mac = parts.join(':');
      bssids.push({ mac: mac.toLowerCase(), signal_level: rssi, channel: chan });
    }
  }
}

module.exports = { scan };

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
      // Try multiple airport paths + system_profiler as final fallback
      command = `
        if [ -f "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport" ]; then
          /System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -s
        elif [ -f "/System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport" ]; then
          /System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport -s
        else
          system_profiler SPAirPortDataType
        fi
      `.trim();
    } else if (isLin) {
      command = 'nmcli -t -f BSSID,SIGNAL,CHAN dev wifi list';
    } else {
      console.warn(`[WiFi Service] Platform ${process.platform} not supported for WiFi scanning.`);
      resolve([]);
      return;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`[WiFi Service] Command failed: ${error.message}`);
        if (stderr) console.error(`[WiFi Service] Stderr: ${stderr}`);
        resolve([]);
        return;
      }

      if (!stdout || stdout.trim() === '') {
        console.warn(`[WiFi Service] Command returned empty output.`);
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
      
      console.log(`[WiFi Service] Scan finished. Found ${bssids.length} networks.`);
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
  // Support both 'airport -s' (tabular) and 'system_profiler' (indented)
  const lines = stdout.split('\n');

  // Check if it's airport output (tabular format with BSSID usually in the second column)
  const isAirport = stdout.includes('SSID BSSID');

  if (isAirport) {
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const macMatch = line.match(/([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}/);
      if (macMatch) {
        const mac = macMatch[0];
        // In airport -s output: [SSID, BSSID, RSSI, CHANNEL, ...]
        const macIndex = parts.indexOf(mac);
        if (macIndex !== -1 && parts[macIndex + 1]) {
          const rssi = parseInt(parts[macIndex + 1]);
          const channel = parseInt(parts[macIndex + 2]);
          bssids.push({ mac: mac.toLowerCase(), signal_level: rssi, channel: channel });
        }
      }
    }
  } else {
    // system_profiler format
    let currentBssid = null;
    let currentRssi = null;
    let currentChannel = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('BSSID:')) {
        currentBssid = trimmed.split('BSSID:')[1].trim().toLowerCase();
      } else if (trimmed.startsWith('Signal / Noise:')) {
        currentRssi = parseInt(trimmed.split('Signal / Noise:')[1].split('/')[0].trim());
      } else if (trimmed.startsWith('Channel:')) {
        currentChannel = parseInt(trimmed.split('Channel:')[1].trim());
      }

      if (currentBssid && currentRssi !== null) {
        bssids.push({
          mac: currentBssid,
          signal_level: currentRssi,
          channel: currentChannel || 0
        });
        currentBssid = null;
        currentRssi = null;
        currentChannel = null;
      }
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

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
      // Use native Swift with improved escaping and type safety
      const swiftCode = 'import CoreWLAN; if let i = CWWiFiClient.shared().interface(), let ns = try? i.scanForNetworks(withSSID: nil) { for n in ns { let b = n.bssid ?? "??"; print(b, n.rssiValue, n.wlanChannel.channelNumber, separator: " | ") } }';
      command = `swift -e '${swiftCode}'`;
    } else if (isLin) {
      command = 'nmcli -t -f BSSID,SIGNAL,CHAN dev wifi list';
    } else {
      console.warn(`[WiFi Service] Platform ${process.platform} not supported for WiFi scanning.`);
      resolve([]);
      return;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        // Fallback for strict Swift versions where bssid is non-optional String
        if (error.message.includes('non-optional')) {
          const fallbackSwift = 'import CoreWLAN; if let i = CWWiFiClient.shared().interface(), let ns = try? i.scanForNetworks(withSSID: nil) { for n in ns { print(n.bssid, n.rssiValue, n.wlanChannel.channelNumber, separator: " | ") } }';
          exec(`swift -e '${fallbackSwift}'`, (err2, out2) => {
            if (err2) {
              console.error(`[WiFi Service] Swift fallback failed: ${err2.message}`);
              resolve([]);
            } else {
              parseMac(out2, bssids);
              console.log(`[WiFi Service] Scan finished via fallback. Found ${bssids.length} networks.`);
              resolve(bssids);
            }
          });
          return;
        }

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
  // Format: "BSSID | RSSI | CHANNEL"
  const lines = stdout.split('\n');
  let permissionWarningShown = false;

  for (const line of lines) {
    if (!line.includes('|')) continue;
    
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 2) continue;

    const mac = parts[0];
    const rssi = parts[1];
    const channel = parts[2] || '0';
    
    if (mac === '??' || mac === '00:00:00:00:00:00' || mac === 'nil') {
      if (!permissionWarningShown) {
        console.warn('[WiFi Service] macOS is censoring BSSIDs. PLEASE ENABLE "Location Services" FOR TERMINAL in System Settings!');
        permissionWarningShown = true;
      }
      continue;
    }

    if (mac && rssi) {
      bssids.push({
        mac: mac.toLowerCase(),
        signal_level: parseInt(rssi),
        channel: parseInt(channel) || 0
      });
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

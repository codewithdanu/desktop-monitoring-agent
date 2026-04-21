/**
 * Activity Monitor
 * Tracks the focused window and emits logs to the server.
 */
const activeWin = require('active-win');

class ActivityMonitor {
  constructor(socket, deviceId, interval = 1000) {
    this.socket = socket;
    this.deviceId = deviceId;
    this.interval = interval;
    this.timer = null;
    this.lastWindow = null;
  }

  start() {
    console.log('[Activity] Starting active window monitor...');
    this.timer = setInterval(() => this.check(), this.interval);
    this.check(); // Initial check
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    console.log('[Activity] Stopped monitor.');
  }

  async check() {
    try {
      const window = await activeWin();
      if (!window) return;

      const windowId = `${window.owner.name}:${window.title}`;
      
      if (windowId !== this.lastWindow) {
        this.lastWindow = windowId;
        
        const payload = {
          deviceId:     this.deviceId,
          package_name: window.owner.name,
          app_name:     window.owner.name,
          activity:     window.title,
          timestamp:    new Date().toISOString()
        };

        console.log(`[Activity] Focus: [${payload.app_name}] ${payload.activity}`);
        this.socket.emit('agent:activity_log', payload);
      }
    } catch (err) {
      // Quietly ignore errors (some apps might be inaccessible)
    }
  }
}

module.exports = ActivityMonitor;

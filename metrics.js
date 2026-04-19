/**
 * Metrics Collector
 * Collects CPU, RAM, Disk, and Battery info using systeminformation.
 */
const si = require('systeminformation');

/**
 * Collect system metrics.
 * @param {string} deviceId
 * @returns {Promise<object>}
 */
async function collectMetrics(deviceId) {
  const [cpu, mem, disk, battery] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.battery(),
  ]);

  // Pick the largest disk as the "main" disk
  const mainDisk = disk.reduce((best, d) => (d.size > (best?.size || 0) ? d : best), null) || {};

  return {
    deviceId,
    cpu_percent:     parseFloat(cpu.currentLoad.toFixed(1)),
    memory_used_mb:  Math.round(mem.used / 1024 / 1024),
    memory_total_mb: Math.round(mem.total / 1024 / 1024),
    disk_used_gb:    parseFloat(((mainDisk.used || 0) / 1e9).toFixed(2)),
    disk_total_gb:   parseFloat(((mainDisk.size || 0) / 1e9).toFixed(2)),
    battery_percent: battery.hasBattery ? battery.percent : null,
    timestamp:       Date.now(),
  };
}

module.exports = { collectMetrics };

/**
 * Command Handler
 * Processes commands received from server and executes them on the local machine.
 */
const { exec, execSync } = require('child_process');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { uploadFile } = require('./fileSync');
const { sendWol }    = require('./wol');

const platform = process.platform; // 'win32' | 'darwin' | 'linux'

/**
 * Handle incoming command.
 * @param {object} data - { command_type, command_params, commandId }
 * @param {object} config - agent config
 * @param {object} socket - socket.io-client instance
 * @returns {Promise<object>}
 */
async function handleCommand({ command_type, command_params = {} }, config) {
  try {
    switch (command_type) {
      // ---- POWER ----
      case 'SHUTDOWN':       return shutdown();
      case 'RESTART':        return restart();
      case 'SLEEP':          return sleep();
      case 'LOCK_SCREEN':    return lockScreen();
      case 'CANCEL_SHUTDOWN':return cancelShutdown();

      // ---- WAKE ON LAN ----
      case 'WAKE_ON_LAN':
        return sendWol(command_params.mac_address, command_params.broadcast_ip);

      // ---- FILES ----
      case 'LIST_FILES':
        return listFiles(command_params.directory);
      case 'UPLOAD_FILE':
        return uploadFile(command_params.file_path, config);
      case 'DELETE_FILE':
        return deleteFile(command_params.file_path);

      // ---- SYSTEM ----
      case 'GET_SYSTEM_INFO':
        return getSystemInfo();
      case 'RUN_COMMAND':
        return runShellCommand(command_params.cmd);
      
      case 'PING':
      case 'HEARTBEAT':
        return { message: 'Pong! Desktop agent is online.', timestamp: new Date().toISOString() };

      default:
        return { error: `Unknown command: ${command_type}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// ─── POWER ────────────────────────────────────────────────────────────────────

function shutdown() {
  if (platform === 'win32') execSync('shutdown /s /t 30', { windowsHide: true });
  else if (platform === 'darwin') exec('osascript -e \'tell app "System Events" to shut down\'');
  else execSync('shutdown -h +1');
  return { message: 'Shutdown scheduled in 30s' };
}

function restart() {
  if (platform === 'win32') execSync('shutdown /r /t 30', { windowsHide: true });
  else if (platform === 'darwin') exec('osascript -e \'tell app "System Events" to restart\'');
  else execSync('shutdown -r +1');
  return { message: 'Restart scheduled in 30s' };
}

function cancelShutdown() {
  if (platform === 'win32') execSync('shutdown /a', { windowsHide: true });
  else execSync('shutdown -c');
  return { message: 'Shutdown cancelled' };
}

function sleep() {
  if (platform === 'win32') {
    execSync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', { windowsHide: true });
  } else if (platform === 'darwin') {
    exec('osascript -e \'tell application "System Events" to sleep\'');
  } else {
    exec('systemctl suspend');
  }
  return { message: 'Going to sleep' };
}

function lockScreen() {
  if (platform === 'win32') {
    execSync('rundll32 user32.dll,LockWorkStation', { windowsHide: true });
  } else if (platform === 'darwin') {
    exec('osascript -e \'tell application "System Events" to key code 12 using {command down, control down}\'');
  } else {
    exec('loginctl lock-session');
  }
  return { message: 'Screen locked' };
}

// ─── FILES ────────────────────────────────────────────────────────────────────

function listFiles(directory) {
  const dir = directory || os.homedir();
  try {
    const items = fs.readdirSync(dir).map((name) => {
      try {
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        return {
          name,
          path:        fullPath,
          isDirectory: stat.isDirectory(),
          size:        stat.size,
          modified:    stat.mtime,
        };
      } catch {
        return { name, path: path.join(dir, name), error: 'Access denied' };
      }
    });
    return { directory: dir, items, count: items.length };
  } catch (err) {
    return { error: `Cannot read directory: ${err.message}` };
  }
}

function deleteFile(filePath) {
  if (!filePath) return { error: 'file_path required' };
  if (!fs.existsSync(filePath)) return { error: 'File not found' };
  fs.unlinkSync(filePath);
  return { message: `Deleted: ${filePath}` };
}

// ─── SYSTEM INFO ──────────────────────────────────────────────────────────────

function getSystemInfo() {
  return {
    hostname:         os.hostname(),
    platform:         process.platform,
    arch:             os.arch(),
    cpus:             os.cpus().length,
    cpu_model:        os.cpus()[0]?.model || 'Unknown',
    total_memory_gb:  (os.totalmem() / 1e9).toFixed(2),
    free_memory_gb:   (os.freemem() / 1e9).toFixed(2),
    uptime_hours:     (os.uptime() / 3600).toFixed(1),
    node_version:     process.version,
  };
}

// ─── SHELL ────────────────────────────────────────────────────────────────────

function runShellCommand(cmd) {
  if (!cmd) return { error: 'cmd required' };
  try {
    const output = execSync(cmd, { timeout: 10000, stdio: 'pipe', windowsHide: true }).toString();
    return { output, exit_code: 0 };
  } catch (err) {
    return { output: err.stdout?.toString() || '', error: err.message, exit_code: err.status };
  }
}

module.exports = { handleCommand };

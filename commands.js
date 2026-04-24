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
const screenshot     = require('screenshot-desktop');

const platform = process.platform; // 'win32' | 'darwin' | 'linux'
let currentCwd = process.cwd();

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
        const listDir = command_params.directory 
          ? (path.isAbsolute(command_params.directory) ? command_params.directory : path.resolve(currentCwd, command_params.directory))
          : currentCwd;
        return listFiles(listDir);
      case 'UPLOAD_FILE':
        const uploadPath = path.isAbsolute(command_params.file_path)
          ? command_params.file_path
          : path.resolve(currentCwd, command_params.file_path);
        return uploadFile(uploadPath, config);
      case 'DELETE_FILE':
        const deletePath = path.isAbsolute(command_params.file_path)
          ? command_params.file_path
          : path.resolve(currentCwd, command_params.file_path);
        return deleteFile(deletePath);
      case 'ZIP_FILE':
        const targetToZip = path.isAbsolute(command_params.path) ? command_params.path : path.resolve(currentCwd, command_params.path);
        const zipOutput  = path.isAbsolute(command_params.output) ? command_params.output : path.resolve(currentCwd, command_params.output);
        return await zipFile(targetToZip, zipOutput);
      case 'UNZIP_FILE':
        const zipToExtract = path.isAbsolute(command_params.path) ? command_params.path : path.resolve(currentCwd, command_params.path);
        const unzipDest    = path.isAbsolute(command_params.output) ? command_params.output : path.resolve(currentCwd, command_params.output);
        const res = await unzipFile(zipToExtract, unzipDest);
        if (res.message && command_params.remove_source) {
           try { fs.unlinkSync(zipToExtract); } catch (e) {}
        }
        return res;

      // ---- SYSTEM ----
      case 'GET_SYSTEM_INFO':
        return getSystemInfo();
      case 'RUN_COMMAND':
        return runShellCommand(command_params.cmd);
      case 'CAPTURE_SCREEN':
        return captureScreen(config);
      
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

function zipFile(targetPath, outputPath) {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(targetPath)) return resolve({ error: 'Target not found' });
      let finalZip = outputPath;
      if (!finalZip) {
        const base = path.basename(targetPath);
        finalZip = path.join(path.dirname(targetPath), `${base}.zip`);
      }
      
      const cmd = platform === 'win32' 
        ? `powershell -Command "Compress-Archive -Path '${targetPath}' -DestinationPath '${finalZip}' -CompressionLevel Fastest -Force"`
        : `zip -r "${finalZip}" "${targetPath}"`;

      exec(cmd, { windowsHide: true }, (error) => {
        if (error) {
          resolve({ error: `Zip failed: ${error.message}` });
        } else {
          resolve({ message: `Zipped to: ${finalZip}`, path: finalZip });
        }
      });
    } catch (err) {
      resolve({ error: `Zip error: ${err.message}` });
    }
  });
}

function unzipFile(zipPath, destPath) {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(zipPath)) return resolve({ error: 'Zip file not found' });
      const finalDest = destPath || path.dirname(zipPath);
      
      const cmd = platform === 'win32'
        ? `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${finalDest}' -Force"`
        : `unzip -o "${zipPath}" -d "${finalDest}"`;

      exec(cmd, { windowsHide: true }, (error) => {
        if (error) {
          resolve({ error: `Unzip failed: ${error.message}` });
        } else {
          resolve({ message: `Unzipped to: ${finalDest}` });
        }
      });
    } catch (err) {
      resolve({ error: `Unzip error: ${err.message}` });
    }
  });
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
  
  const trimmedCmd = cmd.trim();

  // Handle 'cd' commands manually to maintain state
  if (trimmedCmd.startsWith('cd ')) {
    const newDir = trimmedCmd.substring(3).trim().replace(/^["']|["']$/g, '');
    try {
      const resolvedPath = path.resolve(currentCwd, newDir);
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        currentCwd = resolvedPath;
        return { output: `Changed directory to: ${currentCwd}`, exit_code: 0, cwd: currentCwd };
      } else {
        return { error: `Directory not found: ${newDir}`, exit_code: 1 };
      }
    } catch (err) {
      return { error: err.message, exit_code: 1 };
    }
  }

  return new Promise((resolve) => {
    const options = { 
      timeout: 30000, 
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      cwd: currentCwd,
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    };

    exec(cmd, options, (error, stdout, stderr) => {
      const output = stdout ? stdout.toString() : '';
      const errOutput = stderr ? stderr.toString() : '';
      
      if (error) {
        resolve({ 
          output: output + errOutput, 
          error: error.message, 
          exit_code: error.code || 1,
          cwd: currentCwd
        });
      } else {
        resolve({ 
          output, 
          exit_code: 0,
          cwd: currentCwd
        });
      }
    });
  });
}

// ─── SCREEN CAPTURE ───────────────────────────────────────────────────────────

async function captureScreen(config) {
  const tempPath = path.join(os.tmpdir(), `screenshot_${Date.now()}.jpg`);
  try {
    await screenshot({ filename: tempPath, format: 'jpg' });
    const result = await uploadFile(tempPath, config);
    // Cleanup
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    return result;
  } catch (err) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    return { error: `Screenshot failed: ${err.message}` };
  }
}

module.exports = { handleCommand };

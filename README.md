# Desktop Agent — Device Monitoring System

Node.js agent that runs on PC/Laptop. Connects to server, sends metrics, executes commands.

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Register this device (first time only)
Edit `register.js` and set:
- `SERVER` — your backend URL
- `USER_TOKEN` — JWT token from login
- `DEVICE_TYPE` — PC, LAPTOP
- `MAC_ADDRESS` — your NIC MAC address

```bash
node register.js
# → creates config.json
```

### 3. Run agent
```bash
node agent.js
```

## Commands Supported

| Command | Description |
|---------|-------------|
| `LOCK_SCREEN` | Lock the workstation |
| `SLEEP` | Put PC to sleep |
| `RESTART` | Schedule restart (30s delay) |
| `SHUTDOWN` | Schedule shutdown (30s delay) |
| `CANCEL_SHUTDOWN` | Cancel pending shutdown |
| `WAKE_ON_LAN` | Send WoL magic packet |
| `LIST_FILES` | List files in directory |
| `UPLOAD_FILE` | Upload file to server |
| `DELETE_FILE` | Delete local file |
| `GET_SYSTEM_INFO` | Get hostname, CPU, RAM, uptime |
| `RUN_COMMAND` | Run shell command (use carefully) |

## Running in Background (Recommended)

To run the agent in the background and ensure it stays alive or restarts on failure, use **PM2**:

### 1. Install PM2
```bash
npm install -g pm2
```

### 2. Start Agent
```bash
pm2 start agent.js --name "device-agent"
```

### 3. Monitoring & Logs
```bash
pm2 list          # Check status
pm2 logs          # View real-time logs
pm2 stop all      # Stop the agent
```

### 4. Enable Autostart on Boot
```bash
# Windows
npm install -g pm2-windows-startup
pm2-startup install
pm2 save

# Linux/macOS
pm2 startup
pm2 save
```

## Manual Autostart (Alternative)

### Windows — Task Scheduler
```cmd
schtasks /create /tn "DeviceAgent" /tr "node C:\path\to\agent.js" /sc onlogon /f
```


## Enable Wake-on-LAN

1. **BIOS**: Enable "Wake on LAN" / "PME Wake Up" in Power Management
2. **Windows NIC**: Device Manager → NIC → Properties → Power Management → "Allow to wake computer" + Advanced → "Wake on Magic Packet"
3. **Get MAC**: `getmac /v /fo list` (Windows) or `ifconfig | grep ether` (Mac/Linux)

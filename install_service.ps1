# Desktop Agent — Persistence Script (Windows)
# This script sets up the agent to run automatically on system startup.

$AgentPath = Get-Location
$NodePath = Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source

if (-not $NodePath) {
    Write-Error "Node.js not found in PATH. Please install Node.js first."
    exit 1
}

$TaskName = "DeviceMonitoringAgent"
$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "agent.js" -WorkingDirectory $AgentPath.Path
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365)

# Register the task
Write-Host "Registering Scheduled Task: $TaskName"
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -User "SYSTEM" -Force

Write-Host "Success! The agent will now run automatically when the system starts."
Write-Host "You can manage this task in 'Task Scheduler' under '$TaskName'."

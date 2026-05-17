$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$startAndroidScript = Join-Path $root 'scripts\start-android-dev.ps1'

# Start the backend in a new PowerShell window so logs stay visible
Start-Process powershell -ArgumentList @(
  '-NoExit',
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-Command', "Set-Location -Path '$backend'; uvicorn server:app --host 0.0.0.0 --port 8000 --reload"
) -WorkingDirectory $backend

# Wait for backend to respond
$maxAttempts = 30
$attempt = 0
while ($attempt -lt $maxAttempts) {
  try {
    Invoke-RestMethod -Uri 'http://localhost:8000/api/' -Method Get -TimeoutSec 5 | Out-Null
    Write-Host 'Backend is reachable.'
    break
  } catch {
    Start-Sleep -Seconds 1
    $attempt++
  }
}

if ($attempt -ge $maxAttempts) {
  Write-Host 'Backend did not become reachable in time. Check the backend window for errors.' -ForegroundColor Yellow
  Exit 1
}

# Start Android (this will run the existing script which handles ADB reverse and starting Expo)
powershell -NoProfile -ExecutionPolicy Bypass -File $startAndroidScript

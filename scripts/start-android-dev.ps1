param(
  [switch]$ExpoGo
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root 'frontend'
$adbPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'

try {
  Invoke-RestMethod -Uri 'http://localhost:8000/api/' -Method Get -TimeoutSec 8 | Out-Null
} catch {
  throw 'Backend is not reachable. Start it first: cd backend; uvicorn server:app --host 0.0.0.0 --port 8000'
}

if (Test-Path -LiteralPath $adbPath) {
  $devicesOutput = & $adbPath devices
  $devices = @($devicesOutput | Where-Object { $_ -match "`tdevice$" })
  if ($devices.Count -gt 0) {
    & $adbPath reverse tcp:8000 tcp:8000 | Out-Null
    Write-Host 'ADB reverse ready: device localhost:8000 -> PC localhost:8000'
  } else {
    Write-Host 'No Android device found over ADB. Expo will still start.'
  }
} else {
  Write-Host "ADB not found at $adbPath. Expo will still start."
}

$env:EXPO_PUBLIC_BACKEND_URL_ANDROID = 'http://localhost:8000'
$env:EXPO_NO_TELEMETRY = '1'
$env:__UNSAFE_EXPO_HOME_DIRECTORY = '.expo-home'

Push-Location $frontend
try {
  if ($ExpoGo) {
    npm.cmd run android:usb
  } else {
    npm.cmd run dev-client:usb
  }
} finally {
  Pop-Location
}

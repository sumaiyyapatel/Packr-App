$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$adbPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$ok = $true

function Write-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Detail = ''
  )

  $status = if ($Passed) { 'OK' } else { 'FAIL' }
  if ($Detail) {
    Write-Host "$status $Name - $Detail"
  } else {
    Write-Host "$status $Name"
  }
}

try {
  $api = Invoke-RestMethod -Uri 'http://localhost:8000/api/' -Method Get -TimeoutSec 8
  Write-Check 'backend' ($api.status -eq 'ok') 'http://localhost:8000/api/'
} catch {
  $ok = $false
  Write-Check 'backend' $false 'start: cd backend; uvicorn server:app --host 0.0.0.0 --port 8000'
}

try {
  $mongo = Test-NetConnection -ComputerName '127.0.0.1' -Port 27017 -WarningAction SilentlyContinue
  Write-Check 'mongodb' $mongo.TcpTestSucceeded '127.0.0.1:27017'
  if (-not $mongo.TcpTestSucceeded) { $ok = $false }
} catch {
  $ok = $false
  Write-Check 'mongodb' $false 'MongoDB is not reachable'
}

if (-not (Test-Path -LiteralPath $adbPath)) {
  $ok = $false
  Write-Check 'adb' $false "missing: $adbPath"
} else {
  $devicesOutput = & $adbPath devices
  $devices = @($devicesOutput | Where-Object { $_ -match "`tdevice$" })
  Write-Check 'adb devices' ($devices.Count -gt 0) "$($devices.Count) connected"
  if ($devices.Count -eq 0) {
    $ok = $false
  } else {
    & $adbPath reverse tcp:8000 tcp:8000 | Out-Null
    $reverseOutput = & $adbPath reverse --list
    $hasReverse = [bool]($reverseOutput | Select-String 'tcp:8000 tcp:8000')
    Write-Check 'adb reverse' $hasReverse 'tcp:8000 -> tcp:8000'
    if (-not $hasReverse) { $ok = $false }

    try {
      $phoneApi = & $adbPath shell curl -sS -m 8 'http://127.0.0.1:8000/api/'
      $phoneOk = $phoneApi -match '"status"\s*:\s*"ok"'
      Write-Check 'phone backend' $phoneOk 'http://127.0.0.1:8000/api/'
      if (-not $phoneOk) { $ok = $false }
    } catch {
      $ok = $false
      Write-Check 'phone backend' $false 'device could not reach backend through USB reverse'
    }
  }
}

if (-not $ok) {
  exit 1
}

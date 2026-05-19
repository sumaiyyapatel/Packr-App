param(
  [string]$BackendUrl = $env:EXPO_PUBLIC_BACKEND_URL
)

$ErrorActionPreference = 'Stop'

if (-not $BackendUrl) {
  throw 'Pass -BackendUrl https://your-backend.example or set EXPO_PUBLIC_BACKEND_URL.'
}
if (-not $BackendUrl.StartsWith('https://')) {
  throw 'Hosted APK builds require an HTTPS backend URL.'
}

$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root 'frontend'
$android = Join-Path $frontend 'android'
$gradle = Join-Path $android 'gradlew.bat'
$jdk = Join-Path $env:ProgramFiles 'Eclipse Adoptium\jdk-17.0.19.10-hotspot'
$androidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'

if (-not (Test-Path -LiteralPath $jdk)) {
  throw "JDK not found: $jdk"
}
if (-not (Test-Path -LiteralPath $androidSdk)) {
  throw "Android SDK not found: $androidSdk"
}

$env:EXPO_PUBLIC_BACKEND_URL = $BackendUrl.TrimEnd('/')
$env:PACKR_ANDROID_ALLOW_CLEARTEXT = '0'
$env:NODE_ENV = 'production'
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
$env:GRADLE_OPTS = '-Dkotlin.compiler.execution.strategy=in-process'
$env:PATH = "$jdk\bin;$androidSdk\platform-tools;$androidSdk\emulator;$env:PATH"

Push-Location $frontend
try {
  if (-not (Test-Path -LiteralPath $gradle)) {
    npm.cmd exec -- expo prebuild --platform android
  }
  Push-Location $android
  try {
    .\gradlew.bat --no-daemon assembleRelease
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}

$apk = Join-Path $android 'app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path -LiteralPath $apk)) {
  throw "Release APK was not found: $apk"
}

Write-Host "APK ready: $apk"

# PowerShell counterpart to scripts/build-apk.sh for Windows
$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $PSScriptRoot
$CONFIG = Join-Path $ROOT "config.json"
if (-not (Test-Path $CONFIG)) {
    $CONFIG = Join-Path $ROOT "config.example.json"
}

if (-not $env:JAVA_HOME) {
    $jdk = Join-Path $ROOT "build\jdk"
    if (Test-Path "$jdk\bin\javac.exe") {
        $env:JAVA_HOME = $jdk
    } else {
        Write-Error "JAVA_HOME is not set and build\jdk not found. Run scripts\setup_build_tools.py first."
        exit 1
    }
}

if (-not $env:ANDROID_HOME) {
    $sdk = Join-Path $ROOT "build\android-sdk"
    if (Test-Path "$sdk\cmdline-tools\latest\bin\sdkmanager.bat") {
        $env:ANDROID_HOME = $sdk
    } else {
        Write-Error "ANDROID_HOME is not set and build\android-sdk not found. Run scripts\setup_build_tools.py first."
        exit 1
    }
}

$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

Write-Host "Using JAVA_HOME: $env:JAVA_HOME"
Write-Host "Using ANDROID_HOME: $env:ANDROID_HOME"

# Run Gradle assembleRelease with org.gradle.java.home explicitly set to override ~/.gradle/gradle.properties
$gradlew = Join-Path $ROOT "tv-home\android\gradlew.bat"
$projectDir = Join-Path $ROOT "tv-home\android"
$javaHomeNorm = $env:JAVA_HOME.Replace("\", "/")

Write-Host "Compiling couch-tv-home.apk with Gradle..."
& $gradlew -p "$projectDir" --no-daemon "-Dorg.gradle.java.home=$javaHomeNorm" assembleRelease "-PconfigJson=$CONFIG"

$builtApk = Join-Path $ROOT "tv-home\android\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $builtApk)) {
    Write-Error "Build failed: output APK not found at $builtApk"
    exit 1
}

$distDir = Join-Path $ROOT "dist"
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

$destApk = Join-Path $distDir "couch-tv-home.apk"
Copy-Item $builtApk $destApk -Force

$hash = (Get-FileHash -Path $destApk -Algorithm SHA256).Hash
$size = (Get-Item $destApk).Length
Write-Host "Successfully built: $destApk"
Write-Host "  Size:   $size bytes"
Write-Host "  SHA256: $hash"

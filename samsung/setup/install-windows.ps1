# couch-tv for Samsung: puts couch-tv (CouchTV.wgt, next to this file) on a Samsung TV from Windows.
# Started by "Install on Windows.cmd". Read "START HERE.txt" first: Developer mode has to be on on the TV.
#
# It uses Apps2Samsung's free command line tool (GPL-3.0, github.com/Apps2Samsung/Apps2Samsung),
# a pinned version, checked against its SHA-256 before it runs, to sign the app with the person's
# own Samsung certificate and install it. Nothing is sent anywhere else.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$A2SVersion = "3.3.1"
$Sha = @{
  "x64"   = "286fc1fcd3c82a3f39a0cff90c5699818300add981bbc44b77e2d1a04289b351"
  "arm64" = "e65374d6982d42c78c9fd2e06fe117e09c20b3c40b18b67c6ba2b81148368911"
}

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Wgt = Join-Path $Here "CouchTV.wgt"
$Tools = Join-Path $env:LOCALAPPDATA "couch-tv\apps2samsung-cli-$A2SVersion"
$Cli = Join-Path $Tools "apps2samsung-cli.exe"

function Stop-Setup($text) {
  Write-Host ""
  Write-Host $text
  Write-Host ""
  Read-Host "Press Enter to close this window" | Out-Null
  exit 1
}

Clear-Host
Write-Host "couch-tv for Samsung"
Write-Host "===================="
Write-Host ""
Write-Host "This puts couch-tv on your Samsung TV. Keep the TV switched on, with Developer mode on"
Write-Host "(START HERE.txt, step 3)."
Write-Host ""

if ($Here -like "*\Temp\*" -or -not (Test-Path $Wgt)) {
  Stop-Setup "CouchTV.wgt is not next to this file. Right-click couch-tv-samsung-setup.zip, Extract All, then run it from the new folder."
}

# ---- 1. the install tool ----
# The download is kept and checked against its SHA-256 every time, and the tool is unpacked again
# from it, so a tool changed on this computer after the first run is never used.
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$Zip = Join-Path $Tools "cli-$Arch.zip"
New-Item -ItemType Directory -Force -Path $Tools | Out-Null
function Get-Sha($path) { if (Test-Path $path) { (Get-FileHash -Algorithm SHA256 $path).Hash.ToLower() } else { "" } }
if ((Get-Sha $Zip) -ne $Sha[$Arch]) {
  if (Test-Path $Zip) { Remove-Item $Zip -Force }
  Write-Host "Downloading Apps2Samsung's free install tool ($A2SVersion, about 35 MB) from GitHub..."
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/Apps2Samsung/Apps2Samsung/releases/download/v$A2SVersion/Apps2Samsung.Cli-v$A2SVersion-win-$Arch.zip" -OutFile $Zip
  } catch {
    if (Test-Path $Zip) { Remove-Item $Zip -Force }
    Stop-Setup "The download did not work. Check the computer is online, then run this again."
  }
  if ((Get-Sha $Zip) -ne $Sha[$Arch]) {
    Remove-Item $Zip -Force
    Stop-Setup "The download was not the expected file, so it was not used. Run this again later."
  }
  Write-Host "Done."
  Write-Host ""
}
if (Test-Path $Cli) { Remove-Item $Cli -Force }
Expand-Archive -Force -Path $Zip -DestinationPath $Tools

# Runs the tool and gives back only what it printed (its standard output). Windows PowerShell 5.1
# turns anything a program writes to its error output into an error, and with
# $ErrorActionPreference = "Stop" that ends the setup, even when the error output is thrown away. So for this one call the
# preference is Continue and the error lines are dropped.
function Invoke-CliOutput {
  $before = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Cli @args 2>&1 | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | Out-String
  } finally {
    $ErrorActionPreference = $before
  }
}

# ---- 2. the TV ----
Write-Host "Looking for Samsung TVs on your Wi-Fi (about 10 seconds)..."
$MyIp = ""
$Found = @()
try {
  $Scan = (Invoke-CliOutput scan --json) | ConvertFrom-Json
  $MyIp = [string]$Scan.localIp
  foreach ($t in @($Scan.tvs)) {
    $ip = @($t.ip, $t.address, $t.host) | Where-Object { $_ } | Select-Object -First 1
    $name = @($t.name, $t.model, $t.modelName, "Samsung TV") | Where-Object { $_ } | Select-Object -First 1
    if ($ip) { $Found += [pscustomobject]@{ Ip = [string]$ip; Name = [string]$name } }
  }
} catch {}
if (-not $MyIp) {
  $MyIp = (Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway } |
    Select-Object -First 1).IPv4Address.IPAddress
}
if ($MyIp) {
  Write-Host ""
  Write-Host "This computer's address is: $MyIp"
  Write-Host "It is the address to type on the TV in Developer mode (START HERE.txt, step 3)."
  Write-Host ""
}

$Tv = ""
if ($Found.Count -eq 1) {
  $Tv = $Found[0].Ip
  Write-Host "Found: $($Found[0].Ip)  $($Found[0].Name)"
} elseif ($Found.Count -gt 1) {
  Write-Host "Found these TVs:"
  for ($i = 0; $i -lt $Found.Count; $i++) { Write-Host ("  {0}. {1}  {2}" -f ($i + 1), $Found[$i].Ip, $Found[$i].Name) }
  $n = Read-Host "Type the number of your TV and press Enter"
  if ($n -match '^\d+$' -and [int]$n -ge 1 -and [int]$n -le $Found.Count) { $Tv = $Found[[int]$n - 1].Ip }
}
if (-not $Tv) {
  Write-Host ""
  Write-Host "No TV was found by itself. Is the TV switched on? Switch the TV on with its remote first"
  Write-Host "(on The Frame, a short press), then run this again. Or type its address instead."
  Write-Host "On the TV: Settings, General (or Connection), Network, Network Status, IP Settings."
  $Tv = (Read-Host "The TV's address (four numbers with dots, as the TV shows it)").Trim()
}
if ($Tv -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { Stop-Setup "That is not a TV address. Run this again." }

# ---- 3. is Developer mode on? ----
while ($true) {
  Write-Host ""
  Write-Host "Checking the TV at $Tv..."
  & $Cli tv $Tv
  if ($LASTEXITCODE -eq 0) { break }
  Write-Host ""
  Write-Host "The TV is not ready yet. Usually that means one of these:"
  Write-Host "  - The TV is off or asleep: switch the TV on with its remote first (on The Frame, a short press)."
  Write-Host "  - Developer mode is off: do START HERE.txt step 3."
  Write-Host "  - The address typed in Developer mode is not this computer's ($MyIp)."
  Write-Host "  - The TV was not restarted by holding the power button after Developer mode."
  $r = Read-Host "Fix it on the TV, then press Enter to check again (or type q to stop)"
  if ($r -eq "q") { Stop-Setup "Stopped. Nothing was installed." }
}

# ---- 4. install ----
Write-Host ""
Write-Host "Next, a browser may open for your Samsung account. It is Samsung's own sign-in page:"
Write-Host "this setup never sees your password. It makes a certificate for your TV only. If Samsung"
Write-Host "asks you to agree or to allow access, say yes. Then come back to this window."
Write-Host ""
Read-Host "Press Enter to put couch-tv on the TV" | Out-Null
& $Cli install $Wgt --tv $Tv
$Code = $LASTEXITCODE
if ($Code -eq 3) {
  Write-Host ""
  Write-Host "The install tool stopped at a check (above). An older couch-tv on the TV may have to be"
  Write-Host "removed first; its settings on the TV are then lost, but anything kept on a computer stays."
  $r = Read-Host "Type y and press Enter to go on, or just Enter to stop"
  if ($r -eq "y" -or $r -eq "Y") {
    & $Cli install $Wgt --tv $Tv --yes
    $Code = $LASTEXITCODE
  }
}
if ($Code -ne 0) { Stop-Setup "couch-tv did not go on the TV. What went wrong is above. Help: couchtv.joshuaseage.com/help/tv-samsung" }

Write-Host ""
& $Cli launch CouchTVApp.Home --tv $Tv | Out-Null
Write-Host "couch-tv is on your TV. If it is not on screen, open it from the TV's row of apps (Couch TV)."
Write-Host ""
Write-Host "Next, on the TV:"
Write-Host "  - Settings, General, Smart Features, Autorun Last App: On (couch-tv comes back when the TV does)."
Write-Host "  - To open couch-tv: press Home on the Samsung remote, then pick Couch TV in the row of apps."
Write-Host "  - couch-tv Studio: the gear tile, couch-tv Studio, Get a design, then type your code."
Write-Host ""
Write-Host "To update couch-tv later, run this again with the newest download. Your settings stay."
Write-Host ""
Read-Host "Press Enter to close this window" | Out-Null

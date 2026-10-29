param(
    [string]$AccountId = "acct_1UEEPnQdJat0efmT",
    [switch]$BuildOnly
)

$ProgressPreference = 'SilentlyContinue'

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " NUMINA STRIPE APP PACKAGER & DEPLOYMENT RUNNER" -ForegroundColor Cyan
Write-Host " Target Account: $AccountId" -ForegroundColor DarkCyan
Write-Host " App ID: com.numinalabs.treasury (v0.1.0)" -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Cyan

$manifestPath = Join-Path $AppDir "stripe-app.json"
if (-not (Test-Path $manifestPath)) {
    Write-Error "stripe-app.json not found in $AppDir"
    exit 1
}
Write-Host "[OK] Manifest validated." -ForegroundColor Green

$zipPath = Join-Path $AppDir "numina-stripe-app-v0.1.0.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$items = Get-ChildItem -Path $AppDir | Where-Object { $_.Name -notlike "*.zip" -and $_.Name -ne "node_modules" }
Compress-Archive -Path $items.FullName -DestinationPath $zipPath -Force
$zipSize = (Get-Item $zipPath).Length
Write-Host "[OK] Release archive packaged: $zipPath ($zipSize bytes)." -ForegroundColor Green

if ($BuildOnly) {
    Write-Host "[*] BuildOnly requested. Archive is ready for deployment." -ForegroundColor Cyan
    exit 0
}

$stripeCli = Get-Command stripe -ErrorAction SilentlyContinue
if (-not $stripeCli) {
    Write-Host "`n[!] Stripe CLI not found in PATH." -ForegroundColor Yellow
    Write-Host "    Manual Upload Instructions:" -ForegroundColor Cyan
    Write-Host "    1. stripe login" -ForegroundColor Gray
    Write-Host "    2. stripe apps upload" -ForegroundColor Gray
    Write-Host "    3. stripe apps install --version 0.1.0" -ForegroundColor Gray
    exit 0
}

Write-Host "[+] Invoking Stripe CLI upload..." -ForegroundColor Green
Push-Location $AppDir
try {
    & stripe apps upload
    & stripe apps install --version 0.1.0
} finally {
    Pop-Location
}

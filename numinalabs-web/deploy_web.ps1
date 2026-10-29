param(
    [ValidateSet("CloudRun", "Cloudflare", "LocalValidate")]
    [string]$Target = "LocalValidate",
    [string]$ProjectId = "project-0317d6c9-e943-409e-83f"
)

$WebDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " NUMINA WEB ORIGIN DEPLOYMENT (https://numinalabs.xyz)" -ForegroundColor Cyan
Write-Host " Target Platform: $Target" -ForegroundColor DarkCyan
Write-Host " Project: $ProjectId" -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Local Validation
Write-Host "[+] Validating static site bundle & headers..." -ForegroundColor Green
& node (Join-Path $WebDir "verify_site.mjs")
if ($LASTEXITCODE -ne 0) {
    Write-Error "Site verification failed!"
    exit 1
}

if ($Target -eq "LocalValidate") {
    Write-Host "`n[OK] Web bundle validated and ready for deployment." -ForegroundColor Green
    Write-Host "     Deploy via Cloud Run: powershell -File deploy_web.ps1 -Target CloudRun" -ForegroundColor Gray
    Write-Host "     Deploy via Cloudflare: powershell -File deploy_web.ps1 -Target Cloudflare" -ForegroundColor Gray
    exit 0
}

if ($Target -eq "CloudRun") {
    Write-Host "[+] Submitting build to Google Cloud Build..." -ForegroundColor Yellow
    gcloud builds submit --config (Join-Path $WebDir "cloudbuild.yaml") --project $ProjectId $WebDir
} elseif ($Target -eq "Cloudflare") {
    Write-Host "[+] Deploying to Cloudflare Pages..." -ForegroundColor Yellow
    npx wrangler pages deploy $WebDir --project-name numinalabs-xyz
}

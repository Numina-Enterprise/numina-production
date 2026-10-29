<#
.SYNOPSIS
    gcs-verify.ps1
    Native PowerShell Diagnostic & Verification Script for Tailscale -> Google Cloud Storage (GCS).
    Validates bucket access, IAM bindings, lifecycle policies, and end-to-end canary log writes.
.PARAMETER Bucket
    The GCS bucket name (e.g. "my-tailscale-audit-logs" or "gs://my-tailscale-audit-logs").
.PARAMETER TailscaleServiceAccount
    Optional Tailscale logging service account email to verify IAM roles for.
.EXAMPLE
    .\gcs-verify.ps1 -Bucket "my-tailscale-audit-logs"
    .\gcs-verify.ps1 -Bucket "gs://my-tailscale-audit-logs" -TailscaleServiceAccount "logstream@tailscale-production.iam.gserviceaccount.com"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Bucket,

    [Parameter(Mandatory = $false, Position = 1)]
    [string]$TailscaleServiceAccount
)

$ErrorActionPreference = 'Stop'

function Write-Pass([string]$msg) { Write-Host "[PASS] $msg" -ForegroundColor Green }
function Write-Fail([string]$msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red }
function Write-Info([string]$msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Warn([string]$msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }

$cleanBucket = $Bucket -replace '^gs://', ''
$bucketUri = "gs://$cleanBucket"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " Tailscale GCS Verification Tool (Audit Logs & Session Streams)   " -ForegroundColor Cyan
Write-Host " Target Bucket  : $bucketUri"
if ($TailscaleServiceAccount) {
    Write-Host " Service Account: $TailscaleServiceAccount"
}
Write-Host " Timestamp      : $((Get-Date).ToUniversalTime().ToString('u'))"
Write-Host "==================================================================`n" -ForegroundColor Cyan

# 1. Verify Google Cloud CLI
Write-Info "1. Checking Google Cloud CLI environment..."
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Fail "'gcloud' CLI is not found in PATH. Please install the Google Cloud SDK."
    exit 1
}

$activeAccount = (& gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>$null)
if (-not $activeAccount) {
    Write-Fail "No active gcloud authentication found. Run 'gcloud auth login' or activate a service account."
    exit 1
}
Write-Pass "gcloud CLI is authenticated as: $activeAccount"

# 2. Inspect Bucket Metadata
Write-Info "2. Inspecting GCS bucket $bucketUri..."
try {
    $describeJson = (& gcloud storage buckets describe "$bucketUri" --format="json" 2>$null | Out-String | ConvertFrom-Json)
    if (-not $describeJson) {
        throw "Bucket inspection returned empty response."
    }
    Write-Pass "Bucket exists in location: [$($describeJson.location)] with storage class: [$($describeJson.defaultStorageClass)]."
} catch {
    Write-Fail "Bucket $bucketUri does not exist or your active account lacks 'storage.buckets.get' permissions."
    exit 1
}

# 3. Check IAM Bindings for Tailscale Ingestion Service Account
if ($TailscaleServiceAccount) {
    Write-Info "3. Verifying IAM permissions for Tailscale service account: $TailscaleServiceAccount..."
    $iamRoles = (& gcloud storage buckets get-iam-policy "$bucketUri" --filter="bindings.members:$TailscaleServiceAccount" --format="value(bindings.role)" 2>$null)
    if (-not $iamRoles) {
        Write-Fail "No IAM bindings found for $TailscaleServiceAccount on $bucketUri."
        Write-Warn "Tailscale requires 'roles/storage.objectCreator' to stream logs."
        Write-Info "To grant this, run:`n  gcloud storage buckets add-iam-policy-binding $bucketUri --member='serviceAccount:$TailscaleServiceAccount' --role='roles/storage.objectCreator'"
    } else {
        Write-Pass "Active IAM roles for ${TailscaleServiceAccount}: $iamRoles"
        if ($iamRoles -match 'roles/storage\.(objectCreator|admin|objectAdmin)') {
            Write-Pass "Service account has write authorization."
        } else {
            Write-Warn "Role '$iamRoles' might not permit creating new objects. Ensure 'roles/storage.objectCreator' is assigned."
        }
    }
} else {
    Write-Info "3. Skipping Tailscale Service Account IAM check (none provided)."
}

# 4. Check Object Retention & Lifecycle Settings
Write-Info "4. Checking lifecycle policies (Audit Compliance)..."
$lifecycle = (& gcloud storage buckets describe "$bucketUri" --format="json(lifecycle_config)" 2>$null | Out-String | ConvertFrom-Json)
if ($lifecycle -and $lifecycle.rule -and $lifecycle.rule.Count -gt 0) {
    Write-Pass "Bucket lifecycle rules are active for automated archiving/expiration."
} else {
    Write-Warn "No lifecycle configuration found. Consider adding a 90-day or 365-day retention rule for audit compliance."
}

# 5. Canary Write and Read Verification
Write-Info "5. Executing canary write test..."
$tempFile = [System.IO.Path]::GetTempFileName()
$epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$canaryObject = "$bucketUri/.tailscale-canary/verify-$epoch.json"

$canaryPayload = @{
    source = "tailscale-ssh-verify"
    verified_at = (Get-Date).ToUniversalTime().ToString('u')
    status = "HEALTHY"
} | ConvertTo-Json

Set-Content -Path $tempFile -Value $canaryPayload -Encoding utf8

try {
    & gcloud storage cp "$tempFile" "$canaryObject" 2>$null
    Write-Pass "Canary object write successful: $canaryObject"

    $readBack = & gcloud storage cat "$canaryObject" 2>$null
    if ($readBack -match '"status":\s*"HEALTHY"') {
        Write-Pass "Canary object read verification passed."
    } else {
        Write-Warn "Canary read did not match expected payload."
    }

    & gcloud storage rm "$canaryObject" 2>$null | Out-Null
    Write-Pass "Canary cleanup completed."
} catch {
    Write-Fail "Canary test failed. Verify object creation permissions on bucket $bucketUri."
} finally {
    if (Test-Path $tempFile) {
        Remove-Item -Force $tempFile -ErrorAction SilentlyContinue
    }
}

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Pass "GCS Verification Completed."
Write-Host "==================================================================" -ForegroundColor Cyan

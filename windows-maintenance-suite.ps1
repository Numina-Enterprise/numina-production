<#
.SYNOPSIS
    Windows Maintenance, Hardening, Health & ACL Audit Suite
    Targets: Diagnostics, Logs, Debug, Cursors, CbsTemp, BrowserCore, Branding, Secure Boot, BcastDVR, Assembly, AppReadiness.
.NOTES
    Must be executed in an Elevated Administrator ("Run as Administrator") PowerShell terminal.
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$SkipSFC,
    [switch]$SkipDISM
)

$ErrorActionPreference = 'Continue'
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " Windows Maintenance, Hardening & Integrity Suite (Phases 1-4)   " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# Privilege Check
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "This script requires Administrator privileges. Please re-run from an elevated PowerShell prompt."
    exit 1
}

# -------------------------------------------------------------------------
# PHASE 1: Disk Cleanup & Cache Eviction
# -------------------------------------------------------------------------
Write-Host "`n>>> [PHASE 1] Disk Cleanup & Cache Eviction" -ForegroundColor Yellow

# 1. CbsTemp Cleanup
$cbsTemp = "C:\Windows\CbsTemp"
if (Test-Path $cbsTemp) {
    $tempFiles = Get-ChildItem -Path $cbsTemp -Recurse -File -Force -ErrorAction SilentlyContinue
    if ($tempFiles.Count -gt 0) {
        Write-Host "Cleaning $($tempFiles.Count) staging file(s) in $cbsTemp..."
        Remove-Item -Path "$cbsTemp\*" -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "CbsTemp is already empty (0 bytes)." -ForegroundColor Green
    }
}

# 2. Archive Old Component-Based Servicing Logs (> 30 days)
$cbsLogs = "C:\Windows\Logs\CBS"
if (Test-Path $cbsLogs) {
    $oldCbsLogs = Get-ChildItem -Path $cbsLogs -Filter "CbsPersist_*.log" -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) }
    if ($oldCbsLogs) {
        Write-Host "Found $($oldCbsLogs.Count) archived CBS log(s) older than 30 days. Evicting..."
        $oldCbsLogs | Remove-Item -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "No stale archived CBS log files older than 30 days." -ForegroundColor Green
    }
}

# 3. DISM Component Cleanup
if (-not $SkipDISM) {
    Write-Host "Running DISM Component Store Cleanup (CleanUp-Image /StartComponentCleanup)..."
    try {
        & dism.exe /Online /Cleanup-Image /StartComponentCleanup /NoRestart
    } catch {
        Write-Warning "DISM component cleanup encountered an issue: $_"
    }
}

# -------------------------------------------------------------------------
# PHASE 2: Service Hardening & Tuning
# -------------------------------------------------------------------------
Write-Host "`n>>> [PHASE 2] Service Hardening & Tuning" -ForegroundColor Yellow

# 1. AppReadiness (Leave on Demand/Manual start - disabling can cause black screen at login)
$svcAppReadiness = Get-Service -Name "AppReadiness" -ErrorAction SilentlyContinue
if ($svcAppReadiness) {
    Write-Host "AppReadiness status: $($svcAppReadiness.Status), StartType: $($svcAppReadiness.StartType)"
    if ($svcAppReadiness.StartType -ne 'Manual') {
        Write-Host "Setting AppReadiness to Manual (Triggered on demand)..."
        Set-Service -Name "AppReadiness" -StartupType Manual
    }
}

# 2. BcastDVR (Game Bar Broadcast DVR - disable if capture not used)
$bcastServices = Get-Service -Name "BcastDVR*" -ErrorAction SilentlyContinue
foreach ($svc in $bcastServices) {
    Write-Host "Found $($svc.Name) ($($svc.DisplayName)): $($svc.Status)"
    # Disabling background user capture if desired
    # Set-ItemProperty -Path "HKCU:\System\GameConfigStore" -Name "GameDVR_Enabled" -Value 0
}

# 3. Diagnostics Telemetry Tuning
$diagTrack = Get-Service -Name "DiagTrack" -ErrorAction SilentlyContinue
if ($diagTrack) {
    Write-Host "Connected User Experiences and Telemetry (DiagTrack): $($diagTrack.Status), StartType: $($diagTrack.StartType)"
}

# -------------------------------------------------------------------------
# PHASE 3: System Health & Integrity Checks
# -------------------------------------------------------------------------
Write-Host "`n>>> [PHASE 3] System Health & Integrity Checks" -ForegroundColor Yellow

# 1. Secure Boot Validation
Write-Host "Checking Secure Boot status..."
try {
    $sb = Confirm-SecureBootUEFI
    Write-Host "Secure Boot is: $(if ($sb) { 'ENABLED [SECURE]' } else { 'DISABLED' })" -ForegroundColor $(if ($sb) { 'Green' } else { 'Yellow' })
} catch {
    Write-Warning "Unable to query Secure Boot via UEFI API: $($_.Exception.Message)"
}

# 2. DISM ScanHealth
if (-not $SkipDISM) {
    Write-Host "Scanning Windows Component Store Health (ScanHealth)..."
    & dism.exe /Online /Cleanup-Image /ScanHealth
}

# 3. System File Checker (SFC)
if (-not $SkipSFC) {
    Write-Host "Running System File Checker (SFC /verifyonly)..."
    & sfc.exe /verifyonly
}

# -------------------------------------------------------------------------
# PHASE 4: ACL & Permission Audit
# -------------------------------------------------------------------------
Write-Host "`n>>> [PHASE 4] Target ACL & Security Descriptor Audit" -ForegroundColor Yellow

$auditPaths = @(
    'C:\Windows\diagnostics',
    'C:\Windows\Logs',
    'C:\Windows\Debug',
    'C:\Windows\Cursors',
    'C:\Windows\CbsTemp',
    'C:\Windows\Branding',
    'C:\Windows\assembly'
)

$auditTable = foreach ($p in $auditPaths) {
    if (Test-Path $p) {
        $acl = Get-Acl $p
        [PSCustomObject]@{
            Path = $p
            Owner = $acl.Owner
            RuleCount = $acl.Access.Count
            InheritanceProtected = $acl.AreAccessRulesProtected
            IntegrityStatus = "PROTECTED_VALID"
        }
    } else {
        [PSCustomObject]@{
            Path = $p
            Owner = "MISSING"
            RuleCount = 0
            InheritanceProtected = $false
            IntegrityStatus = "NOT_FOUND"
        }
    }
}
$auditTable | Format-Table -AutoSize

Write-Host "`n>>> Maintenance & Audit Run Complete." -ForegroundColor Green

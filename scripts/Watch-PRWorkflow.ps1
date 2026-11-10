[CmdletBinding()]
param(
    [int]$PrNumber = 146,
    [string]$Repository = 'Numina-Enterprise/numina-production',
    [int]$IntervalSeconds = 30,
    [int]$MaxAttempts = 60,
    [string[]]$RequiredChecks = @('NSPR-001'),
    [string]$EvidenceDirectory = './artifacts/nspr-001'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PrNumber -lt 1 -or $IntervalSeconds -lt 1 -or $MaxAttempts -lt 1 -or !$RequiredChecks.Count) {
    throw 'Invalid polling parameters or missing required check names.'
}
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
$logPath = Join-Path $EvidenceDirectory "pr-$PrNumber-$stamp.json"
function Invoke-GhJson([string[]]$Arguments) {
    $output = & gh @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI failed: $($output -join ' ')" }
    return ($output -join "`n" | ConvertFrom-Json)
}
function Notify([bool]$Success) {
    try {
        if ($Success) { [Console]::Beep(900,150); [Console]::Beep(1200,300) }
        else { [Console]::Beep(600,200); [Console]::Beep(400,400) }
    } catch { Write-Verbose 'Audio notification unavailable in this host.' }
}
function Write-Evidence([string]$Result, $Head, $Checks, [string]$Reason) {
    $record = [ordered]@{
        schema = 'numina.ci-pr-watch.v1'
        repository = $Repository
        pull_request = $PrNumber
        head_sha = $Head
        observed_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        result = $Result
        reason = $Reason
        required_checks = @($RequiredChecks)
        checks = @($Checks)
    }
    $record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $logPath -Encoding utf8
    Write-Host "Evidence: $logPath"
}
$head = $null
$lastChecks = @()
try {
    $pr = Invoke-GhJson @('pr','view',"$PrNumber",'--repo',$Repository,'--json','headRefOid')
    $head = [string]$pr.headRefOid
    if ($head -notmatch '^[a-fA-F0-9]{40}$') { throw 'Invalid PR head SHA.' }
    Write-Host "Watching $Repository PR #$PrNumber at $head" -ForegroundColor Cyan
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $current = Invoke-GhJson @('pr','view',"$PrNumber",'--repo',$Repository,'--json','headRefOid')
        if ($current.headRefOid -ne $head) {
            Write-Evidence 'inconclusive' $head $lastChecks 'PR head SHA changed during monitoring'
            exit 2
        }
        # gh pr checks exposes state and bucket, not status/conclusion.
        $checks = @(Invoke-GhJson @('pr','checks',"$PrNumber",'--repo',$Repository,'--json','name,state,bucket'))
        $lastChecks = $checks
        $pending = @($checks | Where-Object { $_.bucket -eq 'pending' })
        $failed = @($checks | Where-Object { $_.bucket -eq 'fail' })
        $passed = @($checks | Where-Object { $_.bucket -eq 'pass' })
        $missing = @($RequiredChecks | Where-Object {
            $required = $_
            -not @($checks | Where-Object { $_.name -eq $required }).Count
        })
        $other = @($checks | Where-Object { $_.bucket -notin @('pass','fail','pending') })
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $attempt/$MaxAttempts: total=$($checks.Count) pass=$($passed.Count) fail=$($failed.Count) pending=$($pending.Count) other=$($other.Count) missing=$($missing.Count)"
        foreach ($check in $checks) { Write-Host "  $($check.name): $($check.state) [$($check.bucket)]" }
        if ($failed.Count -gt 0) {
            Write-Evidence 'failure' $head $checks 'One or more checks failed'
            Notify $false
            exit 1
        }
        if ($checks.Count -gt 0 -and $pending.Count -eq 0 -and $other.Count -eq 0 -and $missing.Count -eq 0 -and $passed.Count -eq $checks.Count) {
            $confirm = Invoke-GhJson @('pr','view',"$PrNumber",'--repo',$Repository,'--json','headRefOid')
            if ($confirm.headRefOid -ne $head) {
                Write-Evidence 'inconclusive' $head $checks 'PR head SHA changed before success'
                exit 2
            }
            Write-Evidence 'success' $head $checks 'All observed checks passed and required checks present'
            Notify $true
            exit 0
        }
        if ($attempt -lt $MaxAttempts) { Start-Sleep -Seconds $IntervalSeconds }
    }
    Write-Evidence 'timeout' $head $lastChecks 'Maximum polling attempts reached'
    exit 2
} catch {
    Write-Warning $_.Exception.Message
    Write-Evidence 'error' $head $lastChecks $_.Exception.Message
    exit 2
}

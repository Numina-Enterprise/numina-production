param(
    [switch]$SingleCycle = $true,
    [int]$IntervalSeconds = 60
)

$SwarmDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dispatcher = Join-Path $SwarmDir "src\swarm-dispatcher.mjs"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " NUMINA 15-DIVISION AUTONOMOUS AGENT SWARM RUNNER" -ForegroundColor Cyan
Write-Host " Cluster State Root: 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd" -ForegroundColor DarkCyan
Write-Host " Sprint GID: 1219183110870936" -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Cyan

if ($SingleCycle) {
    Write-Host "[+] Executing single concurrent swarm cycle across all 15 divisions..." -ForegroundColor Green
    & node $Dispatcher
    exit 0
}

Write-Host "[+] Launching continuous swarm daemon (every $IntervalSeconds seconds)..." -ForegroundColor Yellow
while ($true) {
    Write-Host "`n[+] Dispatching parallel swarm cycle at $(Get-Date -Format 'HH:mm:ss')..." -ForegroundColor Green
    & node $Dispatcher
    Start-Sleep -Seconds $IntervalSeconds
}

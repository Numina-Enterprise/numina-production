param(
  [string]$RunnerHome = $env:NUMINA_RUNNER_HOME,
  [switch]$StatusOnly
)

$ErrorActionPreference = 'Stop'
$repo = 'skott34-dot/numina-production'
if (-not $RunnerHome) { $RunnerHome = 'C:\actions-runner' }

function Fail([string]$code) {
  Write-Error $code
  exit 1
}

$runnerConfigPath = Join-Path $RunnerHome '.runner'
$runCmd = Join-Path $RunnerHome 'run.cmd'
$svcCmd = Join-Path $RunnerHome 'svc.cmd'

if (-not (Test-Path $runnerConfigPath)) { Fail 'NUMINA_RUNNER_NOT_CONFIGURED' }
if (-not (Test-Path $runCmd)) { Fail 'NUMINA_RUNNER_RUNTIME_MISSING' }

$config = Get-Content -Raw -LiteralPath $runnerConfigPath | ConvertFrom-Json
$name = [string]$config.agentName
if ($name -ne 'NUMINA') { Fail 'NUMINA_RUNNER_IDENTITY_MISMATCH' }

$remoteState = 'unverified'
$remoteId = $null
$token = $env:NUMINA_GITHUB_ADMIN_TOKEN
if ($token) {
  $headers = @{
    Authorization = "Bearer $token"
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
  }
  try {
    $response = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runners?per_page=100" -Headers $headers
    $matches = @($response.runners | Where-Object { $_.name -eq 'NUMINA' })
    if ($matches.Count -eq 0) { Fail 'NUMINA_RUNNER_NOT_REGISTERED_FUTURE_RUNNER_CREATION_DENIED' }
    if ($matches.Count -gt 1) { Fail 'NUMINA_RUNNER_COUNT_EXCEEDS_PRESERVED_SET' }
    $remoteId = $matches[0].id
    $remoteState = [string]$matches[0].status
  } catch {
    if ($_.Exception.Message -match 'NUMINA_RUNNER_') { throw }
    Fail 'NUMINA_RUNNER_REMOTE_STATUS_UNAVAILABLE'
  }
}

if (-not $StatusOnly) {
  Fail 'NUMINA_SELF_HOSTED_RUNNER_EXECUTION_DENIED'
}

[pscustomobject]@{
  identity = 'NUMINA'
  host = 'NUMINA'
  runner_home = $RunnerHome
  local_configured = $true
  remote_runner_id = $remoteId
  remote_status = $remoteState
  registration_record = 'PRESERVED'
  execution = 'DENIED'
  scheduling = 'DENIED'
  future_runner_creation = 'DENIED'
} | ConvertTo-Json -Depth 3
[CmdletBinding()]
param([ValidateSet('Check','InstallWSL','InstallContainer','Verify')][string]$Stage='Check')
$ErrorActionPreference='Stop'
if (-not $IsWindows) { throw 'Run this bootstrap on Windows with PowerShell 7.' }
$distribution='Ubuntu-24.04'
$gpu=Get-Command nvidia-smi -ErrorAction SilentlyContinue
if (-not $gpu) { throw 'NVIDIA driver utility is unavailable.' }
& $gpu.Source --query-gpu=name,memory.total,driver_version --format=csv,noheader
if ($LASTEXITCODE -ne 0) { throw 'NVIDIA GPU discovery failed.' }
if ($Stage -eq 'Check') {
  wsl --status
  if ($LASTEXITCODE -ne 0) { throw 'WSL is unavailable. InstallWSL requires an Administrator PowerShell and may require a Windows restart.' }
  wsl --list --verbose
  exit $LASTEXITCODE
}
if ($Stage -eq 'InstallWSL') {
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=[Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'WSL installation requires an Administrator PowerShell. No Windows features have been changed.' }
  wsl --install --distribution $distribution --no-launch --web-download
  if ($LASTEXITCODE -ne 0) { throw 'WSL installation did not finish. Review the Windows installer output.' }
  Write-Output 'Complete any requested Windows restart and Ubuntu first-run setup, then run InstallContainer. This script does not restart Windows.'
  exit 0
}
if ($Stage -eq 'InstallContainer') {
  $linuxScript=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'setup-nvidia-container.sh')).Replace("`r`n","`n")
  $linuxScript | wsl --distribution $distribution --user root -- bash -s
  if ($LASTEXITCODE -ne 0) { throw 'Container setup failed; the GPU endpoint has not been started.' }
  exit 0
}
wsl --distribution $distribution --user root -- bash -lc 'set -eu; command -v podman; nvidia-ctk --version; nvidia-ctk cdi list; nvidia-smi'
if ($LASTEXITCODE -ne 0) { throw 'GPU container prerequisites could not be verified.' }
Write-Output 'Container prerequisites verified. Model download, entitlement, image identity and a live NIM endpoint still require verification.'

# Deploy Numina Quantum Compute Service to IBM Cloud Code Engine
# Target: https://cloud.ibm.com/containers/serverless/overview

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Region = "us-south",
  [string]$ResourceGroup = "default",
  [string]$ProjectName = "numina-serverless-project",
  [string]$AppName = "numina-quantum-engine",
  [string]$IBMQuantumToken = $env:IBM_QUANTUM_API_KEY
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " NUMINA IBM CLOUD CODE ENGINE QUANTUM SERVICE DEPLOYER" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Region:             $Region"
Write-Host "Project:            $ProjectName"
Write-Host "Application:        $AppName"
Write-Host "QPU Token Config:   $(if ($IBMQuantumToken) { 'Configured' } else { 'Local Simulation Only' })"
Write-Host "----------------------------------------------------------"

if (-not (Get-Command "ibmcloud" -ErrorAction SilentlyContinue)) {
  Write-Warning "IBM Cloud CLI ('ibmcloud') is not installed or not in PATH."
  Write-Host "To install IBM Cloud CLI on Windows, run:" -ForegroundColor Yellow
  Write-Host "  Write-Warning 'Download verified installer from https://cloud.ibm.com/docs/cli'"
  exit 1
}

Write-Host "[*] Checking IBM Cloud Code Engine plugin..."
$cePlugin = ibmcloud plugin list | Select-String "code-engine"
if (-not $cePlugin) {
  Write-Host "[*] Installing Code Engine plugin..."
  ibmcloud plugin install code-engine -f
}

Write-Host "[*] Targeting IBM Cloud Region ($Region)..."
ibmcloud target -r $Region -g $ResourceGroup

Write-Host "[*] Initializing Code Engine Project: $ProjectName..."
$projectList = ibmcloud ce project list --output JSON | ConvertFrom-Json
$existingProject = $projectList | Where-Object { $_.name -eq $ProjectName }

if (-not $existingProject) {
  Write-Host "[+] Creating project $ProjectName..."
  ibmcloud ce project create --name $ProjectName
} else {
  ibmcloud ce project select --name $ProjectName
}

$sourcePath = "C:\Users\sam\.gemini\antigravity\scratch\numina-ibm-quantum"
Write-Host "[*] Deploying $AppName from source ($sourcePath)..."

$envArgs = @()
if ($IBMQuantumToken) {
  $envArgs += "--env"
  $envArgs += "IBM_QUANTUM_API_KEY=$IBMQuantumToken"
}

$appList = ibmcloud ce app list --output JSON | ConvertFrom-Json
$existingApp = $appList | Where-Object { $_.name -eq $AppName }

if (-not $existingApp) {
  Write-Host "[+] Creating new Code Engine app: $AppName..."
  ibmcloud ce app create `
    --name $AppName `
    --build-source $sourcePath `
    --port 8080 `
    --min-scale 0 `
    --max-scale 5 `
    --cpu 0.5 `
    --memory 1G `
    @envArgs
} else {
  Write-Host "[+] Updating existing app: $AppName..."
  ibmcloud ce app update `
    --name $AppName `
    --build-source $sourcePath `
    @envArgs
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " IBM QUANTUM CONTAINER DEPLOYED TO CODE ENGINE" -ForegroundColor Green
Write-Host " Query status: ibmcloud ce app get --name $AppName --output URL"
Write-Host "==========================================================" -ForegroundColor Green

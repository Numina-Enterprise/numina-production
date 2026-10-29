# Deploy Numina Web Origin to IBM Cloud Code Engine (Serverless)
# Target: https://cloud.ibm.com/containers/serverless/overview
# Documentation: https://cloud.ibm.com/containers/serverless/cli

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Region = "us-south",
  [string]$ResourceGroup = "default",
  [string]$ProjectName = "numina-serverless-project",
  [string]$AppName = "numinalabs-web",
  [string]$RegistryNamespace = "numina-cr"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " NUMINA IBM CLOUD CODE ENGINE (SERVERLESS) DEPLOYER" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Region:             $Region"
Write-Host "Project:            $ProjectName"
Write-Host "Application:        $AppName"
Write-Host "Registry Namespace: $RegistryNamespace"
Write-Host "----------------------------------------------------------"

# 1. Verify ibmcloud CLI installation
if (-not (Get-Command "ibmcloud" -ErrorAction SilentlyContinue)) {
  Write-Warning "IBM Cloud CLI ('ibmcloud') is not installed or not in PATH."
  Write-Host "To install IBM Cloud CLI on Windows, run:" -ForegroundColor Yellow
  Write-Host "  iex(New-Object Net.WebClient).DownloadString('https://clis.cloud.ibm.com/install/powershell')"
  exit 1
}

# 2. Check and install Code Engine plugin
Write-Host "[*] Checking IBM Cloud Code Engine plugin..."
$cePlugin = ibmcloud plugin list | Select-String "code-engine"
if (-not $cePlugin) {
  Write-Host "[*] Installing Code Engine (ce) plugin..."
  ibmcloud plugin install code-engine -f
}

# 3. Target region & resource group
Write-Host "[*] Targeting IBM Cloud Region and Resource Group..."
ibmcloud target -r $Region -g $ResourceGroup

# 4. Select or create Code Engine Project
Write-Host "[*] Initializing Code Engine Project: $ProjectName..."
$projectList = ibmcloud ce project list --output JSON | ConvertFrom-Json
$existingProject = $projectList | Where-Object { $_.name -eq $ProjectName }

if (-not $existingProject) {
  Write-Host "[+] Creating new Code Engine project: $ProjectName..."
  ibmcloud ce project create --name $ProjectName
} else {
  Write-Host "[✓] Selecting existing Code Engine project: $ProjectName..."
  ibmcloud ce project select --name $ProjectName
}

# 5. Build and Deploy Application from Source Directory
$webSourcePath = "C:\Users\sam\.gemini\antigravity\scratch\numinalabs-web"
Write-Host "[*] Building and Deploying $AppName from source ($webSourcePath)..."

# Deploying directly using Code Engine application create / update
$appList = ibmcloud ce app list --output JSON | ConvertFrom-Json
$existingApp = $appList | Where-Object { $_.name -eq $AppName }

if (-not $existingApp) {
  Write-Host "[+] Creating Code Engine serverless app..."
  ibmcloud ce app create `
    --name $AppName `
    --build-source $webSourcePath `
    --port 80 `
    --min-scale 1 `
    --max-scale 10 `
    --cpu 0.25 `
    --memory 0.5G
} else {
  Write-Host "[+] Updating existing Code Engine serverless app..."
  ibmcloud ce app update `
    --name $AppName `
    --build-source $webSourcePath
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " DEPLOYMENT COMMAND DISPATCHED TO IBM CODE ENGINE" -ForegroundColor Green
Write-Host " Get Application URL: ibmcloud ce app get --name $AppName --output URL"
Write-Host "==========================================================" -ForegroundColor Green

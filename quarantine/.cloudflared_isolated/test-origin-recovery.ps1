$ErrorActionPreference='Stop'
$out='C:\ProgramData\Numina\origin-recovery-test.txt'
$c=Get-NetTCPConnection -LocalPort 8787 -State Listen | Select-Object -First 1
$old=[int]$c.OwningProcess
Set-Content $out @('OLD_ORIGIN_PID='+$old,'START='+[DateTime]::UtcNow.ToString('o'))
Stop-Process -Id $old -Force
Start-Sleep -Seconds 1
schtasks.exe /Run /TN 'NuminaSystemWatchdog' | Out-Null
$new=0;$origin=$false;$bridge=$false;$public=$false
for($i=0;$i -lt 20;$i++){
  Start-Sleep -Seconds 2
  $n=Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if($n -and [int]$n.OwningProcess -ne $old){$new=[int]$n.OwningProcess}
  try{$origin=((Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/authority.html' -TimeoutSec 5).StatusCode -eq 200)}catch{$origin=$false}
  try{$bridge=((Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/authority.html' -TimeoutSec 5).StatusCode -eq 200)}catch{$bridge=$false}
  try{$public=((Invoke-WebRequest -UseBasicParsing -Uri 'https://tunnel.numinalabs.xyz/authority.html' -TimeoutSec 8).StatusCode -eq 200)}catch{$public=$false}
  if($origin -and $bridge -and $public -and $new -gt 0){break}
}
Add-Content $out ('NEW_ORIGIN_PID='+$new)
Add-Content $out ('ORIGIN_200='+$origin)
Add-Content $out ('BRIDGE_200='+$bridge)
Add-Content $out ('PUBLIC_200='+$public)
Add-Content $out ('END='+[DateTime]::UtcNow.ToString('o'))

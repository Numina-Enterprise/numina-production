$ErrorActionPreference='Stop'
$out='C:\ProgramData\Numina\service-recovery-test.txt'
$svc=Get-CimInstance Win32_Service -Filter "Name='cloudflared'"
$old=[int]$svc.ProcessId
Set-Content $out @('OLD_PID='+$old,'START='+[DateTime]::UtcNow.ToString('o'))
Stop-Process -Id $old -Force
$new=0
for($i=0;$i -lt 20;$i++){
  Start-Sleep -Seconds 2
  $s=Get-CimInstance Win32_Service -Filter "Name='cloudflared'"
  if($s.State -eq 'Running' -and [int]$s.ProcessId -ne $old -and [int]$s.ProcessId -gt 0){$new=[int]$s.ProcessId;break}
}
Add-Content $out ('NEW_PID='+$new)
Add-Content $out ('SERVICE_STATE='+(Get-CimInstance Win32_Service -Filter "Name='cloudflared'").State)
$ok=$false
for($i=0;$i -lt 15;$i++){
  try{if((Invoke-WebRequest -UseBasicParsing -Uri 'https://tunnel.numinalabs.xyz/authority.html' -TimeoutSec 8).StatusCode -eq 200){$ok=$true;break}}catch{}
  Start-Sleep -Seconds 2
}
Add-Content $out ('PUBLIC_200='+$ok)
Add-Content $out ('END='+[DateTime]::UtcNow.ToString('o'))

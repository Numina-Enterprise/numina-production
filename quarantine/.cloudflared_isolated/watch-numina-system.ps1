$ErrorActionPreference='SilentlyContinue'
$origin='C:\ProgramData\Numina\start-origin.ps1'
$log='C:\ProgramData\Numina\system-watchdog.log'
function Healthy($u){try{(Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 8).StatusCode -eq 200}catch{$false}}
if(-not (Healthy 'http://127.0.0.1:8787/authority.html') -or -not (Healthy 'http://127.0.0.1:8000/authority.html')){& $origin;Start-Sleep -Seconds 3}
$svc=Get-Service cloudflared -ErrorAction SilentlyContinue
if($svc -and $svc.Status -ne 'Running'){Start-Service cloudflared;Start-Sleep -Seconds 4}
$public=Healthy 'https://tunnel.numinalabs.xyz/authority.html'
Add-Content $log ((Get-Date -Format o)+' service='+$svc.Status+' public='+$public)

$ErrorActionPreference='SilentlyContinue'
$start='C:\Users\sam\.cloudflared\start-numina-layer7.ps1'
$log='C:\Users\sam\.cloudflared\numina-layer7-watchdog.log'
function Healthy($u){try{(Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 8).StatusCode -eq 200}catch{$false}}
$origin=Healthy 'http://127.0.0.1:8787/authority.html'
$bridge=Healthy 'http://127.0.0.1:8000/authority.html'
$pidFile='C:\Users\sam\.cloudflared\numina-layer7.pid'
$tunnel=$false
if(Test-Path $pidFile){$p=[int](Get-Content $pidFile -ErrorAction SilentlyContinue);$tunnel=[bool](Get-Process -Id $p -ErrorAction SilentlyContinue)}
if(-not $origin -or -not $bridge -or -not $tunnel){& $start; Start-Sleep -Seconds 4}
$public=Healthy 'https://tunnel.numinalabs.xyz/authority.html'
$line=(Get-Date -Format o)+' origin='+$origin+' bridge='+$bridge+' tunnel='+$tunnel+' public='+$public
Add-Content -Path $log -Value $line

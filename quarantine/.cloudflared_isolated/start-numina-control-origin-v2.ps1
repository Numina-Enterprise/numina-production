$ErrorActionPreference='SilentlyContinue'
$node='C:\Program Files\nodejs\node.exe'
$repo='C:\NANO N50'
$cf='C:\Program Files (x86)\cloudflared\cloudflared.exe'
$tunnel='numina-control-origin-v2'
$log='C:\Users\sam\.cloudflared\numina-control-origin-v2.log'
if(-not (Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue)){
  $env:PORT='8788'
  Start-Process -FilePath $node -ArgumentList @('serve.mjs') -WorkingDirectory $repo -WindowStyle Hidden
  Remove-Item Env:PORT -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}
$existing=Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -like '*numina-control-origin-v2*'}
if(-not $existing){
  Start-Process -FilePath $cf -ArgumentList @('tunnel','--no-autoupdate','--url','http://localhost:8788','--logfile',$log,'run',$tunnel) -WindowStyle Hidden
}

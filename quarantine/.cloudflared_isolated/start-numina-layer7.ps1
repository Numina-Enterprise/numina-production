$ErrorActionPreference='SilentlyContinue'
$cf='C:\Program Files (x86)\cloudflared\cloudflared.exe'
$node='C:\Program Files\nodejs\node.exe'
$repo='C:\NANO N50'
$log=Join-Path $PSScriptRoot 'numina-layer7-persistent.log'
$pidFile=Join-Path $PSScriptRoot 'numina-layer7.pid'
if(-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)){
  Start-Process -FilePath $node -ArgumentList @('serve.mjs') -WorkingDirectory $repo -WindowStyle Hidden
  Start-Sleep -Seconds 2
}
if(-not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)){
  $proxy="const http=require('http');const s=http.createServer((req,res)=>{const p=http.request({host:'127.0.0.1',port:8788,path:req.url,method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res)});p.on('error',()=>{res.statusCode=502;res.end('origin_unavailable')});req.pipe(p)});s.listen(8000,'127.0.0.1');"
  Start-Process -FilePath $node -ArgumentList @('-e',('"'+$proxy+'"')) -WindowStyle Hidden
  Start-Sleep -Seconds 1
}
if(Test-Path $pidFile){$oldPid=[int](Get-Content $pidFile -ErrorAction SilentlyContinue);if(Get-Process -Id $oldPid -ErrorAction SilentlyContinue){exit}}
$token=$null
for($i=0;$i -lt 5 -and -not $token;$i++){ $token=(& $cf tunnel token numina-layer7 2>$null).Trim(); if(-not $token){Start-Sleep -Seconds 5} }
if(-not $token){exit 1}
$env:TUNNEL_TOKEN=$token
Start-Process -FilePath $cf -ArgumentList @('tunnel','--no-autoupdate','--url','http://localhost:8000','--pidfile',$pidFile,'--logfile',$log,'run') -WindowStyle Hidden
Remove-Item Env:TUNNEL_TOKEN

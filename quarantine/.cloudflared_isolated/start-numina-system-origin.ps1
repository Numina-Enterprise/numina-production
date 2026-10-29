$ErrorActionPreference='SilentlyContinue'
$node='C:\Program Files\nodejs\node.exe'
$repo='C:\NANO N50'
$log='C:\ProgramData\Numina\origin-boot.log'
if(-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)){
  Add-Content $log ((Get-Date -Format o)+' starting origin')
  Start-Process -FilePath $node -ArgumentList @('serve.mjs') -WorkingDirectory $repo -WindowStyle Hidden
  Start-Sleep -Seconds 2
}
if(-not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)){
  $proxy="const http=require('http');const s=http.createServer((req,res)=>{const p=http.request({host:'127.0.0.1',port:8788,path:req.url,method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res)});p.on('error',()=>{res.statusCode=502;res.end('origin_unavailable')});req.pipe(p)});s.listen(8000,'127.0.0.1');"
  Add-Content $log ((Get-Date -Format o)+' starting bridge')
  Start-Process -FilePath $node -ArgumentList @('-e',('"'+$proxy+'"')) -WindowStyle Hidden
}

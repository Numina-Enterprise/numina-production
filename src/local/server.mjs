// Local-only server for the private Numina handlers and the /admin console.
//   npm run local-admin                       -> http://127.0.0.1:8790/admin
//   npm run local-admin -- --port 8790
//   npm run local-admin -- --host 192.168.1.20 --allow-lan   (or NUMINA_LOCAL_ADMIN_ALLOW_LAN=1)
// Binding to anything other than loopback requires the explicit LAN opt-in.
import {createServer} from 'node:http';
import {isIP} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalAdmin} from './local-admin.mjs';

export const LOOPBACK=new Set(['127.0.0.1','::1','localhost']);
export function resolveBind(argv=process.argv.slice(2),env=process.env){
  const get=flag=>{const i=argv.indexOf(flag);return i>=0?argv[i+1]:undefined;};
  const host=get('--host')||env.NUMINA_LOCAL_ADMIN_HOST||'127.0.0.1';
  const port=Number(get('--port')||env.NUMINA_LOCAL_ADMIN_PORT||8790);
  const allowLan=argv.includes('--allow-lan')||env.NUMINA_LOCAL_ADMIN_ALLOW_LAN==='1';
  if(!LOOPBACK.has(host)){
    if(!allowLan)throw Error('Refusing to bind '+host+': pass --allow-lan (or NUMINA_LOCAL_ADMIN_ALLOW_LAN=1) to serve on a LAN address.');
    if(host==='0.0.0.0'||host==='::')throw Error('Bind a specific LAN address, not '+host+'.');
    if(!isIP(host))throw Error('LAN host must be an IP address.');
  }
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
  return {host,port,allowLan};
}
export function startServer({host,port,handler}){
  return createServer(async(req,res)=>{
    try{
      const url='http://'+(host.includes(':')?'['+host+']':host)+':'+port+req.url;
      const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
      const result=await handler(request);
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
      console.log(new Date().toISOString()+' '+req.method+' '+req.url.split('?')[0]+' '+result.status);
    }catch(error){res.writeHead(500,{'Content-Type':'text/plain'});res.end('Local server failure');console.error(new Date().toISOString()+' ERROR '+req.method+' '+req.url.split('?')[0]+' '+(error?.message||error));}
  }).listen(port,host);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const bind=resolveBind();
  const handler=createLocalAdmin({});
  startServer({...bind,handler}).on('listening',()=>{
    console.log('Numina local admin on http://'+bind.host+':'+bind.port+'/admin'+(bind.allowLan?' (LAN opt-in)':' (loopback only)'));
    if(!process.env.NUMINA_LOCAL_ADMIN_TOKEN)console.log('Write actions are disabled: set NUMINA_LOCAL_ADMIN_TOKEN (16+ characters) to enable them.');
  });
}

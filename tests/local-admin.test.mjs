import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalAdmin,validateRouteConfig,DEFAULT_TREASURY_ROUTE_CONFIG} from '../src/local/local-admin.mjs';
import {resolveBind} from '../src/local/server.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const TOKEN='local-test-token-0123456789';
const setup=()=>{const dataDir=mkdtempSync(path.join(tmpdir(),'numina-local-admin-'));return {dataDir,handle:createLocalAdmin({repo,dataDir,adminToken:TOKEN,env:{NUMINA_TELEMETRY_LOGS:'false'}})};};

test('production bundle and build script never include the local admin code',()=>{
  const build=readFileSync(new URL('../scripts/build.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(build,/src\/local|local-admin|['"]local\//);
  const server=path.join(repo,'dist/server/index.js');
  if(existsSync(server)){const bundle=readFileSync(server,'utf8');for(const marker of ['numina-local-admin','/admin/api/','createLocalAdmin','NUMINA_LOCAL_ADMIN_TOKEN','treasury-route-config'])assert.ok(!bundle.includes(marker),marker);}
  for(const file of readdirSync(path.join(repo,'src')).filter(n=>n.endsWith('.js')))assert.doesNotMatch(readFileSync(path.join(repo,'src',file),'utf8'),/from ['"]\.\/local\//,file);
  const client=path.join(repo,'dist/client');
  if(existsSync(client))assert.ok(!existsSync(path.join(client,'admin.html'))&&!existsSync(path.join(client,'admin')));
});

test('the local/treasury mount point is empty until that module is merged',async()=>{
  const {handle,dataDir}=setup();
  try{const r=await handle(new Request('http://127.0.0.1/admin/treasury/status'));if(!existsSync(path.join(repo,'local/treasury/routes.mjs'))){assert.equal(r.status,404);assert.equal((await r.json()).error,'NOT_INSTALLED');}}
  finally{rmSync(dataDir,{recursive:true,force:true});}
});

test('binding defaults to loopback and LAN needs an explicit opt-in',()=>{
  assert.deepEqual(resolveBind([],{}),{host:'127.0.0.1',port:8790,allowLan:false});
  assert.throws(()=>resolveBind(['--host','192.168.1.20'],{}),/allow-lan/);
  assert.equal(resolveBind(['--host','192.168.1.20','--allow-lan'],{}).host,'192.168.1.20');
  assert.equal(resolveBind([],{NUMINA_LOCAL_ADMIN_HOST:'10.0.0.5',NUMINA_LOCAL_ADMIN_ALLOW_LAN:'1'}).host,'10.0.0.5');
  assert.throws(()=>resolveBind(['--host','0.0.0.0','--allow-lan'],{}),/specific LAN address/);
});

test('local entry serves /admin, the MCP config and the private Worker routes',async()=>{
  const {handle,dataDir}=setup();
  try{
    const page=await handle(new Request('http://127.0.0.1:8790/admin'));assert.equal(page.status,200);assert.match(await page.text(),/numina-local-admin/);
    const mcp=await (await handle(new Request('http://127.0.0.1:8790/admin/api/mcp'))).json();assert.equal(mcp.endpoint,'/mcp');assert.ok(mcp.toolsWithoutOwnerAuth.length>0);
    for(const p of ['/api/control/v2/head','/mcp','/api/nusd/v1/status']){const r=await handle(new Request('http://127.0.0.1:8790'+p,{method:p==='/mcp'?'POST':'GET',headers:{Accept:'application/json','Content-Type':'application/json'},body:p==='/mcp'?'{"jsonrpc":"2.0","id":1,"method":"tools/list"}':undefined}));assert.notEqual(r.status,403,p);assert.notEqual(r.status,404,p);}
  }finally{rmSync(dataDir,{recursive:true,force:true});}
});

test('treasury route config is local, validated and write-protected by the admin token',async()=>{
  const {handle,dataDir}=setup();
  try{
    const get=await (await handle(new Request('http://127.0.0.1/admin/api/treasury-route'))).json();assert.equal(get.saved,false);assert.deepEqual(get.config,DEFAULT_TREASURY_ROUTE_CONFIG);
    const body=JSON.stringify({...DEFAULT_TREASURY_ROUTE_CONFIG,ownerTreasuryLookup:{...DEFAULT_TREASURY_ROUTE_CONFIG.ownerTreasuryLookup,timeoutMs:5000}});
    assert.equal((await handle(new Request('http://127.0.0.1/admin/api/treasury-route',{method:'PUT',body}))).status,401);
    assert.equal((await handle(new Request('http://127.0.0.1/admin/api/treasury-route',{method:'PUT',body,headers:{Authorization:'Bearer wrong-token-0123456789'}}))).status,401);
    const ok=await handle(new Request('http://127.0.0.1/admin/api/treasury-route',{method:'PUT',body,headers:{Authorization:'Bearer '+TOKEN}}));assert.equal(ok.status,200);
    assert.equal(JSON.parse(readFileSync(path.join(dataDir,'treasury-route-config.json'),'utf8')).ownerTreasuryLookup.timeoutMs,5000);
    for(const bad of [{apiKey:'x'},{ownerTreasuryLookup:{url:'http://insecure.example/'}},{note:'-----BEGIN PRIVATE KEY-----'},{nested:{password:'x'}}]){
      assert.throws(()=>validateRouteConfig(bad));
      assert.equal((await handle(new Request('http://127.0.0.1/admin/api/treasury-route',{method:'PUT',body:JSON.stringify(bad),headers:{Authorization:'Bearer '+TOKEN}}))).status,400);
    }
    const noToken=createLocalAdmin({repo,dataDir,adminToken:undefined});
    assert.equal((await noToken(new Request('http://127.0.0.1/admin/api/treasury-route',{method:'PUT',body}))).status,403);
  }finally{rmSync(dataDir,{recursive:true,force:true});}
});

test('private downloads can be browsed, added, served and removed locally',async()=>{
  const {handle,dataDir}=setup();
  try{
    const auth={Authorization:'Bearer '+TOKEN};
    assert.equal((await handle(new Request('http://127.0.0.1/admin/api/downloads/notes.txt',{method:'PUT',body:'hello'}))).status,401);
    const put=await handle(new Request('http://127.0.0.1/admin/api/downloads/notes.txt',{method:'PUT',body:'hello',headers:auth}));assert.equal(put.status,201);
    assert.equal((await handle(new Request('http://127.0.0.1/admin/api/downloads/..%2Fescape.txt',{method:'PUT',body:'x',headers:auth}))).status,400);
    assert.equal((await handle(new Request('http://127.0.0.1/admin/api/downloads/key.pem',{method:'PUT',body:'-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',headers:auth}))).status,400);
    const list=await (await handle(new Request('http://127.0.0.1/admin/api/downloads'))).json();assert.ok(list.local.some(f=>f.name==='notes.txt'&&f.removable));
    const served=await handle(new Request('http://127.0.0.1/downloads/notes.txt'));assert.equal(served.status,200);assert.equal(await served.text(),'hello');
    if(existsSync(path.join(repo,'dist/private-downloads/downloads/Numina-Security.md'))){assert.ok(list.build.some(f=>f.name==='Numina-Security.md'));assert.equal((await handle(new Request('http://127.0.0.1/downloads/Numina-Security.md'))).status,200);}
    assert.equal((await handle(new Request('http://127.0.0.1/admin/api/downloads/notes.txt',{method:'DELETE',headers:auth}))).status,200);
    assert.equal((await handle(new Request('http://127.0.0.1/downloads/notes.txt'))).status,404);
  }finally{rmSync(dataDir,{recursive:true,force:true});}
});

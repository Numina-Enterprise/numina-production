import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';

let networkAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw Error('OFFLINE_REGRESSION_NETWORK_DISABLED');};
after(()=>assert.equal(networkAttempts,0,'identity regressions must not attempt network access'));

const retiredToken='synthetic-retired-control-token-only';
const configuredToken='synthetic-configured-control-token-only';
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const controlModuleUrl=new URL('../src/control-http.js',import.meta.url).href;

// Give the historical public pin a synthetic preimage in this test process.
// The real credential is never read or guessed. Only this metadata literal is
// substituted; all authorization and Worker dispatch logic runs as shipped.
const hook=registerHooks({load(url,context,nextLoad){
  const loaded=nextLoad(url,context);
  if(url!==controlModuleUrl)return loaded;
  const source=typeof loaded.source==='string'?loaded.source:Buffer.from(loaded.source).toString('utf8');
  const declaration=/export const CONTROL_API_KEY_SHA256_PIN='[a-f0-9]{64}';/;
  assert.match(source,declaration,'historical public pin fixture must be present');
  return {...loaded,source:source.replace(declaration,"export const CONTROL_API_KEY_SHA256_PIN='"+sha(retiredToken)+"';")};
}});
const [{default:worker},{controlActor},{database},{bootstrapControl,readControl},{reviewerHttp,REVIEW_USER},{MemoryBucket}]=await Promise.all([
  import('../src/worker.js'),
  import('../src/control-http.js'),
  import('../scripts/sqlite.mjs'),
  import('../src/control-store.js'),
  import('../src/reviewer.js'),
  import('./helpers/memory-bucket.mjs')
]);
hook.deregister();

const origin='https://synthetic.numina.test';
const owner='email:synthetic-owner@example.test';
const ownerHeaders={'oai-authenticated-user-id':'synthetic-owner','oai-authenticated-user-email':'synthetic-owner@example.test'};
const bearer=token=>({Authorization:'Bearer '+token});
function request(path,{headers={},body}={}){
  return new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
const ownerCall=()=>({jsonrpc:'2.0',id:'synthetic-owner-read',method:'tools/call',params:{name:'numina_owner_state',arguments:{}}});
async function fixture(t){
  const DB=database(),BUCKET=new MemoryBucket();
  t.after(()=>DB.close());
  for(const name of ['0001_useful_black_crow','0002_chief_rachel_grey','0003_google_play_reviewer']){
    const sql=readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'');
    for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(statement).run();
  }
  await bootstrapControl(DB,owner,Math.floor(Date.now()/1000));
  const password='synthetic-review-password-only';
  const env={DB,BUCKET,ASSETS:{fetch(){return new Response('Not found',{status:404});}},NUMINA_TELEMETRY_LOGS:'false',NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:sha(configuredToken),NUMINA_REVIEW_ENABLED:'true',NUMINA_REVIEW_RECORD_SCOPE:'own',NUMINA_REVIEW_PASSWORD_SHA256:sha(password),NUMINA_REVIEW_SESSION_KEY:'a'.repeat(64)};
  const login=()=>worker.fetch(request('/api/reviewer/v1/login',{body:{username:REVIEW_USER,password}}),env);
  return {env,DB,BUCKET,login};
}

test('changed deployment pin rejects the retired synthetic bearer in the actor helper',async()=>{
  await assert.rejects(controlActor(request('/api/control/v1/state',{headers:bearer(retiredToken)}),{NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:sha(configuredToken)}),{code:'UNAUTHENTICATED',status:401});
});

test('changed deployment pin rejects the retired synthetic bearer through the Worker',async t=>{
  const f=await fixture(t);
  const response=await worker.fetch(request('/api/control/v1/state',{headers:bearer(retiredToken)}),f.env);
  assert.equal(response.status,401);
  assert.equal((await response.json()).error,'UNAUTHENTICATED');
  assert.equal((await readControl(f.DB)).revision,0);
  assert.equal(f.BUCKET.calls,0);
});

test('configured synthetic bearer still authorizes helper and Worker reads',async t=>{
  const f=await fixture(t);
  assert.equal(await controlActor(request('/api/control/v1/state',{headers:bearer(configuredToken)}),f.env),owner);
  const response=await worker.fetch(request('/api/control/v1/state',{headers:bearer(configuredToken)}),f.env);
  assert.equal(response.status,200);
  assert.equal((await response.json()).scope,'complete');
  const padded={...f.env,NUMINA_CONTROL_API_KEY_SHA256:'  '+sha(configuredToken)+'  '};
  assert.equal(await controlActor(request('/api/control/v1/state',{headers:bearer(configuredToken)}),padded),owner);
});

for(const [label,value,code]of [
  ['missing',undefined,'AUTHORITY_CONFIGURATION_MISSING'],
  ['empty','','AUTHORITY_CONFIGURATION_MISSING'],
  ['blank','   ','AUTHORITY_CONFIGURATION_MISSING'],
  ['non-string',123,'AUTHORITY_CONFIGURATION_MISSING'],
  ['malformed','invalid','AUTHORITY_CONFIGURATION_INVALID'],
  ['short',sha(configuredToken).slice(1),'AUTHORITY_CONFIGURATION_INVALID'],
  ['uppercase',sha(configuredToken).toUpperCase(),'AUTHORITY_CONFIGURATION_INVALID']
]){
  test(label+' deployment pin fails closed for helper and Worker bearer reads',async t=>{
    const f=await fixture(t),env={...f.env,NUMINA_CONTROL_API_KEY_SHA256:value};
    for(const token of [retiredToken,configuredToken]){
      await assert.rejects(controlActor(request('/api/control/v1/state',{headers:bearer(token)}),env),{code,status:503});
      const response=await worker.fetch(request('/api/control/v1/state',{headers:bearer(token)}),env);
      assert.equal(response.status,503);
      assert.equal((await response.json()).error,code);
    }
  });
}

test('trusted header authority and public reads do not require a bearer pin',async t=>{
  const f=await fixture(t);
  for(const value of [undefined,'invalid']){
    const env={...f.env,NUMINA_CONTROL_API_KEY_SHA256:value};
    assert.equal(await controlActor(request('/api/control/v1/state',{headers:ownerHeaders}),env),owner);
    assert.equal((await worker.fetch(request('/api/control/v1/state',{headers:ownerHeaders}),env)).status,200);
    assert.equal((await worker.fetch(request('/api/control/v1/health'),env)).status,200);
    const publicRead=await worker.fetch(request('/mcp',{body:{...ownerCall(),params:{name:'numina_head',arguments:{}}}}),env);
    assert.equal(publicRead.status,200);
    assert.equal((await publicRead.json()).result.isError,false);
  }
});

test('MCP owner reads retain trusted header and configured bearer behavior without a reviewer cookie',async t=>{
  const f=await fixture(t);
  for(const headers of [ownerHeaders,bearer(configuredToken)]){
    const response=await worker.fetch(request('/mcp',{headers,body:ownerCall()}),f.env);
    assert.equal(response.status,200);
    assert.equal(JSON.parse((await response.json()).result.content[0].text).scope,'complete');
  }
});

for(const [label,headers]of [['owner headers',ownerHeaders],['owner bearer',bearer(configuredToken)],['combined owner authority',{...ownerHeaders,...bearer(configuredToken)}]]){
  test('valid reviewer cookie confines MCP '+label+' to the reviewer principal',async t=>{
    const f=await fixture(t),login=await f.login();
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const response=await worker.fetch(request('/mcp',{headers:{...headers,Cookie:cookie},body:ownerCall()}),f.env);
    assert.equal(response.status,403);
    assert.equal((await response.json()).error.data.reason,'OWNER_REQUIRED');
    assert.equal((await readControl(f.DB)).revision,0);
    assert.equal(f.BUCKET.calls,0);
  });

  test('malformed reviewer cookie blocks MCP '+label+' before owner dispatch',async t=>{
    const f=await fixture(t);
    const response=await worker.fetch(request('/mcp',{headers:{...headers,Cookie:'__Host-numina-review=bad'},body:ownerCall()}),f.env);
    assert.equal(response.status,401);
    assert.equal((await response.json()).error,'REVIEW_SIGN_IN_REQUIRED');
    assert.equal((await readControl(f.DB)).revision,0);
    assert.equal(f.BUCKET.calls,0);
  });
}

test('reviewer URLs remain first so a malformed cookie can be cleared by logout',async t=>{
  const f=await fixture(t);
  const response=await worker.fetch(request('/api/reviewer/v1/logout',{headers:{...ownerHeaders,Cookie:'__Host-numina-review=bad'},body:{}}),f.env);
  assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
});

test('verified reviewer keeps public MCP discovery access',async t=>{
  const f=await fixture(t),login=await f.login();
  assert.equal(login.status,200);
  const response=await worker.fetch(request('/mcp',{headers:{...ownerHeaders,Cookie:login.headers.get('set-cookie').split(';')[0]},body:{...ownerCall(),params:{name:'numina_head',arguments:{}}}}),f.env);
  assert.equal(response.status,200);
  assert.equal((await response.json()).result.isError,false);
});

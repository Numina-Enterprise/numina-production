import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {setup} from './helpers.mjs';
import {SAMPLE_ARGS} from './mock-mcp-server.mjs';
import {createTreasuryService} from '../../local/treasury/service.mjs';
import {verifyAuditLog,readAudit} from '../../local/treasury/audit.mjs';
import {createComplianceAdapter} from '../../local/treasury/compliance-adapter.mjs';

async function exercise(t,opts={}){
  const s=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch,...opts});
  await s.call('get_balance_summary',{},{profile:'sandbox'});
  await s.call('send_money',SAMPLE_ARGS.send_money,{profile:'live'});
  await s.call('send_money',{...SAMPLE_ARGS.send_money,skip_approval:true},{profile:'live'});
  await s.call('send_money',{...SAMPLE_ARGS.send_money,amount:-1},{profile:'sandbox'});
  await s.call('no_such_tool',{},{profile:'sandbox'});
  return s;
}
test('every attempted call is in the hash-chained, Ed25519-signed audit log, allowed or blocked',async()=>{
  const t=await setup();
  try{
    const s=await exercise(t);
    const entries=readAudit(t.config.audit.path,{limit:1000});
    const calls=entries.filter(e=>e.event.type==='tool_call');
    assert.deepEqual(calls.map(e=>e.event.status),['ok','pending_stripe_approval','blocked','blocked','blocked']);
    assert.deepEqual(calls.slice(2).map(e=>e.event.reason),['APPROVAL_BYPASS_REJECTED','INVALID_INPUT','UNKNOWN_TOOL']);
    assert.ok(calls.every(e=>e.event.stripeApproval==='required'));
    assert.equal(calls[1].event.args.amounts.amount,'125.50');assert.equal(calls[1].event.movesMoney,true);
    assert.ok(entries.some(e=>e.event.type==='discovery'));
    assert.ok(entries.every(e=>e.sig&&e.keyId));
    assert.equal(s.audit.publicKey,t.auditPublicKey);
    assert.deepEqual(verifyAuditLog(t.config.audit.path,{publicKey:t.auditPublicKey}),{ok:true,entries:entries.length,head:entries.at(-1).hash});
  }finally{await t.teardown();}
});

test('audit log tampering is detected: edit, delete, reorder, re-hash without key, wrong key',async()=>{
  const t=await setup();
  try{
    await exercise(t);
    const f=t.config.audit.path;const orig=readFileSync(f,'utf8');const lines=orig.trim().split('\n');
    const attempt=(content,re,opts={publicKey:t.auditPublicKey})=>{writeFileSync(f,content);const r=verifyAuditLog(f,opts);assert.equal(r.ok,false);assert.match(r.reason,re);writeFileSync(f,orig);};
    const edited=JSON.parse(lines[1]);edited.event.tampered=true;
    attempt([lines[0],JSON.stringify(edited),...lines.slice(2)].join('\n')+'\n',/hash mismatch/);
    attempt([lines[0],...lines.slice(2)].join('\n')+'\n',/sequence|chain/);
    attempt([lines[1],lines[0],...lines.slice(2)].join('\n')+'\n',/sequence|chain/);
    // forger recomputes the hash but cannot sign
    const {createHash}=await import('node:crypto');
    const canon=v=>Array.isArray(v)?`[${v.map(canon).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')}}`:JSON.stringify(v);
    const last=JSON.parse(lines.at(-1));const {hash,sig,keyId,...body}=last;body.event.status='ok';const forged={...body,hash:createHash('sha256').update(canon(body)).digest('hex'),sig,keyId};
    attempt([...lines.slice(0,-1),JSON.stringify(forged)].join('\n')+'\n',/bad signature/);
    const {generateKeyPairSync}=await import('node:crypto');
    const other=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64');
    writeFileSync(f,orig);assert.equal(verifyAuditLog(f,{publicKey:other}).ok,false);
    assert.equal(verifyAuditLog(f,{publicKey:t.auditPublicKey}).ok,true);
  }finally{await t.teardown();}
});

test('no secret appears in the audit log, results or console output',async()=>{
  const t=await setup();
  const logs=[];const orig={log:console.log,error:console.error,warn:console.warn};
  for(const k of Object.keys(orig))console[k]=(...a)=>logs.push(a.join(' '));
  try{
    const s=await exercise(t);
    const leak=await s.call('setup_recipient',{name:`Leaky ${t.env.NUMINA_STRIPE_MCP_LIVE_AGENT_KEY}`},{profile:'live'});
    const blob=readFileSync(t.config.audit.path,'utf8')+JSON.stringify(leak)+logs.join('\n');
    for(const k of ['NUMINA_STRIPE_MCP_SANDBOX_AGENT_KEY','NUMINA_STRIPE_MCP_LIVE_AGENT_KEY','NUMINA_TREASURY_SANDBOX_TOKEN_KEY','NUMINA_TREASURY_LIVE_TOKEN_KEY','NUMINA_TREASURY_AUDIT_SIGNING_KEY'])
      assert.ok(!blob.includes(t.env[k]),k);
    assert.doesNotMatch(readFileSync(t.config.audit.path,'utf8'),/Bearer |PRIVATE KEY|rcpt_test12345678/);
  }finally{Object.assign(console,orig);await t.teardown();}
});

test('compliance screening is informational: recorded in the audit log, never blocks',async()=>{
  const t=await setup();
  try{
    const seen=[];
    const failing=createComplianceAdapter({module:{screen:async c=>{seen.push(c.tool);return {pass:false,score:0.97,reasons:['mock sanctions hit']};}}});
    const s=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch,compliance:failing});
    const r=await s.call('send_money',SAMPLE_ARGS.send_money,{profile:'sandbox'});
    assert.equal(r.status,'pending_stripe_approval');assert.deepEqual(seen,['send_money']);
    const e=readAudit(t.config.audit.path).filter(x=>x.event.type==='tool_call').at(-1);
    assert.deepEqual(e.event.compliance,{status:'screened',blocking:false,result:{pass:false,score:0.97,reasons:['mock sanctions hit']}});
    const throwing=createComplianceAdapter({module:{screen:async()=>{throw new Error('screen down');}}});
    const s2=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch,compliance:throwing});
    assert.equal((await s2.call('get_balance_summary',{},{profile:'sandbox'})).status,'ok');
    assert.equal(readAudit(t.config.audit.path).at(-1).event.compliance.status,'error');
    const absent=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch,repo:'/nonexistent'});
    assert.equal((await absent.call('get_balance_summary',{},{profile:'sandbox'})).status,'ok');
    assert.equal(readAudit(t.config.audit.path).at(-1).event.compliance.status,'not_installed');
  }finally{await t.teardown();}
});

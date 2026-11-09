import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setup,repo} from './helpers.mjs';
import {SAMPLE_ARGS} from './mock-mcp-server.mjs';
import {defaultConfig,validateConfig,saveConfig,mergeDefaults} from '../../local/treasury/config.mjs';
import {createTreasuryService} from '../../local/treasury/service.mjs';

const approvalOff=[
  c=>{c.stripeLiveApproval='off';},
  c=>{c.stripeLiveApproval=false;},
  c=>{c.stripeLiveApproval='optional';},
  c=>{delete c.stripeLiveApproval;},
  c=>{c.profiles.live.skipApproval=true;},
  c=>{c.profiles.live.humanConfirmation=false;},
  c=>{c.profiles.sandbox.approvalRequired=false;},
  c=>{c.profiles.live.tools.send_money.autoApprove=true;},
  c=>{c.profiles.live.stripeApproval='disabled';},
  c=>{c.bypass_human_approval='yes';}
];
test('config that records Stripe live approval as off (in any form) is rejected and never saved',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'numina-treasury-approval-'));
  try{
    for(const [i,mutate] of approvalOff.entries()){
      const c=defaultConfig(dir);mutate(c);
      assert.throws(()=>validateConfig(c,{repo}),/approval|stripeLiveApproval/i,`variant ${i}`);
      const f=path.join(dir,`cfg-${i}.json`);
      assert.throws(()=>saveConfig(f,c,{repo}));assert.ok(!existsSync(f));
    }
    // mergeDefaults cannot be used to silently drop a bad value either.
    assert.throws(()=>validateConfig(mergeDefaults({stripeLiveApproval:'off'},dir),{repo}));
    assert.equal(validateConfig(defaultConfig(dir),{repo}).stripeLiveApproval,'required');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('arguments that try to skip or pre-answer Stripe approval are rejected before anything is sent',async()=>{
  const t=await setup();
  try{
    const s=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch});
    const tries=[{skip_approval:true},{human_confirmation:false},{auto_approve:true},{approval:'none'},{metadata:{bypass_review:'1'}},{pre_approved:true},{confirm:'skip'},{approval_override:'x'}];
    for(const extra of tries)for(const profile of ['sandbox','live']){
      const r=await s.call('send_money',{...SAMPLE_ARGS.send_money,...extra},{profile});
      assert.equal(r.status,'blocked',JSON.stringify(extra));assert.equal(r.reason,'APPROVAL_BYPASS_REJECTED');
    }
    assert.equal(t.sbx.calls().length+t.lv.calls().length,0,'no bypass attempt reached the server');
  }finally{await t.teardown();}
});

test('money movement in live returns Stripe\'s pending approval; the documented approval-token retry is passed through only when the server schema declares it',async()=>{
  const t=await setup();
  try{
    const s=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch});
    for(const tool of ['send_money','transfer_money','convert_currency']){
      const r=await s.call(tool,SAMPLE_ARGS[tool],{profile:'live'});
      assert.equal(r.status,'pending_stripe_approval',tool);
    }
    const retry=await s.call('send_money',{...SAMPLE_ARGS.send_money,approval_token:'apr_tok_from_dashboard'},{profile:'live'});
    assert.equal(retry.status,'ok');
    const undeclared=await s.call('transfer_money',{...SAMPLE_ARGS.transfer_money,approval_token:'apr_tok_from_dashboard'},{profile:'live'});
    assert.equal(undeclared.status,'blocked');assert.equal(undeclared.reason,'APPROVAL_BYPASS_REJECTED');
    for(const c of t.lv.calls())assert.ok(!Object.keys(c.body.params.arguments).some(k=>/skip|bypass|auto/i.test(k)));
  }finally{await t.teardown();}
});

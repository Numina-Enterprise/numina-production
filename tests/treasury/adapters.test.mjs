import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {setup,repo} from './helpers.mjs';
import {SAMPLE_ARGS} from './mock-mcp-server.mjs';
import {createTreasuryService} from '../../local/treasury/service.mjs';
import {REGISTRY} from '../../local/treasury/registry.mjs';
import {ADAPTERS} from '../../local/treasury/adapters/index.mjs';

test('one generated adapter per registry tool, in sync with registry.json',()=>{
  execFileSync(process.execPath,['local/treasury/generate-adapters.mjs','--check'],{cwd:repo});
  const files=readdirSync(new URL('../../local/treasury/adapters/',import.meta.url)).filter(n=>n!=='index.mjs').map(n=>n.replace(/\.mjs$/,'')).sort();
  assert.deepEqual(files,REGISTRY.tools.map(t=>t.name).sort());
  for(const t of REGISTRY.tools){assert.equal(ADAPTERS[t.name].name,t.name);assert.match(readFileSync(new URL(`../../local/treasury/adapters/${t.name}.mjs`,import.meta.url),'utf8'),/GENERATED/);}
});

test('registry covers every tool in the Stripe docs inventory and the five Treasury tools',()=>{
  const names=new Set(REGISTRY.tools.map(t=>t.name));
  for(const n of ['get_balance_summary','convert_currency','send_money','setup_recipient','transfer_money','stripe_api_search','stripe_api_details','stripe_api_read','stripe_api_write','get_stripe_account_info','atlas_company_formation','stripe_analytics','search_stripe_documentation','stripe_implementation_planner','send_stripe_feedback'])assert.ok(names.has(n),n);
  for(const n of ['convert_currency','send_money','transfer_money','stripe_api_write'])assert.equal(REGISTRY.tools.find(t=>t.name===n).movesMoney,true,n);
});

for(const profile of ['sandbox','live']){
  test(`every adapter is enabled and callable through the mock in ${profile}`,async()=>{
    const t=await setup();
    try{
      const s=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch});
      const server=profile==='sandbox'?t.sbx:t.lv,other=profile==='sandbox'?t.lv:t.sbx;
      for(const tool of REGISTRY.tools){
        const r=await ADAPTERS[tool.name].call(s,SAMPLE_ARGS[tool.name]||{},{profile});
        const expect=tool.stripeHumanConfirmation===true||tool.name==='stripe_api_write'?'pending_stripe_approval':'ok';
        assert.equal(r.status,expect,`${tool.name}: ${r.reason||''} ${r.message||''}`);
        if(expect==='pending_stripe_approval')assert.match(r.approvalUrl,/^https:\/\/dashboard\.stripe\.com\//);
      }
      assert.equal(server.calls().length,REGISTRY.tools.length);
      assert.equal(other.requests.length,0,'the other profile\'s server is never contacted');
    }finally{await t.teardown();}
  });
}

test('input validation: amounts, currencies, recipient ids, tool-specific rules (nothing sent)',async()=>{
  const t=await setup();
  try{
    const s=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch});
    const bad=[
      ['send_money',{recipient_id:'rcpt_test12345678',amount:-5,currency:'usd'},/non-negative integer/],
      ['send_money',{recipient_id:'rcpt_test12345678',amount:12.5,currency:'usd'},/minor units/],
      ['send_money',{recipient_id:'rcpt_test12345678',amount:'1e5',currency:'usd'},/plain decimal/],
      ['send_money',{recipient_id:'rcpt_test12345678',amount:'0',currency:'usd'},/greater than zero/],
      ['send_money',{recipient_id:'rcpt_test12345678',amount:100,currency:'dollars'},/ISO 4217/],
      ['send_money',{recipient_id:'not an id',amount:100,currency:'usd'},/Stripe object id/],
      ['convert_currency',{amount:100,source_currency:'usd',target_currency:'USD'},/must differ/],
      ['transfer_money',{amount:Number.MAX_SAFE_INTEGER+2,currency:'usd',destination:'fa_test12345678'},/integer/],
      ['setup_recipient',[],/JSON object/]
    ];
    for(const [tool,args,re] of bad){const r=await s.call(tool,args,{profile:'sandbox'});assert.equal(r.status,'blocked',tool);assert.equal(r.reason,'INVALID_INPUT');assert.match(r.message,re);}
    assert.equal(t.sbx.calls().length,0);
    assert.equal((await s.call('send_money',{recipient_id:'rcpt_test12345678',amount:12550,currency:'usd'},{profile:'sandbox'})).status,'pending_stripe_approval');
  }finally{await t.teardown();}
});

test('a tool turned off in one profile is blocked there and still works in the other',async()=>{
  const t=await setup({configure:c=>{c.profiles.live.tools.send_money.enabled=false;}});
  try{
    const s=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch});
    const r=await s.call('send_money',SAMPLE_ARGS.send_money,{profile:'live'});
    assert.equal(r.status,'blocked');assert.equal(r.reason,'TOOL_DISABLED_IN_PROFILE');assert.equal(t.lv.calls().length,0);
    assert.equal((await s.call('send_money',SAMPLE_ARGS.send_money,{profile:'sandbox'})).status,'pending_stripe_approval');
  }finally{await t.teardown();}
});

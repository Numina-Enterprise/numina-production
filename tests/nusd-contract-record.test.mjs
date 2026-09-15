import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {NUSD_CONTRACT_RECORD as record} from '../public/nusd-contract-record.js';
import {createNusdContractRecord,contractDescriptor} from '../scripts/nusd-contract-record.mjs';
import {nusdHttp,NUSD_POLICY,NUSD_MINT_WORKFLOW} from '../src/nusd-http.js';
import {contractSourcePresentation,assessFinancialStatus} from '../public/runtime-build-ui.js';
import {NuminaClient} from '../integrations/numina/src/client.js';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url));
test('contract records hash exact downloadable artifacts and never supply invented deployment identities',()=>{
  assert.deepEqual(createNusdContractRecord().record,record);
  for(const contract of record.contracts){
    for(const field of ['source','artifact']){const file=contract[field],bytes=read('docs/'+file.url.slice('/downloads/'.length));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
    assert.equal(contract.deployment.contract_address,null);assert.equal(contract.deployment.receipt,null);
    const spec={id:contract.id,name:contract.name,schema:JSON.parse(read(contract.artifact.repository_path)).schema,operations:contract.implemented_operations};
    assert.throws(()=>contractDescriptor(spec,Buffer.from('forged source'),read(contract.artifact.repository_path)),/does not match/);
  }
});
test('contract API and UI separate compiled functions from activated financial operations',async()=>{
  const request=method=>new Request('https://numina.test/api/nusd/v1/contracts',{method});
  assert.deepEqual(await (await nusdHttp(request('GET'))).json(),record);
  for(const method of ['POST','PUT','DELETE'])assert.equal((await nusdHttp(request(method))).status,405);
  assert.match(contractSourcePresentation(record).source,/compiled.*unverified/);
  assert.match(assessFinancialStatus(NUSD_POLICY).contract,/No deployed address/);
  assert.ok(Object.values(record.financial_execution).every(value=>value===false));
  for(const capability of ['mint','transfer','settlement','redemption','exchange'])assert.equal(NUSD_POLICY.capabilities[capability],false);
  const forged=structuredClone(record);forged.contracts[0].deployment.contract_address='0x123';assert.throws(()=>contractSourcePresentation(forged));
});
test('integration retains the contract source record without interpreting it as live execution',async()=>{
  const release=JSON.parse(read('dist/client/downloads/application-release-v4.json'));let include=true;
  const client=new NuminaClient({baseUrl:'https://numina.test',fetch:async url=>Response.json(url.endsWith('/status')?{schema:'numina.nusd.status.v1',...(include?{contract_record:record}:{})}:{...release,contract_record:include?record:undefined})});
  assert.deepEqual((await client.network()).data.contract_record,record);
  const build=await client.runtimeBuild();assert.deepEqual(build.data.contract_record,record);assert.equal(build.asset_execution_available,false);
  include=false;assert.equal(Object.hasOwn((await client.network()).data,'contract_record'),false);assert.equal(Object.hasOwn((await client.runtimeBuild()).data,'contract_record'),false);
});

test('mint workflow reports implemented preparation while receipt and provider claims remain evidence-bound',async()=>{
  const r=await nusdHttp(new Request('https://numina.test/api/nusd/v1/mint-workflow'));
  assert.equal(r.status,200);assert.deepEqual(await r.json(),NUSD_MINT_WORKFLOW);
  for(const method of ['POST','PUT','DELETE'])assert.equal((await nusdHttp(new Request('https://numina.test/api/nusd/v1/mint-workflow',{method}))).status,405);
  assert.equal(NUSD_MINT_WORKFLOW.nativeJournal.route,'/api/control/v1/treasury');
  assert.equal(NUSD_MINT_WORKFLOW.nativeJournal.nativeBalanceChanged,false);
  assert.equal(NUSD_MINT_WORKFLOW.preparation.broadcast,false);
  assert.equal(NUSD_MINT_WORKFLOW.recipientEvidence.providerAcceptanceInferred,false);
  assert.match(assessFinancialStatus(NUSD_POLICY).mint,/Implemented in contract.*unsigned preparation/);
  const unsafe=structuredClone(NUSD_POLICY);unsafe.mint_workflow.preparation.broadcast=true;
  assert.throws(()=>assessFinancialStatus(unsafe),/Mint workflow unavailable/);
  const mismatched=structuredClone(NUSD_POLICY);mismatched.mint_workflow.contract.artifactSha256='0'.repeat(64);
  assert.throws(()=>assessFinancialStatus(mismatched),/Mint workflow unavailable/);
  const release=JSON.parse(read('dist/client/downloads/application-release-v4.json'));
  assert.deepEqual(release.mint_workflow,NUSD_MINT_WORKFLOW);
});

test('integration retains optional mint workflow metadata without activating execution',async()=>{
  const release=JSON.parse(read('dist/client/downloads/application-release-v4.json'));
  let workflow=NUSD_MINT_WORKFLOW;
  const calls=[];
  const client=new NuminaClient({baseUrl:'https://numina.test',fetch:async(url,options)=>{
    calls.push({url,method:options.method});
    return Response.json(url.endsWith('/status')?{schema:'numina.nusd.status.v1',mint_workflow:workflow}:{...release,mint_workflow:workflow});
  }});
  const network=await client.network(),build=await client.runtimeBuild();
  assert.deepEqual(network.data.mint_workflow,NUSD_MINT_WORKFLOW);
  assert.deepEqual(build.data.mint_workflow,NUSD_MINT_WORKFLOW);
  for(const result of [network,build])assert.equal(result.asset_execution_available,false);
  assert.equal(network.data.blockchain_rpc_checked,false);assert.equal(network.data.independently_verified,false);
  assert.equal(build.data.receipt_verification_performed,false);assert.equal(build.data.readiness_verification_performed,false);
  workflow=undefined;
  assert.equal(Object.hasOwn((await client.network()).data,'mint_workflow'),false);
  assert.equal(Object.hasOwn((await client.runtimeBuild()).data,'mint_workflow'),false);
  for(const invalid of [null,[],true,'implemented']){
    workflow=invalid;
    await assert.rejects(client.network(),error=>error.code==='INVALID_SERVER_RESPONSE');
    await assert.rejects(client.runtimeBuild(),error=>error.code==='INVALID_SERVER_RESPONSE');
  }
  assert.ok(calls.every(call=>call.method==='GET'&&['https://numina.test/api/nusd/v1/status','https://numina.test/v4/release/manifest'].includes(call.url)));
});

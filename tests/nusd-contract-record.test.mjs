import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {NUSD_CONTRACT_RECORD as record} from '../public/nusd-contract-record.js';
import {createNusdContractRecord,contractDescriptor} from '../scripts/nusd-contract-record.mjs';
import {nusdHttp,NUSD_POLICY,NUSD_MINT_WORKFLOW,NUSD_CONVERSION_WORKFLOW} from '../src/nusd-http.js';
import {contractSourcePresentation,assessFinancialStatus} from '../public/runtime-build-ui.js';
import {NuminaClient} from '../integrations/numina/src/client.js';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url));

test('published contract stays bound to the finalized deployed source, artifact and receipts',()=>{
  const receipt=JSON.parse(read('runtime/nusd/deployment-receipt.json'));
  const {record:bound}=createNusdContractRecord();
  assert.equal(bound.contracts[0].deployment.contract_address,receipt.token.address);
  assert.equal(bound.contracts[0].artifact.sha256,receipt.artifactSha256);
  assert.equal(bound.contracts[0].source.sha256,receipt.sourceSha256);
  assert.equal(bound.issuance.decimals,18);
  for(const mutate of [
    value=>value.sourceSha256='0'.repeat(64),
    value=>value.artifactSha256='0'.repeat(64),
    value=>value.settlementSourceSha256='0'.repeat(64),
    value=>value.chainId='1',
    value=>value.genesisHash='0x'+'0'.repeat(64),
    value=>value.issuance.decimals=6,
    value=>value.finality.status='PENDING',
    value=>value.finality.requiredConfirmations=1,
    value=>value.finality.observedAt='2026-09-18T00:00:00Z',
    value=>value.token.address='0x'+'1'.repeat(40),
    value=>value.token.receipt.status='0x0',
    value=>value.token.receipt.transactionHash='0x'+'1'.repeat(64),
    value=>value.token.receipt.contractAddress='0x'+'1'.repeat(40),
    value=>value.token.finalConfirmations=1,
    value=>value.settlement.nusd='0x'+'1'.repeat(40)
  ]){
    const changed=structuredClone(receipt);mutate(changed);
    const readChanged=file=>String(file).replaceAll('\\','/').endsWith('/runtime/nusd/deployment-receipt.json')?Buffer.from(JSON.stringify(changed)):fs.readFileSync(file);
    assert.throws(()=>createNusdContractRecord(readChanged),/Finalized NUSD deployment binding mismatch/);
  }
});

test('conversion workflow binds both compiled contracts and preserves disabled live money movement',async()=>{
 const route='https://numina.test/api/nusd/v1/conversion-workflow';
 const response=await nusdHttp(new Request(route));assert.equal(response.status,200);
 assert.deepEqual(await response.json(),NUSD_CONVERSION_WORKFLOW);
 assert.equal(NUSD_CONVERSION_WORKFLOW.contracts.length,2);
 for(const contract of NUSD_CONVERSION_WORKFLOW.contracts)assert.deepEqual(contract,record.contracts.find(c=>c.id===contract.id));
 for(const method of ['POST','PUT','DELETE'])assert.equal((await nusdHttp(new Request(route,{method}))).status,405);
 assert.equal(NUSD_CONVERSION_WORKFLOW.usdc.sameChainRequired,true);
 assert.equal(NUSD_CONVERSION_WORKFLOW.usdc.bridgeImplemented,false);
 assert.equal(NUSD_CONVERSION_WORKFLOW.usd.bankSubmissionImplemented,false);
 assert.equal(NUSD_CONVERSION_WORKFLOW.usd.nusdBaseUnitsPerUsdCent,'10000000000000000');
 assert.equal(NUSD_CONVERSION_WORKFLOW.treasury.balanceCount,1);
 assert.equal(NUSD_CONVERSION_WORKFLOW.activation.financialExecutionEnabled,false);
 assert.deepEqual(NUSD_POLICY.conversion_workflow,NUSD_CONVERSION_WORKFLOW);
 const release=JSON.parse(read('dist/client/downloads/application-release-v4.json'));
 assert.deepEqual(release.conversion_workflow,NUSD_CONVERSION_WORKFLOW);
});
test('contract records hash exact downloadable artifacts and never supply invented deployment identities',()=>{
  assert.deepEqual(createNusdContractRecord().record,record);
  for(const contract of record.contracts){
    for(const field of ['source','artifact']){const file=contract[field],bytes=read('docs/'+file.url.slice('/downloads/'.length));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
    if(['nusd','nusd_settlement'].includes(contract.id)){assert.equal(contract.deployment.status,'verified');assert.equal(contract.deployment.submission_performed,true);assert.equal(contract.verification.chain_receipt_verified,true);assert.ok(/^0x[0-9a-fA-F]{40}$/.test(contract.deployment.contract_address));assert.ok(/^0x[0-9a-fA-F]{64}$/.test(contract.deployment.transaction_hash));assert.equal(contract.deployment.receipt.status,'0x1');}else{assert.equal(contract.deployment.contract_address,null);assert.equal(contract.deployment.receipt,null);}
    const spec={id:contract.id,name:contract.name,schema:JSON.parse(read(contract.artifact.repository_path)).schema,operations:contract.implemented_operations};
    assert.throws(()=>contractDescriptor(spec,Buffer.from('forged source'),read(contract.artifact.repository_path)),/does not match/);
  }
});
test('contract API and UI separate compiled functions from activated financial operations',async()=>{
  const request=method=>new Request('https://numina.test/api/nusd/v1/contracts',{method});
  assert.deepEqual(await (await nusdHttp(request('GET'))).json(),record);
  for(const method of ['POST','PUT','DELETE'])assert.equal((await nusdHttp(request(method))).status,405);
  assert.match(contractSourcePresentation(record).source,/deployed.*receipt-verified/);
  assert.equal(assessFinancialStatus(NUSD_POLICY).contract,NUSD_POLICY.asset.contract);
  assert.match(assessFinancialStatus(NUSD_POLICY).identity,/Issued NUSD.*18 decimals/);
  assert.match(assessFinancialStatus(NUSD_POLICY).checked,/current transfer activity was not checked/);
  for(const mutate of [
    value=>value.issuance.baseUnits='1',
    value=>value.issuance.transactionHash='0x'+'0'.repeat(64),
    value=>value.financial_execution.external_deposits=true
  ]){const changed=structuredClone(record);mutate(changed);assert.throws(()=>contractSourcePresentation(changed));}
  assert.equal(record.financial_execution.issuance,true);assert.equal(record.financial_execution.transfer,false);assert.equal(record.financial_execution.nusd_settlement,false);assert.equal(record.financial_execution.usd_redemption,false);assert.equal(record.financial_execution.usdc_conversion,false);assert.equal(record.financial_execution.external_deposits,false);
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
  assert.equal(NUSD_MINT_WORKFLOW.contract.decimals,18);assert.equal(NUSD_MINT_WORKFLOW.preparation.broadcast,false);
  assert.equal(NUSD_MINT_WORKFLOW.recipientEvidence.providerAcceptanceInferred,false);
  assert.match(assessFinancialStatus(NUSD_POLICY).mint,/Constructor issuance verified.*1,500T NUSD.*18 decimals/);
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

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
  for(const descriptor of bound.contracts.slice(0,2)){
    assert.equal(descriptor.historicalRecord,true);
    assert.equal(descriptor.observedAt,receipt.finality.observedAt);
    assert.equal(descriptor.currentPaused,null);
    assert.equal(descriptor.currentChainStateVerified,false);
    assert.equal(descriptor.deployment.verification_scope,'RETAINED_CHAIN_RECEIPT');
    assert.equal(descriptor.deployment.observedAt,receipt.finality.observedAt);
  }
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
  assert.match(assessFinancialStatus(NUSD_POLICY).identity,/constructor issuance recorded.*18 decimals/);
  assert.match(assessFinancialStatus(NUSD_POLICY).checked,/current transfer activity was not checked/);
  for(const mutate of [
    value=>value.issuance.baseUnits='1',
    value=>value.issuance.transactionHash='0x'+'0'.repeat(64),
    value=>value.financial_execution.external_deposits=true,
    value=>value.contracts[2].deployment.external_provider_verified=true,
    value=>value.contracts[2].deployment.submission_performed=true,
    value=>value.contracts[2].deployment.contract_address='0x'+'1'.repeat(40),
    value=>value.contracts[3].deployment.native_attestation_id='unbound',
    value=>value.contracts[3].verification.chain_receipt_verified=true
  ]){const changed=structuredClone(record);mutate(changed);assert.throws(()=>contractSourcePresentation(changed));}
  assert.equal(record.financial_execution.issuance,true);assert.equal(record.financial_execution.transfer,false);assert.equal(record.financial_execution.nusd_settlement,false);assert.equal(record.financial_execution.usd_redemption,false);assert.equal(record.financial_execution.usdc_conversion,false);assert.equal(record.financial_execution.external_deposits,false);
  for(const capability of ['mint','transfer','settlement','redemption','exchange'])assert.equal(NUSD_POLICY.capabilities[capability],false);
  for(const contract of record.contracts.slice(2)){
    assert.equal(contract.deployment.status,'retained_attestation');assert.equal(contract.deployment.lifecycle,'HISTORICAL_ATTESTATION');
    assert.equal(contract.deployment.verification_scope,'HISTORICAL_NUMINA_ATTESTATION');
    assert.equal(contract.deployment.backing_verified,null);
    assert.equal(contract.deployment.external_provider_verified,false);assert.equal(contract.deployment.transaction_hash,null);
  }
  assert.match(contractSourcePresentation(record)['source-scope'],/dated native attestations; current backing and chain deployment remain unverified/);
  const forged=structuredClone(record);forged.contracts[0].deployment.contract_address='0x123';assert.throws(()=>contractSourcePresentation(forged));
});
test('integration retains the contract source record without interpreting it as live execution',async()=>{
  const release=JSON.parse(read('dist/client/downloads/application-release-v4.json'));let include=true;
  const client=new NuminaClient({baseUrl:'https://numina.test',fetch:async url=>Response.json(url.endsWith('/status')?{schema:'numina.nusd.status.v1',...(include?{contract_record:record}:{})}:{...release,contract_record:include?record:undefined})});
  const expected=structuredClone(record);
  // The integration's credential sanitizer omits all authorization fields,
  // including retained owner-authorization metadata. Financial evidence remains.
  delete expected.canonicalTreasuryValues.settlementReceiptValidation.authorization;
  delete expected.historical_native_settlement.authorization;
  assert.deepEqual((await client.network()).data.contract_record,expected);
  const build=await client.runtimeBuild();assert.deepEqual(build.data.contract_record,expected);assert.equal(build.asset_execution_available,false);
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
  assert.equal(NUSD_MINT_WORKFLOW.status,'HISTORICAL_CHAIN_DEPLOYMENT_OBSERVATION');
  assert.equal(NUSD_MINT_WORKFLOW.observedAt,'2026-09-18T15:35:24.884Z');
  assert.equal(NUSD_MINT_WORKFLOW.currentChainStateVerified,false);
  assert.equal(NUSD_MINT_WORKFLOW.nativeJournal.observedRevision,142);
  assert.equal(NUSD_MINT_WORKFLOW.nativeJournal.snapshotIsLive,false);
  assert.equal(NUSD_MINT_WORKFLOW.execution.transactionHash,'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b');
  assert.equal(NUSD_MINT_WORKFLOW.execution.receipt.blockNumber,'51725');
  assert.match(assessFinancialStatus(NUSD_POLICY).mint,/September 18, 2026 receipt.*1,500T NUSD.*current chain activity unverified/);
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

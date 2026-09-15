import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {NUSD_CONTRACT_RECORD as record} from '../public/nusd-contract-record.js';
import {createNusdContractRecord,contractDescriptor} from '../scripts/nusd-contract-record.mjs';
import {nusdHttp,NUSD_POLICY} from '../src/nusd-http.js';
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

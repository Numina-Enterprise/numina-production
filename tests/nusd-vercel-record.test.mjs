import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import handler from '../api/status.js';
import {NUSD_POLICY} from '../src/nusd-http.js';

async function request(mode,method='GET'){
  const headers={};
  const response={setHeader(name,value){headers[name]=value;},end(body){this.body=JSON.parse(body);}};
  await handler({url:'/api/status?mode='+mode,method},response);
  return {...response,headers};
}

test('public Vercel NUSD records use the same canonical source and existing function',async()=>{
  const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  const fallback=config.rewrites.findIndex(route=>route.source==='/api/nusd/v1/:path*');
  for(const [path,mode,value] of [
    ['status','nusd-status',NUSD_POLICY],
    ['contracts','nusd-contracts',NUSD_POLICY.contract_record],
    ['mint-workflow','nusd-mint-workflow',NUSD_POLICY.mint_workflow],
    ['conversion-workflow','nusd-conversion-workflow',NUSD_POLICY.conversion_workflow]
  ]){
    const index=config.rewrites.findIndex(route=>route.source==='/api/nusd/v1/'+path);
    assert.ok(index>=0&&index<fallback);
    assert.equal(config.rewrites[index].destination,'/api/status?mode='+mode);
    const response=await request(mode);
    assert.equal(response.statusCode,200);
    assert.equal(response.headers['cache-control'],'no-store');
    assert.deepEqual(response.body,value);
    assert.equal((await request(mode,'POST')).statusCode,405);
  }
});

test('receipt endpoint preserves factual issuance and dated verification',async()=>{
  const receipt=await request('nusd-deployment-receipt');
  const verification=await request('nusd-deployment-verification');
  assert.equal(receipt.body.issuance.decimals,18);
  assert.equal(receipt.body.token.address,NUSD_POLICY.asset.contract);
  assert.equal(verification.body.verifiedAt,'2026-09-18T15:35:24.884Z');
  assert.equal(verification.body.issuance.paused,true);
  assert.equal(verification.body.externalSettlement.reservesVerified,false);
});

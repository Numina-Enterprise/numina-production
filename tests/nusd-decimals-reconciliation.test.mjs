import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {loadTokenArtifact,TOKEN_ARTIFACT_SHA256,TOKEN_SOURCE_SHA256,TOKEN_DECIMALS} from '../runtime/nusd/scripts/token-artifact.mjs';
import {NUSD_DECIMALS,USDC_DECIMALS,NUSD_PER_USDC_BASE_UNIT,NUSD_TOKEN,parseNusdToBaseUnits,parseUsdcToBaseUnits,
  formatNusdBaseUnits,formatUsdcBaseUnits,nusdToUsdcBaseUnits,usdcToNusdBaseUnits,nusdAmount,parseMonetaryToUnits} from '../numina-financial-core/src/money.mjs';
import {treasuryAmount,describeTreasuryProjectionAmounts,NUMINA_TREASURY_ASSETS,NUMINA_TREASURY_MODEL} from '../src/native-treasury-model.js';

const root=new URL('../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root));
const json=p=>JSON.parse(read(p).toString('utf8'));
const sha=p=>createHash('sha256').update(read(p)).digest('hex');
const TOKEN='0x491c1DF1b5CA77AF797f052c2310ca17039C931b',CHAIN='962421430',SUPPLY='1500000000000000000000000000000000';

test('active token source and artifact are the deployed 18-decimal bytes recorded in the deployment receipt',()=>{
  const receipt=json('runtime/nusd/deployment-receipt.json'),mint=json('runtime/nusd/mint-receipt.json');
  assert.equal(TOKEN_DECIMALS,18);
  assert.equal(TOKEN_ARTIFACT_SHA256,receipt.artifactSha256);assert.equal(TOKEN_SOURCE_SHA256,receipt.sourceSha256);
  assert.equal(sha('runtime/nusd/artifacts/NuminaUSD.json'),receipt.artifactSha256);
  assert.equal(sha('runtime/nusd/contracts/NuminaUSD.sol'),receipt.sourceSha256);
  assert.deepEqual(read('runtime/nusd/contracts/NuminaUSD.sol'),read('runtime/nusd/history/18d/contracts/NuminaUSD.sol'));
  assert.match(read('runtime/nusd/contracts/NuminaUSD.sol').toString('utf8'),/function decimals\(\) public pure override returns \(uint8\) \{ return 18; \}/);
  assert.equal(loadTokenArtifact().sourceSha256,receipt.sourceSha256);
  assert.equal(mint.decimals,18);assert.equal(mint.baseUnits,SUPPLY);assert.equal(mint.cap,SUPPLY);assert.equal(mint.tokenAddress,TOKEN);assert.equal(mint.chainId,CHAIN);
  assert.equal(receipt.issuance.decimals,18);assert.equal(receipt.token.state.decimals,18);
});

test('superseded 6-decimal candidates are retained in history/6d and no active contract assumes 6-decimal NUSD',()=>{
  for(const name of ['NuminaUSD','NuminaUSDCConversion','NuminaUSDRedemption']){
    assert.ok(fs.existsSync(new URL(`runtime/nusd/history/6d/contracts/${name}.sol`,root)));
    assert.ok(fs.existsSync(new URL(`runtime/nusd/history/6d/artifacts/${name}.json`,root)));
    const artifact=json(`runtime/nusd/artifacts/${name}.json`);
    assert.equal(artifact.sourceSha256,sha(`runtime/nusd/contracts/${name}.sol`));
  }
  assert.match(read('runtime/nusd/history/6d/contracts/NuminaUSD.sol').toString('utf8'),/return 6; \}/);
  const conversion=read('runtime/nusd/contracts/NuminaUSDCConversion.sol').toString('utf8');
  assert.match(conversion,/NUSD_DECIMALS = 18;/);assert.match(conversion,/NUSD_PER_USDC_BASE_UNIT = 1_000_000_000_000;/);
  assert.deepEqual(read('runtime/nusd/contracts/NuminaUSDCConversion.sol'),read('runtime/nusd/history/18d/contracts/NuminaUSDCConversion.sol'));
  const redemption=read('runtime/nusd/contracts/NuminaUSDRedemption.sol').toString('utf8');
  assert.match(redemption,/NUSD_UNITS_PER_USD_CENT = 10_000_000_000_000_000;/);assert.match(redemption,/decimals\(\) != 18\)/);
  assert.match(redemption,/markReconciliationRequired/);
});

test('deploy and verify scripts require 18-decimal NUSD and 1.5e33 base units',()=>{
  const text=p=>read('runtime/nusd/scripts/'+p).toString('utf8');
  assert.match(text('deploy-production.mjs'),new RegExp(`REQUIRED_INITIAL_SUPPLY='${SUPPLY}'`));assert.match(text('deploy-production.mjs'),/REQUIRED_DECIMALS=18n/);
  assert.match(text('verify-production.mjs'),new RegExp(`expectedSupply='${SUPPLY}'`));assert.match(text('verify-production.mjs'),/decimals===18n/);
  assert.match(text('enable-transfers.mjs'),/issuance\?\.decimals!==18/);
  assert.match(text('finalize-post-freeze-journal.mjs'),/issuance\?\.decimals!==18/);
  assert.match(text('validate-deployment.mjs'),/NUSD_DECIMALS = TOKEN_DECIMALS/);
  assert.match(text('prepare-mint.mjs'),/parseUnits\(config\.amountNusd, TOKEN_DECIMALS\)/);
  for(const file of ['deploy-production.mjs','verify-production.mjs','enable-transfers.mjs','finalize-post-freeze-journal.mjs','validate-deployment.mjs','prepare-mint.mjs']){
    assert.doesNotMatch(text(file),/decimals:6\b|decimals!==6\b|decimals===6n|REQUIRED_DECIMALS=6n|parseUnits\([^)]*, 6\)|NUSD_DECIMALS = 6;/,file);
  }
  const deployment=json('runtime/nusd/deployment-receipt.json');
  assert.equal(deployment.issuance.baseUnits,SUPPLY);assert.equal(deployment.issuance.amountNusd,'1500000000000000');
});

test('money helpers convert 18-decimal NUSD and 6-decimal USDC exactly and reject non-divisible amounts',()=>{
  assert.equal(NUSD_DECIMALS,18n);assert.equal(USDC_DECIMALS,6n);assert.equal(NUSD_PER_USDC_BASE_UNIT,1_000_000_000_000n);
  assert.equal(parseNusdToBaseUnits('1500000000000000').toString(),SUPPLY);
  assert.equal(parseNusdToBaseUnits('0.000000000000000001'),1n);
  assert.equal(parseUsdcToBaseUnits('12.5'),12_500_000n);
  assert.equal(nusdToUsdcBaseUnits(12n*10n**18n),12_000_000n);
  assert.equal(nusdToUsdcBaseUnits('1000000000000'),1n);
  assert.equal(usdcToNusdBaseUnits(1n),1_000_000_000_000n);
  assert.equal(nusdToUsdcBaseUnits(usdcToNusdBaseUnits(987654321n)),987654321n);
  for(const bad of [1n,999_999_999_999n,1_000_000_000_001n,12n*10n**18n+1n])assert.throws(()=>nusdToUsdcBaseUnits(bad),/NOT_DIVISIBLE_BY_1E12/);
  for(const bad of ['1.0000000000000000001','-1','01','1e18','',' 1',null,1.5,true])assert.throws(()=>parseNusdToBaseUnits(bad));
  assert.throws(()=>parseUsdcToBaseUnits('1.0000001'));assert.throws(()=>nusdToUsdcBaseUnits(-1n));assert.throws(()=>nusdToUsdcBaseUnits(1.5));
  assert.throws(()=>usdcToNusdBaseUnits(2n**256n));
  assert.equal(formatNusdBaseUnits(SUPPLY),'1500000000000000');assert.equal(formatNusdBaseUnits(1n),'0.000000000000000001');
  assert.equal(formatUsdcBaseUnits(12_500_000n),'12.5');
  assert.deepEqual({...nusdAmount(SUPPLY)},{baseUnits:SUPPLY,decimals:18,tokenAddress:TOKEN,chainId:CHAIN});
  assert.deepEqual({...NUSD_TOKEN},{symbol:'NUSD',decimals:18,tokenAddress:TOKEN,chainId:CHAIN});
  // The 6-decimal fiat/micro-unit parser used by bank and CAMT rails is unchanged.
  assert.equal(parseMonetaryToUnits('100.50'),100_500_000n);
});

test('every treasury ledger amount expands to base units, decimals, token address and chain ID without changing the stored projection',()=>{
  assert.equal(NUMINA_TREASURY_ASSETS.NUSD.decimals,18);assert.equal(NUMINA_TREASURY_ASSETS.NUSD.tokenAddress,TOKEN);assert.equal(NUMINA_TREASURY_ASSETS.NUSD.chainId,CHAIN);
  const nusd=treasuryAmount('500000000000000','NUSD');
  assert.deepEqual({...nusd},{schema:'numina.treasury.ledger-amount.v1',unit:'NUSD',recorded:'500000000000000',recordedScale:'whole',
    baseUnits:'500000000000000000000000000000000',decimals:18,tokenAddress:TOKEN,chainId:CHAIN});
  assert.equal(treasuryAmount('500000000000000','USDC').baseUnits,'500000000000000000000');
  assert.equal(treasuryAmount('12345','USD','minor').baseUnits,'12345');
  assert.throws(()=>treasuryAmount('1','EUR'));assert.throws(()=>treasuryAmount('-1','NUSD'));assert.throws(()=>treasuryAmount(1,'NUSD'));
  assert.throws(()=>treasuryAmount('9'.repeat(78),'NUSD'));
  const projection={...NUMINA_TREASURY_MODEL,balance:'500000000000000',last_event_id:'e3',transaction_requests:[
    {id:'e1',kind:'mint_request',status:'PREPARED',destination_reference:'0xabc',amount:'1500000000000000',unit:'NUSD',network_reference:'numina',submission_performed:false,receipt:null},
    {id:'e2',kind:'usdc_deposit_request',status:'PREPARED',destination_reference:'stripe',amount:'7',unit:'USDC',submission_performed:false,receipt:null},
    {id:'e3',kind:'bank_transaction_request',status:'PREPARED',destination_reference:'bank',amount_minor:'250',currency:'USD',submission_performed:false,receipt:null},
    {id:'e4',kind:'aggregate_settlement',aggregate_amount:'1500000000000000',unit:'NUSD',components:[
      {id:'bank-usd',amount_nusd:'500000000000000',settled_amount:'500000000000000',settled_unit:'USD'},
      {id:'stripe-usdc',amount_nusd:'500000000000000',settled_amount:'500000000000000',settled_unit:'USDC'},
      {id:'native-retained',amount_nusd:'500000000000000',settled_amount:'500000000000000',settled_unit:'NUSD'}]}
  ]};
  const before=JSON.stringify(projection);
  const view=describeTreasuryProjectionAmounts(projection);
  assert.equal(JSON.stringify(projection),before);
  assert.equal(view.balance.baseUnits,'500000000000000000000000000000000');assert.equal(view.balance.tokenAddress,TOKEN);
  assert.equal(view.transaction_requests[0].amounts.amount.baseUnits,SUPPLY);
  assert.equal(view.transaction_requests[1].amounts.amount.decimals,6);
  assert.equal(view.transaction_requests[2].amounts.amount_minor.decimals,2);
  const components=view.transaction_requests[3].amounts.components;
  assert.equal(view.transaction_requests[3].amounts.aggregate_amount.baseUnits,SUPPLY);
  assert.equal(components.length,3);
  for(const component of components){assert.equal(component.amount_nusd.decimals,18);assert.equal(component.amount_nusd.chainId,CHAIN);}
  const walk=value=>{if(value&&typeof value==='object'){if(Object.hasOwn(value,'recorded')){for(const key of ['baseUnits','decimals','tokenAddress','chainId'])assert.ok(Object.hasOwn(value,key),key);assert.match(value.baseUnits,/^(0|[1-9][0-9]*)$/);}else Object.values(value).forEach(walk);}};
  walk(view);
  const schema=json('src/schemas/numina-treasury-ledger-amount.v1.schema.json');
  assert.deepEqual(schema.required,['schema','unit','recorded','recordedScale','baseUnits','decimals','tokenAddress','chainId']);
  assert.deepEqual(Object.keys(nusd).sort(),[...schema.required].sort());
});

test('signed receipts are untouched and addenda reference their exact SHA-256 and the corrected 18-decimal basis',()=>{
  const cases=[
    ['docs/nusd/treasury-settlement-receipt.json','docs/nusd/treasury-settlement-receipt.addendum-2026-11-11.json'],
    ['runtime/nusd/treasury-settlement-receipt.json','runtime/nusd/treasury-settlement-receipt.addendum-2026-11-11.json'],
    ['runtime/nusd/deployment.production.json','runtime/nusd/deployment.production.addendum-2026-11-11.json']
  ];
  for(const [original,addendumPath] of cases){
    const addendum=json(addendumPath);
    assert.equal(addendum.original.path,original);assert.equal(addendum.original.sha256,sha(original));assert.equal(addendum.original.edited,false);
    assert.equal(addendum.signed,false);assert.equal(addendum.boundaries.onChainActionPerformed,false);assert.equal(addendum.boundaries.signaturePerformed,false);
  }
  const docs=json(cases[0][1]),runtime=json(cases[1][1]);
  for(const addendum of [docs,runtime]){
    assert.equal(addendum.correction.token.decimals,18);assert.equal(addendum.correction.token.tokenAddress,TOKEN);assert.equal(addendum.correction.token.chainId,CHAIN);
    assert.equal(addendum.correction.amounts['aggregate.amountNusd'].baseUnits,SUPPLY);
    assert.equal(addendum.correction.token.mintEvidence.receiptSha256,sha('runtime/nusd/mint-receipt.json'));
    for(const value of Object.values(addendum.correction.amounts)){for(const key of ['baseUnits','decimals','tokenAddress','chainId'])assert.ok(Object.hasOwn(value,key));}
    assert.ok(addendum.docsVsRuntimeDiscrepancy.fieldDifferences.length>0);
  }
  assert.equal(docs.counterpart.sha256,sha(cases[1][0]));assert.equal(runtime.counterpart.sha256,sha(cases[0][0]));
  assert.notEqual(sha(cases[0][0]),sha(cases[1][0]));
  const deployment=json(cases[2][1]),request=json(cases[2][0]);
  assert.equal(request.issuer.policySha256,deployment.findings[1].recorded);
  assert.notEqual(request.issuer.policySha256,sha('runtime/nusd/policies/issuer-policy-1500t-6d.json'));
  assert.equal(deployment.deployedToken.issuerPolicyHashOnChain,json('runtime/nusd/deployment-receipt.json').token.state.issuerPolicyHash);
});

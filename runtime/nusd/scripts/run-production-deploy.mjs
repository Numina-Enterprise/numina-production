import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const request=process.argv[2]||'deployment.production.json';
const receipt=process.argv[3]||'deployment-receipt.json';
const statusFile=process.argv[4]||'deployment-status.json';

const child=spawnSync(process.execPath,['scripts/deploy-production.mjs',request,receipt],{
  cwd:root,encoding:'utf8',env:process.env,maxBuffer:1024*1024
});
const combined=(child.stderr||'')+'\n'+(child.stdout||'');
const allowed=[
  ['NUMINA_RPC_APP_CREDENTIAL_REQUIRED_ADMIN_KEY_DETECTED','RPC_APP_CREDENTIAL_REQUIRED'],
  ['NUMINA_RPC_AUTHENTICATION_FAILED','RPC_AUTHENTICATION_FAILED'],
  ['NUMINA_RPC_CONFIGURATION_REQUIRED','RPC_CONFIGURATION_REQUIRED'],
  ['MANAGED_SIGNER_UNAVAILABLE','MANAGED_SIGNER_UNAVAILABLE'],
  ['INSUFFICIENT_GAS_BALANCE','INSUFFICIENT_GAS_BALANCE'],
  ['CHAIN_MISMATCH','CHAIN_MISMATCH'],
  ['GENESIS_MISMATCH','GENESIS_MISMATCH'],
  ['DEPLOYMENT_REQUEST_INVALID','DEPLOYMENT_REQUEST_INVALID'],
  ['SUPPLY_NOT_1500T_18D','SUPPLY_NOT_1500T_18D'],
  ['RECIPIENT_SIGNER_MISMATCH','RECIPIENT_SIGNER_MISMATCH'],
  ['DEPLOYMENT_REVERTED','DEPLOYMENT_REVERTED'],
  ['FINALITY_TIMEOUT','FINALITY_TIMEOUT'],
  ['RECEIPT_TIMEOUT','RECEIPT_TIMEOUT'],
  ['NUSD_POST_DEPLOY_VERIFICATION_FAILED','NUSD_POST_DEPLOY_VERIFICATION_FAILED'],
  ['SETTLEMENT_TOKEN_BINDING_MISMATCH','SETTLEMENT_TOKEN_BINDING_MISMATCH']
];
let status;
if(child.status===0&&fs.existsSync(path.join(root,receipt))){
  const value=JSON.parse(fs.readFileSync(path.join(root,receipt),'utf8'));
  status={
    schema:'numina.nusd.deployment-status.v1',identity:'NUMINA',status:'VERIFIED',
    sourceCommit:process.env.GITHUB_SHA||null,
    chainId:value.chainId,genesisHash:value.genesisHash,
    issuance:value.issuance,
    token:value.token,
    settlement:value.settlement,
    externalSettlement:value.externalSettlement,
    verification:value.verification
  };
}else{
  const match=allowed.find(([needle])=>combined.includes(needle));
  status={
    schema:'numina.nusd.deployment-status.v1',identity:'NUMINA',status:'BLOCKED',
    sourceCommit:process.env.GITHUB_SHA||null,
    code:match?.[1]||'DEPLOYMENT_FAILED_UNCLASSIFIED',
    requestedIssuance:{amountNusd:'1500000000000000',decimals:18,baseUnits:'1500000000000000000000000000000000'},
    externalSettlement:{usd:false,usdc:false},
    receipt:null
  };
}
fs.writeFileSync(path.join(root,statusFile),JSON.stringify(status,null,2)+'\n');
console.log(JSON.stringify({status:status.status,code:status.code??null}));
if(child.status!==0)process.exitCode=child.status||1;

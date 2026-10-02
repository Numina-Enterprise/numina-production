import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTokenArtifact,TOKEN_ARTIFACT_SHA256,TOKEN_SOURCE_SHA256} from '../scripts/token-artifact.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// Retained entrypoint: validate protected pins against the exact artifact and
// finalized historical receipt. It must never refresh pins or rewrite evidence.
export function validateRetainedTokenPins(){
  loadTokenArtifact();
  const receipt=JSON.parse(fs.readFileSync(path.join(root,'deployment-receipt.json'),'utf8'));
  if(receipt.schema!=='numina.nusd.production-deployment-receipt.v1'||receipt.identity!=='NUMINA'||
    receipt.artifactSha256!==TOKEN_ARTIFACT_SHA256||receipt.sourceSha256!==TOKEN_SOURCE_SHA256||
    receipt.finality?.status!=='FINAL'||!Number.isSafeInteger(receipt.finality.requiredConfirmations)||
    receipt.finality.requiredConfirmations<12||receipt.token?.receipt?.status!=='0x1'||
    receipt.issuance?.decimals!==18||receipt.token.state?.decimals!==18||
    receipt.issuance.externallyBackedClaim!==false||
    !/^[1-9][0-9]*$/.test(String(receipt.issuance.amountNusd))||
    !/^[1-9][0-9]*$/.test(String(receipt.issuance.baseUnits))||
    BigInt(receipt.issuance.amountNusd)*10n**18n!==BigInt(receipt.issuance.baseUnits)||
    receipt.token.state.totalSupply!==receipt.issuance.baseUnits)
    throw Error('RETAINED_TOKEN_RECEIPT_MISMATCH: protected source/artifact pins and finalized 18-decimal receipt must agree');
  return {artifactSha256:TOKEN_ARTIFACT_SHA256,sourceSha256:TOKEN_SOURCE_SHA256,decimals:18,
    scope:'RETAINED_FINALIZED_RECEIPT',currentChainStateVerified:false,pinsRefreshed:false,
    artifactWritten:false,receiptWritten:false,externalExecutionPerformed:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2)throw Error('READ_ONLY_VALIDATION: this retained entrypoint accepts no pin refresh or output options');
  console.log(JSON.stringify(validateRetainedTokenPins()));
  console.log('Validated retained pins and 18-decimal receipt; no pin refresh, artifact writes or provider transactions.');
}

import {execFileSync} from 'node:child_process';
import {syncApplicationReleasePin} from './sync-application-release-pin.mjs';
import {verifyProductionPair} from './production-pair.mjs';
execFileSync(process.execPath,['scripts/check-final-build.mjs'],{stdio:'inherit'});
verifyProductionPair();
const inventory=syncApplicationReleasePin();
console.log(JSON.stringify({publishCandidateVerified:true,...inventory,providerExecutionVerified:false}));

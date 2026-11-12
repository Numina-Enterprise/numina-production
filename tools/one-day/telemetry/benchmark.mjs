import {generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {cpus,platform,arch} from 'node:os';
import {parseSpacePacket,normalizeStac,canonical,hash} from './adapters.mjs';
import {SimulationPolicy,receiptSigner,ReceiptVerifier,fingerprint} from './provenance.mjs';
import {packet,stacItem} from './fixtures.mjs';

const count=Number(process.argv[2]||1200);
if(!Number.isSafeInteger(count)||count<30||count>100000)throw new Error('COUNT_MUST_BE_30_TO_100000');
const {privateKey,publicKey}=generateKeyPairSync('ed25519'),runId='generated-telemetry-benchmark';
const signer=receiptSigner({privateKey,runId}),verifier=new ReceiptVerifier({publicKey,runId}),policy=new SimulationPolicy({maxObservations:count});
const timings=[],counts={ALLOW:0,DENY:0,ESCALATE:0},fixtures=[],receiptExamples=[];let verified=0;
const start=performance.now();
for(let i=0;i<count;i++){
 const begin=performance.now();
 const record=i%2===0?parseSpacePacket(packet({sequence:(i/2)%16384})):normalizeStac(stacItem('generated-point-'+i));
 const context=i%3===0?{principal:'unauthorized-fixture',action:'observe'}:i%3===1?{principal:'simulation-operator',action:'tasking_proposal'}:{principal:'simulation-operator',action:'observe'};
 const decision=policy.decide(record,context),receipt=signer(record,decision);if(!verifier.accept(receipt))throw new Error('SIGNATURE_OR_CHAIN_FAILED');
 if(receiptExamples.length<3)receiptExamples.push(receipt);
 verified++;counts[decision.decision]++;timings.push(performance.now()-begin);fixtures.push({record,context});
}
const elapsedMs=performance.now()-start;timings.sort((a,b)=>a-b);
const percentile=q=>timings[Math.ceil(q*timings.length)-1];
const files=['adapters.mjs','provenance.mjs','fixtures.mjs','benchmark.mjs'];
console.log(JSON.stringify({schema:'numina.telemetry.benchmark.v1',classification:'LOCAL_SIMULATION',observedAt:new Date().toISOString(),baselineRepositoryRevision:'23c38e1e3a15e8f6559486ca024edb2faa3244cb',sourceHashes:Object.fromEntries(files.map(f=>[f,hash(readFileSync(new URL(f,import.meta.url)))])),fixtureClassification:'generated_no_mission_data',fixtureSha256:hash(canonical(fixtures)),count,counts,verifiedReceipts:verified,metrics:{elapsedMs,itemsPerSecond:count/(elapsedMs/1000),p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),maxMs:timings.at(-1)},runtime:{node:process.version,platform:platform(),arch:arch(),cpuModel:cpus()[0]?.model||'unavailable'},signing:{algorithm:'Ed25519',keyScope:'ephemeral_test_key_in_memory',publicKeyPem:publicKey.export({format:'pem',type:'spki'}),publicKeySpkiSha256:fingerprint(publicKey),operationalAuthority:false},receiptExamples,acceptance:{localProfileTests:'separate_test_run_required',productionRuntime:'unverified',hardwareInLoop:'not_present',missionEnvironment:'not_evaluated',deployment:'not_performed'},limitations:['Local sequential microbenchmark, not mission latency or throughput.','Input bytes and policies are generated fixtures.','Replay tracking is in-memory for one run; not persistent production enforcement.','No provider calls or command transmission.']},null,2));

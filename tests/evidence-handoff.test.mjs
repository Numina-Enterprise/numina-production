import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {identifyPolicy,createEvidenceHandoff,MAX_POLICY_BYTES} from '../public/evidence-handoff-model.js';
import {mountEvidenceHandoff} from '../public/evidence-handoff-ui.js';
import {NUMINA_OWNER_APPROVAL} from '../public/owner-approval.js';
import {WALLET_EXECUTION_POLICY,walletExecutionAuthorized} from '../public/wallet-execution-policy.js';
const bytes=text=>new TextEncoder().encode(text),tx='0x'+'a'.repeat(64);
test('recorded owner signing statement does not replace signature evidence or enable execution',()=>{
 assert.equal(NUMINA_OWNER_APPROVAL.issuerPolicySigningStatement.ownerReportsSigned,true);
 assert.equal(NUMINA_OWNER_APPROVAL.issuerPolicySigningStatement.signedDocumentSha256,null);
 assert.equal(NUMINA_OWNER_APPROVAL.issuerPolicySigningStatement.signatureVerified,false);
 assert.equal(walletExecutionAuthorized(),false);assert.equal(WALLET_EXECUTION_POLICY.issuerPolicySigned,false);
});
test('document fingerprint records exact bytes without claiming a signature or exporting content',async()=>{
 const raw=bytes('A synthetic policy for testing only.'),expected=createHash('sha256').update(raw).digest('hex');
 const pending=identifyPolicy(raw);raw[0]=0;const policy=await pending;
 assert.equal(policy.sha256,expected);assert.equal(policy.signatureVerified,false);assert.equal(policy.exactPublishedPolicyBytes,false);
 const record=createEvidenceHandoff({policy,ownerReportsSigned:true},()=>0);
 assert.equal(record.policy.ownerReportsSigned,true);assert.equal(record.policy.binding,'DIFFERENT_BYTES_REQUIRE_POLICY_REVIEW');
 assert.equal(record.policy.signatureVerified,false);assert.equal(record.transactionReference,null);assert(!JSON.stringify(record).includes('synthetic policy'));
 for(const key of ['signatureCreated','submissionPerformed','mintPerformed','treasuryWritePerformed','depositPerformed','releaseGateChanged'])assert.equal(record[key],false);
});
test('a reported signature can be recorded while the signed document remains missing',()=>{
 const record=createEvidenceHandoff({ownerReportsSigned:true},()=>0);
 assert.equal(record.policy.binding,'DOCUMENT_NOT_PROVIDED');assert.equal(record.policy.signatureVerified,false);assert.equal(record.policy.document,null);
 assert.throws(()=>createEvidenceHandoff({ownerReportsSigned:'true'}));
});
test('references are separate unverified operations and never become receipts',()=>{
 const mint=createEvidenceHandoff({operation:'nusd_constructor_mint',transactionHash:tx});
 assert.equal(mint.transactionReference.claimedNetwork.chainId,'962421430');assert.equal(mint.transactionReference.receipt,null);
 assert.equal(mint.transactionReference.verified,false);
 const deposit=createEvidenceHandoff({operation:'deposit',providerReference:'txn_ABC123'});
 assert.equal(deposit.transactionReference.claimedNetwork,null);assert.equal(deposit.transactionReference.receipt,null);
 assert.throws(()=>createEvidenceHandoff({operation:'nusd_constructor_mint',providerReference:'txn_1'}));
 assert.throws(()=>createEvidenceHandoff({transactionHash:tx}));assert.throws(()=>createEvidenceHandoff({operation:'deposit'}));
 assert.throws(()=>createEvidenceHandoff({operation:'deposit',transactionHash:'0x123'}));
 assert.throws(()=>createEvidenceHandoff({operation:'deposit',providerReference:'x'.repeat(121)}));
 assert.throws(()=>createEvidenceHandoff({policy:{sha256:'f'.repeat(64),signatureVerified:true}}));
});
test('empty, oversized, binary and wallet-secret files are rejected',async()=>{
 for(const input of [new Uint8Array(),new Uint8Array(MAX_POLICY_BYTES+1),Uint8Array.of(255),bytes('{"privateKey":"test-only"}'),bytes('{"crypto":{}}'),bytes('-----BEGIN PRIVATE KEY-----')])await assert.rejects(identifyPolicy(input));
 const pdf=await identifyPolicy(bytes('%PDF-1.7\nSynthetic test only'));assert.equal(pdf.format,'pdf');assert.equal(pdf.signatureVerified,false);
});
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
function harness(identify=identifyPolicy){
 const nodes=new Map(),events=new Map(),downloads=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='operation'?'none':'',checked:false,files:[],disabled:false,hidden:false,textContent:''});return nodes.get(id);};
 const doc={getElementById:id=>node(id.replace('evidence-',''))},win={addEventListener:(id,fn)=>events.set(id,fn),removeEventListener:id=>events.delete(id)};
 const mounted=mountEvidenceHandoff({doc,win,identify,download:record=>downloads.push(record)});
 return{doc,win,node,events,downloads,mounted,select:file=>{node('policy').files=file?[file]:[];return node('policy').onchange();}};
}
test('explicit creation and download distinguish an owner statement from verified evidence',()=>{
 const h=harness();h.node('signed').checked=true;h.node('signed').onchange();assert.equal(h.node('download').disabled,true);
 h.node('create').onclick();assert.equal(h.node('download').disabled,false);h.node('download').onclick();
 assert.equal(h.downloads[0].policy.ownerReportsSigned,true);assert.equal(h.downloads[0].policy.signatureVerified,false);
 h.node('hash').value=tx;h.node('hash').oninput();assert.equal(h.node('download').disabled,true);assert.equal(h.node('result').textContent,'');h.mounted.dispose();
});
test('cancelled or oversized file selection invalidates earlier record without reading',async()=>{
 const h=harness();h.node('signed').checked=true;h.node('create').onclick();let read=false;
 await h.select({size:MAX_POLICY_BYTES+1,arrayBuffer:async()=>{read=true;}});
 assert.equal(read,false);assert.equal(h.node('download').disabled,true);await h.select(null);assert.equal(h.node('policy-status').textContent,'No policy document selected.');h.mounted.dispose();
});
test('clear suppresses late file fingerprint and page restoration clears previous success',async()=>{
 const wait=deferred(),h=harness(()=>wait.promise);const pending=h.select({size:1,arrayBuffer:async()=>bytes('x').buffer});
 await Promise.resolve();h.node('clear').onclick();wait.resolve({sha256:'f'.repeat(64),bytes:1});await pending;
 assert.equal(h.node('policy-status').textContent,'No policy document selected.');assert.equal(h.node('download').disabled,true);
 h.node('signed').checked=true;h.node('create').onclick();h.events.get('pagehide')();
 const next=mountEvidenceHandoff({doc:h.doc,win:h.win});assert.equal(h.node('status').textContent,'No evidence record created.');assert.equal(h.node('download').disabled,true);assert.equal(h.node('signed').checked,false);next.dispose();
});

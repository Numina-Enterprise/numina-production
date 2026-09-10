// Independently runnable with Node 24+: node conformance.mjs https://www.numinalabs.xyz
import {generateKeyPairSync,sign,verify} from 'node:crypto';
const origin=process.argv[2]||'http://127.0.0.1:8787';
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const get=async p=>{const r=await fetch(origin+p);if(!r.ok)throw Error(p+' HTTP '+r.status);return r.json();};
const fixture=await get('/downloads/demo-test-key.json'),keys=await get('/api/v0.1/keys');
const now=Math.floor(Date.now()/1000),credential={version:'0.1',environment:'test',issuer:'numina-demo',subject:'independent-harness',audience:'numina-demo-gateway',profile:'numina-demo-rp-0.1',action:'simulate.commit',resource:'demo:ledger',eventId:crypto.randomUUID(),nonce:crypto.randomUUID(),issuedAt:now,notBefore:now,expiresAt:now+300};
const protectedHeader={alg:'Ed25519',kid:fixture.kid,purpose:fixture.purpose};
const envelope={credential,signature:{...protectedHeader,value:sign(null,Buffer.from(canonical({credential,protected:protectedHeader})),{key:fixture.privateJwk,format:'jwk'}).toString('base64url')}};
const post=async(p,e)=>{const r=await fetch(origin+'/api/v0.1/'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:canonical(e)});if(r.headers.get('x-numina-version')!=='0.2.0')throw Error('Missing version');return {status:r.status,...await r.json()};};
const results=[];function check(name,ok){results.push({name,pass:!!ok});if(!ok)throw Error('FAIL '+name);}
check('health',(await get('/api/v0.1/health')).status==='up');
check('verify',(await post('verify',envelope)).outcome==='VALID_FOR_COMMIT');
const committed=await post('commit',envelope);check('atomic demo commit',committed.committed&&committed.persisted);
const r=committed.receipt,{value,...header}=r.signature,pk=keys.keys.find(k=>k.kid===header.kid);
check('independent receipt signature',verify(null,Buffer.from(canonical({receipt:r.receipt,protected:header})),{key:pk.jwk,format:'jwk'},Buffer.from(value,'base64url')));
check('external receipt retrieval',JSON.stringify(await get(committed.receiptUrl))===JSON.stringify(r));
check('replay rejected',(await post('commit',envelope)).reason==='REPLAY_DETECTED');
const tampered=structuredClone(envelope);tampered.credential.subject='changed';check('tamper rejected',(await post('verify',tampered)).reason==='SIGNATURE_INVALID');
check('coverage scope',(await get('/api/v0.1/coverage')).externalExecution==='disabled');
check('core source manifest',(await get('/api/core/v1.8/manifest')).coreVersion==='1.8.0');
const corePacket=await get('/downloads/core-v1.8-eac.json');
const coreResponse=await fetch(origin+'/api/core/v1.8/eac/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:canonical(corePacket)});check('Python-signed core EAC',(await coreResponse.json()).outcome==='VALID_FOR_COMMIT');
const margin=await fetch(origin+'/api/core/v1.8/stability/assess',{method:'POST',headers:{'Content-Type':'application/json'},body:canonical({exposure:1000000,eligibleCollateral:400000,settlementCapacity:100000,maintenanceBps:8000,callBufferBps:1000,maxCallAmount:1000000})});const assessment=await margin.json();check('observational v1.8 margin',assessment.deficiency===300000&&assessment.proposedCallAmount===330000&&assessment.authorityChanged===false);
console.log(JSON.stringify({origin,checkedAt:new Date().toISOString(),passed:results.length,results},null,2));

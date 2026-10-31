import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign as cryptoSign} from 'node:crypto';
import {jwkThumbprint,verifyPaymentAuthorization} from '../src/payment-authorization-gates.js';

const makeKeys = () => {
  const p = generateKeyPairSync('ec',{namedCurve:'P-256'});
  return {privateKey:p.privateKey,publicJwk:p.publicKey.export({format:'jwk'})};
};
const signJwt = (payload,key,typ,kid='key1') => {
  const header=Buffer.from(JSON.stringify({alg:'ES256',typ,kid})).toString('base64url');
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const input=header+'.'+body;
  const sig=cryptoSign('sha256',Buffer.from(input,'ascii'),{key:key.privateKey,
    dsaEncoding:'ieee-p1363'}).toString('base64url');
  return input+'.'+sig;
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
function fixture({now=Math.floor(Date.now()/1000), amountMinor='400'}={}) {
  const authority=makeKeys(),issuer=makeKeys(),agent=makeKeys();
  const expected={issuer:'https://issuer.example.test',audience:'urn:numina:settler',
    operator:'operator-synthetic',payer:'payer-synthetic',
    settlementEndpoint:'https://settler.example.test/settle',
    recipient:'0xSYNTHETIC',asset:'USDC',amountMinor,mandateId:'mandate-1',
    policySha256:'a'.repeat(64)};
  const history=signJwt({iss:expected.issuer,aud:'numina-payment-verifier',
    iat:now-10,exp:now+1000,environment:'production',
    keys:[{kid:'key1',publicJwk:issuer.publicJwk,validFrom:now-500,validUntil:now+800}]},
  authority,'numina-key-history+jwt');
  const claim={iss:expected.issuer,aud:expected.audience,operator:expected.operator,
    payer:expected.payer,mandate_id:expected.mandateId,
    policy_sha256:expected.policySha256,iat:now-5,nbf:now-5,exp:now+150,
    jti:'jti-'+amountMinor,nonce:'nonce-'+amountMinor,decision:'ALLOW',
    request:{recipient:expected.recipient,asset:expected.asset,
      amount_minor:amountMinor,settlement_endpoint:expected.settlementEndpoint},
    cnf:{jwk_thumbprint:jwkThumbprint(agent.publicJwk)}};
  const issue=(data=claim)=>signJwt(data,issuer,'numina-payment-verdict+jwt');
  const pop=(jwt, data=claim)=> {
    const challenge=sha256(Buffer.from(jwt,'ascii'))+'\nPOST\n'+
      expected.settlementEndpoint+'\n'+data.nonce;
    return {method:'POST',endpoint:expected.settlementEndpoint,
      nonce:data.nonce,publicJwk:agent.publicJwk,
      signature:cryptoSign('sha256',Buffer.from(challenge),{key:agent.privateKey,
        dsaEncoding:'ieee-p1363'}).toString('base64url')};
  };
  const used=new Set();let total=0n;
  const store={
    durability:'PERSISTENT_ATOMIC', // test double, not production durability evidence
    async commit(d){
      if(used.has(d.nonce))return false;
      if(total+BigInt(d.amountMinor)>1000n)return false;
      used.add(d.nonce);total+=BigInt(d.amountMinor);
      return true;
    },
  };
  const config={...expected,authorityPublicJwk:authority.publicJwk,
    keyHistoryJws:history,nowSeconds:now,consumeAndReserve:store};
  return {authority,issuer,agent,claim,config,issue,pop,store,used};
}
const verify=(f,jwt=f.issue(),override={})=>verifyPaymentAuthorization(jwt,
  {...f.config,proof:f.pop(jwt),...override});

test('valid signed allow is only an authorization to attempt', async () => {
  const f=fixture(),result=await verify(f);
  assert.equal(result.authorization,'AUTHORIZED_TO_ATTEMPT');
  for(const field of ['executionEstablished','finalityEstablished',
    'complianceEstablished','reconciliationEstablished'])assert.equal(result[field],false);
});

test('reject unknown top-level authority claim, even when signed by issuer', async () => {
  const f=fixture(),jwt=f.issue({...f.claim,unrecognized_restriction:'must-see'});
  await assert.rejects(verify(f,jwt),/UNKNOWN_OR_MALFORMED_CLAIM/);
});

test('single-use token without persistent atomic consumption store fails closed', async () => {
  const f=fixture();
  await assert.rejects(verify(f,f.issue(),{consumeAndReserve:null}),
    /DURABLE_REPLAY_AND_LIMIT_STORE_REQUIRED/);
  await assert.rejects(verify(f,f.issue(),{consumeAndReserve:{durability:'MEMORY',commit:async()=>true}}),
    /DURABLE_REPLAY_AND_LIMIT_STORE_REQUIRED/);
  await assert.rejects(verify(f,f.issue(),{consumeAndReserve:{durability:'PERSISTENT_ATOMIC',
    commit:async()=>{throw Error('database unavailable');}}}),/ATOMIC_CONSUMPTION_UNAVAILABLE/);
});

test('field stripping/reordering and reserialization invalidates signature over exact bytes', async () => {
  const f=fixture(),jwt=f.issue(),[header,,signature]=jwt.split('.');
  const modified = {...f.claim};delete modified.payer;
  const stripped=header+'.'+Buffer.from(JSON.stringify(modified)).toString('base64url')+'.'+signature;
  await assert.rejects(verify(f,stripped),/AUTHORIZATION_BINDING_MISMATCH|VERDICT_SIGNATURE_INVALID/);
  const reordered=Object.fromEntries(Object.entries(f.claim).reverse());
  const rearranged=header+'.'+Buffer.from(JSON.stringify(reordered)).toString('base64url')+'.'+signature;
  await assert.rejects(verify(f,rearranged),/VERDICT_SIGNATURE_INVALID/);
});

test('incorrect payer/operator, audience, endpoint, recipient, amount and policy digest all fail', async () => {
  for(const [field,value] of [['payer','wrong payer'],['operator','wrong operator'],
    ['audience','other audience'],['settlementEndpoint','https://elsewhere.test'],
    ['recipient','different'],['amountMinor','900'],['policySha256','b'.repeat(64)]]) {
    const f=fixture();
    await assert.rejects(verify(f,f.issue(),{[field]:value}),/AUTHORIZATION_BINDING_MISMATCH/);
  }
});

test('proof-of-possession binds token, endpoint and nonce', async () => {
  const f=fixture(),jwt=f.issue();
  await assert.rejects(verify(f,jwt,{proof:null}),/PROOF_OF_POSSESSION_REQUIRED/);
  const p=f.pop(jwt);p.signature=p.signature.slice(0,-3)+'abc';
  await assert.rejects(verify(f,jwt,{proof:p}),/PROOF_OF_POSSESSION_INVALID/);
});

test('signed historic key metadata is required, cannot self-select a token key', async () => {
  const f=fixture();
  await assert.rejects(verify(f,f.issue(),{authorityPublicJwk:null}),/PINNED_TRUST_ROOT_REQUIRED/);
  const fake=makeKeys();
  await assert.rejects(verify(f,f.issue(),{authorityPublicJwk:fake.publicJwk}),
    /KEY_HISTORY_SIGNATURE_INVALID/);
});

test('reject replay and enforce cumulative amount in the same atomic consumption operation', async () => {
  const f=fixture();
  await verify(f);
  await assert.rejects(verify(f),/REPLAY_OR_CUMULATIVE_LIMIT_DENIED/);
  const f2=fixture({amountMinor:'700'});f2.config.consumeAndReserve=f.store;
  await assert.rejects(verify(f2),/REPLAY_OR_CUMULATIVE_LIMIT_DENIED/);
});

test('deny and expired verdicts cannot unlock execution', async () => {
  const f=fixture();
  await assert.rejects(verify(f,f.issue({...f.claim,decision:'DENY'})),/VERDICT_NOT_ALLOWED/);
  await assert.rejects(verify(f,f.issue({...f.claim,exp:f.config.nowSeconds-1})),
    /VERDICT_TIME_INVALID/);
});

test('different key environments never pass signed production history policy', async () => {
  const f=fixture(),invalid=signJwt({iss:f.config.issuer,
    aud:'numina-payment-verifier',iat:f.config.nowSeconds-1,
    exp:f.config.nowSeconds+300,environment:'test',
    keys:[]},f.authority,'numina-key-history+jwt');
  await assert.rejects(verify(f,f.issue(),{keyHistoryJws:invalid}),/KEY_HISTORY_INVALID/);
});

test('duplicate JSON members and escaped aliases are always rejected, even with valid issuer signatures',async()=>{
  const f=fixture();
  const header=JSON.stringify({alg:'ES256',typ:'numina-payment-verdict+jwt',kid:'key1'});
  const raw=JSON.stringify(f.claim);
  const duplicates=[
    raw.slice(0,-1)+',"payer":"'+f.claim.payer+'"}',
    raw.slice(0,-1)+',"pay\\u0065r":"'+f.claim.payer+'"}',
    raw.replace('"request":{','"request":{"recipient":"shadow",'),
  ];
  for(const bodyRaw of duplicates) {
    const b64h=Buffer.from(header).toString('base64url');
    const b64p=Buffer.from(bodyRaw).toString('base64url');
    const input=b64h+'.'+b64p;
    const signature=cryptoSign('sha256',Buffer.from(input,'ascii'),
      {key:f.issuer.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
    const jwt=input+'.'+signature;
    await assert.rejects(verify(f,jwt),/DUPLICATE_JWS_JSON_KEY/);
  }
  const duplicateHeader='{"alg":"ES256","typ":"numina-payment-verdict+jwt","kid":"key1","alg":"ES256"}';
  const head=Buffer.from(duplicateHeader).toString('base64url');
  const pay=Buffer.from(JSON.stringify(f.claim)).toString('base64url');
  const signingInput=head+'.'+pay;
  const sig=cryptoSign('sha256',Buffer.from(signingInput,'ascii'),
    {key:f.issuer.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
  await assert.rejects(verify(f,signingInput+'.'+sig),/DUPLICATE_JWS_JSON_KEY/);
});

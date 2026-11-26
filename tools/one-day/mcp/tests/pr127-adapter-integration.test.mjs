import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {verifyPaymentAuthorization,jwkThumbprint} from '../vendor/pr127/src/payment-authorization-gates.js';
import {ReservationStore} from '../reservation-store.mjs';
test('actual PR127 ES256 verdict verifier uses durable adapter and blocks replay after restart',async()=>{
 const key=()=>{const p=generateKeyPairSync('ec',{namedCurve:'P-256'});return {...p,jwk:p.publicKey.export({format:'jwk'})};},authority=key(),issuer=key(),agent=key(),now=Math.floor(Date.now()/1000);
 const jwt=(payload,key,typ)=>{const body=Buffer.from(JSON.stringify({alg:'ES256',typ,kid:'fixture'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url');return body+'.'+sign('sha256',Buffer.from(body),{key:key.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');};
 const context={issuer:'https://issuer.example.test',audience:'urn:numina:settler',operator:'operator-test',payer:'payer-test',mandateId:'mandate-test',asset:'USDC',amountMinor:'400',settlementEndpoint:'https://settler.example.test',recipient:'fixture-recipient',policySha256:'a'.repeat(64),nowSeconds:now,authorityPublicJwk:authority.jwk};
 context.keyHistoryJws=jwt({iss:context.issuer,aud:'numina-payment-verifier',iat:now-1,exp:now+300,environment:'production',keys:[{kid:'fixture',publicJwk:issuer.jwk,validFrom:now-10,validUntil:now+300}]},authority,'numina-key-history+jwt');
 const claims={iss:context.issuer,aud:context.audience,operator:context.operator,payer:context.payer,mandate_id:context.mandateId,policy_sha256:context.policySha256,iat:now-1,nbf:now-1,exp:now+120,jti:'fixture-verdict',nonce:'fixture-nonce',decision:'ALLOW',request:{recipient:context.recipient,asset:context.asset,amount_minor:context.amountMinor,settlement_endpoint:context.settlementEndpoint},cnf:{jwk_thumbprint:jwkThumbprint(agent.jwk)}};
 const token=jwt(claims,issuer,'numina-payment-verdict+jwt'),challenge=createHash('sha256').update(token).digest('hex')+'\nPOST\n'+context.settlementEndpoint+'\n'+claims.nonce;
 context.proof={method:'POST',endpoint:context.settlementEndpoint,nonce:claims.nonce,publicJwk:agent.jwk,signature:sign('sha256',Buffer.from(challenge),{key:agent.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};
 const dir=mkdtempSync(join(tmpdir(),'numina-pr127-')),path=join(dir,'reserve.sqlite');let store;try{
 store=new ReservationStore(path,{...context,limitMinor:'1000'});context.consumeAndReserve=store;assert.equal((await verifyPaymentAuthorization(token,context)).authorization,'AUTHORIZED_TO_ATTEMPT');store.close();store=new ReservationStore(path,{...context,limitMinor:'1000'});context.consumeAndReserve=store;
 await assert.rejects(verifyPaymentAuthorization(token,context),/REPLAY_OR_CUMULATIVE_LIMIT_DENIED/);assert.equal(store.snapshot().usedMinor,'400');
 }finally{store?.close();rmSync(dir,{recursive:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {pae,probeSchemes,PAYLOAD_TYPE,SCHEMES} from '../scripts/release-lib.mjs';
import {writeStatement} from '../scripts/release-statement.mjs';
import {signRelease} from '../scripts/release-sign.mjs';
import {verifyRelease} from '../scripts/release-verify.mjs';
import {pqKeygen} from '../scripts/release-pq-keygen.mjs';

// Throwaway keys live only in this test's temp directory and are deleted afterwards.
function fixture(){
  const root=mkdtempSync(path.join(tmpdir(),'numina-release-'));
  writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'fixture',version:'5.0.0'}));
  for(const [f,c] of [['dist/client/index.html','<h1>hi</h1>'],['dist/client/a/b.css','b{}'],['dist/server/index.js','export default {}'],['src/x.js','1'],['release-evidence/RELEASE-ATTESTATION.md','doc']]){mkdirSync(path.dirname(path.join(root,f)),{recursive:true});writeFileSync(path.join(root,f),c);}
  const git=(...a)=>execFileSync('git',a,{cwd:root,stdio:'pipe'});
  git('init','-q');git('add','-A');git('-c','user.name=t','-c','user.email=t@example.invalid','commit','-qm','fixture');
  const keys=path.join(root,'..',path.basename(root)+'-keys');mkdirSync(keys);
  const ed=generateKeyPairSync('ed25519');writeFileSync(path.join(keys,'ed25519.pem'),ed.privateKey.export({type:'pkcs8',format:'pem'}));
  return {root,keys,ed:path.join(keys,'ed25519.pem'),cleanup(){rmSync(root,{recursive:true,force:true});rmSync(keys,{recursive:true,force:true});}};
}
const quiet=()=>{};

test('DSSE PAE matches the specification example',()=>{
  assert.equal(pae('http://example.com/HelloWorld',Buffer.from('hello world')).toString(),'DSSEv1 29 http://example.com/HelloWorld 11 hello world');
});

test('every supported scheme signs, verifies and detects tampering (throwaway keys)',async()=>{
  const probe=await probeSchemes();
  const supported=probe.filter(s=>s.supported).map(s=>s.scheme);
  for(const s of ['Ed25519','ML-DSA-44','ML-DSA-65','ML-DSA-87','FN-DSA-512','FN-DSA-1024'])assert.ok(supported.includes(s),s+' must be supported on this Node');
  const fx=fixture();
  try{
    const pq=supported.filter(s=>s!=='Ed25519');
    const gen=await pqKeygen({out:path.join(fx.keys,'pq'),pubOut:path.join(fx.root,'release-evidence/pubkeys'),schemes:pq,log:quiet});
    assert.equal(gen.made.length,pq.length);
    const st=writeStatement({root:fx.root,timestamp:'2026-11-09T15:40:00.000Z'});
    assert.equal(st.subjects,3);
    const statement=JSON.parse(readFileSync(st.file,'utf8'));
    assert.equal(statement._type,'https://in-toto.io/Statement/v1');assert.deepEqual(statement.subject.map(s=>s.name),['dist/client/a/b.css','dist/client/index.html','dist/server/index.js']);
    assert.equal(statement.predicate.keyLabel,'SKOTT34-Ed25519');assert.equal(statement.predicate.builder.id,'local');
    const printed=[];
    const signed=await signRelease({root:fx.root,keys:[{file:fx.ed,keyid:'SKOTT34-Ed25519'}],keyDir:path.join(fx.keys,'pq'),writePubkeys:true,log:l=>printed.push(l)});
    assert.equal(signed.keyids.length,supported.length);
    assert.ok(!printed.join('\n').includes('PRIVATE KEY'),'never prints private keys');
    for(const f of readdirSync(path.join(fx.root,'release-evidence/pubkeys')))assert.doesNotMatch(readFileSync(path.join(fx.root,'release-evidence/pubkeys',f),'utf8'),/PRIVATE|secretKey/,f);
    const envelope=JSON.parse(readFileSync(signed.envelope,'utf8'));assert.equal(envelope.payloadType,PAYLOAD_TYPE);assert.doesNotMatch(JSON.stringify(envelope),/PRIVATE|secretKey/);
    // Committing the envelope and public keys must not change the source tree digest.
    execFileSync('git',['add','-A'],{cwd:fx.root});execFileSync('git',['-c','user.name=t','-c','user.email=t@example.invalid','commit','-qm','sign'],{cwd:fx.root});
    const ok=await verifyRelease({root:fx.root});
    assert.equal(ok.ok,true,JSON.stringify(ok.errors));assert.ok(ok.signatures.every(s=>s.status==='pass'));
    const envFile=signed.envelope,original=readFileSync(envFile,'utf8');
    for(const scheme of supported){
      const bad=JSON.parse(original),sig=bad.signatures.find(s=>s.keyid==='SKOTT34-'+scheme),bytes=Buffer.from(sig.sig,'base64');bytes[10]^=1;sig.sig=bytes.toString('base64');
      writeFileSync(envFile,JSON.stringify(bad));const r=await verifyRelease({root:fx.root});
      assert.equal(r.ok,false,scheme);assert.equal(r.signatures.find(s=>s.keyid==='SKOTT34-'+scheme).status,'fail',scheme);
    }
    const noEd=JSON.parse(original);noEd.signatures=noEd.signatures.filter(s=>s.keyid!=='SKOTT34-Ed25519');writeFileSync(envFile,JSON.stringify(noEd));
    assert.match((await verifyRelease({root:fx.root})).errors.join('\n'),/Ed25519/);
    const dropPq=JSON.parse(original);dropPq.signatures=dropPq.signatures.filter(s=>s.keyid!=='SKOTT34-ML-DSA-65');writeFileSync(envFile,JSON.stringify(dropPq));
    assert.match((await verifyRelease({root:fx.root})).errors.join('\n'),/SKOTT34-ML-DSA-65\.pub\.pem has no signature/);
    writeFileSync(envFile,original);
    writeFileSync(path.join(fx.root,'dist/client/index.html'),'<h1>tampered</h1>');
    const tampered=await verifyRelease({root:fx.root});assert.equal(tampered.ok,false);assert.deepEqual(tampered.digests.differ,['dist/client/index.html']);
    writeFileSync(path.join(fx.root,'dist/client/index.html'),'<h1>hi</h1>');writeFileSync(path.join(fx.root,'dist/client/extra.js'),'x');
    assert.deepEqual((await verifyRelease({root:fx.root})).digests.extra,['dist/client/extra.js']);
    rmSync(path.join(fx.root,'dist/client/extra.js'));
    writeFileSync(path.join(fx.root,'src/x.js'),'2');execFileSync('git',['-c','user.name=t','-c','user.email=t@example.invalid','commit','-qam','src change'],{cwd:fx.root});
    assert.match((await verifyRelease({root:fx.root})).errors.join('\n'),/Source tree digest/);
    rmSync(envFile);assert.match((await verifyRelease({root:fx.root})).errors.join('\n'),/envelope missing/);
  }finally{fx.cleanup();}
});

test('signing requires Ed25519 and rejects mismatched key ids',async()=>{
  const fx=fixture();
  try{
    writeStatement({root:fx.root});
    const pq=path.join(fx.keys,'pq');await pqKeygen({out:pq,schemes:['ML-DSA-65'],log:quiet});
    await assert.rejects(signRelease({root:fx.root,keyDir:pq,log:quiet}),/Ed25519 key/);
    await assert.rejects(signRelease({root:fx.root,keys:[{file:fx.ed,keyid:'SKOTT34-ML-DSA-65'}],log:quiet}),/does not match/);
    await assert.rejects(pqKeygen({out:pq,schemes:['ML-DSA-65'],log:quiet}),/overwrite/);
    assert.ok(SCHEMES.filter(s=>s.preStandard).every(s=>s.scheme.startsWith('FN-DSA')));
  }finally{fx.cleanup();}
});

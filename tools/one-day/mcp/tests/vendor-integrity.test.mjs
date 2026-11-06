import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
test('PR127 reproduction uses exact captured Git blobs and SHA256 bytes',()=>{
 const root=new URL('../vendor/pr127/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('provenance.json',root),'utf8'));
 assert.equal(manifest.sourceCommit,'b4181eb325b89f541ba8cf96cc2568c7ac750ea4');assert.equal(manifest.files.length,6);
 for(const f of manifest.files){const b=readFileSync(new URL(f.path,root));assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256,f.path);assert.equal(createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),f.gitBlobSha,f.path);}
});

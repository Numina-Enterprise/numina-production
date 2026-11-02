import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('orphan gitlink breaks checkout cleanup; removing its index reference restores it',()=>{
 const directory=mkdtempSync(join(tmpdir(),'numina-checkout-'));
 function git(...args){return spawnSync('git',args,{cwd:directory,encoding:'utf8'});}
 function ok(...args){const result=git(...args);assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
 try{
  ok('init');ok('config','user.name','Checkout regression');ok('config','user.email','test@example.invalid');
  writeFileSync(join(directory,'keep.txt'),'preserved\n');ok('add','keep.txt');ok('commit','-m','fixture');
  const pointer=ok('rev-parse','HEAD');
  ok('update-index','--add','--cacheinfo',`160000,${pointer},consolidated-evidence/your_files`);
  ok('commit','-m','orphan reference');
  const broken=git('submodule','foreach','--recursive','git status --porcelain');
  assert.notEqual(broken.status,0);assert.match(broken.stderr,/No url found for submodule/);
  ok('update-index','--force-remove','consolidated-evidence/your_files');
  ok('submodule','foreach','--recursive','git status --porcelain');
  // An index repair removes no referenced repository or commit object.
  assert.equal(ok('cat-file','-t',pointer),'commit');
  assert.equal(ok('show',`${pointer}:keep.txt`),'preserved');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

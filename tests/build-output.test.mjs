import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {resetBuildOutput} from '../scripts/build-output.mjs';

function fixture(t){
  const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'numina-build-output-'));
  t.after(()=>{
    assert.equal(dirname(resolve(root)),parent);
    assert.ok(basename(root).startsWith('numina-build-output-'));
    rmSync(root,{recursive:true,force:true});
  });
  return root;
}

test('a rebuild removes retired assets and migrations while retaining source records',t=>{
  const project=fixture(t);
  for(const path of ['dist/client','dist/server','dist/.openai/drizzle','public','drizzle'])mkdirSync(join(project,path),{recursive:true});
  for(const path of ['dist/old-root.html','dist/client/retired.js','dist/server/old-worker.js','dist/.openai/drizzle/retired.sql'])writeFileSync(join(project,path),'obsolete');
  writeFileSync(join(project,'public/current.js'),'current asset');
  writeFileSync(join(project,'drizzle/current.sql'),'current migration');
  const output=resetBuildOutput(project);
  assert.equal(output,join(project,'dist'));
  assert.ok(existsSync(output));
  for(const path of ['old-root.html','client/retired.js','server/old-worker.js','.openai/drizzle/retired.sql'])assert.equal(existsSync(join(output,path)),false,path);
  assert.equal(readFileSync(join(project,'public/current.js'),'utf8'),'current asset');
  assert.equal(readFileSync(join(project,'drizzle/current.sql'),'utf8'),'current migration');
});

test('a first build creates the output directory',t=>{
  assert.ok(existsSync(resetBuildOutput(fixture(t))));
});

test('build cleanup rejects a linked output directory and preserves its target',t=>{
  const root=fixture(t),project=join(root,'project'),target=join(root,'external');
  mkdirSync(project);mkdirSync(target);
  writeFileSync(join(target,'keep.txt'),'retained');
  symlinkSync(target,join(project,'dist'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>resetBuildOutput(project),/real project directory/);
  assert.equal(readFileSync(join(target,'keep.txt'),'utf8'),'retained');
});

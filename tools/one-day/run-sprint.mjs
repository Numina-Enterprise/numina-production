import {readdirSync, mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {resolve, relative, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(process.argv[2]||join(root,'tools/one-day/results'));
const groups=['ksi','mcp','telemetry'];
function discover(directory){
 return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const path=join(directory,entry.name);
  if(entry.isSymbolicLink())return [];
  return entry.isDirectory()?discover(path):entry.name.endsWith('.test.mjs')?[path]:[];
 }).sort();
}
const files=groups.flatMap(group=>discover(join(root,'tools/one-day',group)));
files.push(...readdirSync(join(root,'tools/one-day')).filter(name=>name.endsWith('.test.mjs')).map(name=>join(root,'tools/one-day',name)));
if(!files.length)throw new Error('No sprint tests found');
mkdirSync(output,{recursive:true});
const start=Date.now();
const result=spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{
 cwd:root,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,
 env:{...process.env,TMPDIR:output}
});
const log=(result.stdout||'')+(result.stderr||'');
writeFileSync(join(output,'tests.tap'),log);
const number=label=>Number(log.match(new RegExp('^# '+label+' (\\d+)$','m'))?.[1]||0);
const base='23c38e1e3a15e8f6559486ca024edb2faa3244cb';
const report={schema:'numina.one-day-sprint.validation.v1',recordedAt:new Date().toISOString(),
 sourceBase:base,runtime:process.version,platform:process.platform,
 classification:'local_or_ci_test_execution',durationMs:Date.now()-start,
 exitCode:result.status,signal:result.signal,errorCode:result.error?.code||null,
 tests:number('tests'),passed:number('pass'),failed:number('fail'),skipped:number('skipped'),
 files:files.map(path=>({path:relative(root,path),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),
 logSha256:createHash('sha256').update(log).digest('hex'),
 liveRuntimeVerified:false,providerExecutionVerified:false,hardwareInLoopVerified:false,
 complianceAuthorizationEstablished:false};
writeFileSync(join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(log);
if(result.error)console.error(result.error.code||'TEST_EXECUTION_FAILED');
process.exitCode=result.status===0&&!result.error&&report.failed===0&&report.tests>0?0:1;

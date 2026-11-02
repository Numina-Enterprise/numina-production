import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url);
const tests=['tests/','vendor/pr127/tests/'].flatMap(dir=>readdirSync(new URL(dir,root)).filter(f=>f.endsWith('.test.mjs')).map(f=>fileURLToPath(new URL(dir+f,root))));
const result=spawnSync(process.execPath,['--test','--test-reporter=tap',...tests],{cwd:fileURLToPath(root),encoding:'utf8',maxBuffer:4*1024*1024});
const report={schema:'numina.one-day.mcp-evidence.v1',generatedAt:new Date().toISOString(),node:process.version,
 classification:'LOCAL_FIXTURE_AND_DURABILITY_TESTS',sourceCommit:'23c38e1e3a15e8f6559486ca024edb2faa3244cb',pr127SnapshotCommit:'b4181eb325b89f541ba8cf96cc2568c7ac750ea4',
 tests:{exitCode:result.status,passed:Number(result.stdout.match(/# pass (\d+)/)?.[1]||0),failed:Number(result.stdout.match(/# fail (\d+)/)?.[1]||0),outputSha256:createHash('sha256').update(result.stdout||'').digest('hex')},
 files:['authorization-boundary.mjs','reservation-store.mjs','vendor/pr127/provenance.json'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex')})),
 providerConnected:false,liveActionsEnabled:false,deploymentVerified:false,productionSignerBound:false,
 blockers:['TRUSTED_AUTHORIZATION_SERVER_AND_KEYS_NOT_CONFIGURED','LIVE_PROVIDER_OAUTH_NOT_EXERCISED','SQLITE_SHARED_DISK_ONLY_NOT_DISTRIBUTED','DURABLE_PKCE_CALLBACK_SESSION_INTEGRATION_REQUIRED','PRODUCTION_DEPLOYMENT_AND_SIGNED_RUNTIME_RECEIPT_NOT_VERIFIED']};
const out=process.argv[2];if(out)writeFileSync(out,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(report,null,2)+'\n');if(result.status!==0){process.stderr.write(result.stdout+result.stderr);process.exitCode=1;}

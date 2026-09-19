import {spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';

const result=spawnSync(process.execPath,['scripts/build.mjs'],{encoding:'utf8',env:process.env});
const redact=value=>String(value||'')
  .replace(/(authorization|bearer|token|secret|password|private[_-]?key)\s*[:=]\s*[^\s]+/gi,'$1=[REDACTED]')
  .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk_[A-Za-z0-9_]{20,})\b/g,'[REDACTED_TOKEN]');
const tail=value=>redact(value).split(/\r?\n/).slice(-80).join('\n');
const diagnostic={
  schema:'numina.build-diagnostic.v1',
  sourceCommit:process.env.VERCEL_GIT_COMMIT_SHA||null,
  exitCode:result.status,
  signal:result.signal||null,
  spawnError:result.error?.message||null,
  stdoutTail:tail(result.stdout),
  stderrTail:tail(result.stderr)
};
const body=JSON.stringify(diagnostic,null,2)+'\n';
writeFileSync('public/__build-diagnostic.json',body);
mkdirSync('dist/client',{recursive:true});
if(!existsSync('dist/client/final-build.json'))cpSync('public','dist/client',{recursive:true});
writeFileSync('dist/client/__build-diagnostic.json',body);
console.log(JSON.stringify({diagnostic:'public/__build-diagnostic.json',exitCode:result.status}));

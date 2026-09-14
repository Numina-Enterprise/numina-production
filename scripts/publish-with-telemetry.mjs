import {spawnSync} from 'node:child_process';
import {closeSync,fsyncSync,ftruncateSync,mkdirSync,openSync,readFileSync,realpathSync,writeSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const SITE_PROJECT = 'appgprj_6aa1a5988258819196abc45e9ac02796';
export const PUBLISH_TARGETS = Object.freeze({
  github: 'https://github.com/skott34-dot/numina-production.git',
  builder: 'https://github.com/skott34-dot/numina-builder.git',
  sites: 'https://git.chatgpt-team.site/26e6048d-1773-4301-af72-0b7aeedabce7/'+SITE_PROJECT+'.git'
});
const SHA = /^[a-f0-9]{40}$/;
const TRANSIENT = new Set(['timeout','connection_reset','temporary_http_failure']);
const remedies = {
  access_denied: 'Restore execution or repository access through the owning host controls.',
  authentication: 'Restore the publishing identity and its permission for this existing repository.',
  proxy_denied: 'Restore access to the configured host through the approved network proxy controls.',
  non_fast_forward: 'Fetch and reconcile the remote history before publishing; never force overwrite.',
  dns: 'Repair name resolution for the configured publishing host.',
  tls: 'Repair certificate trust or the configured HTTPS service; retain TLS verification.',
  connection_failed: 'Inspect host networking and service availability. This error alone does not identify the cause.',
  timeout: 'Inspect service availability and reconcile the remote revision before another attempt.',
  connection_reset: 'Inspect service availability and reconcile the remote revision before another attempt.',
  temporary_http_failure: 'Inspect provider availability or throttling before another attempt.',
  spawn_failed: 'Restore the Git executable and command execution access.',
  dirty_source: 'Commit the intended source before publishing.',
  source_identity_mismatch: 'Select the configured Numina repository root and source identity.',
  remote_revision_mismatch: 'Inspect the current remote revision; the requested release is not verified there.',
  output_limit: 'Inspect Git locally; output exceeded the bounded capture limit.',
  unknown: 'Inspect the publishing host locally; this report intentionally excludes raw command output.'
};

function classify(result) {
  if(result.status === 0 && !result.error)return 'none';
  const output = String(result.stderr || '')+'\n'+String(result.stdout || '');
  if(/non-fast-forward|fetch first|stale info/i.test(output))return 'non_fast_forward';
  if(/SSL certificate|certificate verify|server certificate|TLS handshake|schannel.*failed/i.test(output))return 'tls';
  if(['EACCES','EPERM'].includes(result.error?.code) || /AccessDenied|WSAEACCES|forbidden by its access permissions|permission denied|\b10013\b/i.test(output))return 'access_denied';
  if(/CONNECT tunnel failed, response 403/i.test(output))return 'proxy_denied';
  if(/authentication failed|could not read (?:Username|Password)|terminal prompts disabled|repository not found|requested URL returned error: (?:401|403)/i.test(output))return 'authentication';
  if(/could not resolve (?:host|proxy)|name or service not known/i.test(output))return 'dns';
  if(result.error?.code === 'ETIMEDOUT' || /timed out|timeout was reached/i.test(output))return 'timeout';
  if(/requested URL returned error: (?:429|500|502|503|504)|CONNECT tunnel failed, response (?:502|503|504)/i.test(output))return 'temporary_http_failure';
  if(/connection reset|empty reply from server|connection was closed unexpectedly/i.test(output))return 'connection_reset';
  if(/failed to connect|could not connect to server|connection refused|network is unreachable/i.test(output))return 'connection_failed';
  if(result.error?.code === 'ENOBUFS')return 'output_limit';
  if(result.error)return 'spawn_failed';
  return 'unknown';
}

/** Publish a pinned commit with existing host credentials. Never deploys or transfers funds. */
export async function publishGit({cwd=process.cwd(),target,env=process.env,reportDirectory}={}) {
  if(!Object.hasOwn(PUBLISH_TARGETS,target))throw Error('Select github, builder or sites.');
  cwd = realpathSync(resolve(cwd));
  const id = randomUUID();
  const directory = resolve(reportDirectory || resolve(cwd,'.openai/publishing'));
  mkdirSync(directory,{recursive:true,mode:0o700});
  const reportPath = resolve(directory,target+'-'+id+'.json');
  const fd = openSync(reportPath,'wx',0o600);
  const started = performance.now();
  const report = {
    schema:'numina.publishing-telemetry.v1',observation:'local_command_results',id,
    target,host:new URL(PUBLISH_TARGETS[target]).hostname,branch:'refs/heads/main',
    startedAt:new Date().toISOString(),finishedAt:null,status:'in_progress',
    sourceCommit:null,remoteCommit:null,sourcePushVerified:false,deploymentStarted:false,
    signedAttestation:false,treasuryWrites:false,externalTransactions:false,
    retryPolicy:{maxPushAttempts:2,retryDelayMs:2000,reconcileBeforeRetry:true},
    steps:[]
  };
  const persist = () => {
    const bytes = Buffer.from(JSON.stringify(report,null,2)+'\n');
    ftruncateSync(fd,0);
    let offset = 0;
    while(offset < bytes.length)offset += writeSync(fd,bytes,offset,bytes.length-offset,offset);
    fsyncSync(fd);
  };
  const command = (stage,args,attempt=0) => {
    const time = performance.now();
    const result = spawnSync('git',['-c','safe.directory='+cwd.replaceAll('\\','/'),...args],{
      cwd,env:{...env,GIT_TERMINAL_PROMPT:'0',GH_PROMPT_DISABLED:'1'},encoding:'utf8',
      windowsHide:true,timeout:30000,maxBuffer:256*1024
    });
    const failure = classify(result);
    report.steps.push({stage,attempt,observedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-time),
      exitCode:Number.isInteger(result.status)?result.status:null,signal:result.signal || null,
      timedOut:result.error?.code === 'ETIMEDOUT',failure});
    persist();
    return {ok:failure === 'none',failure,output:String(result.stdout || '').trim()};
  };
  const finish = (status,failure='none') => {
    report.status = status;
    report.failure = failure;
    report.nextAction = failure === 'none'
      ? 'Save and deploy the matching artifact through the existing hosting provider; source publication alone is not deployment.'
      : remedies[failure] || remedies.unknown;
    report.finishedAt = new Date().toISOString();
    report.metrics = {
      gitCommands:report.steps.length,gitFailures:report.steps.filter(step=>step.failure !== 'none').length,
      pushAttempts:report.steps.filter(step=>step.stage === 'push').length,
      totalDurationMs:Math.round(performance.now()-started)
    };
    report.metrics.retries = Math.max(0,report.metrics.pushAttempts-1);
    persist();
    return {reportPath,report,exitCode:report.sourcePushVerified?0:1};
  };
  const readRemote = attempt => {
    const result = command('read_remote',['ls-remote','--exit-code',PUBLISH_TARGETS[target],'refs/heads/main'],attempt);
    const match = result.ok?result.output.match(/^([a-f0-9]{40})\s+refs\/heads\/main$/):null;
    report.remoteCommit = match?.[1] || null;
    return {...result,exact:report.remoteCommit === report.sourceCommit,valid:!!match};
  };
  try {
    persist();
    const root = command('repository_root',['rev-parse','--show-toplevel']);
    if(!root.ok)return finish('blocked_before_push',root.failure);
    if(realpathSync(root.output) !== cwd)return finish('blocked_before_push','source_identity_mismatch');
    if(target === 'sites') {
      let manifest;
      try {manifest = JSON.parse(readFileSync(resolve(cwd,'.openai/hosting.json'),'utf8'));}catch{return finish('blocked_before_push','source_identity_mismatch');}
      if(manifest.project_id !== SITE_PROJECT)return finish('blocked_before_push','source_identity_mismatch');
    } else {
      const origin = command('origin_identity',['remote','get-url','origin']);
      if(!origin.ok)return finish('blocked_before_push',origin.failure);
      if(origin.output !== PUBLISH_TARGETS[target])return finish('blocked_before_push','source_identity_mismatch');
    }
    const head = command('source_revision',['rev-parse','--verify','HEAD']);
    if(!head.ok)return finish('blocked_before_push',head.failure);
    if(!SHA.test(head.output))return finish('blocked_before_push','source_identity_mismatch');
    report.sourceCommit = head.output;
    const state = command('source_status',['status','--porcelain','--untracked-files=normal']);
    if(!state.ok)return finish('blocked_before_push',state.failure);
    if(state.output)return finish('blocked_before_push','dirty_source');
    for(let attempt=1;attempt<=2;attempt++) {
      const push = command('push',['push','--porcelain',PUBLISH_TARGETS[target],report.sourceCommit+':refs/heads/main'],attempt);
      if(push.ok || TRANSIENT.has(push.failure)) {
        const remote = readRemote(attempt);
        if(remote.exact) {
          report.sourcePushVerified = true;
          return finish(push.ok?'source_push_verified':'source_reconciled_after_ambiguous_push');
        }
        if(push.ok)return finish(remote.valid?'remote_revision_mismatch':'push_accepted_verification_unavailable',remote.ok?'remote_revision_mismatch':remote.failure);
        // A failed or missing remote read cannot establish whether the write was accepted.
        if(!remote.valid)return finish('push_outcome_unconfirmed',remote.ok?'remote_revision_mismatch':remote.failure);
      }
      if(!TRANSIENT.has(push.failure) || attempt === 2)return finish('push_failed',push.failure);
      await delay(2000);
    }
  } catch {
    return finish('local_publishing_error','unknown');
  } finally {
    closeSync(fd);
  }
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length !== 3)throw Error('Usage: node scripts/publish-with-telemetry.mjs github|builder|sites');
    const result = await publishGit({target:process.argv[2]});
    console.log(JSON.stringify(result));
    process.exitCode = result.exitCode;
  } catch {
    console.error('Publishing setup failed. Select a configured target and a writable private report directory.');
    process.exitCode = 1;
  }
}

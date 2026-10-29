import {appendFileSync,readFileSync} from 'node:fs';

const steps=JSON.parse(process.env.EVIDENCE_STEPS||'{}');
const lines=['## Provider evidence persistence','',`Source: \`${process.env.GITHUB_SHA}\``,
  `Run: ${process.env.GITHUB_RUN_ID}, attempt: ${process.env.GITHUB_RUN_ATTEMPT}`,'',
  '| Path | Outcome | Provider receipt |','| --- | --- | --- |'];
for(const [id,label] of [['archive','Actions observation'],['record_archive','Actions canonical record'],['trusted_archive','Actions trusted release']]){
  const step=steps[id],outputs=step?.outputs||{};
  const available=step?.outcome==='success'&&/^[1-9]\d*$/.test(outputs['artifact-id']||'')&&/^(sha256:)?[0-9a-f]{64}$/i.test(outputs['artifact-digest']||'');
  lines.push(`| ${label} | ${available?'confirmed':step?.outcome||'not run'} | ${available?`ID ${outputs['artifact-id']}; digest ${outputs['artifact-digest']}`:'No confirmed Actions archive receipt'} |`);
  if(step&&step.outcome!=='skipped'&&!available)console.log(`::warning::${label} has no confirmed archive receipt. See the separate durable Release result.`);
}
for(const [id,label,path] of [['publication','Release observation and canonical record',process.env.NUMINA_PUBLICATION_RECEIPT_PATH],['trusted_publication','Release trusted source',process.env.NUMINA_TRUSTED_PUBLICATION_RECEIPT_PATH]]){
  let receipt;
  try{receipt=JSON.parse(readFileSync(path,'utf8'));}catch{}
  const available=steps[id]?.outcome==='success'&&receipt?.sha256ReadBackVerified===true&&receipt?.sourceCommit===process.env.GITHUB_SHA&&receipt?.releaseId&&receipt?.assets?.length>0&&receipt.assets.every(asset=>asset.assetId&&asset.readBackVerified===true);
  lines.push(`| ${label} | ${available?'confirmed with byte readback':steps[id]?.outcome||'not run'} | ${available?`Release ${receipt.releaseId}; assets ${receipt.assets.map(asset=>`${asset.assetId} (sha256:${asset.sha256})`).join(', ')}`:'No confirmed Release publication receipt'} |`);
}
lines.push('',`Canonical record construction: ${steps.record?.outcome||'not run'}. Source verification: ${steps.source?.outcome||'not run'}.`,
  'Scheduled runs publish observations only; trusted source publication requires the build and test gate.');
const summary=lines.join('\n')+'\n';
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);

const encoder=new TextEncoder();
export const PINNED_RELEASE_PUBLIC_KEY='bwsq5wdHhNy/qb3d+jxZEUO5OIIxtxmy62leNG9SN9I=';
export function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
function bytes(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
export async function verifyReleaseAttestation(envelope,pinnedKey=PINNED_RELEASE_PUBLIC_KEY){
  if(!envelope||envelope.algorithm!=='Ed25519'||envelope.artifact_type!=='NUMINA_RELEASE_ATTESTATION'||envelope.public_key!==pinnedKey)return false;
  try{
    const raw=bytes(pinnedKey);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');
    if(envelope.key_id!==digest.slice(0,24))return false;
    const key=await crypto.subtle.importKey('raw',raw,{name:'Ed25519'},false,['verify']);
    const body={artifact_type:envelope.artifact_type,key_id:envelope.key_id,payload:envelope.payload};
    return await crypto.subtle.verify('Ed25519',key,bytes(envelope.signature),encoder.encode(canonical(body)));
  }catch{return false;}
}
export function releaseChecks({manifest,status,supply,preflight,ready,attestation,key},signature){
  const signed=attestation?.payload;
  if(!signature||!manifest||!status||!signed||!key)return false;
  const fields=['product','core_version','production_version','release','frozen_core_manifest_root','frozen_core_valid','frozen_core_checked_files','core_conformance_valid','core_conformance_passing_tests','production_files_root','build_id','core_conformance_artifact_sha256','release_gate_artifact_sha256','spdx_sbom_sha256','slsa_provenance_sha256','slsa_predicate_type','slsa_level_claimed','public_execution_api','real_funds_enabled','employer_ip_enabled'];
  const identity=manifest.production_version==='1.9.0-rc20'&&fields.every(field=>Object.hasOwn(manifest,field)&&canonical(manifest[field])===canonical(signed[field])&&canonical(manifest[field])===canonical(status[field]));
  const keyMatches=key.algorithm==='Ed25519'&&key.public_key===PINNED_RELEASE_PUBLIC_KEY&&key.public_key===attestation.public_key&&key.key_id===attestation.key_id;
  const core=signed.frozen_core?.valid===true&&signed.conformance?.valid===true&&canonical(signed.frozen_core)===canonical(status.frozen_core)&&canonical(signed.conformance)===canonical(status.conformance);
  const supplyMatches=supply?.valid===true&&['spdx_sbom_sha256','slsa_provenance_sha256','slsa_predicate_type','slsa_level_claimed'].every(field=>canonical(supply[field])===canonical(signed[field]));
  const preflightMatches=preflight?.valid===true&&preflight.environment==='production'&&['production_version','environment','role'].every(field=>preflight[field]===signed[field]&&preflight[field]===status[field]);
  return Boolean(identity&&keyMatches&&core&&supplyMatches&&preflightMatches&&ready?.status==='ready');
}

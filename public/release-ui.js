import {verifyReleaseAttestation,releaseChecks} from './release-model.js';

const all=selector=>[...document.querySelectorAll(selector)];

const set=(selector,value)=>all(selector).forEach(element=>{element.textContent=String(value??'Unavailable');});

let snapshot=null;

let running=false;

const liveFields=['[data-release-version]','[data-core-version]','[data-frozen-files]','[data-conformance]','[data-readiness]','[data-signature-status]','[data-supply-status]','[data-build-id]','[data-production-root]','[data-core-root]','[data-key-id]','[data-sbom-hash]','[data-provenance-hash]'];

async function read(path,signal){

  const response=await fetch(path,{cache:'no-store',signal,headers:{Accept:'application/json'}});

  if(!response.ok)throw new Error('A release endpoint is unavailable.');

  return response.json();

}

async function refresh(){

  if(running)return;

  running=true;snapshot=null;

  liveFields.forEach(selector=>set(selector,'Checking…'));set('[data-download-message]','');set('[data-manifest-json]','Waiting for a current response.');set('[data-status-json]','Waiting for a current response.');set('[data-checked-at]','Check in progress');

  all('[data-refresh-release],[data-download]').forEach(button=>button.disabled=true);

  set('[data-live-status]','Checking…');set('[data-release-message]','Loading current release evidence.');

  all('[data-live-status]').forEach(element=>element.dataset.state='checking');

  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);

  try{

    const names=['manifest','status','supply','preflight','ready','attestation','key'];

    const paths=['/v1/release/manifest','/v1/status','/v1/release/supply-chain','/v1/preflight','/readyz','/v1/release/attestation','/v1/keys/release-verification'];

    const data=Object.fromEntries((await Promise.all(paths.map(path=>read(path,controller.signal)))).map((value,index)=>[names[index],value]));

    const signature=await verifyReleaseAttestation(data.attestation);

    const ok=releaseChecks(data,signature);

    snapshot=data;

    const {manifest,status,supply,preflight,ready,key}=data;

    set('[data-release-version]','v'+manifest.production_version);set('[data-core-version]','v'+manifest.core_version);

    set('[data-frozen-files]',status.frozen_core?.checked_files);set('[data-conformance]',status.conformance?.passing_tests);

    set('[data-readiness]',ready.status==='ready'&&preflight.valid?'Ready':'Needs attention');

    set('[data-signature-status]',signature?'Verified':'Not verified');set('[data-supply-status]',supply.valid?'Passed':'Not verified');

    set('[data-build-id]',manifest.build_id);set('[data-production-root]',manifest.production_files_root);set('[data-core-root]',manifest.frozen_core_manifest_root);set('[data-key-id]',key.key_id);set('[data-sbom-hash]',manifest.spdx_sbom_sha256);set('[data-provenance-hash]',manifest.slsa_provenance_sha256);

    set('[data-live-status]',ok?'Verified':'Needs attention');set('[data-release-message]',ok?'Readiness, payload evidence, and the signed release identity pass their checks.':'One or more release checks did not pass. Inspect the evidence before relying on it.');

    all('[data-live-status]').forEach(element=>element.dataset.state=ok?'verified':'error');

    set('[data-checked-at]','Checked '+new Date().toLocaleString());

    set('[data-manifest-json]',JSON.stringify(manifest,null,2));set('[data-status-json]',JSON.stringify(status,null,2));

    all('[data-download]').forEach(button=>button.disabled=false);

  }catch{

    set('[data-live-status]','Unavailable');set('[data-release-message]','The live evidence could not be checked. Try again in a moment; no verified result is being shown.');

    all('[data-live-status]').forEach(element=>element.dataset.state='error');

    liveFields.forEach(selector=>set(selector,'Unavailable'));

    set('[data-checked-at]','Last attempt '+new Date().toLocaleString());set('[data-manifest-json]','No current response available.');set('[data-status-json]','No current response available.');

  }finally{clearTimeout(timer);running=false;all('[data-refresh-release]').forEach(button=>button.disabled=false);}

}

all('[data-refresh-release]').forEach(button=>button.addEventListener('click',refresh));

all('[data-download]').forEach(button=>button.addEventListener('click',()=>{

  const kind=button.dataset.download;if(!snapshot?.[kind])return;

  const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot[kind],null,2)+'\n'],{type:'application/json'}));

  const link=document.createElement('a');link.href=url;link.download='numina-rc20-'+kind+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);

  set('[data-download-message]','Prepared the '+kind+' download from the most recent check.');

}));

refresh();


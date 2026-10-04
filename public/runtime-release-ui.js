import {PINNED_RUNTIME_PUBLIC_KEY, assessRuntimeEvidence} from './runtime-release-model.js';
import {MANIFEST_ROUTES,canonicalManifest,alignedApplication,controlHealth} from './manifest-surface.js';

export const RUNTIME_ENDPOINTS = Object.freeze({
  manifest: '/v1/release/manifest',
  status: '/v1/status',
  control: '/v1/control/state',
  attestation: '/v1/release/attestation',
  supply: '/v1/release/supply-chain',
  providers: '/v1/execution/providers'
});

const fieldSelectors = [
  '[data-release-version]', '[data-core-version]', '[data-frozen-files]', '[data-conformance]',
  '[data-readiness]', '[data-signature-status]', '[data-supply-status]', '[data-build-id]',
  '[data-production-root]', '[data-core-root]', '[data-key-id]', '[data-sbom-hash]', '[data-provenance-hash]'
];
const jsonSelectors = {
  manifest: '[data-manifest-json]', status: '[data-status-json]', control: '[data-control-state-json]',
  supply: '[data-supply-json]', providers: '[data-providers-json]'
};
const text = value => typeof value === 'string' && value.length <= 256 ? value : 'Not reported';
const recordObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function readJson(fetcher, path, parentSignal, timeoutMs, acceptedStatuses = []) {
  const controller = new AbortController();
  let timer, onAbort;
  try {
    return await Promise.race([
      new Promise((_, reject) => {
        onAbort = () => { controller.abort(); reject(new Error('Request cancelled.')); };
        if (parentSignal.aborted) { onAbort(); return; }
        parentSignal.addEventListener('abort', onAbort, {once: true});
        timer = setTimeout(() => { controller.abort(); reject(new Error('Request timed out.')); }, timeoutMs);
      }),
      (async () => {
        const response = await fetcher(path, {
          method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
          signal: controller.signal, headers: {Accept: 'application/json'}
        });
        if (response.redirected) throw new Error('The endpoint redirected; its evidence was not accepted.');
        if (!response.ok && !acceptedStatuses.includes(response.status)) throw new Error('Endpoint unavailable (HTTP ' + response.status + ').');
        let data;
        try { data = await response.json(); } // The deadline includes reading and parsing the body.
        catch { throw new Error('The endpoint returned an unreadable JSON response.'); }
        if (!recordObject(data)) throw new Error('The endpoint returned an unrecognized JSON response.');
        return data;
      })()
    ]);
  } catch (error) {
    if (error instanceof TypeError) throw new Error('The endpoint could not be reached.');
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener('abort', onAbort);
  }
}

export function createRuntimeReleaseUI({
  document, window, fetch: fetcher, timeoutMs = 12000,
  pinnedKey = PINNED_RUNTIME_PUBLIC_KEY, now = () => new Date()
}) {
  const all = selector => [...document.querySelectorAll(selector)];
  const set = (selector, value) => all(selector).forEach(element => { element.textContent = String(value); });
  const downloads = () => all('[data-download]');
  const refreshButtons = () => all('[data-refresh-release]');
  let generation = 0, renderRevision = 0, controller = null, records = {}, downloadBundle = null, destroyed = false;
  const listeners = [];

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }

  function resetDisplay(label, message) {
    downloadBundle = null;
    for (const selector of fieldSelectors) set(selector, label);
    for (const selector of Object.values(jsonSelectors)) set(selector, 'No current response available.');
    set('[data-live-status]', label);
    set('[data-release-message]', message);
    set('[data-runtime-release-summary]', label);
    set('[data-runtime-release-detail]', message);
    set('[data-checked-at]', 'Not checked');
    set('[data-download-message]', '');
    downloads().forEach(button => { button.disabled = true; });
    all('[data-live-status]').forEach(element => { element.dataset.state = 'checking'; });
  }

  function clear() {
    generation++;
    renderRevision++;
    controller?.abort();
    controller = null;
    records = {};
    resetDisplay('Unavailable', 'Refresh to load current runtime evidence.');
    refreshButtons().forEach(button => { button.disabled = false; });
  }

  async function render(currentGeneration) {
    const revision = ++renderRevision;
    const current = {...records};
    const assessed = await assessRuntimeEvidence(current, {pinnedKey});
    if (destroyed || currentGeneration !== generation || revision !== renderRevision) return;
    const ok = name => current[name]?.phase === 'ok';
    const pending = Object.values(current).some(record => record.phase === 'pending');
    const failed = Object.values(current).some(record => record.phase === 'error');
    const manifestPending = current.manifest?.phase === 'pending';
    const manifest = assessed.release;
    const hasManifest = ok('manifest');
    for (const [name, selector] of Object.entries(jsonSelectors)) {
      set(selector, ok(name) ? JSON.stringify(current[name].data, null, 2) :
        current[name]?.phase === 'pending' ? 'Waiting for a current response.' :
        current[name]?.error || 'No current response available.');
    }
    set('[data-release-version]', hasManifest ? 'v' + text(manifest?.production_version) : manifestPending ? 'Checking…' : 'Unavailable');
    set('[data-core-version]', hasManifest ? 'v' + text(manifest?.core_version) : 'Unavailable');
    set('[data-build-id]', hasManifest ? text(manifest?.build_id) : 'Unavailable');
    set('[data-production-root]', hasManifest ? text(manifest?.production_files_root) : 'Unavailable');
    set('[data-core-root]', hasManifest ? text(manifest?.frozen_core_manifest_root) : 'Unavailable');
    const status = ok('status') ? assessed.status : null;
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 'Not reported';
    set('[data-frozen-files]', status ? count(status.frozen_core?.checked_files) : 'Unavailable');
    set('[data-conformance]', status ? count(status.conformance?.passing_tests) : 'Unavailable');
    set('[data-sbom-hash]', ok('supply') ? text(assessed.supply?.spdx_sbom_sha256) : 'Unavailable');
    set('[data-provenance-hash]', ok('supply') ? text(assessed.supply?.slsa_provenance_sha256) : 'Unavailable');
    set('[data-supply-status]', ok('supply') ? assessed.supplyIdentityMatches ?
      assessed.releaseDeclarationVerified ? 'Artifact hashes match the signed manifest' : 'Artifact hashes match the pins; release signature unavailable' : 'Reported artifact identity does not match rc26' :
      current.supply?.phase === 'pending' ? 'Checking…' : 'Unavailable');
    set('[data-readiness]', status ? assessed.runtimeStatusMatches ?
      'Runtime responding · rc26 identity matches' : 'Runtime response identity does not match rc26' :
      current.status?.phase === 'pending' ? 'Checking…' : 'Unavailable');
    set('[data-signature-status]', assessed.releaseDeclarationVerified ? 'Signed runtime declaration verified' :
      current.attestation?.phase === 'pending' ? 'Checking…' : 'Not verified');
    set('[data-key-id]', assessed.key ? assessed.key.key_id : 'Not verified');

    let label = 'Runtime manifest unavailable', message = 'The runtime manifest at ' + RUNTIME_ENDPOINTS.manifest + ' could not be loaded.';
    if (current.manifest?.phase === 'error') message += ' ' + current.manifest.error;
    if (hasManifest && !assessed.manifestMatches) {
      label = 'Needs attention';
      message = 'The observed manifest does not match the pinned rc26 release identity.';
    } else if (hasManifest) {
      label = assessed.releaseDeclarationVerified ? 'Signed declaration verified' : 'Observed release';
      message = assessed.releaseDeclarationVerified ?
        'The rc26 release signature verifies against the established production key and binds the displayed source and artifact hashes.' :
        'The response declares the expected rc26 identity. Its signed runtime declaration has not been verified.';
      if (failed) message += ' One or more runtime evidence endpoints are unavailable.';
      else if (pending) message += ' Other evidence checks are still running.';
      if ((ok('status') && !assessed.runtimeStatusMatches) || (ok('supply') && !assessed.supplyIdentityMatches)) {
        label = 'Needs attention';
        message += ' A runtime or supply-chain response does not match the expected rc26 identity.';
      }
    } else if (manifestPending) {
      label = 'Checking…';
      message = 'Loading the runtime manifest from ' + RUNTIME_ENDPOINTS.manifest + '.';
    }
    set('[data-live-status]', label);
    set('[data-release-message]', message);
    all('[data-live-status]').forEach(element => {
      element.dataset.state = manifestPending ? 'checking' : label === 'Needs attention' ? 'error' : assessed.releaseDeclarationVerified ? 'verified' : hasManifest && assessed.manifestMatches ? 'observed' : 'error';
    });
    set('[data-runtime-release-summary]', hasManifest ? 'Runtime ' + text(manifest?.production_version) + ' · ' + label.toLowerCase() : label);
    const binding = assessed.controlManifestBound ? 'The legacy control route receipt matches the NUMINA manifest.' :
      current.control?.phase === 'pending' ? 'NUMINA control-manifest binding check is running.' :
      current.control?.phase === 'error' ? 'NUMINA control-manifest binding could not be checked. ' + current.control.error :
      'NUMINA control-manifest binding is not verified.';
    set('[data-runtime-release-detail]', message + ' ' + binding + ' Application release fingerprints and network connection checks are reported separately.');
    set('[data-checked-at]', 'Response check ' + now().toLocaleString());
    // Raw observed artifacts remain downloadable; a key is offered only after verification against the configured pin.
    downloadBundle = {
      manifest: hasManifest ? current.manifest.data : null,
      attestation: ok('attestation') ? current.attestation.data : null,
      key: assessed.key,
      version: hasManifest && assessed.manifestMatches ? manifest?.production_version : 'observed-runtime'
    };
    downloads().forEach(button => { button.disabled = !downloadBundle[button.dataset.download]; });
  }

  async function refresh() {
    if (destroyed) return;
    controller?.abort();
    const currentGeneration = ++generation;
    renderRevision++;
    controller = new AbortController();
    const activeController = controller;
    records = Object.fromEntries(Object.keys(RUNTIME_ENDPOINTS).map(name => [name, {phase: 'pending'}]));
    resetDisplay('Checking…', 'Loading runtime evidence; application release and network checks are separate.');
    refreshButtons().forEach(button => { button.disabled = true; });
    await Promise.all(Object.entries(RUNTIME_ENDPOINTS).map(async ([name, path]) => {
      let record;
      try { record = {phase: 'ok', data: await readJson(fetcher, path, activeController.signal, timeoutMs)}; }
      catch (error) { record = {phase: 'error', error: error.message}; }
      if (destroyed || currentGeneration !== generation) return;
      records[name] = record;
      await render(currentGeneration);
    }));
    if (!destroyed && currentGeneration === generation) {
      await render(currentGeneration);
      refreshButtons().forEach(button => { button.disabled = false; });
    }
  }

  function download(event) {
    const kind = event.currentTarget.dataset.download;
    if (!['manifest', 'attestation', 'key'].includes(kind) || !downloadBundle?.[kind]) return;
    const blob = new Blob([JSON.stringify(downloadBundle[kind], null, 2) + '\n'], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'numina-' + downloadBundle.version.replace(/[^a-zA-Z0-9.-]/g, '-') + '-' + kind + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    set('[data-download-message]', 'Prepared the current ' + kind + ' response. Downloading it does not establish independent verification.');
  }

  refreshButtons().forEach(button => listen(button, 'click', refresh));
  downloads().forEach(button => listen(button, 'click', download));
  listen(window, 'pagehide', clear);
  listen(window, 'pageshow', event => { if (event.persisted) void refresh(); });
  return {refresh, clear, destroy() { clear(); destroyed = true; listeners.forEach(remove => remove()); }};
}

// The strict signed RC26 reader above remains available for historical callers.
// Current pages read the canonical manifest; a reported identity is not a signature.
export function createManifestReleaseUI({document,window,fetch:fetcher,timeoutMs=12000,now=()=>new Date()}){
  const all=selector=>[...document.querySelectorAll(selector)];
  const set=(selector,value)=>all(selector).forEach(element=>{element.textContent=String(value);});
  const buttons=()=>all('[data-refresh-release]');
  let generation=0,controller=null,manifest=null,destroyed=false;
  const listeners=[];
  const listen=(target,type,handler)=>{target.addEventListener(type,handler);listeners.push(()=>target.removeEventListener(type,handler));};
  function reset(label){
    manifest=null;
    for(const selector of fieldSelectors)set(selector,label);
    for(const selector of Object.values(jsonSelectors))set(selector,'No current response available.');
    set('[data-live-status]',label);set('[data-runtime-release-summary]',label);
    set('[data-release-message]','Reading the canonical Numina manifest and application inventory.');
    set('[data-runtime-release-detail]','Control readiness and historical signed records have separate evidence.');
    set('[data-checked-at]','Not checked');set('[data-download-message]','');
    all('[data-download]').forEach(button=>{button.disabled=true;});
    all('[data-live-status]').forEach(element=>{element.dataset.state=label==='Checking…'?'checking':'error';});
  }
  async function refresh(){
    if(destroyed)return;
    controller?.abort();controller=new AbortController();const signal=controller.signal,current=++generation;
    reset('Checking…');buttons().forEach(button=>{button.disabled=true;});
    const names=['manifest','release','health','capabilities'];
    const results=await Promise.allSettled(names.map(name=>readJson(fetcher,MANIFEST_ROUTES[name],signal,timeoutMs,name==='health'?[503]:[])));
    if(destroyed||current!==generation)return;
    for(const selector of fieldSelectors)set(selector,'Unavailable');
    const records=Object.fromEntries(names.map((name,index)=>[name,results[index]]));
    const read=name=>{const record=records[name];if(record.status!=='fulfilled')throw record.reason;return record.value;};
    for(const [name,selector]of Object.entries({manifest:'[data-manifest-json]',release:'[data-supply-json]',health:'[data-status-json]',capabilities:'[data-providers-json]'})){
      const record=records[name];set(selector,record.status==='fulfilled'?JSON.stringify(record.value,null,2):record.reason.message);
    }
    let label='Manifest unavailable',detail,aligned=false;
    try{
      manifest=canonicalManifest(read('manifest'));
      set('[data-release-version]','v'+manifest.mechanics.runtime.version);
      set('[data-core-version]','v'+manifest.version);
      set('[data-build-id]',manifest.mechanics.artifact.build_id);
      alignedApplication(manifest,read('release'));
      const capabilities=read('capabilities');
      if(capabilities.schema!=='numina.frontier.v2'||capabilities.identity!=='NUMINA'||capabilities.version!==manifest.applicationVersion)throw Error('Capability manifest does not match the canonical application version.');
      aligned=true;
      label='Manifest aligned';detail='NUMINA · application '+manifest.applicationVersion+' · control interface '+manifest.version+' · runtime dependency '+manifest.mechanics.runtime.version+'. The application inventory matches the canonical build identity.';
    }catch(error){label=manifest?'Needs attention':'Manifest unavailable';detail=error.message;}
    let readiness='Unavailable';
    try{const health=controlHealth(read('health'));if(manifest&&health.version!==manifest.version)throw Error('Control interface version mismatch.');readiness=health.status==='ready'?'Control ready':'Control degraded';}
    catch(error){readiness='Control health unavailable';detail+=' '+error.message;}
    set('[data-readiness]',readiness);
    set('[data-frozen-files]','Not checked');set('[data-conformance]','Not checked');
    for(const selector of ['[data-production-root]','[data-core-root]','[data-key-id]','[data-sbom-hash]','[data-provenance-hash]'])set(selector,'Historical RC26 record; not checked here');
    set('[data-signature-status]','No current signature check');
    set('[data-supply-status]',aligned?'Application identity matches manifest':'Application identity not aligned');
    set('[data-control-state-json]','Current journal readiness is reported by the control health response. No signed control-state receipt was requested.');
    set('[data-live-status]',label);set('[data-release-message]',detail);
    set('[data-runtime-release-summary]',label+(manifest?' · Numina '+manifest.applicationVersion:''));
    set('[data-runtime-release-detail]',detail+' '+readiness+'. RC26 signed history is preserved; this read does not verify a current runtime signature.');
    set('[data-checked-at]','Response check '+now().toLocaleString());
    all('[data-live-status]').forEach(element=>{element.dataset.state=aligned?'observed':'error';});
    all('[data-download]').forEach(button=>{button.disabled=button.dataset.download!=='manifest'||!manifest;});
    buttons().forEach(button=>{button.disabled=false;});
  }
  function clear(){generation++;controller?.abort();controller=null;reset('Unavailable');buttons().forEach(button=>{button.disabled=false;});}
  function download(event){
    if(event.currentTarget.dataset.download!=='manifest'||!manifest)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(manifest,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='numina-canonical-manifest.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    set('[data-download-message]','Downloaded the observed canonical manifest. This is an unsigned response.');
  }
  buttons().forEach(button=>listen(button,'click',refresh));
  all('[data-download]').forEach(button=>listen(button,'click',download));
  listen(window,'pagehide',clear);listen(window,'pageshow',event=>{if(event.persisted)void refresh();});
  return {refresh,clear,destroy(){clear();destroyed=true;listeners.forEach(remove=>remove());}};
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const ui = createManifestReleaseUI({document, window, fetch: globalThis.fetch.bind(globalThis)});
  void ui.refresh();
}

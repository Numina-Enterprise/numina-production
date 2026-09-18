import {PINNED_RUNTIME_PUBLIC_KEY, assessRuntimeEvidence} from './runtime-release-model.js';

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

async function readJson(fetcher, path, parentSignal, timeoutMs) {
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
        if (!response.ok) throw new Error('Endpoint unavailable (HTTP ' + response.status + ').');
        const data = await response.json(); // The deadline includes reading and parsing the body.
        if (!recordObject(data)) throw new Error('The endpoint returned an unrecognized JSON response.');
        return data;
      })()
    ]);
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
  let generation = 0, renderRevision = 0, controller = null, records = {}, snapshot = null, destroyed = false;
  const listeners = [];

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }

  function resetDisplay(label, message) {
    snapshot = null;
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
    const ok = name => current[name]?.state === 'ok';
    const pending = Object.values(current).some(record => record.state === 'pending');
    const failed = Object.values(current).some(record => record.state === 'error');
    const manifest = assessed.manifest;
    const hasManifest = ok('manifest');
    for (const [name, selector] of Object.entries(jsonSelectors)) {
      set(selector, ok(name) ? JSON.stringify(current[name].data, null, 2) :
        current[name]?.state === 'pending' ? 'Waiting for a current response.' :
        current[name]?.error || 'No current response available.');
    }
    set('[data-release-version]', hasManifest ? 'v' + text(manifest.production_version) : pending ? 'Checking…' : 'Unavailable');
    set('[data-core-version]', hasManifest ? 'v' + text(manifest.core_version) : 'Unavailable');
    set('[data-build-id]', hasManifest ? text(manifest.build_id) : 'Unavailable');
    set('[data-production-root]', hasManifest ? text(manifest.production_files_root) : 'Unavailable');
    set('[data-core-root]', hasManifest ? text(manifest.frozen_core_manifest_root) : 'Unavailable');
    const status = ok('status') ? current.status.data : null;
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 'Not reported';
    set('[data-frozen-files]', status ? count(status.frozen_core?.checked_files) : 'Unavailable');
    set('[data-conformance]', status ? count(status.conformance?.passing_tests) : 'Unavailable');
    set('[data-sbom-hash]', ok('supply') ? text(current.supply.data.spdx_sbom_sha256) : 'Unavailable');
    set('[data-provenance-hash]', ok('supply') ? text(current.supply.data.slsa_provenance_sha256) : 'Unavailable');
    set('[data-supply-status]', ok('supply') ? assessed.supplyIdentityMatches ?
      assessed.releaseDeclarationVerified ? 'Artifact hashes match the signed manifest' : 'Artifact hashes match the pins; release signature unavailable' : 'Reported artifact identity does not match rc26' :
      current.supply?.state === 'pending' ? 'Checking…' : 'Unavailable');
    set('[data-readiness]', status ? assessed.runtimeStatusMatches ?
      'Runtime responding · rc26 identity matches' : 'Runtime response identity does not match rc26' :
      current.status?.state === 'pending' ? 'Checking…' : 'Unavailable');
    set('[data-signature-status]', assessed.releaseDeclarationVerified ? 'Signed runtime declaration verified' :
      current.attestation?.state === 'pending' ? 'Checking…' : 'Not verified');
    set('[data-key-id]', assessed.key ? assessed.key.key_id : 'Not verified');

    let label = 'Unavailable', message = 'No current release manifest is available.';
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
    } else if (pending) {
      label = 'Checking…';
      message = 'Loading current release and runtime responses independently.';
    }
    set('[data-live-status]', label);
    set('[data-release-message]', message);
    all('[data-live-status]').forEach(element => {
      element.dataset.state = label === 'Needs attention' ? 'error' : assessed.releaseDeclarationVerified ? 'verified' : hasManifest && assessed.manifestMatches ? 'observed' : 'error';
    });
    set('[data-runtime-release-summary]', hasManifest ? 'Runtime ' + text(manifest.production_version) + ' · ' + label.toLowerCase() : label);
    set('[data-runtime-release-detail]', message + (assessed.controlManifestBound ? ' The legacy control route receipt matches the NUMINA manifest.' : ' NUMINA control-manifest binding is not verified.'));
    set('[data-checked-at]', 'Response check ' + now().toLocaleString());
    // Raw observed artifacts remain downloadable; a key is offered only after verification against the configured pin.
    snapshot = {
      manifest: hasManifest ? manifest : null,
      attestation: ok('attestation') ? current.attestation.data : null,
      key: assessed.key,
      version: hasManifest && assessed.manifestMatches ? manifest.production_version : 'observed-runtime'
    };
    downloads().forEach(button => { button.disabled = !snapshot[button.dataset.download]; });
  }

  async function refresh() {
    if (destroyed) return;
    controller?.abort();
    const currentGeneration = ++generation;
    renderRevision++;
    controller = new AbortController();
    const activeController = controller;
    records = Object.fromEntries(Object.keys(RUNTIME_ENDPOINTS).map(name => [name, {state: 'pending'}]));
    resetDisplay('Checking…', 'Loading current release and runtime responses independently.');
    refreshButtons().forEach(button => { button.disabled = true; });
    await Promise.all(Object.entries(RUNTIME_ENDPOINTS).map(async ([name, path]) => {
      let record;
      try { record = {state: 'ok', data: await readJson(fetcher, path, activeController.signal, timeoutMs)}; }
      catch (error) { record = {state: 'error', error: error.message}; }
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
    if (!['manifest', 'attestation', 'key'].includes(kind) || !snapshot?.[kind]) return;
    const blob = new Blob([JSON.stringify(snapshot[kind], null, 2) + '\n'], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'numina-' + snapshot.version.replace(/[^a-zA-Z0-9.-]/g, '-') + '-' + kind + '.json';
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

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const ui = createRuntimeReleaseUI({document, window, fetch: globalThis.fetch.bind(globalThis)});
  void ui.refresh();
}

#!/usr/bin/env python3
"""Continuous read-only Numina evidence coordination in the managed cloud.

This service observes assigned inputs and matching reviewer receipts. It does
not execute model tasks, activate Salesforce agents, move funds, sign, run
tests, or mark a task complete without a registered full acceptance evaluator.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path('/workspace/numina-production')
BASE = ROOT / 'outputs/cloud-self-driving'
SCRIPT = ROOT / 'scripts/numina-cloud-work-loop.py'
CONFIG = ROOT / 'config/numina-cloud-work.v1.json'
MANIFEST = ROOT / 'config/numina-workspaces.v1.json'
LEDGER = ROOT / 'config/numina-agentforce-tasks.v1.json'
NODE_CONFIG = ROOT / 'config/numina-node26.v1.json'
NODE = Path('/workspace/.numina-tools/node-v26.11.1-linux-x64/bin/node')
INSTALL = NODE.parent.parent / 'numina-installation.json'
TEAMS = {'engineering', 'deployment', 'proofs', 'signatures', 'review'}
TASK_IDS = {'agentforce-' + str(i).zfill(3) for i in range(1, 101)}
ACTIONS = ('canonical_inputs', 'workspace_links', 'task_records', 'node_toolchain',
           'cloud_preview', 'reviewer_receipts')
INPUTS = (CONFIG, MANIFEST, LEDGER, NODE_CONFIG, ROOT / 'package.json',
          ROOT / 'public/final-manifest.json', ROOT / 'public/final-build.json',
          ROOT / 'src/worker.js', ROOT / 'src/frontier-http.js',
          ROOT / 'scripts/serve-numina-cloud.mjs', ROOT / 'dist/server/index.js', SCRIPT)
ACTION_TASKS = {
    'canonical_inputs': {'agentforce-001', 'agentforce-005', 'agentforce-045', 'agentforce-071'},
    'workspace_links': {'agentforce-006', 'agentforce-011', 'agentforce-040'},
    'task_records': {'agentforce-011', 'agentforce-045'},
    'node_toolchain': {'agentforce-056', 'agentforce-061'},
    'cloud_preview': {'agentforce-016', 'agentforce-021', 'agentforce-052'},
    'reviewer_receipts': {'agentforce-076', 'agentforce-081', 'agentforce-086', 'agentforce-091'}
}
STOP = threading.Event()
LAUNCH = {}


def utc():
    return datetime.now(timezone.utc).isoformat()


def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2) + '\n').encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('DUPLICATE_JSON_MEMBER')
        value[key] = item
    return value


def directory(path, create=False):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('ABSOLUTE_DIRECTORY_REQUIRED')
    for part in [*reversed(path.parents), path]:
        try:
            mode = part.lstat().st_mode
        except FileNotFoundError:
            if create:
                part.mkdir(mode=0o700)
                mode = part.lstat().st_mode
            else:
                raise
        if not stat.S_ISDIR(mode) or stat.S_ISLNK(mode):
            raise ValueError('REGULAR_DIRECTORY_REQUIRED')


def raw(path, limit=1024 * 1024):
    directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > limit:
            raise ValueError('REGULAR_BOUNDED_FILE_REQUIRED')
        data = source.read(limit + 1)
    if len(data) > limit:
        raise ValueError('INPUT_TOO_LARGE')
    return data


def doc(path):
    return parsed(raw(path))


def parsed(data):
    return json.loads(data.decode('utf-8'), object_pairs_hook=unique)


def write(path, value):
    directory(path.parent, create=True)
    if os.path.lexists(path) and not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError('REGULAR_OUTPUT_REQUIRED')
    temp = path.with_name('.' + path.name + '-' + uuid.uuid4().hex)
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(encoded(value))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def process_identity(pid):
    # Linux birth ticks distinguish a reused PID from this managed process.
    try:
        row = Path('/proc', str(pid), 'stat').read_text()
        tail = row[row.rindex(')') + 2:].split()
        args = Path('/proc', str(pid), 'cmdline').read_bytes().split(b'\0')
        if tail[0] == 'Z' or str(SCRIPT).encode() not in args or b'run' not in args:
            return None
        return tail[19]
    except (OSError, ValueError, IndexError):
        return None


def alive(record):
    pid = record.get('pid') if isinstance(record, dict) else None
    return isinstance(pid, int) and pid > 1 and process_identity(pid) == record.get('processBirthTicks')


def config(value=None):
    if value is None:
        value = doc(CONFIG)
    interval = value.get('intervalSeconds')
    limits = value.get('executionLimits', {})
    if (value.get('schema') != 'numina.cloud-work-config.v1' or value.get('canonicalRoot') != str(ROOT)
            or value.get('mode') != 'continuous_read_only_evidence_coordination'
            or value.get('workspaceBase') != '/workspace/numina-workspaces'
            or value.get('nodeExecutable') != str(NODE)
            or value.get('previewOrigin') != 'http://127.0.0.1:8788'
            or value.get('receiptIntake') != 'outputs/cloud-self-driving/incoming'
            or value.get('registeredActions') != list(ACTIONS)
            or not isinstance(interval, int) or isinstance(interval, bool) or not 30 <= interval <= 3600
            or any(limits.get(k) is not False for k in ('financialActions', 'providerMutations', 'signing',
                   'testRuns', 'arbitraryCommands', 'salesforceActivation', 'modelExecutorEstablished',
                   'taskCompletionEvaluatorsRegistered')) or limits.get('hostAvailabilityRequired') is not True):
        raise ValueError('CLOUD_WORK_POLICY_MISMATCH')
    return value


def stamp(path):
    try:
        s = path.lstat()
        return [s.st_ino, s.st_size, s.st_mtime_ns, s.st_mode]
    except FileNotFoundError:
        return None


def listener():
    rows = []
    for path in (Path('/proc/net/tcp'), Path('/proc/net/tcp6')):
        try:
            for line in path.read_text().splitlines()[1:]:
                fields = line.split()
                if fields[1].endswith(':2254') and fields[3] == '0A':
                    rows.append([fields[1], fields[9]])
        except OSError:
            pass
    return sorted(rows)


def snapshot():
    incoming = BASE / 'incoming'
    directory(incoming)
    files = sorted(incoming.glob('*.json'))
    if len(files) > 500:
        raise ValueError('REVIEW_RECEIPT_LIMIT_EXCEEDED')
    links, records = [], []
    for name in sorted(TASK_IDS | TEAMS):
        folder = Path('/workspace/numina-workspaces') / name
        link = folder / 'numina-production'
        links.append([name, stamp(link), os.readlink(link) if link.is_symlink() else None])
        records.append([name, stamp(folder / 'task.json')])
    # File stats wake the observer; content digests bind any resulting receipt.
    inputs = [[str(p), stamp(p)] for p in INPUTS]
    canonical = [inputs, stamp(ROOT / '.git/HEAD'), stamp(ROOT / '.git/refs/heads/main')]
    refresh = stamp(BASE / 'refresh.json')
    triggers = {
        'canonical_inputs': canonical,
        'workspace_links': [stamp(MANIFEST), links],
        'task_records': [stamp(LEDGER), records],
        'node_toolchain': [stamp(NODE_CONFIG), stamp(INSTALL), stamp(NODE), stamp(ROOT / 'package.json')],
        'cloud_preview': [listener(), stamp(ROOT / 'dist/server/index.js'),
                          stamp(ROOT / 'scripts/serve-numina-cloud.mjs'), stamp(NODE_CONFIG)],
        'reviewer_receipts': [canonical, [[p.name, stamp(p)] for p in files]]
    }
    return {name: sha(encoded([trigger, refresh])) for name, trigger in triggers.items()}


def canonical_inputs():
    captured = {}
    identities = []
    for path in INPUTS:
        try:
            data = raw(path, 32 * 1024 * 1024)
            captured[path] = data
            identities.append({'path': str(path.relative_to(ROOT)), 'sha256': sha(data), 'bytes': len(data)})
        except FileNotFoundError:
            identities.append({'path': str(path.relative_to(ROOT)), 'state': 'unavailable'})
    config(parsed(captured[CONFIG]))
    manifest, ledger = parsed(captured[MANIFEST]), parsed(captured[LEDGER])
    manifest_sha, ledger_sha = sha(captured[MANIFEST]), sha(captured[LEDGER])
    rooms, tasks = manifest.get('workspaces'), ledger.get('tasks')
    if (manifest.get('schema') != 'numina.workspaces.v1' or manifest.get('canonicalRoot') != str(ROOT)
            or manifest.get('workspaceBase') != '/workspace/numina-workspaces'
            or not isinstance(rooms, list) or len(rooms) != 105
            or {r.get('id') for r in rooms} != TASK_IDS | TEAMS
            or ledger.get('schema') != 'numina.agentforce-tasks.v1' or ledger.get('canonicalRoot') != str(ROOT)
            or ledger.get('preparedManifestSha256') != manifest_sha
            or not isinstance(tasks, list) or len(tasks) != 100
            or {t.get('id') for t in tasks} != TASK_IDS
            or any(t.get('configurationId') != t.get('id') or t.get('canonicalRoot') != str(ROOT) for t in tasks)):
        raise ValueError('CANONICAL_ASSIGNMENT_BINDING_MISMATCH')
    commit = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True, timeout=5).strip()
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('CANONICAL_COMMIT_REQUIRED')
    source = {'canonicalRoot': str(ROOT), 'canonicalCommit': commit, 'inputIdentities': identities,
              'scope': 'Live scoped input snapshot; may include uncommitted source edits'}
    return manifest, ledger, {**source, 'sourceIdentitySha256': sha(encoded(source)),
                             'taskLedgerSha256': ledger_sha, 'preparedManifestSha256': manifest_sha}


def workspace_links(manifest):
    links = []
    for room in manifest['workspaces']:
        folder = Path('/workspace/numina-workspaces') / room['id']
        directory(folder)
        path = folder / 'numina-production'
        if not path.is_symlink() or os.readlink(path) != str(ROOT) or path.resolve() != ROOT:
            raise ValueError('CANONICAL_WORKSPACE_LINK_MISMATCH:' + room['id'])
        links.append({'id': room['id'], 'path': str(path), 'destination': str(ROOT)})
    return {'observedLinks': len(links), 'links': links, 'workerActivationEstablished': False}


def task_records(ledger):
    for task in ledger['tasks']:
        observed = doc(Path('/workspace/numina-workspaces') / task['id'] / 'task.json')
        if observed != task:
            raise ValueError('WORKSPACE_TASK_RECORD_MISMATCH:' + task['id'])
    return {'matchingTaskRecords': 100, 'assignmentsChanged': False, 'taskExecutionEstablished': False}


def node_toolchain():
    pin, installation = doc(NODE_CONFIG), doc(INSTALL)
    archive = pin.get('artifacts', {}).get('linux-x64', {})
    if (pin.get('version') != '26.11.1' or installation.get('version') != 'v26.11.1'
            or installation.get('archiveSha256') != archive.get('sha256')
            or installation.get('archive') != archive.get('filename')
            or doc(ROOT / 'package.json').get('engines', {}).get('node') != '26.x'):
        raise ValueError('NODE_TOOLCHAIN_PIN_MISMATCH')
    before = stamp(NODE)
    binary = raw(NODE, 256 * 1024 * 1024)
    node_env = dict(os.environ)
    node_env.pop('NODE_OPTIONS', None)
    node_env.pop('NODE_PATH', None)
    version = subprocess.check_output([str(NODE), '--version'], text=True, timeout=10, env=node_env).strip()
    if stamp(NODE) != before:
        raise ValueError('NODE_EXECUTABLE_CHANGED_DURING_OBSERVATION')
    if version != 'v26.11.1':
        raise ValueError('NODE_EXECUTABLE_VERSION_MISMATCH')
    return {'version': version, 'executable': str(NODE), 'executableSha256': sha(binary),
            'installationRecordSha256': sha(raw(INSTALL)), 'officialArchiveSha256': archive['sha256'],
            'scope': 'Installed executable identity/version and retained archive pin; no new archive download',
            'applicationCompatibilityEstablished': False, 'productionWorkerRuntimeChanged': False}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        raise ValueError('CLOUD_PREVIEW_REDIRECT_REJECTED')


def local_json(path, payload=None):
    # Explicitly use the loopback transport. No request credentials or arbitrary URLs.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    data = encoded(payload) if payload is not None else None
    request = urllib.request.Request('http://127.0.0.1:8788' + path, data=data,
                                     headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
    with opener.open(request, timeout=8) as response:
        body = response.read(256 * 1024 + 1)
        if response.status != 200 or len(body) > 256 * 1024:
            raise ValueError('CLOUD_PREVIEW_RESPONSE_REJECTED')
    return json.loads(body.decode('utf-8'), object_pairs_hook=unique), sha(body)


def cloud_preview():
    runtime, runtime_sha = local_json('/__numina/cloud-runtime')
    if (runtime.get('schema') != 'numina.cloud-preview-runtime.v1'
            or runtime.get('canonicalRepository') != str(ROOT) or runtime.get('nodeVersion') != '26.11.1'
            or runtime.get('financialExecutionEnabled') is not False or runtime.get('productionWorkerActivated') is not False):
        raise ValueError('CLOUD_PREVIEW_RUNTIME_IDENTITY_MISMATCH')
    init, init_sha = local_json('/mcp', {'jsonrpc': '2.0', 'id': 'numina-cloud-initialize', 'method': 'initialize',
        'params': {'protocolVersion': '2025-11-25', 'capabilities': {},
                   'clientInfo': {'name': 'Numina cloud evidence coordinator', 'version': '1.0.0'}}})
    listing, listing_sha = local_json('/mcp', {'jsonrpc': '2.0', 'id': 'numina-cloud-tools', 'method': 'tools/list', 'params': {}})
    tools = listing.get('result', {}).get('tools')
    if init.get('id') != 'numina-cloud-initialize' or 'result' not in init or 'error' in init:
        raise ValueError('CLOUD_MCP_INITIALIZE_REJECTED')
    if listing.get('id') != 'numina-cloud-tools' or 'error' in listing or not isinstance(tools, list):
        raise ValueError('CLOUD_MCP_TOOL_LIST_REJECTED')
    names = [tool.get('name') for tool in tools]
    public_names = {'numina_connections', 'numina_architecture', 'numina_capabilities', 'numina_head'}
    protected_names = {'numina_provider_routes', 'numina_treasury_evidence', 'numina_owner_state'}
    if set(names) != public_names | protected_names or len(names) != 7:
        raise ValueError('CLOUD_MCP_DISCOVERY_SCOPE_MISMATCH')
    return {'runtime': runtime, 'runtimeResponseSha256': runtime_sha, 'initializeResponseSha256': init_sha,
            'toolsListResponseSha256': listing_sha, 'discoveredToolNames': names,
            'publicToolNames': [name for name in names if name in public_names],
            'protectedToolNames': [name for name in names if name in protected_names],
            'protectedToolsCalled': False, 'ownerAuthenticationEstablished': False,
            'scope': 'Loopback read-only cloud preview; not production publication or owner authentication'}


def reviewer_receipts(ledger, identity):
    tasks = {task['id']: task for task in ledger['tasks']}
    matches, rejected = [], []
    for path in sorted((BASE / 'incoming').glob('*.json')):
        try:
            receipt = doc(path)
            task = tasks.get(receipt.get('taskId'))
            recorded_time = datetime.fromisoformat(receipt.get('observedAtUtc', ''))
            if (receipt.get('schema') != 'numina.cloud-task-review-receipt.v1' or not task
                    or any(receipt.get(k) != identity[k] for k in ('canonicalRoot', 'canonicalCommit',
                           'sourceIdentitySha256', 'taskLedgerSha256', 'preparedManifestSha256'))
                    or receipt.get('target') != task['target']
                    or receipt.get('reviewer') != task['workerAssignment']['agentTask']
                    or receipt.get('result') != 'completed'
                    or receipt.get('passConditionSha256') != sha(task['acceptance']['passCondition'].encode())
                    or not isinstance(receipt.get('scopeLimits'), list)
                    or not isinstance(receipt.get('inputIdentities'), list)
                    or not isinstance(receipt.get('runId'), str) or not 1 <= len(receipt['runId']) <= 256
                    or recorded_time.tzinfo is None):
                raise ValueError('REVIEW_RECEIPT_BINDING_MISMATCH')
            matches.append({'taskId': task['id'], 'path': str(path.relative_to(ROOT)), 'sha256': sha(raw(path)),
                            'state': 'matching_declaration_hash_binding_observed', 'taskCompletionEstablished': False,
                            'reviewerAuthorityVerified': False, 'signatureVerified': False})
        except (OSError, ValueError, KeyError, TypeError) as error:
            rejected.append({'path': path.name, 'reason': str(error)[:240]})
    return {'matchingReviews': matches, 'rejectedReceipts': rejected,
            'fullAcceptanceEvaluatorsRegistered': False, 'completedTasks': 0}


def transient(error):
    if isinstance(error, urllib.error.HTTPError):
        return error.code in (502, 503, 504)
    if isinstance(error, urllib.error.URLError):
        return isinstance(error.reason, (TimeoutError, ConnectionError, OSError))
    return isinstance(error, (TimeoutError, ConnectionError))


def observe(changed, cache, context):
    if 'canonical_inputs' in changed or not context:
        try:
            manifest, ledger, identity = canonical_inputs()
            context[:] = [manifest, ledger, identity]
            cache['canonical_inputs'] = {'observedAtUtc': utc(), 'state': 'input_observed', 'data': identity}
        except Exception as error:
            context.clear()
            cache['canonical_inputs'] = {'observedAtUtc': utc(), 'state': 'needs_evidence', 'error': str(error)[:240]}
    if not context:
        return {'observedAtUtc': utc(), 'actions': cache, 'failures':
                [{'action': 'canonical_inputs', 'error': cache['canonical_inputs']['error']}],
                'queue': [], 'mode': 'needs_evidence', 'canonicalAssignmentsChanged': False}
    manifest, ledger, identity = context
    registered = {'workspace_links': lambda: workspace_links(manifest), 'task_records': lambda: task_records(ledger),
                  'node_toolchain': node_toolchain, 'cloud_preview': cloud_preview,
                  'reviewer_receipts': lambda: reviewer_receipts(ledger, identity)}
    for name, action in registered.items():
        if name not in changed:
            continue
        if STOP.is_set():
            break
        attempt = cache.get(name, {}).get('attempts', 0) + 1
        try:
            cache[name] = {'observedAtUtc': utc(), 'state': 'input_observed', 'data': action(), 'attempts': attempt}
            if name == 'reviewer_receipts' and cache[name]['data']['rejectedReceipts']:
                cache[name].update({'state': 'needs_evidence', 'error': 'REVIEW_RECEIPTS_REJECTED'})
        except Exception as error:
            retry = transient(error)
            cache[name] = {'observedAtUtc': utc(), 'state': 'needs_evidence', 'error': str(error)[:240],
                           'attempts': attempt, 'transientRetryAllowed': retry,
                           'retryExhausted': retry and attempt >= 2,
                           'retryAfterMonotonic': time.monotonic() + 60 if retry and attempt < 2 else None}
    failures = [{'action': name, 'error': row['error'], 'attempts': row.get('attempts', 1),
                 'transientRetryAllowed': row.get('transientRetryAllowed', False),
                 'retryExhausted': row.get('retryExhausted', False)}
                for name, row in cache.items() if 'error' in row]
    queue = []
    for task in sorted(ledger['tasks'], key=lambda t: (t['readiness'] != 'ready_for_cloud_review', t['priority'], t['id'])):
        applicable = [name for name, ids in ACTION_TASKS.items() if task['id'] in ids]
        observations = [name for name in applicable if cache.get(name, {}).get('state') == 'input_observed']
        failed_actions = [name for name in applicable if cache.get(name, {}).get('state') == 'needs_evidence']
        state = ('needs_evidence' if task['readiness'] != 'ready_for_cloud_review' else
                 'needs_evidence' if failed_actions else
                 'input_observed' if observations else 'awaiting_executor')
        queue.append({'taskId': task['id'], 'priority': task['priority'], 'team': task['team'],
                      'assignmentStatus': task['status'], 'coordinationState': state,
                      'readiness': task['readiness'], 'nextBestAction': task['nextBestAction'],
                      'registeredInputObservations': observations, 'failedInputActions': failed_actions,
                      'taskCompletedByCoordinator': False})
    return {'observedAtUtc': utc(), 'sourceIdentity': identity, 'actions': cache, 'failures': failures, 'queue': queue,
            'mode': 'input_observations_recorded_awaiting_execution_receipts', 'canonicalAssignmentsChanged': False,
            'wholeProtocolVerified': False, 'independentStreamAcceptanceVerified': False}


def health(run_id, started, observation, state, interval):
    queue = observation.get('queue', [])
    counts = dict(Counter(item['coordinationState'] for item in queue))
    pending = next((item for item in queue if item['coordinationState'] == 'awaiting_executor'), None)
    return {'schema': 'numina.cloud-work-health.v1', 'pid': os.getpid(), 'processBirthTicks': process_identity(os.getpid()),
            'runId': run_id, 'state': state, 'heartbeatAtUtc': utc(), 'uptimeSeconds': round(time.monotonic() - started, 2),
            'scope': 'Continuous read-only input/evidence coordination while this managed cloud host is running',
            'continuousCloudCoordinationEnabled': state == 'running', 'queueCounts': counts,
            'intervalSeconds': interval, 'launchIdentity': LAUNCH,
            'sourceScriptChangedSinceLaunch': sha(raw(SCRIPT)) != LAUNCH.get('scriptSha256'),
            'currentTask': pending['taskId'] if pending else None,
            'currentTaskState': pending['coordinationState'] if pending else 'awaiting_matching_execution_receipts',
            'lastObservationAtUtc': observation.get('observedAtUtc'), 'visibleFailures': observation.get('failures', []),
            'assignedTaskCount': len(queue), 'tasksCompletedByCoordinator': 0, 'runningSalesforceAgentCountEstablished': False,
            'modelExecutionEnabled': False, 'financialExecutionEnabled': False, 'newSignaturesIssued': False,
            'hostAvailabilityGuaranteed': False, 'observationMode': observation.get('mode', 'awaiting_initial_observation')}


def run():
    cfg = config()
    directory(BASE / 'incoming', create=True)
    fd = os.open(BASE / 'service.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        if not stat.S_ISREG(os.fstat(lock.fileno()).st_mode):
            raise ValueError('REGULAR_LOCK_REQUIRED')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('CLOUD_COORDINATOR_ALREADY_RUNNING')
        run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex
        run_dir = BASE / 'runs' / run_id
        directory(run_dir, create=True)
        interpreter = Path(sys.executable).resolve()
        LAUNCH.update({'launchedAtUtc': utc(), 'script': str(SCRIPT), 'scriptSha256': sha(raw(SCRIPT)),
                       'interpreter': str(interpreter), 'interpreterSha256': sha(raw(interpreter, 256 * 1024 * 1024)),
                       'pythonVersion': sys.version.split()[0]})
        write(run_dir / 'launch.json', LAUNCH)
        started, previous, observation, sequence = time.monotonic(), {}, {}, 0
        cache, context = {}, []
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda _sig, _frame: STOP.set())
        try:
            write(BASE / 'health.json', health(run_id, started, observation, 'running', cfg['intervalSeconds']))
            while not STOP.is_set():
                try:
                    current = snapshot()
                    changed = [name for name in ACTIONS if current[name] != previous.get(name)]
                    retrying = [name for name, row in cache.items()
                                if row.get('state') == 'needs_evidence' and row.get('transientRetryAllowed')
                                and row.get('attempts', 0) < 2
                                and row.get('retryAfterMonotonic', float('inf')) <= time.monotonic()]
                    if changed or retrying:
                        for name in changed:
                            cache.pop(name, None)
                        observation = observe(list(dict.fromkeys(changed + retrying)), cache, context)
                        sequence += 1
                        observation.update({'schema': 'numina.cloud-work-observation.v1', 'runId': run_id,
                                            'sequence': sequence, 'triggerIdentitySha256': sha(encoded(current)),
                                            'changedRegisteredActions': changed, 'boundedTransientRetries': retrying})
                        write(run_dir / ('observation-' + str(sequence).zfill(6) + '.json'), observation)
                        write(BASE / 'latest-observation.json', observation)
                        previous = current
                except Exception as error:
                    observation = {**observation, 'mode': 'needs_evidence', 'failures':
                                   [{'action': 'coordination', 'error': str(error)[:240]}]}
                write(BASE / 'health.json', health(run_id, started, observation, 'running', cfg['intervalSeconds']))
                STOP.wait(cfg['intervalSeconds'])
        finally:
            final = health(run_id, started, observation, 'stopped', cfg['intervalSeconds'])
            write(BASE / 'health.json', final)
            write(run_dir / 'shutdown.json', final)


def status():
    try:
        value = doc(BASE / 'health.json')
    except FileNotFoundError:
        return {'state': 'not_started', 'processAlive': False, 'continuousCloudCoordinationEnabled': False}
    value['processAlive'] = alive(value)
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(value['heartbeatAtUtc'])).total_seconds()
        interval = value.get('intervalSeconds', 60)
        if not isinstance(interval, int) or not 30 <= interval <= 3600 or age < -5:
            raise ValueError('HEARTBEAT_IDENTITY_INVALID')
        value['heartbeatAgeSeconds'] = round(max(0, age), 2)
        value['heartbeatStale'] = age > max(120, interval * 3)
    except (KeyError, TypeError, ValueError):
        value['heartbeatStale'] = True
    if not value['processAlive']:
        value['state'] = 'stopped_or_host_interrupted'
        value['continuousCloudCoordinationEnabled'] = False
    elif value['heartbeatStale']:
        value['state'] = 'heartbeat_stale'
        value['continuousCloudCoordinationEnabled'] = False
    elif value.get('sourceScriptChangedSinceLaunch'):
        value['state'] = 'running_prior_source_restart_required'
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('start', 'run', 'stop', 'status', 'refresh'))
    args = parser.parse_args()
    if ROOT.resolve() != ROOT or SCRIPT.resolve() != SCRIPT:
        raise ValueError('CANONICAL_CLOUD_SOURCE_REQUIRED')
    if args.command == 'run':
        run()
        return
    if args.command == 'status':
        print(json.dumps(status(), indent=2))
        return
    config()
    directory(BASE, create=True)
    if args.command == 'refresh':
        write(BASE / 'refresh.json', {'requestedAtUtc': utc(), 'id': uuid.uuid4().hex,
                                     'scope': 'Schedule registered read-only observations at the next bounded interval'})
        print(json.dumps({'state': 'refresh_requested', 'processAlive': alive(status())}))
    elif args.command == 'stop':
        value = status()
        requested = alive(value)
        if requested:
            os.kill(value['pid'], signal.SIGTERM)
            for _ in range(50):
                if not alive(value):
                    break
                time.sleep(0.1)
        result = status()
        result['stopRequested'] = requested
        if result.get('processAlive'):
            result['state'] = 'stop_requested_pending_current_read'
            result['continuousCloudCoordinationEnabled'] = False
        print(json.dumps(result, indent=2))
    elif args.command == 'start':
        if alive(status()):
            print(json.dumps(status(), indent=2))
            return
        log_fd = os.open(BASE / 'service.log', os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(log_fd, 'ab') as log:
            if not stat.S_ISREG(os.fstat(log.fileno()).st_mode):
                raise ValueError('REGULAR_LOG_REQUIRED')
            child = subprocess.Popen([sys.executable, '-B', str(SCRIPT), 'run'], cwd=ROOT,
                                     stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        for _ in range(50):
            value = status()
            if value.get('pid') == child.pid and alive(value):
                print(json.dumps(value, indent=2))
                return
            if child.poll() is not None:
                raise ValueError('CLOUD_COORDINATOR_START_FAILED; inspect private service.log')
            time.sleep(0.1)
        raise ValueError('CLOUD_COORDINATOR_START_UNCONFIRMED; inspect private health.json and service.log')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error), 'continuousCloudCoordinationEnabled': False}), file=sys.stderr)
        sys.exit(1)

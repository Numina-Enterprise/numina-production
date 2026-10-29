#!/usr/bin/env python3
"""Build Numina in its canonical cloud tree and retain exact execution receipts."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import uuid

ROOT = Path('/workspace/numina-production')
SOURCE_RECORD = ROOT / 'release-evidence/final-manuscript-delivery-2026-10-10/source-record.json'
SOURCE_RECORD_SHA = '1cf4c2fe90af6d24229ac227ed26f28cc02c50f70980ffccab2273b3577c1957'
FINAL_PDF = Path('/workspace/outputs/draft-kott-numina-pair-binding-02-final.pdf')
FINAL_PDF_SHA = '3e5db9f5ef29b7adb7ce408488b6c78cdd7121732d92efa638157de7a96f3ce9'
WORKSPACE_BASE = Path('/workspace/numina-workspaces')
TEAM_IDS = {'engineering', 'deployment', 'proofs', 'signatures', 'review'}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Repeated JSON member: ' + key)
        result[key] = value
    return result


def pinned_document(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError('A regular input file is required: ' + str(path))
    data = path.read_bytes()
    return (json.loads(data.decode('utf-8'), object_pairs_hook=unique_object),
            hashlib.sha256(data).hexdigest())


def document(path):
    return pinned_document(path)[0]


def preserved_delivery():
    if SOURCE_RECORD.is_symlink() or not SOURCE_RECORD.is_file() or FINAL_PDF.is_symlink() or not FINAL_PDF.is_file():
        raise ValueError('The retained signed delivery requires regular input files.')
    if digest(SOURCE_RECORD) != SOURCE_RECORD_SHA or digest(FINAL_PDF) != FINAL_PDF_SHA:
        raise ValueError('The retained signed delivery identity changed.')
    rows = document(SOURCE_RECORD)['files']
    for row in rows:
        path = ROOT / row['path']
        if path.is_symlink() or not path.is_file() or ROOT not in path.resolve().parents:
            raise ValueError('Retained source record path is unavailable.')
        if path.stat().st_size != row['bytes'] or digest(path) != row['sha256']:
            raise ValueError('Retained delivery bytes differ: ' + row['path'])
    return {'sourceRecordSha256': SOURCE_RECORD_SHA, 'matchingRetainedFiles': len(rows),
            'finalPdfSha256': FINAL_PDF_SHA, 'retainedBytesUnchanged': True}


def directory_path(path):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Directory paths must be absolute and contain no parent traversal.')
    for part in [*reversed(path.parents), path]:
        try:
            mode = part.lstat().st_mode
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(mode) or stat.S_ISLNK(mode):
            raise ValueError('A regular directory is required: ' + str(part))


def json_data(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def task_record_plan(path, value, allow_revision):
    directory_path(path.parent)
    expected = json_data(value)
    previous = None
    if os.path.lexists(path):
        if path.is_symlink() or not path.is_file():
            raise ValueError('A regular task record is required: ' + str(path))
        previous = path.read_bytes()
        if previous != expected and not allow_revision:
            raise ValueError('Existing task record needs an explicit new revision: ' + str(path))
    action = 'create' if previous is None else 'preserve' if previous == expected else 'revise'
    record = {'configurationId': value['configurationId'], 'path': str(path),
              'action': action, 'status': 'planned',
              'oldBytes': len(previous) if previous is not None else None,
              'oldSha256': hashlib.sha256(previous).hexdigest() if previous is not None else None,
              'newBytes': len(expected), 'newSha256': hashlib.sha256(expected).hexdigest()}
    return {'path': path, 'previous': previous, 'expected': expected, 'record': record}


def confirm_task_bytes(path, previous):
    directory_path(path.parent)
    if previous is None:
        if os.path.lexists(path):
            raise ValueError('Task record appeared after preflight: ' + str(path))
    elif (path.is_symlink() or not path.is_file() or path.stat().st_size != len(previous)
          or path.read_bytes() != previous):
        raise ValueError('Task record changed after preflight: ' + str(path))


def preserve_previous_task(output, plan):
    folder = output / 'previous-task-records' / plan['record']['configurationId']
    directory_path(folder.parent)
    folder.parent.mkdir(mode=0o700, exist_ok=True)
    folder.mkdir(mode=0o700)
    path = folder / 'task.json'
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(plan['previous'])
        stream.flush()
        os.fsync(stream.fileno())
    if path.read_bytes() != plan['previous']:
        raise ValueError('Archived task bytes differ: ' + str(path))
    plan['record']['preservedPreviousPath'] = str(path)


def apply_task_record(plan):
    path, previous, expected = plan['path'], plan['previous'], plan['expected']
    confirm_task_bytes(path, previous)
    if plan['record']['action'] == 'preserve':
        plan['record']['status'] = 'preserved'
        return
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    mode = path.stat().st_mode & 0o777 if previous is not None else 0o600
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(expected)
            stream.flush()
            os.fsync(stream.fileno())
        # The archived old bytes and the destination must still match immediately
        # before replacement. The replacement itself is one filesystem operation.
        confirm_task_bytes(path, previous)
        os.replace(temporary, path)
        plan['record']['status'] = 'applied'
        plan['record']['appliedAtUtc'] = datetime.now(timezone.utc).isoformat()
        if path.is_symlink() or not path.is_file() or path.read_bytes() != expected:
            raise ValueError('Applied task record differs: ' + str(path))
    finally:
        if temporary.exists():
            temporary.unlink()


def write_json(path, value):
    directory_path(path.parent)
    if os.path.lexists(path) and (path.is_symlink() or not path.is_file()):
        raise ValueError('Refusing a nonregular output: ' + str(path))
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--build', action='store_true', help='Execute the canonical build and Sites packaging.')
    parser.add_argument('--revise-task-records', action='store_true',
                        help='Preserve exact previous task bytes and explicitly revise changed task records.')
    args = parser.parse_args()
    os.chdir(ROOT)
    output_base = ROOT / 'outputs/cloud-root-delivery-2026-10-11'
    directory_path(output_base)
    output_base.mkdir(parents=True, exist_ok=True, mode=0o700)
    run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex
    output = output_base / run_id
    output.mkdir(mode=0o700)
    report_path = output / 'root-execution-receipt.json'
    receipt = {'schema': 'numina.cloud-root-execution.v1', 'canonicalRoot': str(ROOT), 'runId': run_id,
               'startedAtUtc': datetime.now(timezone.utc).isoformat(), 'status': 'in_progress',
               'steps': [], 'financialExecution': False, 'salesforceActivation': False,
               'wholeProtocolVerified': False, 'independentStreamAcceptanceVerified': False,
               'newSignatureIssued': False, 'buildExecuted': False}
    write_json(report_path, receipt)
    try:
        receipt['preservedDeliveryBefore'] = preserved_delivery()
        runtime = document(ROOT / 'config/numina-node26.v1.json')
        if runtime.get('schema') != 'numina.node-toolchain.v1' or runtime.get('version') != '26.11.1':
            raise ValueError('The exact observed Node 26.11.1 toolchain configuration is required.')
        if not args.node:
            raise ValueError('The selected Node executable is unavailable.')
        version = subprocess.check_output([args.node, '--version'], text=True).strip()
        if version != 'v' + runtime['version']:
            raise ValueError('Select the exact observed Node ' + runtime['version'] + ' cloud build executable.')
        receipt['buildRuntime'] = {'version': version, 'executable': str(Path(args.node).resolve()),
                                   'configuredVersion': runtime['version'],
                                   'workerRuntime': 'Cloudflare Workers Web APIs; separate from Node build host'}
        manifest_path = ROOT / 'config/numina-workspaces.v1.json'
        manifest, manifest_sha = pinned_document(manifest_path)
        tasks_path = ROOT / 'config/numina-agentforce-tasks.v1.json'
        ledger, tasks_sha = pinned_document(tasks_path)
        expected = {'agentforce-' + str(i).zfill(3) for i in range(1, 101)}
        rooms = manifest.get('workspaces')
        if (manifest.get('schema') != 'numina.workspaces.v1' or manifest.get('identity') != 'NUMINA'
                or manifest.get('canonicalRoot') != str(ROOT) or manifest.get('workspaceBase') != str(WORKSPACE_BASE)
                or manifest.get('linkName') != 'numina-production' or not isinstance(rooms, list)
                or len(rooms) != 105 or any(not isinstance(room, dict) or not isinstance(room.get('id'), str) for room in rooms)):
            raise ValueError('Workspace manifest does not identify the canonical 105-room configuration.')
        room_ids = {room['id'] for room in rooms}
        if room_ids != expected | TEAM_IDS:
            raise ValueError('Workspace manifest IDs must be the exact five teams and 100 Agentforce configurations.')
        if (ledger.get('schema') != 'numina.agentforce-tasks.v1' or ledger.get('identity') != 'NUMINA'
                or ledger.get('canonicalRoot') != str(ROOT) or ledger.get('preparedManifest') != 'config/numina-workspaces.v1.json'
                or ledger.get('preparedManifestSha256') != manifest_sha):
            raise ValueError('Task ledger is not bound to the canonical workspace manifest.')
        tasks = ledger.get('tasks')
        if not isinstance(tasks, list) or any(not isinstance(row, dict) or not isinstance(row.get('configurationId'), str) for row in tasks):
            raise ValueError('Task ledger entries require literal configuration IDs.')
        actual = {row['configurationId'] for row in tasks}
        if len(tasks) != 100 or actual != expected:
            raise ValueError('Task ledger must assign exactly one task to each of the 100 workspaces.')
        base = WORKSPACE_BASE
        directory_path(base)
        for room in rooms:
            folder = base / room['id']
            directory_path(folder)
            link = folder / 'numina-production'
            if not link.is_symlink() or link.resolve() != ROOT:
                raise ValueError('Canonical workspace link differs: ' + room['id'])
        # Preflight the entire set before archiving or replacing any task record.
        plans = [task_record_plan(base / task['configurationId'] / 'task.json', task,
                                  args.revise_task_records) for task in tasks]
        if digest(manifest_path) != manifest_sha or digest(tasks_path) != tasks_sha:
            raise ValueError('Canonical task configuration changed after preflight.')
        for plan in plans:
            if plan['record']['action'] == 'revise':
                preserve_previous_task(output, plan)
        receipt['taskLedger'] = {'sha256': tasks_sha, 'preparedManifestSha256': manifest_sha,
                                'assignedConfigurations': len(tasks),
                                'explicitRevisionsAuthorized': args.revise_task_records,
                                'plannedCreates': sum(p['record']['action'] == 'create' for p in plans),
                                'plannedRevisions': sum(p['record']['action'] == 'revise' for p in plans),
                                'plannedPreserves': sum(p['record']['action'] == 'preserve' for p in plans),
                                'taskRecordsCopied': 0, 'taskRecordsRevised': 0,
                                'matchingTaskRecordsPreserved': 0,
                                'canonicalLinks': len(rooms),
                                'configuredTasksAreRunningAgents': False,
                                'records': [plan['record'] for plan in plans]}
        # Commit the planned old/new hashes and preserved paths before replacement.
        write_json(report_path, receipt)
        for plan in plans:
            try:
                apply_task_record(plan)
            finally:
                records = receipt['taskLedger']['records']
                receipt['taskLedger']['taskRecordsCopied'] = sum(r['action'] == 'create' and r['status'] == 'applied' for r in records)
                receipt['taskLedger']['taskRecordsRevised'] = sum(r['action'] == 'revise' and r['status'] == 'applied' for r in records)
                receipt['taskLedger']['matchingTaskRecordsPreserved'] = sum(r['status'] == 'preserved' for r in records)
                write_json(report_path, receipt)
        if args.build:
            receipt['buildExecuted'] = True
            archive = output / 'numina-cloud-site-delivery.tar.gz'
            commands = [('build', [args.node, 'scripts/build.mjs']),
                        ('package', [args.node, 'scripts/package.mjs', str(archive)])]
            child_env = dict(os.environ)
            child_env['PATH'] = str(Path(args.node).resolve().parent) + os.pathsep + child_env.get('PATH', '')
            for name, command in commands:
                log = output / (name + '.log')
                with log.open('xb') as stream:
                    result = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, env=child_env)
                receipt['steps'].append({'action': name, 'exitCode': result.returncode,
                                         'log': str(log), 'logSha256': digest(log)})
                write_json(report_path, receipt)
                if result.returncode:
                    raise ValueError(name + ' stopped; inspect ' + str(log))
            for source, destination in [('config/numina-workspaces.v1.json', 'dist/client/workspaces.json'),
                                        ('config/numina-agentforce-tasks.v1.json', 'dist/client/tasks.json')]:
                if digest(ROOT / source) != digest(ROOT / destination):
                    raise ValueError('Served ledger differs from canonical source: ' + destination)
            if digest(tasks_path) != receipt['taskLedger']['sha256']:
                raise ValueError('Task ledger changed during the build; a new explicit task revision is required.')
            if digest(manifest_path) != receipt['taskLedger']['preparedManifestSha256']:
                raise ValueError('Workspace manifest changed during the build; a new explicit task revision is required.')
            receipt['archive'] = {'path': str(archive), 'bytes': archive.stat().st_size, 'sha256': digest(archive)}
        receipt['preservedDeliveryAfter'] = preserved_delivery()
        receipt['status'] = 'completed' if args.build else 'configuration_prepared'
    except Exception as error:
        receipt['status'] = 'failed'
        receipt['failure'] = str(error)
        raise
    finally:
        receipt['finishedAtUtc'] = datetime.now(timezone.utc).isoformat()
        write_json(report_path, receipt)
        print(json.dumps({'receipt': str(report_path), 'status': receipt['status'],
                          'failure': receipt.get('failure')}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print('Numina root execution stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)

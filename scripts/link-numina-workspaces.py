#!/usr/bin/env python3
"""Link prepared local workspaces to Numina's existing canonical repository.

This command prepares folders and public configuration records. It does not
start agents, connect Salesforce, deploy an org, change repository contents or
create signing keys. An existing matching link and record are left untouched.
"""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import sys

CANONICAL_ROOT = Path('/workspace/numina-production')
DEFAULT_MANIFEST = CANONICAL_ROOT / 'config/numina-workspaces.v1.json'
TEAM_IDS = {'engineering', 'deployment', 'proofs', 'signatures', 'review'}
SAFE_ID = re.compile(r'[a-z][a-z0-9-]{0,63}\Z')
AGENTFORCE_ID = re.compile(r'agentforce-(?:00[1-9]|0[1-9][0-9]|100)\Z')
DESTINATIONS = {'/build', '/deployment-readiness', '/downloads/provenance/decoded-attribution-closure-2026-10-11/README.md', '/provenance', '/control', '/integrations'}


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('Manifest contains a repeated member: ' + key)
        value[key] = item
    return value


def directory_path(path):
    """Require an absolute directory path with no symbolic-link components."""
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Workspace paths must be absolute and contain no parent traversal.')
    for part in [*reversed(path.parents), path]:
        try:
            mode = part.lstat().st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
            raise ValueError('Directory path is not a regular directory: ' + str(part))


def read_manifest(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError('The manifest must be a regular file.')
    if path.stat().st_size > 262144:
        raise ValueError('Workspace manifest exceeds the supported size.')
    manifest = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_object)
    if (not isinstance(manifest, dict) or manifest.get('schema') != 'numina.workspaces.v1' or
            manifest.get('canonicalRoot') != str(CANONICAL_ROOT) or
            manifest.get('workspaceBase') != '/workspace/numina-workspaces' or
            manifest.get('linkName') != 'numina-production' or
            manifest.get('configurationStatus') != 'prepared'):
        raise ValueError('Manifest does not identify the prepared Numina workspace configuration.')
    salesforce = manifest.get('salesforce', {})
    if (not isinstance(salesforce, dict) or salesforce.get('deploymentStatus') != 'not_deployed' or
            any(salesforce.get(key) is not False for key in
                ('orgConfigured', 'agentConfigured', 'licenseOrQuotaEstablished'))):
        raise ValueError('Prepared workspaces must not claim Salesforce activation or entitlement.')
    execution = manifest.get('agentExecution', {})
    if not isinstance(execution, dict) or any(execution.get(key) is not False for key in
            ('workspaceCountIsConcurrency', 'runningAgentsEstablished', 'executionCapacityReserved')):
        raise ValueError('Prepared workspace entries must not claim running agents or reserved capacity.')
    entries = manifest.get('workspaces')
    if not isinstance(entries, list) or len(entries) != 105:
        raise ValueError('Manifest must contain five team rooms and 100 Agentforce workspaces.')
    ids = set()
    cleaned = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError('Workspace entries must be objects.')
        workspace_id = entry.get('id')
        if not isinstance(workspace_id, str) or not SAFE_ID.fullmatch(workspace_id) or workspace_id in ids:
            raise ValueError('Workspace IDs must be unique safe directory names.')
        kind, team = entry.get('kind'), entry.get('team')
        if not isinstance(kind, str) or not isinstance(team, str) or kind not in ('team', 'agentforce') or team not in TEAM_IDS or entry.get('status') != 'prepared':
            raise ValueError('Workspace kind, team or prepared status is invalid: ' + workspace_id)
        if kind == 'team' and (workspace_id not in TEAM_IDS or workspace_id != team):
            raise ValueError('Team workspace ID and team must match.')
        if kind == 'agentforce' and not AGENTFORCE_ID.fullmatch(workspace_id):
            raise ValueError('Agentforce workspace IDs must identify configurations 001 through 100.')
        if any(not isinstance(entry.get(key), str) or not entry[key] or len(entry[key]) > limit
               for key, limit in [('name', 80), ('description', 240)]):
            raise ValueError('Workspace display fields are invalid: ' + workspace_id)
        if not isinstance(entry.get('destination'), str) or entry['destination'] not in DESTINATIONS:
            raise ValueError('Workspace tools must use an approved local destination.')
        ids.add(workspace_id)
        cleaned.append({key: entry[key] for key in
                        ('id', 'name', 'kind', 'team', 'status', 'description', 'destination')})
    if sum(entry['kind'] == 'team' for entry in cleaned) != 5 or sum(entry['kind'] == 'agentforce' for entry in cleaned) != 100:
        raise ValueError('Prepared workspace counts are inconsistent.')
    return cleaned


def record_bytes(entry, base):
    record = {'schema': 'numina.workspace-link.v1', **entry,
              'canonicalRoot': str(CANONICAL_ROOT),
              'workspacePath': str(base / entry['id']), 'productionLink': 'numina-production',
              'configurationStatus': 'prepared', 'agentStarted': False,
              'salesforceDeploymentEstablished': False, 'executionCapacityReserved': False}
    return (json.dumps(record, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def preflight(base, entries):
    """Check every existing destination before creating any workspace folder."""
    directory_path(base)
    for entry in entries:
        folder = base / entry['id']
        directory_path(folder)
        link = folder / 'numina-production'
        if os.path.lexists(link):
            if not link.is_symlink() or os.readlink(link) != str(CANONICAL_ROOT):
                raise ValueError('Existing production link does not match the canonical root: ' + str(link))
        record = folder / 'workspace.json'
        if os.path.lexists(record):
            if record.is_symlink() or not record.is_file() or record.stat().st_size > 8192:
                raise ValueError('Existing workspace record is not a supported regular file: ' + str(record))
            if record.read_bytes() != record_bytes(entry, base):
                raise ValueError('Existing workspace record differs; it will not be overwritten: ' + str(record))


def link_workspace(base_fd, entry, base):
    workspace_id = entry['id']
    try:
        os.mkdir(workspace_id, mode=0o755, dir_fd=base_fd)
    except FileExistsError:
        pass
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    folder_fd = os.open(workspace_id, flags, dir_fd=base_fd)
    try:
        try:
            os.symlink(str(CANONICAL_ROOT), 'numina-production', dir_fd=folder_fd, target_is_directory=True)
        except FileExistsError:
            if os.readlink('numina-production', dir_fd=folder_fd) != str(CANONICAL_ROOT):
                raise ValueError('Existing production link does not match: ' + workspace_id)
        expected = record_bytes(entry, base)
        try:
            record_fd = os.open('workspace.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                0o644, dir_fd=folder_fd)
        except FileExistsError:
            record_fd = os.open('workspace.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder_fd)
            with os.fdopen(record_fd, 'rb') as record:
                if not stat.S_ISREG(os.fstat(record.fileno()).st_mode) or record.read(8193) != expected:
                    raise ValueError('Existing workspace record differs: ' + workspace_id)
        else:
            with os.fdopen(record_fd, 'wb') as record:
                record.write(expected)
    finally:
        os.close(folder_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=DEFAULT_MANIFEST,
                        help='Prepared workspace manifest; the canonical root remains pinned.')
    parser.add_argument('--base', type=Path, default=Path('/workspace/numina-workspaces'),
                        help='Local workspace directory (default: /workspace/numina-workspaces).')
    args = parser.parse_args()
    entries = read_manifest(args.manifest)
    directory_path(CANONICAL_ROOT)
    if not CANONICAL_ROOT.is_dir():
        raise ValueError('The established canonical repository is not available.')
    base = args.base
    directory_path(base)
    if base == CANONICAL_ROOT or base in CANONICAL_ROOT.parents or CANONICAL_ROOT in base.parents:
        raise ValueError('Workspace storage must be separate from the canonical repository.')
    preflight(base, entries)
    base.mkdir(mode=0o755, parents=True, exist_ok=True)
    base_fd = os.open(base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for entry in entries:
            link_workspace(base_fd, entry, base)
    finally:
        os.close(base_fd)
    print(json.dumps({'schema': 'numina.workspace-link-result.v1', 'workspaceCount': len(entries),
                      'teamWorkspaceCount': 5, 'agentforceConfigurationCount': 100,
                      'canonicalRoot': str(CANONICAL_ROOT), 'workspaceBase': str(base),
                      'productionLinksPrepared': True, 'agentsStarted': False,
                      'salesforceDeploymentEstablished': False, 'executionCapacityReserved': False}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print('Workspace linking stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)

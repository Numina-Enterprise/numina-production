#!/usr/bin/env python3
"""Install Numina's official checksum-pinned Node 26 toolchain in isolation.

Uses only the Python standard library on Linux and macOS. Existing Node
installations, system paths, signing custody and Worker runtime stay intact.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import posixpath
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'config/numina-node26.v1.json'
VERSION = '26.11.1'
ORIGIN = 'https://nodejs.org/dist'


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def download(url, destination):
    request = urllib.request.Request(url, headers={'User-Agent': 'Numina-Node-Toolchain/1'})
    with urllib.request.urlopen(request, timeout=60) as response, destination.open('xb') as output:
        if not response.url.startswith(ORIGIN + '/'):
            raise ValueError('Node download redirected outside the official distribution origin.')
        shutil.copyfileobj(response, output)


def extract_archive(archive_path, stage, package_name):
    """Extract regular files first, then links whose targets remain in the package."""
    with tarfile.open(archive_path, 'r:xz') as archive:
        members = archive.getmembers()
        if len(members) > 100000 or sum(member.size for member in members) > 1024 * 1024 * 1024:
            raise ValueError('Node archive exceeds the supported bounds.')
        seen = set()
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != package_name or str(path) in seen:
                raise ValueError('Node archive contains an unsafe or repeated path.')
            seen.add(str(path))
            if not (member.isdir() or member.isfile() or member.issym() or member.islnk()):
                raise ValueError('Node archive contains an unsupported entry type.')
            if member.issym() or member.islnk():
                target = member.linkname if member.islnk() else posixpath.join(str(path.parent), member.linkname)
                target = posixpath.normpath(target)
                if target != package_name and not target.startswith(package_name + '/'):
                    raise ValueError('Node archive link points outside its package.')
        for member in members:
            path = stage.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                path.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, path.open('xb') as output:
                    shutil.copyfileobj(source, output)
                path.chmod(member.mode & 0o777)
        for member in members:
            path = stage.joinpath(*PurePosixPath(member.name).parts)
            if member.issym():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.symlink_to(member.linkname)
            elif member.islnk():
                path.parent.mkdir(parents=True, exist_ok=True)
                os.link(stage.joinpath(*PurePosixPath(member.linkname).parts), path)


def observe_node(target):
    binary = target / 'bin/node'
    if not binary.is_file() or binary.is_symlink():
        raise ValueError('Installed Node binary is unavailable or is an unexpected symbolic link.')
    observed = subprocess.check_output([str(binary), '--version'], text=True, timeout=15).strip()
    if observed != 'v' + VERSION:
        raise ValueError('Installed Node version does not match the pinned release.')
    return observed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, default=Path('/workspace/.numina-tools'),
                        help='Isolated installation directory; use another absolute path on macOS.')
    parser.add_argument('--print-bin', action='store_true', help='Print only the installed bin directory.')
    args = parser.parse_args()
    config = json.loads(CONFIG.read_text(encoding='utf-8'))
    if config.get('schema') != 'numina.node-toolchain.v1' or config.get('version') != VERSION or config.get('downloadOrigin') != ORIGIN:
        raise ValueError('Node configuration does not match the pinned official release.')
    system = {'Linux': 'linux', 'Darwin': 'darwin'}.get(platform.system())
    machine = {'x86_64': 'x64', 'AMD64': 'x64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(platform.machine())
    key = str(system) + '-' + str(machine)
    item = config.get('artifacts', {}).get(key)
    package_name = 'node-v' + VERSION + '-' + key
    if not item or item.get('filename') != package_name + '.tar.xz' or not re.fullmatch('[0-9a-f]{64}', item.get('sha256', '')):
        raise ValueError('This platform has no pinned official Node artifact.')
    prefix = args.prefix
    if not prefix.is_absolute() or '..' in prefix.parts:
        raise ValueError('The installation prefix must be an absolute path without parent traversal.')
    for component in [*reversed(prefix.parents), prefix]:
        if component.is_symlink() or (component.exists() and not component.is_dir()):
            raise ValueError('The installation prefix must use regular directories.')
    prefix.mkdir(parents=True, exist_ok=True)
    target = prefix / package_name
    expected_record = {'schema': 'numina.node-installation.v1', 'version': 'v' + VERSION,
                       'platform': key, 'archive': item['filename'], 'archiveSha256': item['sha256'],
                       'checksumSource': ORIGIN + '/v' + VERSION + '/SHASUMS256.txt',
                       'archiveSource': ORIGIN + '/v' + VERSION + '/' + item['filename'],
                       'verification': 'Pinned SHA-256 and matching official SHASUMS256.txt entry',
                       'scope': 'Node executable installation and version observation',
                       'applicationCompatibilityEstablished': False, 'workerRuntimeChanged': False}
    if os.path.lexists(target):
        record = target / 'numina-installation.json'
        if target.is_symlink() or record.is_symlink() or not record.is_file() or json.loads(record.read_text()) != expected_record:
            raise ValueError('An existing installation differs; it will not be overwritten.')
        observed = observe_node(target)
        reused = True
    else:
        with tempfile.TemporaryDirectory(prefix='.numina-node26-', dir=prefix) as staging:
            stage = Path(staging)
            sums = stage / 'SHASUMS256.txt'
            archive_path = stage / item['filename']
            download(expected_record['checksumSource'], sums)
            matches = [line.split() for line in sums.read_text().splitlines()
                       if line.split() and line.split()[-1] == item['filename']]
            if len(matches) != 1 or matches[0] != [item['sha256'], item['filename']]:
                raise ValueError('The official checksum entry does not match the pinned archive.')
            download(expected_record['archiveSource'], archive_path)
            if digest(archive_path) != item['sha256']:
                raise ValueError('Downloaded Node archive SHA-256 does not match.')
            extract_archive(archive_path, stage, package_name)
            candidate = stage / package_name
            observed = observe_node(candidate)
            (candidate / 'numina-installation.json').write_text(json.dumps(expected_record, indent=2) + '\n')
            shutil.copyfile(sums, candidate / 'NUMINA-SHASUMS256.txt')
            if os.path.lexists(target):
                raise ValueError('The installation destination appeared during preparation; no replacement performed.')
            candidate.rename(target)
        reused = False
    if args.print_bin:
        print(target / 'bin')
    else:
        print(json.dumps({**expected_record, 'nodeBinary': str(target / 'bin/node'),
                          'observedVersion': observed, 'reusedInstallation': reused,
                          'testsExecuted': False, 'buildExecuted': False}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit('Node installation stopped: ' + str(error))

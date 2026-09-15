"""Owner-run portable backup. Passwords stay in this console and a private child pipe."""
import argparse
import base64
import getpass
import os
from pathlib import Path
import subprocess
import sys

try:
    parser = argparse.ArgumentParser(description='Create encrypted portable backups of the four NUSD role wallets.')
    parser.add_argument('--vault', required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--owner-account', required=True)
    parser.add_argument('--node', default='node')
    args = parser.parse_args()
    if not sys.stdin.isatty():
        raise ValueError('A local interactive console is required')
    password = getpass.getpass('Backup password (at least 16 characters): ')
    confirmation = getpass.getpass('Repeat backup password: ')
    if len(password) < 16 or password != confirmation:
        raise ValueError('Invalid password')
    environment = dict(os.environ, NUMINA_WALLET_PYTHON=sys.executable)
    result = subprocess.run([args.node, str(Path(__file__).with_name('export-wallet-backup.mjs')),
                             str(Path(args.vault).absolute()), args.owner_account, str(Path(args.destination).absolute())],
                            input=base64.b64encode(password.encode('utf-8')), capture_output=True,
                            env=environment, check=False)
    password = confirmation = None
    if result.returncode:
        raise ValueError('Backup failed')
    print(result.stdout.decode('utf-8').strip())
except Exception:
    print('Encrypted backup was not completed. Check local access, password length and a new destination directory. No secret details were logged.', file=sys.stderr)
    sys.exit(1)

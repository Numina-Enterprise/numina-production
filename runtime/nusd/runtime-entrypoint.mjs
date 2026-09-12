import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (!args.length) args.push('check-runtime', '/var/lib/numina/journal');
const operation = args[0];
const arity = { 'check-runtime': 2, prepare: 4, submit: 3, observe: 3 };

function rejectConfiguration(code, message) {
  console.log(JSON.stringify({ schema: 'numina.runtime-entrypoint.v1', status: 'failed',
    error: { code, message }, childStarted: false, transactionBroadcast: false,
    submissionReady: false }));
  process.exit(1);
}
if (!Object.hasOwn(arity, operation) || args.length !== arity[operation]) {
  rejectConfiguration('INVALID_OPERATION', 'Use a supported operation with its required arguments.');
}

function readSecretFile(file) {
  let fd;
  try {
    if (typeof file !== 'string' || !path.isAbsolute(file) || path.normalize(file) !== file) throw new Error();
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > 8192) throw new Error();
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size < 1 || opened.size > 8192) throw new Error();
    // Bound reads even if another process modifies the file after the stat call.
    const bytes = Buffer.alloc(8193); let used = 0;
    for (;;) {
      const count = fs.readSync(fd, bytes, used, bytes.length - used, null);
      if (count === 0) break;
      used += count;
      if (used > 8192) throw new Error();
    }
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used)).replace(/\r?\n$/, '');
    if (!value || value.trim() !== value || /[^\x20-\x7e]/.test(value)) throw new Error();
    return value;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

const environment = { ...process.env };
// Check-only startup never opens secret files or passes RPC credential values.
delete environment.NUMINA_RPC_URL;
delete environment.NUMINA_RPC_AUTHORIZATION;
if (operation !== 'check-runtime') {
  try {
    const url = readSecretFile(process.env.NUMINA_RPC_URL_FILE);
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.hash) throw new Error();
    environment.NUMINA_RPC_URL = url;
    if (process.env.NUMINA_RPC_AUTHORIZATION_FILE !== undefined) {
      environment.NUMINA_RPC_AUTHORIZATION = readSecretFile(process.env.NUMINA_RPC_AUTHORIZATION_FILE);
    }
  } catch {
    rejectConfiguration('RPC_SECRET_UNAVAILABLE', 'Required RPC secret files are missing or invalid.');
  }
}
delete environment.NUMINA_RPC_URL_FILE;
delete environment.NUMINA_RPC_AUTHORIZATION_FILE;
// Credentials stay in the child environment, never in argv or the image. The
// child adapter owns all existing review, nonce, durability and send-once gates.
const child = spawnSync(process.execPath, [path.join(root, 'scripts/managed-deployment.mjs'), ...args], {
  cwd: root, env: environment, stdio: 'inherit', windowsHide: true
});
if (child.error) {
  // A spawn failure starts no child; do not print the raw process error or paths.
  rejectConfiguration('RUNTIME_START_FAILED', 'The managed adapter could not be started.');
}
process.exitCode = child.status ?? 1;

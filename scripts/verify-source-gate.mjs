import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve, posix } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
export const SOURCE_GATE_OS_IMAGE = 'node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553';
const NODE_VERSION = 'v26.11.1';

export function validateRuntime({ platform, version }) {
  assert.equal(platform, 'linux', 'SOURCE_GATE_LINUX_HOST_REQUIRED');
  assert.equal(version, NODE_VERSION, 'SOURCE_GATE_EXACT_NODE26_REQUIRED');
}

export function assertCredentialFreeGitConfig(config) {
  assert.ok(!/extraheader|credential|\[\s*include|:\/\/[^/\s]+@/i.test(config), 'SOURCE_GATE_GIT_CREDENTIALS_OR_INCLUDES_DENIED');
}

export function validateSandboxState({ version, uid, noNewPrivileges, effectiveCapabilities, environment, interfaces, routes, socketPresent }) {
  assert.equal(version, NODE_VERSION, 'SOURCE_GATE_CONTAINER_NODE26_REQUIRED');
  assert.equal(uid, 1000, 'SOURCE_GATE_UNPRIVILEGED_UID_REQUIRED');
  assert.equal(noNewPrivileges, true, 'SOURCE_GATE_NO_NEW_PRIVILEGES_REQUIRED');
  assert.match(effectiveCapabilities, /^0+$/, 'SOURCE_GATE_CAPABILITIES_DENIED');
  assert.equal(environment.HOME, '/work', 'SOURCE_GATE_PRIVATE_HOME_REQUIRED');
  assert.equal(socketPresent, false, 'SOURCE_GATE_HOST_SOCKET_DENIED');
  for (const name of Object.keys(environment)) assert.doesNotMatch(name, /TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|API_KEY|PRIVATE_KEY|^ACTIONS_|^GITHUB_/i, 'SOURCE_GATE_CREDENTIAL_ENV_DENIED');
  const addresses = Object.values(interfaces).flat();
  assert.ok(addresses.length && addresses.every(address => address.internal === true), 'SOURCE_GATE_EXTERNAL_NETWORK_INTERFACE_DENIED');
  assert.equal(routes.trim().split(/\r?\n/).length, 1, 'SOURCE_GATE_EXTERNAL_ROUTE_DENIED');
}

export function dockerArguments({ sourceRoot, nodeHome }) {
  for (const value of [sourceRoot, nodeHome]) assert.ok(posix.isAbsolute(value) && !/[,\r\n]/.test(value), 'SOURCE_GATE_UNSAFE_MOUNT_PATH');
  assert.match(nodeHome, /^\/opt\/hostedtoolcache\/node\/26\.11\.1\/(?:x64|arm64)$/, 'SOURCE_GATE_PUBLIC_NODE_TOOLCACHE_REQUIRED');
  return [
    'run', '--rm', '--network', 'none', '--read-only', '--user', '1000:1000',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/work:rw,nosuid,nodev,size=3g,mode=1777',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,mode=1777',
    '--mount', 'type=bind,src=' + sourceRoot + ',dst=/source,readonly',
    '--mount', 'type=bind,src=' + nodeHome + ',dst=/node26,readonly',
    '--env', 'HOME=/work', '--env', 'PATH=/node26/bin:/usr/local/bin:/usr/bin:/bin',
    '--workdir', '/work', '--entrypoint', '/node26/bin/node', SOURCE_GATE_OS_IMAGE,
    '--input-type=module', '-e', "const {sandboxMain}=await import('/source/scripts/verify-source-gate.mjs'); await sandboxMain();"
  ];
}

export function runGateContainer({ sourceRoot, nodeHome, environment, expectedSourceCommit, onOutput }, run = spawnSync) {
  const result = run('docker', dockerArguments({ sourceRoot, nodeHome }), { env: environment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  onOutput?.(result.stdout || '');
  assert.equal(result.error, undefined, 'SOURCE_GATE_DOCKER_UNAVAILABLE');
  assert.equal(result.status, 0, 'SOURCE_GATE_CONTAINER_FAILED');
  const prefix = 'NUMINA_SOURCE_GATE_DISPOSABLE_BUILD ';
  const receipts = (result.stdout || '').split(/\r?\n/).filter(line => line.startsWith(prefix));
  assert.equal(receipts.length, 1, 'SOURCE_GATE_DISPOSABLE_RECEIPT_REQUIRED');
  const receipt = JSON.parse(receipts[0].slice(prefix.length));
  assert.equal(receipt.schema, 'numina.source-gate.disposable-build.v1');
  assert.equal(receipt.nodeVersion, NODE_VERSION);
  assert.equal(receipt.sourceCommit, expectedSourceCommit);
  assert.equal(receipt.fullRootSuitePassed, true);
  assert.equal(receipt.scope, 'disposable_build_and_full_root_tests_not_release_or_deployment_proof');
  for (const changes of [receipt.postBuildChanges, receipt.postTestChanges]) {
    assert.ok(Array.isArray(changes) && changes.length <= 10000);
    for (const file of changes) {
      assert.ok(typeof file.path === 'string' && !posix.isAbsolute(file.path) && !file.path.split('/').includes('..'));
      assert.ok(['file', 'symlink_target', 'deleted'].includes(file.type));
      assert.ok(file.type === 'deleted' ? file.sha256 === null : /^[a-f0-9]{64}$/.test(file.sha256));
    }
  }
  return { ...receipt, osImage: SOURCE_GATE_OS_IMAGE };
}

export function assertCleanTrackedSource({ sourceRoot, environment }, run = spawnSync) {
  for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']]) {
    const result = run('git', args, { cwd: sourceRoot, env: environment, encoding: 'utf8' });
    assert.equal(result.status, 0, 'SOURCE_GATE_DIRTY_TRACKED_SOURCE');
  }
}

export function runSandboxSuite({ nodeExecutable, npmEntry, workingDirectory, captureChanges, onBuildCapture }, run = spawnSync) {
  assert.equal(typeof captureChanges, 'function', 'SOURCE_GATE_BUILD_MUTATION_CAPTURE_REQUIRED');
  let postBuildChanges;
  for (const [args, failure] of [
    [[npmEntry, 'run', 'build'], 'SOURCE_GATE_BUILD_FAILED'],
    [['scripts/sync-application-release-pin.mjs'], 'SOURCE_GATE_ARTIFACT_PIN_CHECK_FAILED'],
    [[npmEntry, 'test'], 'SOURCE_GATE_FULL_ROOT_SUITE_FAILED']
  ]) {
    const result = run(nodeExecutable, args, { cwd: workingDirectory, stdio: 'inherit' });
    assert.equal(result.status, 0, failure);
    if (failure === 'SOURCE_GATE_ARTIFACT_PIN_CHECK_FAILED') {
      postBuildChanges = captureChanges('post_build');
      onBuildCapture?.(postBuildChanges);
    }
  }
  return { fullRootSuitePassed: true, postBuildChanges, postTestChanges: captureChanges('post_test'), scope: 'disposable_build_and_full_root_tests_not_release_or_deployment_proof' };
}

export async function sandboxMain() {
  const status = readFileSync('/proc/self/status', 'utf8');
  const effectiveCapabilities = status.match(/^CapEff:\s*([a-f0-9]+)$/m)?.[1];
  const noNewPrivileges = status.match(/^NoNewPrivs:\s*(\d+)$/m)?.[1] === '1';
  validateSandboxState({
    version: process.version, uid: process.getuid(), noNewPrivileges, effectiveCapabilities, environment: process.env, interfaces: networkInterfaces(),
    routes: readFileSync('/proc/net/route', 'utf8'),
    socketPresent: ['/var/run/docker.sock', '/run/docker.sock', '/run/containerd/containerd.sock'].some(existsSync)
  });
  const { createConnection } = await import('node:net');
  const { createSocket } = await import('node:dgram');
  const http = await import('node:http'), https = await import('node:https');
  const blocked = (label, makeRequest) => new Promise((accept, reject) => {
    let settled = false, request;
    const clean = () => { try { request?.destroy?.(); } catch {} try { request?.close?.(); } catch {} };
    const timer = setTimeout(() => { settled = true; clean(); reject(Error('SOURCE_GATE_NETWORK_PROBE_TIMEOUT_' + label)); }, 2000);
    const deny = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clean();
      if (['ENETUNREACH', 'EHOSTUNREACH'].includes(error?.code)) accept();
      else reject(Error('SOURCE_GATE_NETWORK_DENIAL_NOT_CONFIRMED_' + label));
    };
    request = makeRequest(deny, () => { if (settled) return; settled = true; clearTimeout(timer); clean(); reject(Error('SOURCE_GATE_NETWORK_CONNECTION_ALLOWED_' + label)); });
  });
  // Documentation-range addresses; interface/route checks precede these probes.
  await blocked('tcp', (deny, allowed) => createConnection({ host: '198.51.100.1', port: 443 }).once('error', deny).once('connect', allowed));
  await blocked('http', (deny, allowed) => http.get('http://198.51.100.1/', allowed).once('error', deny));
  await blocked('tls', (deny, allowed) => https.get('https://198.51.100.1/', allowed).once('error', deny));
  await blocked('udp', (deny, allowed) => {
    const socket = createSocket('udp4').once('error', deny);
    socket.send(Buffer.from('isolation'), 53, '198.51.100.1', error => error ? deny(error) : allowed());
    return socket;
  });
  console.log(JSON.stringify({ schema: 'numina.source-gate.isolation.v1', nodeVersion: process.version, uid: process.getuid(), noNewPrivileges, effectiveCapabilities, networkDenied: true, credentialEnvironmentAbsent: true, hostSocketsAbsent: true }));
  assertCredentialFreeGitConfig(readFileSync('/source/.git/config', 'utf8'));
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  assert.ok(!git.error && git.status === 0, 'SOURCE_GATE_REQUIRED_TOOL_MISSING_git: full root suite not executed');
  cpSync('/source', '/work/repository', { recursive: true, dereference: false });
  process.chdir('/work/repository');
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).scripts.test, 'node --test tests/*.test.mjs', 'SOURCE_GATE_FULL_ROOT_TEST_SCRIPT_REQUIRED');
  const captureChanges = () => {
    const paths = new Set();
    for (const args of [['diff', 'HEAD', '--name-only', '-z'], ['diff', '--cached', '--name-only', '-z']]) {
      const diff = spawnSync('git', args, { encoding: 'utf8' });
      assert.equal(diff.status, 0, 'SOURCE_GATE_BUILD_CHANGE_CAPTURE_FAILED');
      for (const path of diff.stdout.split('\0').filter(Boolean)) paths.add(path);
    }
    return [...paths].sort().map(path => {
      assert.ok(!posix.isAbsolute(path) && !path.split('/').includes('..'), 'SOURCE_GATE_INVALID_CHANGED_PATH');
      let metadata;
      try { metadata = lstatSync(path); }
      catch (error) { if (error.code === 'ENOENT') return { path, type: 'deleted', sha256: null }; throw error; }
      const symlink = metadata.isSymbolicLink();
      return { path, type: symlink ? 'symlink_target' : 'file', sha256: createHash('sha256').update(symlink ? readlinkSync(path) : readFileSync(path)).digest('hex') };
    });
  };
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  assert.equal(head.status, 0, 'SOURCE_GATE_DISPOSABLE_SOURCE_READ_FAILED');
  const sourceCommit = head.stdout.trim();
  const result = runSandboxSuite({
    nodeExecutable: process.execPath, npmEntry: '/node26/lib/node_modules/npm/bin/npm-cli.js',
    workingDirectory: '/work/repository', captureChanges,
    onBuildCapture: changes => {
      assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).scripts.test, 'node --test tests/*.test.mjs', 'SOURCE_GATE_FULL_ROOT_TEST_SCRIPT_CHANGED');
      console.log('NUMINA_SOURCE_GATE_POST_BUILD ' + JSON.stringify({ schema: 'numina.source-gate.post-build-inputs.v1', sourceCommit, changes }));
    }
  });
  console.log('NUMINA_SOURCE_GATE_DISPOSABLE_BUILD ' + JSON.stringify({ schema: 'numina.source-gate.disposable-build.v1', nodeVersion: process.version, sourceCommit, ...result }));
}

function main() {
  validateRuntime({ platform: process.platform, version: process.version });
  assert.ok(lstatSync(join(root, '.git')).isDirectory(), 'SOURCE_GATE_LOCAL_GIT_DIRECTORY_REQUIRED');
  assertCredentialFreeGitConfig(readFileSync(join(root, '.git/config'), 'utf8'));
  const expected = process.env.NUMINA_VERIFICATION_SOURCE_SHA || process.env.GITHUB_SHA;
  assert.match(expected || '', /^[a-f0-9]{40}$/, 'SOURCE_GATE_IMMUTABLE_SOURCE_SHA_REQUIRED');
  const temporary = mkdtempSync(join(tmpdir(), 'numina-gate-config-'));
  try {
    const environment = {
      PATH: process.env.PATH, HOME: temporary, DOCKER_CONFIG: temporary, DOCKER_HOST: 'unix:///var/run/docker.sock',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0'
    };
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, env: environment, encoding: 'utf8' });
    assert.equal(git.status, 0, 'SOURCE_GATE_GIT_READ_FAILED');
    assert.equal(git.stdout.trim(), expected, 'SOURCE_GATE_SOURCE_SHA_MISMATCH');
    assertCleanTrackedSource({ sourceRoot: root, environment });
    const sourceRoot = realpathSync(root), nodeHome = dirname(dirname(realpathSync(process.execPath)));
    const result = runGateContainer({ sourceRoot, nodeHome, environment, expectedSourceCommit: expected, onOutput: output => process.stdout.write(output) });
    const after = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, env: environment, encoding: 'utf8' });
    assert.equal(after.status, 0, 'SOURCE_GATE_SOURCE_READBACK_FAILED');
    assert.equal(after.stdout.trim(), expected, 'SOURCE_GATE_SOURCE_CHANGED');
    assertCleanTrackedSource({ sourceRoot: root, environment });
    console.log(JSON.stringify({ schema: 'numina.source-gate.result.v1', sourceCommit: expected, ...result }));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

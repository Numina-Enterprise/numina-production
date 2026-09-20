import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const readJson = path => JSON.parse(readFileSync(new URL('../'+path, import.meta.url), 'utf8'));

test('production NUSD runtime pins the reviewed ethers and patched ws dependency', () => {
  const pkg = readJson('runtime/nusd/package.json');
  const lock = readJson('runtime/nusd/package-lock.json');

  assert.deepEqual(pkg.dependencies, {ethers: '6.17.0'});
  assert.equal(lock.packages[''].dependencies.ethers, '6.17.0');
  assert.equal(lock.packages['node_modules/ethers'].version, '6.17.0');
  assert.equal(pkg.overrides.ws, '8.21.3');
  assert.equal(lock.packages['node_modules/ethers'].dependencies.ws, '8.21.0');
  assert.equal(lock.packages['node_modules/ws'].version, '8.21.3');

  const productionWs = Object.entries(lock.packages)
    .filter(([path]) => path === 'node_modules/ws' || path.endsWith('/node_modules/ws'))
    .map(([, record]) => record.version);
  assert.deepEqual(productionWs, ['8.21.3']);
});

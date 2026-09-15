import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { generateRoleKeystores, validateRoleKeystores } from './wallet-provisioning.mjs';

const helper = fileURLToPath(new URL('./windows-wallet-custody.py', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
function custody(action, { directory, ownerAccount, creatorSid, input } = {}) {
  if (process.platform !== 'win32') throw new Error('Local wallet custody requires Windows');
  const args = ['-B', helper, action];
  if (directory) args.push('--directory', directory);
  if (ownerAccount) args.push('--owner-account', ownerAccount);
  if (creatorSid) args.push('--creator-sid', creatorSid);
  const result = spawnSync(process.env.NUMINA_WALLET_PYTHON || 'python', args, { input, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1048576 });
  if (result.error || result.status !== 0) throw new Error('Windows wallet protection or access verification failed');
  return result.stdout.trim();
}

function assertRegular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Wallet vault must be a regular private file');
}

export function assertPrivateVaultLocation(directory) {
  const resolved = path.resolve(directory);
  // Private custody belongs outside the canonical checkout and public deliverables.
  let current = fs.existsSync(resolved) ? resolved : path.dirname(resolved);
  while (true) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Wallet vault path must not contain links');
    if (fs.existsSync(path.join(current, '.git')) || /^(outputs|public|dist)$/i.test(path.basename(current))) {
      throw new Error('Wallet vault must be outside repositories and public output directories');
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolved;
}

export async function loadWindowsRoleVault(directory, ownerAccount) {
  directory = assertPrivateVaultLocation(directory);
  const file = path.join(directory, 'role-wallets.private.json');
  assertRegular(file);
  const bytes = fs.readFileSync(file), vault = JSON.parse(bytes);
  if (vault.schema !== 'numina.nusd.windows-role-vault.v1') throw new Error('Wallet vault identity mismatch');
  const acl = JSON.parse(custody('Assert', { directory, ownerAccount, creatorSid: vault.creatorSid }));
  if (acl.ownerSid !== vault.ownerSid) throw new Error('Wallet vault owner mismatch');
  const password = Buffer.from(custody('Unprotect', { input: vault.protectedPassword }), 'base64');
  try {
    const roles = await validateRoleKeystores(vault.keystores, password);
    if (JSON.stringify(roles) !== JSON.stringify(vault.roles)) throw new Error('Wallet vault address mismatch');
    return { roles, vaultSha256: hash(bytes), custody: acl, createdAt: vault.createdAt, keystores: vault.keystores, password };
  } catch (error) { password.fill(0); throw error; }
}

export async function createWindowsRoleVault(directory, ownerAccount) {
  directory = assertPrivateVaultLocation(directory);
  if (fs.existsSync(directory)) {
    const restored = await loadWindowsRoleVault(directory, ownerAccount);
    restored.password.fill(0);
    return { roles: restored.roles, vaultSha256: restored.vaultSha256, custody: restored.custody, createdAt: restored.createdAt, reused: true };
  }
  const acl = JSON.parse(custody('Initialize', { directory, ownerAccount }));
  const password = randomBytes(32);
  try {
    // Prove OS protection works before generating any private keys.
    const protectedPassword = custody('Protect', { input: password.toString('base64') });
    const roundTrip = Buffer.from(custody('Unprotect', { input: protectedPassword }), 'base64');
    const matches = roundTrip.equals(password); roundTrip.fill(0);
    if (!matches) throw new Error('Wallet password recovery failed');
    const generated = await generateRoleKeystores(password);
    const verified = await validateRoleKeystores(generated.keystores, password);
    if (JSON.stringify(verified) !== JSON.stringify(generated.roles)) throw new Error('Generated wallet verification failed');
    const vault = { schema: 'numina.nusd.windows-role-vault.v1', createdAt: new Date().toISOString(), ownerAccount,
      ownerSid: acl.ownerSid, creatorSid: acl.creatorSid, protection: acl.protection, protectedPassword,
      roles: generated.roles, keystores: generated.keystores };
    const bytes = JSON.stringify(vault, null, 2) + '\n';
    const fd = fs.openSync(path.join(directory, 'role-wallets.private.json'), 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const restored = await loadWindowsRoleVault(directory, ownerAccount);
    restored.password.fill(0);
    return { roles: restored.roles, vaultSha256: restored.vaultSha256, custody: acl, createdAt: restored.createdAt, reused: false };
  } finally { password.fill(0); }
}

export function initializePrivateDirectory(directory, ownerAccount) {
  directory = assertPrivateVaultLocation(directory);
  return JSON.parse(custody('Initialize', { directory, ownerAccount }));
}

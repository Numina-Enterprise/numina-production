import fs from 'node:fs';
import path from 'node:path';
import { Wallet, encryptKeystoreJson } from 'ethers';
import { loadWindowsRoleVault, initializePrivateDirectory } from './windows-wallet-vault.mjs';
import { ROLE_NAMES, validateRoleKeystores } from './wallet-provisioning.mjs';

let original, password;
try {
  const [vaultDirectory, ownerAccount, destination, ...extra] = process.argv.slice(2);
  if (!vaultDirectory || !ownerAccount || !destination || extra.length) throw new Error();
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; if (size > 16384) throw new Error(); chunks.push(chunk); }
  password = Buffer.from(Buffer.concat(chunks).toString('utf8').trim(), 'base64');
  for (const chunk of chunks) chunk.fill(0);
  if (password.length < 16) throw new Error();
  original = await loadWindowsRoleVault(vaultDirectory, ownerAccount);
  const keystores = {};
  for (const role of ROLE_NAMES) {
    const wallet = await Wallet.fromEncryptedJson(original.keystores[role], original.password);
    keystores[role] = await encryptKeystoreJson({ address: wallet.address, privateKey: wallet.privateKey }, password);
  }
  const restored = await validateRoleKeystores(keystores, password);
  if (JSON.stringify(restored) !== JSON.stringify(original.roles)) throw new Error();
  initializePrivateDirectory(destination, ownerAccount);
  for (const role of ROLE_NAMES) {
    const fd = fs.openSync(path.join(destination, role + '.keystore.json'), 'wx', 0o600);
    try { fs.writeFileSync(fd, keystores[role] + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  fs.writeFileSync(path.join(destination, 'public-addresses.json'), JSON.stringify({ roles: restored, format: 'WEB3_SECRET_STORAGE_V3', broadcast: false }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: 'ENCRYPTED_PORTABLE_BACKUP_CREATED', directory: path.resolve(destination), roles: restored, broadcast: false }));
} catch {
  console.error('Encrypted wallet backup failed. No private key or password was printed. Check local vault access, password length and a new destination directory.');
  process.exitCode = 1;
} finally { original?.password.fill(0); password?.fill(0); }

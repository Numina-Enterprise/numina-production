import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getAddress, ZeroAddress } from 'ethers';
import { createWindowsRoleVault } from './windows-wallet-vault.mjs';
import { applyWalletAssignments, ROLE_NAMES } from './wallet-provisioning.mjs';

let requestUpdated = false;
try {
  const [requestArg, vaultArg, ownerAccount, recipientArg, ...extra] = process.argv.slice(2);
  if (!requestArg || !vaultArg || !ownerAccount || !recipientArg || extra.length) throw new Error();
  const request = path.resolve(requestArg), bytes = fs.readFileSync(request), config = JSON.parse(bytes);
  const recipient = getAddress(recipientArg);
  if (recipient === ZeroAddress || config.schema !== 'numina.nusd.deployment.request.v2') throw new Error();
  if (config.initialRecipient != null && String(config.initialRecipient).toLowerCase() !== recipient.toLowerCase()) throw new Error();
  if (!fs.existsSync(vaultArg) && ROLE_NAMES.some(role => config.roles?.[role] != null)) throw new Error();
  const provisioned = await createWindowsRoleVault(vaultArg, ownerAccount);
  const updated = applyWalletAssignments(config, provisioned.roles, recipient);
  const updatedBytes = JSON.stringify(updated, null, 2) + '\n';
  const manifest = { schema: 'numina.nusd.wallet-assignments.v1', status: 'CREATED_LOCAL_SOFTWARE_WALLETS',
    createdAt: provisioned.createdAt, roles: provisioned.roles, initialRecipient: updated.initialRecipient,
    custody: { model: 'SINGLE_WINDOWS_HOST_SHARED_CUSTODY', ownerAccount, protection: provisioned.custody.protection,
      distinctKeys: true, independentRoleCustodyVerified: false, portableBackupConfirmed: false,
      keyAccess: 'Named Windows owner, creating local account and SYSTEM; machine administrators can recover access' },
    privateVaultPath: path.resolve(vaultArg), privateVaultSha256: provisioned.vaultSha256,
    requestSha256: createHash('sha256').update(updatedBytes).digest('hex'),
    broadcast: false, transactionHash: null, deployedAddress: null, receipt: null };
  const manifestFile = path.join(path.dirname(request), 'nusd-wallet-assignments.json');
  if (fs.existsSync(manifestFile)) {
    const previous = JSON.parse(fs.readFileSync(manifestFile));
    if (previous.schema !== manifest.schema || previous.privateVaultSha256 !== manifest.privateVaultSha256 ||
        previous.initialRecipient !== manifest.initialRecipient || JSON.stringify(previous.roles) !== JSON.stringify(manifest.roles)) throw new Error();
  }
  const stage = (file, content) => {
    const temporary = file + '.wallet-update.tmp';
    if (fs.existsSync(temporary)) {
      if (fs.readFileSync(temporary, 'utf8') !== content) throw new Error();
    } else {
      const fd = fs.openSync(temporary, 'wx');
      try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    return temporary;
  };
  const requestStage = stage(request, updatedBytes);
  const manifestStage = stage(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  // Detect edits made while encryption was running before updating this request.
  if (!fs.readFileSync(request).equals(bytes)) throw new Error();
  fs.renameSync(requestStage, request); requestUpdated = true;
  fs.renameSync(manifestStage, manifestFile);
  console.log(JSON.stringify({ status: manifest.status, reused: provisioned.reused, roles: manifest.roles,
    initialRecipient: manifest.initialRecipient, manifest: manifestFile, broadcast: false }, null, 2));
} catch {
  console.error(JSON.stringify({ status: requestUpdated ? 'REQUEST_UPDATED_MANIFEST_PENDING' : 'WALLET_PROVISIONING_INCOMPLETE',
    requestUpdated, broadcast: false, message: 'No secret details were logged. Any created vault is retained. Check configuration and private storage access; retry with the same request and vault paths.' }));
  process.exitCode = 1;
}

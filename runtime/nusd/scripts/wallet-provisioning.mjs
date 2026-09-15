import { Wallet, encryptKeystoreJson, getAddress, hexlify, randomBytes, ZeroAddress } from 'ethers';

export const ROLE_NAMES = Object.freeze(['admin', 'issuer', 'minter', 'pauser']);

function requirePassword(password) {
  const length = typeof password === 'string' ? Buffer.byteLength(password, 'utf8') : password?.byteLength;
  if (!Number.isInteger(length) || length < 16) throw new Error('A wallet encryption password of at least 16 bytes is required');
}

function checkedRoles(roles) {
  const result = {};
  try {
    if (!roles || Object.keys(roles).length !== ROLE_NAMES.length) throw new Error();
    for (const role of ROLE_NAMES) {
      result[role] = getAddress(roles[role]);
      if (result[role] === ZeroAddress) throw new Error();
    }
    if (new Set(Object.values(result)).size !== ROLE_NAMES.length) throw new Error();
  } catch { throw new Error('Four distinct nonzero role addresses are required'); }
  return result;
}

export async function generateRoleKeystores(password) {
  requirePassword(password);
  const roles = {}, keystores = {};
  for (const role of ROLE_NAMES) {
    // Independent OS CSPRNG draws; no shared mnemonic, deterministic seed or network.
    let wallet;
    do { wallet = new Wallet(hexlify(randomBytes(32))); } while (Object.values(roles).includes(wallet.address));
    roles[role] = wallet.address;
    keystores[role] = await encryptKeystoreJson({ address: wallet.address, privateKey: wallet.privateKey }, password);
  }
  return { roles, keystores };
}

export async function validateRoleKeystores(keystores, password) {
  requirePassword(password);
  const roles = {};
  try {
    if (!keystores || Object.keys(keystores).length !== ROLE_NAMES.length) throw new Error();
    for (const role of ROLE_NAMES) {
      if (typeof keystores[role] !== 'string') throw new Error();
      const wallet = await Wallet.fromEncryptedJson(keystores[role], password);
      roles[role] = wallet.address;
    }
    return checkedRoles(roles);
  } catch { throw new Error('Wallet vault authentication or role validation failed'); }
}

export function applyWalletAssignments(config, roles, recipient) {
  if (!config || config.schema !== 'numina.nusd.deployment.request.v2') throw new Error('A v2 deployment request is required');
  const checked = checkedRoles(roles);
  let initialRecipient;
  try {
    initialRecipient = getAddress(recipient);
    if (initialRecipient === ZeroAddress) throw new Error();
  } catch { throw new Error('A nonzero treasury recipient address is required'); }
  const result = structuredClone(config);
  for (const role of ROLE_NAMES) {
    const existing = config.roles?.[role];
    if (existing != null && String(existing).toLowerCase() !== checked[role].toLowerCase()) {
      throw new Error('Existing wallet assignments cannot be replaced by provisioning');
    }
  }
  if (config.initialRecipient != null && String(config.initialRecipient).toLowerCase() !== initialRecipient.toLowerCase()) {
    throw new Error('Existing treasury recipient cannot be replaced by provisioning');
  }
  result.roles = checked;
  result.initialRecipient = initialRecipient;
  return result;
}

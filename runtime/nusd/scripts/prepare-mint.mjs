import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Interface, getAddress, parseUnits, ZeroAddress, keccak256 } from 'ethers';
import { loadTokenArtifact, TOKEN_ARTIFACT_SHA256 } from './token-artifact.mjs';

const CHAIN_ID = 962421430;
const NUSD_DECIMALS = 18;
const MAX_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const MAX_UINT48 = 2 ** 48 - 1;
const MAX_UINT256 = 2n ** 256n - 1n;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = message => Object.assign(new Error(message), { code: 'INVALID_MINT_REQUEST' });
const exact = (value, fields) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    throw invalid('The request contains missing or unsupported fields');
  }
};

/** Encode two unsigned calls for review. No provider, wallet, or treasury is accessed. */
export function prepareMint(requestFile, { nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const file = path.resolve(requestFile);
  let bytes, config;
  try {
    bytes = fs.readFileSync(file);
    if (bytes.length > 16384) throw new Error();
    config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw invalid('A readable mint request JSON object of at most 16 KiB is required'); }
  exact(config, ['schema', 'network', 'tokenAddress', 'issuer', 'minter', 'recipient',
    'amountNusd', 'reserveReference', 'expiresAt']);
  exact(config.network, ['chainId']);
  if (config.schema !== 'numina.nusd.mint.request.v1' || config.network.chainId !== CHAIN_ID) {
    throw invalid('The mint request schema and configured Numina chain ID are required');
  }
  const addresses = {};
  for (const key of ['tokenAddress', 'issuer', 'minter', 'recipient']) {
    try {
      if (typeof config[key] !== 'string') throw new Error();
      addresses[key] = getAddress(config[key]);
      if (addresses[key] === ZeroAddress) throw new Error();
    } catch { throw invalid(`An explicit nonzero ${key} address is required`); }
  }
  if (addresses.issuer === addresses.minter) throw invalid('Issuer and minter addresses must be distinct');
  let amount;
  try {
    if (typeof config.amountNusd !== 'string' || !/^(?:0|[1-9][0-9]{0,77})(?:\.[0-9]{1,18})?$/.test(config.amountNusd)) throw new Error();
    amount = parseUnits(config.amountNusd, NUSD_DECIMALS);
    if (amount <= 0n || amount > MAX_UINT256) throw new Error();
  } catch { throw invalid('A positive uint256 NUSD amount in decimal text with at most 18 decimals is required'); }
  if (typeof config.reserveReference !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(config.reserveReference) ||
      /^0x0{64}$/.test(config.reserveReference)) throw invalid('An explicit nonzero bytes32 reserve reference is required');
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0 || nowSeconds > MAX_UINT48 ||
      !Number.isSafeInteger(config.expiresAt) || config.expiresAt > MAX_UINT48 ||
      config.expiresAt <= nowSeconds || config.expiresAt > nowSeconds + MAX_LIFETIME_SECONDS) {
    throw invalid('Expiry must be a uint48 Unix timestamp after local preparation time and within 7 days');
  }
  const artifact = loadTokenArtifact(), abi = new Interface(artifact.abi);
  const reference = config.reserveReference.toLowerCase();
  const call = (step, method, role, sender, args) => {
    const data = abi.encodeFunctionData(method, args);
    return { step, method, requiredRole: role, dependsOnStep: step === 2 ? 1 : null,
      transaction: { chainId: CHAIN_ID, to: addresses.tokenAddress, from: sender,
        nonce: null, gas: null, fee: null, value: '0', data },
      dataSha256: sha256(Buffer.from(data.slice(2), 'hex')), dataKeccak256: keccak256(data),
      signature: null, broadcast: false, transactionHash: null, receipt: null };
  };
  const transactions = [
    call(1, 'authorizeIssuance', 'ISSUER_ROLE', addresses.issuer, [reference, addresses.recipient, amount, config.expiresAt]),
    call(2, 'mintAuthorized', 'MINTER_ROLE', addresses.minter, [reference])
  ];
  const requestSha256 = sha256(bytes);
  if (sha256(fs.readFileSync(file)) !== requestSha256) {
    throw Object.assign(new Error('The request changed during preparation'), { code: 'REQUEST_CHANGED' });
  }
  return {
    schema: 'numina.nusd.unsigned-mint-review-draft.v1', status: 'UNSIGNED_MINT_REVIEW_DRAFT_NOT_APPROVED',
    purpose: 'Offline review of issuer authorization followed by the distinct minter call',
    submissionApproved: false, broadcast: false, signature: null,
    request: { network: { chainId: CHAIN_ID }, ...addresses, amountNusd: config.amountNusd,
      amountBaseUnits: amount.toString(), reserveReference: reference, expiresAt: config.expiresAt },
    transactions,
    integrity: { requestSha256, sourceSha256: artifact.sourceSha256,
      artifactSha256: TOKEN_ARTIFACT_SHA256, compiler: artifact.compiler },
    expiry: { maximumLifetimeSeconds: MAX_LIFETIME_SECONDS, checkedAgainst: 'local_system_time_only',
      currentChainTimeVerified: false, recheckBeforeSigningRequired: true },
    verification: { chainIdentityVerified: false, tokenDeploymentVerified: false, roleAssignmentsVerified: false,
      signerControlVerified: false, unpausedStateVerified: false, availableSupplyCapacityVerified: false,
      unusedReferenceVerified: false, issuerAuthorizationConfirmed: false, reserveEvidenceVerified: false,
      independentReviewsVerified: false, nativeTreasuryRecipientVerified: false },
    requirements: [
      'Verify the chain, deployed token identity, role assignments, signer control and current pause state.',
      'The administrator must separately unpause the token before either call can execute.',
      'Verify that cap minus totalSupply minus authorizedSupply covers the requested amount.',
      'Verify the reference is unused and expiry is after the current chain timestamp and at most 7 days later.',
      'Verify issuer policy and the evidence represented by the public reference; the reference proves no reserves.',
      'Confirm issuer authorization of this exact recipient, amount and expiry before the distinct minter signs.',
      'Recheck expiry and current authorization state before the minter call.'
    ],
    execution: { managedManifest: null, nonceAndFeesVerified: false },
    effects: { contractDeployed: false, tokensIssued: false, nativeTreasuryWritten: false,
      settlementCompleted: false, providerDepositSubmitted: false },
    transactionHash: null, deployedAddress: null, receipt: null
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [request, flag, destination, ...extra] = process.argv.slice(2);
    if (!request || flag !== '--output' || !destination || extra.length) throw new Error('Invalid CLI arguments');
    const output = path.resolve(destination);
    if (output.toLowerCase() === path.resolve(request).toLowerCase()) throw new Error('Request and output must differ');
    const draft = prepareMint(request), bytes = JSON.stringify(draft, null, 2) + '\n';
    fs.mkdirSync(path.dirname(output), { recursive: true });
    let reused = false;
    if (fs.existsSync(output)) {
      const stat = fs.lstatSync(output);
      if (!stat.isFile() || stat.isSymbolicLink() || fs.readFileSync(output, 'utf8') !== bytes) throw new Error('Output already contains different content');
      reused = true;
    } else {
      const fd = fs.openSync(output, 'wx');
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    console.log(JSON.stringify({ status: draft.status, output, reused, submissionApproved: false, broadcast: false }));
  } catch (error) {
    console.error(JSON.stringify({ status: 'MINT_DRAFT_NOT_CREATED',
      error: error.code === 'INVALID_MINT_REQUEST' ? error.code : 'REQUEST_OR_OUTPUT_INVALID',
      errors: error.code === 'INVALID_MINT_REQUEST' ? [error.message] : [], submissionApproved: false, broadcast: false }));
    process.exitCode = 1;
  }
}

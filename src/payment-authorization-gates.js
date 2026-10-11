// Verification-only prototype for a stricter Numina profile inspired by
// draft-dias-agent-payment-verdicts-00. NOT a compliant implementation of that
// individual Internet-Draft, a payment executor, or a production adapter.
// All network keys are pinned from caller configuration, never token-provided.
import {createHash, createPublicKey, verify as cryptoVerify} from 'node:crypto';

const headerFields = new Set(['alg', 'typ', 'kid']);
const verdictFields = new Set(['iss','aud','iat','nbf','exp','jti','nonce','decision',
  'operator','payer','mandate_id','policy_sha256','request','cnf','metadata']);
const requestFields = new Set(['recipient','asset','amount_minor','settlement_endpoint']);
const confirmationFields = new Set(['jwk_thumbprint']);
const historyFields = new Set(['iss','aud','iat','exp','environment','keys']);
const nonempty = x => typeof x === 'string' && x.length > 0 && x.length <= 1024;
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const hasExactFields = (obj, allowed) => obj && typeof obj === 'object' &&
  !Array.isArray(obj) && Object.keys(obj).every(key => allowed.has(key));
const reject = code => {throw Object.assign(new Error(code), {paymentGateCode: code});};
const requireGate = (value, code) => {if (!value) reject(code);};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function decodeSegment(segment) {
  requireGate(typeof segment === 'string' && /^[A-Za-z0-9_-]+$/.test(segment),
    'INVALID_JWS_ENCODING');
  const bytes = Buffer.from(segment, 'base64url');
  requireGate(bytes.toString('base64url') === segment, 'NONCANONICAL_BASE64URL');
  return bytes;
}

function readJws(token, expectedTyp) {
  requireGate(typeof token === 'string' && token.length <= 16384, 'INVALID_JWS');
  const pieces = token.split('.');
  requireGate(pieces.length === 3, 'INVALID_JWS');
  const [protectedPart,payloadPart,signaturePart] = pieces;
  const headerBytes = decodeSegment(protectedPart);
  const payloadBytes = decodeSegment(payloadPart);
  const signature = decodeSegment(signaturePart);
  requireGate(signature.length === 64, 'INVALID_ES256_SIGNATURE');
  let header, payload;
  try {
    const decoder = new TextDecoder('utf-8', {fatal:true});
    header = JSON.parse(decoder.decode(headerBytes));
    payload = JSON.parse(decoder.decode(payloadBytes));
  } catch {reject('INVALID_JWS_JSON');}
  requireGate(hasExactFields(header, headerFields) &&
    header.alg === 'ES256' && header.typ === expectedTyp &&
    nonempty(header.kid), 'INVALID_JWS_HEADER');
  requireGate(payload && typeof payload === 'object' && !Array.isArray(payload),
    'INVALID_JWS_PAYLOAD');
  return {header,payload,signature,
    signingInput: Buffer.from(protectedPart + '.' + payloadPart,'ascii')};
}

function verifySignature(jws, publicJwk) {
  try {
    const key = createPublicKey({key: publicJwk,format:'jwk'});
    return key.asymmetricKeyType === 'ec' &&
      key.asymmetricKeyDetails?.namedCurve === 'prime256v1' &&
      cryptoVerify('sha256',jws.signingInput,{key,dsaEncoding:'ieee-p1363'},jws.signature);
  } catch {return false;}
}

export function jwkThumbprint(jwk) {
  requireGate(jwk?.kty === 'EC' && jwk?.crv === 'P-256' &&
    nonempty(jwk.x) && nonempty(jwk.y), 'INVALID_PROOF_KEY');
  return createHash('sha256').update(JSON.stringify({
    crv:'P-256',kty:'EC',x:jwk.x,y:jwk.y,
  })).digest('base64url');
}

function signedKeyHistory(historyToken, pinnedAuthorityJwk, issuer, now) {
  requireGate(pinnedAuthorityJwk, 'PINNED_TRUST_ROOT_REQUIRED');
  const statement = readJws(historyToken, 'numina-key-history+jwt');
  requireGate(verifySignature(statement,pinnedAuthorityJwk), 'KEY_HISTORY_SIGNATURE_INVALID');
  const history=statement.payload;
  requireGate(hasExactFields(history,historyFields) && history.iss === issuer &&
    history.aud === 'numina-payment-verifier' &&
    history.environment === 'production' &&
    Number.isSafeInteger(history.iat) && Number.isSafeInteger(history.exp) &&
    history.iat <= now && history.exp > now &&
    Array.isArray(history.keys) && history.keys.length > 0 &&
    history.keys.length <= 100, 'KEY_HISTORY_INVALID');
  return history.keys;
}

// The store MUST atomically consume the nonce and reserve the running-limit
// budget in durable storage. Reject a missing/stale/non-atomic adapter.
// The declared adapter capability is NOT independent proof of durability.
export async function verifyPaymentAuthorization(token, context) {
  const {issuer,audience,operator,payer,settlementEndpoint,recipient,asset,
    amountMinor,mandateId,policySha256,authorityPublicJwk,keyHistoryJws,
    proof,consumeAndReserve,nowSeconds=Math.floor(Date.now()/1000)} = context ?? {};
  requireGate([issuer,audience,operator,payer,settlementEndpoint,recipient,asset,
    amountMinor,mandateId].every(nonempty) && digest(policySha256) &&
    /^(?:[1-9]\d*)$/.test(amountMinor) &&
    Number.isSafeInteger(nowSeconds) && nowSeconds > 0, 'CONTEXT_INCOMPLETE');
  const keys = signedKeyHistory(keyHistoryJws,authorityPublicJwk,issuer,nowSeconds);
  const jws = readJws(token,'numina-payment-verdict+jwt');
  const v=jws.payload;
  requireGate(hasExactFields(v,verdictFields) &&
    hasExactFields(v.request,requestFields) &&
    hasExactFields(v.cnf,confirmationFields), 'UNKNOWN_OR_MALFORMED_CLAIM');
  requireGate(v.iss === issuer && v.aud === audience &&
    v.operator === operator && v.payer === payer &&
    v.mandate_id === mandateId && v.policy_sha256 === policySha256 &&
    v.request.recipient === recipient && v.request.asset === asset &&
    v.request.amount_minor === amountMinor &&
    v.request.settlement_endpoint === settlementEndpoint,
    'AUTHORIZATION_BINDING_MISMATCH');
  requireGate(v.decision === 'ALLOW' && nonempty(v.jti) &&
    nonempty(v.nonce) && typeof v.cnf.jwk_thumbprint === 'string',
    'VERDICT_NOT_ALLOWED');
  requireGate(Number.isSafeInteger(v.iat) && Number.isSafeInteger(v.nbf) &&
    Number.isSafeInteger(v.exp) && v.iat <= nowSeconds &&
    v.nbf <= nowSeconds && v.exp > nowSeconds &&
    v.exp - v.iat <= 300, 'VERDICT_TIME_INVALID');
  const matchingKeys = keys.filter(k => k.kid === jws.header.kid &&
    Number.isSafeInteger(k.validFrom) && Number.isSafeInteger(k.validUntil) &&
    k.validFrom <= v.iat && k.validUntil >= v.exp &&
    (k.revokedAt == null || nowSeconds < k.revokedAt));
  requireGate(matchingKeys.length === 1 && matchingKeys[0].publicJwk,
    'SIGNING_KEY_NOT_IN_VERIFIED_HISTORY');
  requireGate(verifySignature(jws,matchingKeys[0].publicJwk),
    'VERDICT_SIGNATURE_INVALID');

  // Proof of possession signs this exact receipt hash, intended endpoint,
  // nonce, and HTTP method; a stolen bearer verdict alone cannot pass.
  requireGate(proof && proof.method === 'POST' && proof.endpoint === settlementEndpoint &&
    proof.nonce === v.nonce && nonempty(proof.signature) &&
    proof.publicJwk && jwkThumbprint(proof.publicJwk) === v.cnf.jwk_thumbprint,
    'PROOF_OF_POSSESSION_REQUIRED');
  const challenge = sha256(Buffer.from(token,'ascii')) + '\nPOST\n' +
    settlementEndpoint + '\n' + v.nonce;
  let proofValid = false;
  try {
    const bytes=decodeSegment(proof.signature);
    proofValid = bytes.length === 64 &&
      cryptoVerify('sha256',Buffer.from(challenge,'utf8'),
        {key:createPublicKey({key:proof.publicJwk,format:'jwk'}),
          dsaEncoding:'ieee-p1363'},bytes);
  } catch {proofValid=false;}
  requireGate(proofValid,'PROOF_OF_POSSESSION_INVALID');
  requireGate(consumeAndReserve &&
    consumeAndReserve.durability === 'PERSISTENT_ATOMIC' &&
    typeof consumeAndReserve.commit === 'function',
    'DURABLE_REPLAY_AND_LIMIT_STORE_REQUIRED');
  let consumed;
  try {
    consumed = await consumeAndReserve.commit({
      issuer, audience, operator, payer, mandateId, asset, nonce:v.nonce,
      jti:v.jti, amountMinor, expiresAt:v.exp,
    });
  } catch {reject('ATOMIC_CONSUMPTION_UNAVAILABLE');}
  requireGate(consumed === true,'REPLAY_OR_CUMULATIVE_LIMIT_DENIED');
  return Object.freeze({
    authorization: 'AUTHORIZED_TO_ATTEMPT',
    verdict: 'ALLOW',
    receiptSha256: sha256(Buffer.from(token,'ascii')),
    executionEstablished: false,
    finalityEstablished: false,
    complianceEstablished: false,
    reconciliationEstablished: false,
  });
}

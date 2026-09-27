import {NUMINA_PROCUREMENT_POLICY} from './procurement-policy.js';

// This library performs no network, storage, signing, reservation or purchase
// operations. A server adapter must load immutable records and trust anchors;
// no HTTP endpoint accepts caller evidence or caller-provided trust anchors.
const procurementRequestFields = ['requestId','requestVersion','workflowId','providerId','providerAccountId','category','amountMinor','currency'];
const procurementCommonFields = ['schema','type','evidenceId','bindingHash','issuedAt','expiresAt'];
const procurementId = value => typeof value === 'string' && value.length >= 1 && value.length <= 128 && /^[a-zA-Z0-9]/.test(value) && !/[^a-zA-Z0-9:._-]/.test(value);
function procurementExact(value, fields) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join('|') !== [...fields].sort().join('|')) throw Error('INVALID_RECORD_FIELDS');
}
function procurementCanonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return '[' + value.map(procurementCanonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+procurementCanonical(value[k])).join(',') + '}';
  throw Error('NONCANONICAL_RECORD');
}
async function procurementDigest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(procurementCanonical(value))))].map(x => x.toString(16).padStart(2,'0')).join('');
}
export async function procurementBinding(request) {
  procurementExact(request, procurementRequestFields);
  for (const key of ['requestId','workflowId','providerId','providerAccountId']) if (!procurementId(request[key])) throw Error('INVALID_REQUEST_IDENTITY');
  if (!Number.isSafeInteger(request.requestVersion) || request.requestVersion < 1) throw Error('INVALID_REQUEST_VERSION');
  if (typeof request.amountMinor !== 'string' || request.amountMinor.length > 30 || !/^[1-9]/.test(request.amountMinor) || /[^0-9]/.test(request.amountMinor)) throw Error('INVALID_AMOUNT');
  if (!NUMINA_PROCUREMENT_POLICY.currencies.includes(request.currency)) throw Error('INVALID_CURRENCY');
  if (!NUMINA_PROCUREMENT_POLICY.allowedCategories.includes(request.category)) throw Error('CATEGORY_NOT_ALLOWED');
  return procurementDigest({policy: NUMINA_PROCUREMENT_POLICY, request});
}
function procurementSignatureBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(value)) throw Error('INVALID_SIGNATURE');
  const bytes = Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'=='), c => c.charCodeAt(0));
  if (bytes.length !== 64) throw Error('INVALID_SIGNATURE');
  return bytes;
}
function procurementPublicMaterial(jwk) {
  try {
    if (jwk?.kty!=='OKP' || jwk.crv!=='Ed25519' || typeof jwk.x!=='string' || jwk.x.length!==43 || Object.hasOwn(jwk,'d')) return null;
    const raw=atob(jwk.x.replace(/-/g,'+').replace(/_/g,'/')+'=');
    if (raw.length!==32 || btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==jwk.x) return null;
    return jwk.x;
  } catch { return null; }
}
export function createProcurementProjector({ownerKeyId = null, keys = {}, providerKeyIds = {}, clock = () => Math.floor(Date.now()/1000)} = {}) {
  // Configuration is copied once from the trusted server, never from a request.
  const anchors = new Map(Object.entries(structuredClone(keys))), providers = new Map(Object.entries(structuredClone(providerKeyIds)));
  const publicMaterials = [...anchors.values()].map(procurementPublicMaterial), providerActors=new Set(providers.values());
  const validTrustConfiguration = typeof clock === 'function' && [...anchors.keys()].every(procurementId) && publicMaterials.every(Boolean) && new Set(publicMaterials).size===publicMaterials.length && !providerActors.has(ownerKeyId) && [...providerActors].every(id=>procurementId(id)&&anchors.has(id));
  return async function projectProcurement(records = {}) {
    const base = {schema:'numina.procurement-projection.v1', status:'DISABLED_BY_DEFAULT', eligibility:false, categoryEligible:false, permission:false, completed:false, historicallyAuthorized:false, procurement_usage:false, automaticPurchasing:false, executionPerformedByEvaluator:false, providerMutationPerformed:false, reasonCodes:[], evidence:[], validUntil:null};
    const result = (status, reason, extra={}) => ({...base, ...extra, status, reasonCodes:reason ? [reason] : []});
    try {
      procurementExact(records, ['request','approval','delegation','budget','providerAccess','receipt','revokedEvidenceIds','receiptBindings']);
      records = structuredClone(records);
      if (!validTrustConfiguration) return result('DISABLED_BY_DEFAULT','INVALID_TRUST_CONFIGURATION');
      const now = clock();
      if (!Number.isSafeInteger(now) || now < 0) throw Error('INVALID_TIME');
      if (!procurementId(ownerKeyId) || !anchors.has(ownerKeyId)) return result('DISABLED_BY_DEFAULT','TRUST_CONFIGURATION_REQUIRED');
      if (!Array.isArray(records.revokedEvidenceIds) || records.revokedEvidenceIds.some(x=>typeof x!=='string') || !Array.isArray(records.receiptBindings)) throw Error('INVALID_SERVER_RECORDS');
      const request = structuredClone(records.request), bindingHash = await procurementBinding(request);
      const evidence = [], ids = new Set(), providerKey = providers.get(JSON.stringify([request.providerId,request.providerAccountId]));
      const verify = async (envelope, type, fields, keyId, historical=false) => {
        procurementExact(envelope, ['keyId','payload','signature']);
        procurementExact(envelope.payload, [...procurementCommonFields, ...fields]);
        const p = envelope.payload;
        if (!procurementId(keyId) || envelope.keyId !== keyId || !anchors.has(keyId)) throw Error('UNTRUSTED_SIGNER');
        if (p.schema !== 'numina.procurement-evidence.v1' || p.type !== type || p.bindingHash !== bindingHash) throw Error('EVIDENCE_BINDING_MISMATCH');
        if (!procurementId(p.evidenceId) || ids.has(p.evidenceId)) throw Error('INVALID_EVIDENCE_ID');
        if (records.revokedEvidenceIds.includes(p.evidenceId)) throw Error('EVIDENCE_REVOKED');
        if (!Number.isSafeInteger(p.issuedAt) || !Number.isSafeInteger(p.expiresAt) || p.issuedAt < 0 || p.issuedAt > now || p.expiresAt <= p.issuedAt || (!historical && p.expiresAt <= now)) throw Error('EVIDENCE_EXPIRED_OR_FUTURE');
        const jwk = anchors.get(keyId);
        if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || Object.hasOwn(jwk,'d')) throw Error('INVALID_TRUST_ANCHOR');
        const key = await crypto.subtle.importKey('jwk', jwk, {name:'Ed25519'}, false, ['verify']);
        if (!await crypto.subtle.verify('Ed25519', key, procurementSignatureBytes(envelope.signature), new TextEncoder().encode(procurementCanonical(p)))) throw Error('INVALID_SIGNATURE');
        ids.add(p.evidenceId); evidence.push({id:p.evidenceId, hash:await procurementDigest(p)});
        return p;
      };
      // Historical completion evaluates evidence at the provider's signed time,
      // separately from current permission; no receipt can grant permission.
      let receipt = null;
      if (records.receipt) receipt = await verify(records.receipt,'provider_receipt',['providerReceiptId','idempotencyKey','status','occurredAt'],providerKey,true);
      const historical = receipt !== null;
      let approvalKey = ownerKeyId, delegation = null;
      if (records.delegation) {
        delegation = await verify(records.delegation,'delegation',['delegateKeyId'],ownerKeyId,historical);
        if (!procurementId(delegation.delegateKeyId) || delegation.delegateKeyId === ownerKeyId || providerActors.has(delegation.delegateKeyId) || !anchors.has(delegation.delegateKeyId)) throw Error('INVALID_DELEGATION');
        approvalKey = delegation.delegateKeyId;
      }
      const pending = (status, reason) => receipt ? result('UNAUTHORIZED_PROVIDER_ACTIVITY_OBSERVED',reason,{categoryEligible:true,evidence}) : result(status,reason,{categoryEligible:true,evidence});
      if (!records.approval) return pending('AWAITING_APPROVAL','APPROVAL_REQUIRED');
      const approval = await verify(records.approval,'approval',[],approvalKey,historical);
      if (!records.budget) return pending('AWAITING_BUDGET','BUDGET_REQUIRED');
      const budget = await verify(records.budget,'budget',['reservationId','state'],ownerKeyId,historical);
      if (!procurementId(budget.reservationId) || budget.state !== 'RESERVED') throw Error('BUDGET_NOT_RESERVED');
      if (!records.providerAccess) return pending('AWAITING_PROVIDER_ACCESS','PROVIDER_ACCESS_REQUIRED');
      const access = await verify(records.providerAccess,'provider_access',['capability'],providerKey,historical);
      if (access.capability !== 'MANUAL_DIRECT_PARTNERSHIP') throw Error('PROVIDER_CAPABILITY_MISMATCH');
      const requirements = [approval,budget,access,...(delegation?[delegation]:[])];
      const validUntil = Math.min(...requirements.map(p=>p.expiresAt));
      if (delegation && approval.issuedAt < delegation.issuedAt) throw Error('APPROVAL_PREDATES_DELEGATION');
      if (!receipt) return result('READY_FOR_MANUAL_EXECUTION',null,{eligibility:true,categoryEligible:true,permission:true,evidence,validUntil});
      if (!['SETTLED','PENDING','FAILED','REVERSED'].includes(receipt.status) || !procurementId(receipt.providerReceiptId) || !procurementId(receipt.idempotencyKey) || !Number.isSafeInteger(receipt.occurredAt) || receipt.occurredAt > receipt.issuedAt) throw Error('INVALID_PROVIDER_RECEIPT');
      for (const used of records.receiptBindings) {
        procurementExact(used,['providerId','providerAccountId','providerReceiptId','idempotencyKey','bindingHash']);
        if (used.providerId===request.providerId && used.providerAccountId===request.providerAccountId && (used.providerReceiptId===receipt.providerReceiptId || used.idempotencyKey===receipt.idempotencyKey) && used.bindingHash!==bindingHash) throw Error('PROVIDER_RECEIPT_REUSED');
      }
      if (requirements.some(p=>p.issuedAt>receipt.occurredAt || p.expiresAt<=receipt.occurredAt)) return result('UNAUTHORIZED_PROVIDER_ACTIVITY_OBSERVED','RECEIPT_OUTSIDE_AUTHORIZATION_WINDOW',{categoryEligible:true,evidence});
      if (receipt.status==='REVERSED') return result('REVERSED','PROVIDER_REVERSAL',{categoryEligible:true,evidence});
      if (receipt.status!=='SETTLED') return result('PROVIDER_RECEIPT_PENDING','SETTLED_PROVIDER_RECEIPT_REQUIRED',{categoryEligible:true,evidence});
      return result('COMPLETED_PROVIDER_CONFIRMED',null,{categoryEligible:true,historicallyAuthorized:true,completed:true,evidence});
    } catch (error) {
      const reason = /^[A-Z_]+$/.test(error.message) ? error.message : 'EVIDENCE_VERIFICATION_FAILED';
      return result(reason==='CATEGORY_NOT_ALLOWED'?'CATEGORY_NOT_ALLOWED':'EVIDENCE_INVALID',reason);
    }
  };
}

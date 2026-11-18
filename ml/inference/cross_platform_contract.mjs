/** Numina 5 cross-platform inference contract (nonproduction).
 * Zero external dependencies. Clients must never supply trusted identity headers.
 */
export const CONTRACT_VERSION = "numina.inference.v1";
const surfaces = new Set(["web","ios","android","desktop","api","agent","multimodal"]);
const modalities = new Set(["text","image","audio","video"]);
export function validateInferenceRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("request must be an object");
  if (input.contract_version !== CONTRACT_VERSION) throw new Error("unsupported contract version");
  if (!surfaces.has(input.surface)) throw new Error("unsupported surface");
  if (!modalities.has(input.modality)) throw new Error("unsupported modality");
  if (typeof input.request_id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(input.request_id)) throw new Error("invalid request ID");
  if (typeof input.prompt !== "string" || input.prompt.length < 1 || input.prompt.length > 32768) throw new Error("invalid prompt");
  for (const forbidden of ["user_id","tenant_id","role","authorization","x-user-id","x-tenant-id","x-authenticated-user","trusted_identity"]) {
    if (Object.hasOwn(input, forbidden)) throw new Error("client asserted privileged identity: " + forbidden);
  }
  return Object.freeze({contract_version:CONTRACT_VERSION,surface:input.surface,modality:input.modality,request_id:input.request_id,prompt:input.prompt});
}
export async function dispatchInference(input, {principal, authorize, infer, receipt}) {
  const request = validateInferenceRequest(input);
  if (!principal?.subject || !principal?.tenant || principal.verified !== true) throw new Error("verified principal required");
  if (typeof authorize !== "function" || await authorize(principal, request) !== true) throw new Error("inference not authorized");
  if (typeof infer !== "function" || typeof receipt !== "function") throw new Error("inference and receipt adapters required");
  const start = performance.now();
  const result = await infer({request,principal});
  if (!result || typeof result.text !== "string" || !result.model_sha256 || !/^[a-f0-9]{64}$/.test(result.model_sha256)) throw new Error("invalid inference result or checkpoint digest");
  const evidence = await receipt({request_id:request.request_id,tenant:principal.tenant,model_sha256:result.model_sha256,elapsed_ms:performance.now()-start,status:"completed"});
  if (!evidence?.receipt_id) throw new Error("receipt required");
  return {contract_version:CONTRACT_VERSION,request_id:request.request_id,text:result.text,model_sha256:result.model_sha256,receipt_id:evidence.receipt_id};
}

// Secret redaction shared by the audit log, errors and console output.
// Values are never logged when their key looks secret, and token-shaped strings are masked anywhere.
const SECRET_KEY=/(^|_|-)(authorization|token|access_token|refresh_token|id_token|secret|client_secret|api_?key|password|passphrase|private_?key|code_verifier|cookie|session_?key|bearer)($|_|-)/i;
const SECRET_VALUE=[
  /\b(sk|rk|ek|pk|whsec)_(live|test)_[A-Za-z0-9]{6,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g
];
export function redactString(s,extra=[]){
  let out=String(s);
  for(const re of SECRET_VALUE)out=out.replace(re,'[REDACTED]');
  for(const v of extra)if(typeof v==='string'&&v.length>=6)out=out.split(v).join('[REDACTED]');
  return out;
}
export function redact(value,extra=[],depth=0){
  if(depth>20)return '[DEPTH]';
  if(typeof value==='string')return redactString(value,extra);
  if(Array.isArray(value))return value.map(v=>redact(v,extra,depth+1));
  if(value&&typeof value==='object'){
    const out={};
    for(const [k,v] of Object.entries(value))out[k]=isSecretKeyName(k)?'[REDACTED]':redact(v,extra,depth+1);
    return out;
  }
  return value;
}
export const isSecretKeyName=k=>SECRET_KEY.test(String(k).replace(/([a-z0-9])([A-Z])/g,'$1_$2'));

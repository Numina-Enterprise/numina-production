import {createHash,createPublicKey,verify as verifySignature,randomBytes,timingSafeEqual} from 'node:crypto';
const reject=code=>{throw Object.assign(new Error(code),{code});};
const requireGate=(v,c)=>{if(!v)reject(c);};
const nonempty=x=>typeof x==='string'&&x.length>0&&x.length<=1024;
const sha=x=>createHash('sha256').update(x).digest('hex');
function absoluteHttps(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.hash&&!u.username&&!u.password;}catch{return false;}}
function segment(value){requireGate(typeof value==='string'&&/^[A-Za-z0-9_-]+$/.test(value),'TOKEN_ENCODING_INVALID');const b=Buffer.from(value,'base64url');requireGate(b.toString('base64url')===value,'TOKEN_ENCODING_INVALID');return b;}
function parseUniqueJson(bytes) {
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const parsed=JSON.parse(source);
  let index=0;
  const whitespace=()=>{while(index<source.length && /[\x20\t\r\n]/.test(source[index]))index++;};
  function quoted() {
    requireGate(source[index]==='"','INVALID_JWS_JSON');
    const begin=index++;
    let escaped=false;
    while(index<source.length) {
      const ch=source[index++];
      if(ch==='"'&&!escaped) return JSON.parse(source.slice(begin,index));
      if(ch==='\\'&&!escaped){escaped=true;continue;}
      escaped=false;
    }
    reject('INVALID_JWS_JSON');
  }
  function scan(depth) {
    requireGate(depth<=32,'JWS_JSON_TOO_DEEP');
    whitespace();
    if(source[index]==='{') {
      index++;
      const keys=new Set();
      whitespace();
      if(source[index]==='}') {index++;return;}
      for(;;) {
        whitespace();
        const key=quoted();
        requireGate(!keys.has(key),'DUPLICATE_JWS_JSON_KEY');
        keys.add(key);
        whitespace();
        requireGate(source[index++]===':','INVALID_JWS_JSON');
        scan(depth+1);
        whitespace();
        const delimiter=source[index++];
        if(delimiter==='}')return;
        requireGate(delimiter===',','INVALID_JWS_JSON');
      }
    }
    if(source[index]==='[') {
      index++;
      whitespace();
      if(source[index]===']'){index++;return;}
      for(;;){
        scan(depth+1);
        whitespace();
        const delimiter=source[index++];
        if(delimiter===']')return;
        requireGate(delimiter===',','INVALID_JWS_JSON');
      }
    }
    if(source[index]==='"'){quoted();return;}
    const start=index;
    while(index<source.length&&!/[\x20\t\r\n,\]}]/.test(source[index])) index++;
    requireGate(index>start,'INVALID_JWS_JSON');
  }
  scan(0);
  whitespace();
  requireGate(index===source.length,'INVALID_JWS_JSON');
  return parsed;
}

/** Narrow RFC 9068 ES256 resource-server profile. Does not implement an issuer. */
export function verifyAccessToken(token, config, now=Math.floor(Date.now()/1000)) {
 requireGate(config&&absoluteHttps(config.issuer)&&absoluteHttps(config.resource)&&nonempty(config.kid)&&/^[a-f0-9]{64}$/.test(config.publicKeySpkiSha256||''),'TRUST_CONFIGURATION_REQUIRED');
 requireGate(Number.isSafeInteger(now)&&now>0,'CLOCK_INVALID');
 requireGate(typeof token==='string'&&token.length<=16384,'TOKEN_INVALID');
 const p=token.split('.');requireGate(p.length===3,'TOKEN_INVALID');
 let h,c,key,sig;try{h=parseUniqueJson(segment(p[0]));c=parseUniqueJson(segment(p[1]));sig=segment(p[2]);key=createPublicKey({key:config.publicJwk,format:'jwk'});}catch(error){if(error.code)throw error;reject('TOKEN_INVALID');}
 requireGate(h&&Object.keys(h).every(k=>['alg','typ','kid'].includes(k))&&h.alg==='ES256'&&h.typ==='at+jwt'&&h.kid===config.kid,'TOKEN_HEADER_INVALID');
 requireGate(key.asymmetricKeyType==='ec'&&key.asymmetricKeyDetails?.namedCurve==='prime256v1'&&sha(key.export({format:'der',type:'spki'}))===config.publicKeySpkiSha256,'PINNED_KEY_MISMATCH');
 requireGate(sig.length===64&&verifySignature('sha256',Buffer.from(p[0]+'.'+p[1]),{key,dsaEncoding:'ieee-p1363'},sig),'TOKEN_SIGNATURE_INVALID');
 requireGate(c&&c.iss===config.issuer&&c.aud===config.resource&&nonempty(c.sub)&&nonempty(c.client_id)&&nonempty(c.jti),'TOKEN_BINDING_INVALID');
 requireGate(Number.isSafeInteger(c.iat)&&Number.isSafeInteger(c.exp)&&c.iat<=now&&c.exp>now&&c.exp>c.iat&&c.exp-c.iat<=300&&(c.nbf===undefined||(Number.isSafeInteger(c.nbf)&&c.nbf<=now)),'TOKEN_TIME_INVALID');
 requireGate(typeof c.scope==='string'&&/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(c.scope),'TOKEN_SCOPE_INVALID');
 return Object.freeze({issuer:c.iss,subject:c.sub,clientId:c.client_id,resource:c.aud,scopes:Object.freeze(c.scope.split(' ')),tokenSha256:sha(token),expiresAt:c.exp});
}
export function protectedResourceMetadata({issuer,resource,scopes}) {
 requireGate(absoluteHttps(issuer)&&absoluteHttps(resource)&&Array.isArray(scopes)&&scopes.every(nonempty),'TRUST_CONFIGURATION_REQUIRED');
 return {resource,authorization_servers:[issuer],scopes_supported:[...scopes],bearer_methods_supported:['header']};
}
/** Authorization only. No provider tokens are forwarded and no tool is executed. */
export function authorizeTool({authorization,resource,tool},config,now) {
 requireGate(resource===config.resource,'RESOURCE_MISMATCH');
 requireGate(typeof authorization==='string'&&/^Bearer [A-Za-z0-9_.-]+$/.test(authorization),'AUTHENTICATION_REQUIRED');
 const actor=verifyAccessToken(authorization.slice(7),config,now);
 requireGate(Object.hasOwn(config.tools||{},tool),'TOOL_DENIED');
 const rule=config.tools[tool];
 requireGate(rule&&rule.readOnly===true&&typeof rule.scope==='string','LIVE_ACTION_NOT_ENABLED');
 requireGate(actor.scopes.includes(rule.scope),'INSUFFICIENT_SCOPE');
 return Object.freeze({decision:'ALLOW_READ_ONLY_ADAPTER',resource,tool,subjectSha256:sha(actor.issuer+'\n'+actor.subject),tokenSha256:actor.tokenSha256,executionEstablished:false,providerConnected:false});
}
export function createPkce() {
 const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url');
 return {verifier,state,challenge:createHash('sha256').update(verifier).digest('base64url'),method:'S256'};
}
/** Call before redeeming a code. Expected issuer comes from validated AS metadata. */
export function validateAuthorizationResponse(response,pending,now=Math.floor(Date.now()/1000)) {
 requireGate(pending&&absoluteHttps(pending.issuer)&&nonempty(pending.state)&&Number.isSafeInteger(pending.expiresAt)&&pending.expiresAt>now,'AUTH_REQUEST_EXPIRED');
 const actual=Buffer.from(String(response?.state||'')),expected=Buffer.from(pending.state);
 requireGate(actual.length===expected.length&&timingSafeEqual(actual,expected),'STATE_MISMATCH');
 if(pending.issuerParameterSupported===true||response.iss!==undefined)requireGate(response.iss===pending.issuer,'ISSUER_MISMATCH');
 requireGate(nonempty(response.code)&&!response.error,'AUTHORIZATION_FAILED');
 return {code:response.code,issuer:pending.issuer};
}


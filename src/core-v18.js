// HTTP adapter for the supplied Numina Core v1.8. Original Python source stays in vendor/.
// Integer quantities remain BigInt internally; signed canonical bytes are never rounded.
import {exact,encoder,unb64,decision,canonical} from './core.js';
import {DEMO_KEY} from './generated.js';
import {CORE_MANIFEST,CORE_CONTEXT} from './core-generated.js';
export {CORE_MANIFEST,CORE_CONTEXT};
const integerFields=['max_quantity_wei','max_price_usd_minor_per_eth','max_notional_usd_minor','issued_sequence','valid_until_sequence'];
const stringFields=['authorization_id','operation_id','principal_id','agent_id','mandate_id','asset','side','rail','nonce','dependency_root','pre_state_digest','constitution_digest','issuer_id'];
export function coreCanonical(o){return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+(typeof o[k]==='bigint'?String(o[k]):JSON.stringify(o[k]))).join(',')+'}';}
export function parseCoreCredential(raw){
 if(typeof raw!=='string'||raw.length>5000||!/^[\x20-\x7e]+$/.test(raw))throw Error('CORE_SCHEMA_INVALID');
 let offset=1;const c={},pattern=/"([a-z_]+)":("(?:[^"\\]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"|-?(?:0|[1-9][0-9]*))/y;
 if(raw[0]!=='{'||raw.at(-1)!=='}')throw Error('CORE_SCHEMA_INVALID');
 while(offset<raw.length-1){pattern.lastIndex=offset;const m=pattern.exec(raw);if(!m||Object.hasOwn(c,m[1]))throw Error('CORE_SCHEMA_INVALID');c[m[1]]=m[2][0]==='"'?JSON.parse(m[2]):BigInt(m[2]);offset=pattern.lastIndex;if(raw[offset]===',')offset++;else if(offset!==raw.length-1)throw Error('CORE_SCHEMA_INVALID');}
 if(!exact(c,[...integerFields,...stringFields].join(','))||coreCanonical(c)!==raw)throw Error('CORE_SCHEMA_INVALID');
 if(!integerFields.every(k=>typeof c[k]==='bigint'&&c[k]>=0n&&c[k]<10n**38n)||!stringFields.every(k=>typeof c[k]==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(c[k])))throw Error('CORE_SCHEMA_INVALID');
 return c;
}
export async function verifyCoreEac(packet,context=CORE_CONTEXT){
 let c;try{if(!exact(packet,'credentialJson,signatureHex,kid')||packet.kid!==DEMO_KEY.kid||!/^[0-9a-f]{128}$/.test(packet.signatureHex))throw 0;c=parseCoreCredential(packet.credentialJson);}catch{return decision('INVALID','CORE_SCHEMA_INVALID');}
 // Preserve the reference recognition/sequence/replay precedence. Context belongs to the server.
 if(c.issuer_id!==context.issuer)return decision('INVALID','UNRECOGNIZED_ISSUER');
 if(c.constitution_digest!==context.constitutionDigest)return decision('INVALID','UNRECOGNIZED_CONSTITUTION');
 if(c.rail!=='SIM_A')return decision('INVALID','UNRECOGNIZED_RAIL');
 if(BigInt(context.sequence)>c.valid_until_sequence)return decision('REVALIDATION_REQUIRED','EXPIRED');
 if(BigInt(context.sequence)-c.issued_sequence>32n)return decision('REVALIDATION_REQUIRED','STATUS_STALE');
 const pk=await crypto.subtle.importKey('jwk',DEMO_KEY.jwk,'Ed25519',false,['verify']);
 if(!await crypto.subtle.verify('Ed25519',pk,Uint8Array.from(packet.signatureHex.match(/../g),x=>parseInt(x,16)),encoder.encode(packet.credentialJson)))return decision('INVALID','INVALID_SIGNATURE');
 // Deployment profile narrows the reference: exact synthetic context, BUY/ETH and fixed bounds.
 if(c.issued_sequence>BigInt(context.sequence)||c.valid_until_sequence<c.issued_sequence)return decision('REVALIDATION_REQUIRED','SEQUENCE_INVALID');
 if(c.dependency_root!==context.dependencyRoot||c.pre_state_digest!==context.preStateDigest)return decision('REVALIDATION_REQUIRED','CONTEXT_CHANGED');
 if(c.asset!=='ETH'||c.side!=='BUY'||c.max_price_usd_minor_per_eth<=0n||c.max_notional_usd_minor>2000000n||c.max_quantity_wei*c.max_price_usd_minor_per_eth/1000000000000000000n>c.max_notional_usd_minor)return decision('INVALID','BOUNDS_DENIED');
 return {...decision('VALID_FOR_COMMIT','CORE_TEST_EAC_VALID'),coreVersion:'1.8.0',kernelDecision:'NOT_EVALUATED',commitAvailable:false,recognition:'reference EAC plus narrowing test profile; no core state transition'};
}
export function assessStability(input){
 if(!exact(input,'exposure,eligibleCollateral,settlementCapacity,maintenanceBps,callBufferBps,maxCallAmount')||!Object.values(input).every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000000000)||input.maintenanceBps>10000||input.callBufferBps>10000)throw {status:400,reason:'STABILITY_SCHEMA_INVALID'};
 const i=Object.fromEntries(Object.entries(input).map(([k,v])=>[k,BigInt(v)]));
 const required=(i.exposure*i.maintenanceBps+9999n)/10000n,support=i.eligibleCollateral+i.settlementCapacity,deficiency=required>support?required-support:0n,buffered=deficiency+(deficiency*i.callBufferBps+9999n)/10000n;
 return {coreVersion:'1.8.0',scope:'observation-only synthetic inputs',requiredSupport:Number(required),deficiency:Number(deficiency),state:deficiency===0n?'HEALTHY':support>0n?'CALL_REQUIRED':'DEFAULT_PENDING',proposedCallAmount:Number(buffered<i.maxCallAmount?buffered:i.maxCallAmount),authorityChanged:false,callIssued:false};
}

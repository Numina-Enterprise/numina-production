import {createHash} from 'node:crypto';

export const PROFILE='numina.telemetry.simulation-profile.v1';
export function requireThat(ok,code){if(!ok)throw new Error(code);}
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Restricted JSON canonicalization: finite numbers and well-formed Unicode only.
// This is independently scoped testbed code, not a replacement for Numina's core.
export function canonical(value,depth=0){
 requireThat(depth<32,'JSON_DEPTH');
 if(value===null||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='string'){requireThat(value.isWellFormed(),'INVALID_UNICODE');return JSON.stringify(value);}
 if(typeof value==='number'){requireThat(Number.isFinite(value),'INVALID_NUMBER');return JSON.stringify(value);}
 if(Array.isArray(value)){
  requireThat(Reflect.ownKeys(value).length===value.length+1,'INVALID_JSON_ARRAY');
  for(let i=0;i<value.length;i++)requireThat(Object.hasOwn(value,i),'INVALID_JSON_ARRAY');
  return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 }
 requireThat(value&&Object.getPrototypeOf(value)===Object.prototype,'INVALID_JSON_VALUE');
 return '{'+Object.keys(value).sort().map(k=>canonical(k,depth+1)+':'+canonical(value[k],depth+1)).join(',')+'}';
}

// Strict day-one CCSDS profile: v0 telemetry, no secondary header, no segmentation.
// Application payload is opaque; no command, mission format, CRC or link framing is inferred.
export function parseSpacePacket(bytes,{maxDataBytes=4096}={}){
 requireThat(Number.isInteger(maxDataBytes)&&maxDataBytes>=1&&maxDataBytes<=65536,'INVALID_LIMIT');
 requireThat(Buffer.isBuffer(bytes),'PACKET_BUFFER_REQUIRED');
 requireThat(bytes.length>=7,'PACKET_TRUNCATED');
 const id=bytes.readUInt16BE(0),seq=bytes.readUInt16BE(2),dataLength=bytes.readUInt16BE(4)+1;
 requireThat((id>>>13)===0,'PACKET_VERSION');
 requireThat(((id>>>12)&1)===0,'TELECOMMAND_UNSUPPORTED');
 requireThat(((id>>>11)&1)===0,'SECONDARY_HEADER_UNSUPPORTED');
 requireThat((seq>>>14)===3,'SEGMENTATION_UNSUPPORTED');
 requireThat((id&0x7ff)!==0x7ff,'IDLE_PACKET_UNSUPPORTED');
 requireThat(dataLength<=maxDataBytes,'PACKET_OVERSIZE');
 requireThat(bytes.length===6+dataLength,'PACKET_LENGTH_MISMATCH');
 return {resource:'record:telemetry:ccsds:apid:'+(id&0x7ff),payload:{profile:PROFILE,source:'ccsds',apid:id&0x7ff,sequence:seq&0x3fff,dataBytes:dataLength,inputSha256:hash(bytes),payloadSha256:hash(bytes.subarray(6))}};
}

export class SpacePacketStream{
 #buffer=Buffer.alloc(0);#failed=false;
 constructor({maxDataBytes=4096,maxChunkBytes=65536}={}){requireThat(Number.isInteger(maxDataBytes)&&maxDataBytes>=1&&maxDataBytes<=65536,'INVALID_LIMIT');requireThat(Number.isInteger(maxChunkBytes)&&maxChunkBytes>=6&&maxChunkBytes<=1048576,'INVALID_LIMIT');this.maxDataBytes=maxDataBytes;this.maxChunkBytes=maxChunkBytes;}
 push(chunk){
  requireThat(!this.#failed,'STREAM_FAILED');
  try{
   requireThat(Buffer.isBuffer(chunk)&&chunk.length<=this.maxChunkBytes,'CHUNK_OVERSIZE');
   this.#buffer=Buffer.concat([this.#buffer,chunk]);const records=[];
   while(this.#buffer.length>=6){
    const size=this.#buffer.readUInt16BE(4)+7;requireThat(size<=this.maxDataBytes+6,'PACKET_OVERSIZE');
    if(this.#buffer.length<size)break;
    records.push(parseSpacePacket(this.#buffer.subarray(0,size),{maxDataBytes:this.maxDataBytes}));this.#buffer=this.#buffer.subarray(size);
   }
   return records;
  }catch(error){this.#failed=true;this.#buffer=Buffer.alloc(0);throw error;}
 }
 finish(){requireThat(!this.#failed,'STREAM_FAILED');requireThat(this.#buffer.length===0,'STREAM_TRUNCATED');}
}

const text=(v,max=128)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v)&&v.isWellFormed();
function utc(value){
 requireThat(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value),'STAC_DATETIME');
 const time=Date.parse(value);requireThat(Number.isFinite(time),'STAC_DATETIME');
 // Date.parse normalizes impossible days; reject that behavior.
 requireThat(new Date(time).toISOString().slice(0,19)===value.slice(0,19),'STAC_DATETIME');return time;
}
function safeHref(value){requireThat(text(value,2048),'STAC_HREF');const u=new URL(value);requireThat(u.protocol==='https:'&&!u.username&&!u.password,'STAC_HREF');}
export function normalizeStac(item,{maxBytes=65536}={}){
 const serialized=canonical(item);requireThat(Buffer.byteLength(serialized)<=maxBytes,'STAC_OVERSIZE');
 requireThat(item.type==='Feature'&&item.stac_version==='1.1.0'&&text(item.id),'STAC_ITEM');
 requireThat(item.stac_extensions===undefined||(Array.isArray(item.stac_extensions)&&item.stac_extensions.length===0),'STAC_EXTENSIONS_UNSUPPORTED');
 requireThat(item.properties&&Object.getPrototypeOf(item.properties)===Object.prototype,'STAC_PROPERTIES');
 let time;
 if(item.properties.datetime===null){const start=utc(item.properties.start_datetime),end=utc(item.properties.end_datetime);requireThat(start<=end,'STAC_TIME_RANGE');time={start:item.properties.start_datetime,end:item.properties.end_datetime};}
 else{utc(item.properties.datetime);time={datetime:item.properties.datetime};}
 requireThat(Array.isArray(item.links)&&item.links.length<=32,'STAC_LINKS');
 for(const link of item.links){requireThat(link&&text(link.rel),'STAC_LINK');safeHref(link.href);}
 const collectionLinks=item.links.filter(l=>l.rel==='collection');
 requireThat(item.collection===undefined?collectionLinks.length===0:text(item.collection)&&collectionLinks.length>0,'STAC_COLLECTION');
 requireThat(item.assets&&Object.getPrototypeOf(item.assets)===Object.prototype&&Object.keys(item.assets).length<=16,'STAC_ASSETS');
 for(const [name,asset]of Object.entries(item.assets)){requireThat(text(name)&&asset&&Object.getPrototypeOf(asset)===Object.prototype,'STAC_ASSET');safeHref(asset.href);}
 if(item.geometry===null)requireThat(item.bbox===undefined,'STAC_NULL_GEOMETRY_BBOX');
 else{
  requireThat(item.geometry&&item.geometry.type==='Point','STAC_GEOMETRY_PROFILE');
  const p=item.geometry.coordinates,b=item.bbox;
  requireThat(Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90,'STAC_POINT');
  requireThat(Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<=b[2]&&b[1]<=b[3]&&b[0]>=-180&&b[2]<=180&&b[1]>=-90&&b[3]<=90,'STAC_BBOX');
  requireThat(p[0]>=b[0]&&p[0]<=b[2]&&p[1]>=b[1]&&p[1]<=b[3],'STAC_BBOX_CONTAINMENT');
 }
 return {resource:'record:telemetry:stac:'+hash(Buffer.from((item.collection||'')+'\n'+item.id)),payload:{profile:PROFILE,source:'stac',id:item.id,collection:item.collection??null,time,geometry:item.geometry,assetCount:Object.keys(item.assets).length,inputSha256:hash(serialized)}};
}

// Matches src/control.js normalizeRecord's resource + bounded string payload contract.
export function toCoreRecord(record){
 requireThat(record&&/^record:[a-zA-Z0-9_.:/-]+$/.test(record.resource)&&record.resource.length<=160,'CORE_RESOURCE');
 const payload=canonical(record.payload);requireThat(payload.length>0&&payload.length<=4000,'CORE_PAYLOAD');
 return {resource:record.resource,payload};
}

// The sequence rule is deliberately a stricter receiver policy, not a CCSDS mandate.
export class SequenceGuard{
 #last=new Map();
 inspect(record){
  if(record.payload.source!=='ccsds')return {decision:'ALLOW',reason:'validated_metadata'};
  const {apid,sequence}=record.payload,last=this.#last.get(apid);
  if(last===undefined){this.#last.set(apid,sequence);return {decision:'ALLOW',reason:'first_observation'};}
  const delta=(sequence-last+16384)%16384;
  if(delta===0)return {decision:'DENY',reason:'duplicate_sequence'};
  if(delta>=8192)return {decision:'DENY',reason:'out_of_order_sequence'};
  this.#last.set(apid,sequence);
  return delta===1?{decision:'ALLOW',reason:'continuous_sequence'}:{decision:'ESCALATE',reason:'sequence_gap'};
 }
}

export class MemoryBucket {
 constructor(){this.objects=new Map();this.calls=0;this.failPut=false;this.failAfterPut=false;this.failList=false;}
 meta(key,item){return {key,size:item.bytes.byteLength,etag:'test-etag',uploaded:new Date(),customMetadata:structuredClone(item.options.customMetadata),httpMetadata:structuredClone(item.options.httpMetadata)};}
 async head(key){this.calls++;const item=this.objects.get(key);return item?this.meta(key,item):null;}
 async put(key,bytes,options){this.calls++;if(this.failPut)throw Error('Storage unavailable');if(this.objects.has(key)&&options.onlyIf)return null;const {onlyIf,...storedOptions}=options;const item={bytes:new Uint8Array(bytes),options:structuredClone(storedOptions)};this.objects.set(key,item);if(this.failAfterPut)throw Error('Response lost after write');return this.meta(key,item);}
 async get(key){this.calls++;const item=this.objects.get(key);return item?{...this.meta(key,item),body:new Response(item.bytes).body}:null;}
 async list({prefix,limit=50,cursor}){this.calls++;if(this.failList)throw Error('Storage unavailable');const keys=[...this.objects.keys()].filter(key=>key.startsWith(prefix)).sort(),start=Number(cursor||0),page=keys.slice(start,start+limit);return {objects:page.map(key=>this.meta(key,this.objects.get(key))),truncated:start+page.length<keys.length,cursor:String(start+page.length)};}
}

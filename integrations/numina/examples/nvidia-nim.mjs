import {NuminaClient} from '../src/index.js';
import {openAIChatRoundTrip} from './provider-roundtrips.mjs';

export const NUMINA_ORIGIN='https://numinalabs.xyz';
export function nimEndpoint(value){
 let url;try{url=new URL(value);}catch{throw Error('NVIDIA_NIM_ENDPOINT_REQUIRED');}
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!(url.protocol==='https:'||(url.protocol==='http:'&&local))||url.username||url.password||url.search||url.hash||!/^\/v1\/?$/.test(url.pathname))throw Error('NVIDIA_NIM_ENDPOINT_INVALID');
 return url.origin+'/v1';
}

// The host supplies its configured SDK factory; credentials stay in its closure.
// At most two model requests and one validated, read-only Numina tool batch.
export async function nvidiaNimRoundTrip({createProvider,endpoint,model,messages,maxTokens=512,toolNames,numinaFetch=globalThis.fetch}){
 const baseURL=nimEndpoint(endpoint);
 if(typeof model!=='string'||!model.trim()||model.length>256||/[\u0000-\u001f]/.test(model))throw Error('NVIDIA_NIM_MODEL_REQUIRED');
 if(typeof createProvider!=='function')throw Error('NVIDIA_NIM_CLIENT_FACTORY_REQUIRED');
 let bytes;try{bytes=Buffer.byteLength(JSON.stringify(messages),'utf8');}catch{throw Error('NVIDIA_NIM_MESSAGES_INVALID');}
 if(!Array.isArray(messages)||!messages.length||messages.length>32||bytes>65536)throw Error('NVIDIA_NIM_MESSAGES_INVALID');
 if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>4096)throw Error('NVIDIA_NIM_TOKEN_LIMIT_INVALID');
 const numina=new NuminaClient({baseUrl:NUMINA_ORIGIN,fetch:numinaFetch});
 // Checks the application shape and shared rc26 identity; no signature claim.
 await numina.release({});
 const client=createProvider({baseURL,maxRetries:0,timeout:15000});
 if(typeof client?.chat?.completions?.create!=='function')throw Error('NVIDIA_NIM_CLIENT_INVALID');
 const provider={chat:{completions:{create:request=>client.chat.completions.create({...request,max_tokens:maxTokens,stream:false})}}};
 return openAIChatRoundTrip({provider,numina,model:model.trim(),messages,toolNames});
}

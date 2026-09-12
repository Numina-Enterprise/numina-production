// One deadline covers connection, headers and JSON body reading. Never retry writes automatically.
export async function requestJson(path,{timeoutMs=15000,signal,...options}={}){
 const controller=new AbortController();let timer,onAbort;
 const abortError=()=>Object.assign(new Error('Request cancelled.'),{name:'AbortError',code:'REQUEST_CANCELLED'});
 try{
  return await Promise.race([
   new Promise((_,reject)=>{
    onAbort=()=>{controller.abort();reject(abortError());};
    if(signal?.aborted){onAbort();return;}
    signal?.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('The connection timed out.'),{name:'TimeoutError',code:'REQUEST_TIMEOUT'}));},timeoutMs);
   }),
   (async()=>{
    const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...options.headers}});
    if(response.redirected)throw Object.assign(new Error('Sign in again to refresh your records.'),{code:'SIGN_IN_REQUIRED',status:401});
    let value;try{value=await response.json();}catch(error){if(controller.signal.aborted)throw error;throw Object.assign(new Error('The service returned an unreadable response.'),{code:'INVALID_RESPONSE',status:response.status});}
    if(!response.ok)throw Object.assign(new Error(value?.error||'The request could not be completed.'),{code:value?.error,status:response.status});
    return value;
   })()
  ]);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}

export function createViewScope(){
 let generation=0,controller=new AbortController();
 return {get signal(){return controller.signal;},get generation(){return generation;},isCurrent(value){return value===generation;},reset(){generation++;controller.abort();controller=new AbortController();}};
}

const ADMIN_API='https://console.kaleido.io/api/v1';

function basic(username,password){
  return username&&password?'Basic '+Buffer.from(username+':'+password,'utf8').toString('base64'):null;
}
function directCandidates(values,pairs){
  const candidates=[];
  for(const value of values.filter(v=>typeof v==='string'&&v)){
    if(/^(?:Basic|Bearer) [\x21-\x7e]+$/.test(value)){candidates.push(value);continue;}
    try{
      if(/^https:\/\//i.test(value)){
        const u=new URL(value);const b=basic(decodeURIComponent(u.username),decodeURIComponent(u.password));if(b)candidates.push(b);
      }
    }catch{}
    try{
      if(/^\s*\{/.test(value)){
        const p=JSON.parse(value);const b=basic(p.username??p.user??p.id??p.appId,p.password??p.pass??p.secret);if(b)candidates.push(b);
        if(typeof p.authorization==='string'&&/^(?:Basic|Bearer) [\x21-\x7e]+$/.test(p.authorization))candidates.push(p.authorization);
      }
    }catch{}
    if(value.includes(':')&&!/^https:\/\//i.test(value))candidates.push(basic(value.slice(0,value.indexOf(':')),value.slice(value.indexOf(':')+1)));
    candidates.push('Bearer '+value,'Basic '+value);
  }
  for(const [username,password] of pairs){const b=basic(username,password);if(b)candidates.push(b);}
  return [...new Set(candidates.filter(Boolean))];
}
function adminTokens(values){
  const tokens=[];
  for(const value of values.filter(v=>typeof v==='string'&&v)){
    if(/^Bearer [\x21-\x7e]+$/.test(value))tokens.push(value.slice(7));
    try{
      if(/^\s*\{/.test(value)){
        const p=JSON.parse(value);
        for(const v of [p.apiKey,p.api_key,p.token,p.accessToken])if(typeof v==='string'&&v)tokens.push(v);
        if(typeof p.authorization==='string'&&/^Bearer [\x21-\x7e]+$/.test(p.authorization))tokens.push(p.authorization.slice(7));
      }
    }catch{}
    if(!/^https:\/\//i.test(value)&&!value.includes(':')&&!/^(?:Basic|Bearer) /.test(value))tokens.push(value);
  }
  return [...new Set(tokens)];
}
async function rpcProbe(endpoint,authorization,fetcher){
  const id=1;
  const response=await fetcher(endpoint,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','authorization':authorization},
    body:JSON.stringify({jsonrpc:'2.0',id,method:'eth_chainId',params:[]}),redirect:'error',signal:AbortSignal.timeout(15000)});
  const type=(response.headers.get('content-type')||'').toLowerCase();
  if(!response.ok||!/^application\/(?:json|json-rpc)(?:\s*;|$)/i.test(type))return false;
  let body;try{body=await response.json();}catch{return false;}
  return body?.jsonrpc==='2.0'&&body.id===id&&!body.error&&typeof body.result==='string';
}
async function adminRequest(token,path,{method='GET',body,fetcher}={}){
  const response=await fetcher(ADMIN_API+path,{method,headers:{accept:'application/json','content-type':'application/json',authorization:'Bearer '+token},
    ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('KALEIDO_ADMIN_API_REJECTED');
  if(response.status===204)return null;
  const type=(response.headers.get('content-type')||'').toLowerCase();
  if(!/^application\/json(?:\s*;|$)/i.test(type))throw Error('KALEIDO_ADMIN_API_RESPONSE_INVALID');
  return response.json();
}
async function bootstrap(token,endpoint,fetcher){
  const host=new URL(endpoint).hostname;
  const match=host.match(/^([a-z0-9]+)-([a-z0-9]+)-rpc\./i);
  if(!match)throw Error('KALEIDO_RPC_HOST_UNRECOGNIZED');
  const [,environmentId,nodeId]=match;
  const consortia=await adminRequest(token,'/consortia',{fetcher});
  if(!Array.isArray(consortia))throw Error('KALEIDO_CONSORTIA_INVALID');
  for(const consortium of consortia){
    const consortiumId=consortium?._id??consortium?.id;if(!consortiumId)continue;
    let environments;try{environments=await adminRequest(token,`/consortia/${consortiumId}/environments`,{fetcher});}catch{continue;}
    if(!Array.isArray(environments)||!environments.some(e=>(e?._id??e?.id)===environmentId))continue;
    let node;
    try{node=await adminRequest(token,`/consortia/${consortiumId}/environments/${environmentId}/nodes/${nodeId}`,{fetcher});}
    catch{
      const nodes=await adminRequest(token,`/consortia/${consortiumId}/environments/${environmentId}/nodes`,{fetcher});
      node=Array.isArray(nodes)?nodes.find(n=>(n?._id??n?.id)===nodeId):null;
    }
    const membershipId=node?.membership_id??node?.membershipId;
    if(!membershipId)throw Error('KALEIDO_NODE_MEMBERSHIP_UNAVAILABLE');
    const credential=await adminRequest(token,`/consortia/${consortiumId}/environments/${environmentId}/appcreds`,{
      method:'POST',body:{membership_id:membershipId},fetcher
    });
    const credentialId=credential?.id??credential?._id;
    const authorization=basic(credential?.username,credential?.password);
    if(!credentialId||!authorization)throw Error('KALEIDO_APP_CREDENTIAL_INVALID');
    let active=true;
    const cleanup=async()=>{
      if(!active)return;active=false;
      try{
        await adminRequest(token,`/consortia/${consortiumId}/environments/${environmentId}/appcreds/${credentialId}`,{method:'DELETE',fetcher});
      }catch{throw Error('KALEIDO_EPHEMERAL_CREDENTIAL_REVOKE_FAILED');}
    };
    if(!await rpcProbe(endpoint,authorization,fetcher)){await cleanup();throw Error('KALEIDO_APP_CREDENTIAL_RPC_REJECTED');}
    return {authorization,cleanup,mode:'ephemeral_app_credential'};
  }
  throw Error('KALEIDO_PINNED_ENVIRONMENT_NOT_FOUND');
}

export async function resolveRpcAuthorization({endpoint,directInputs=[],pairs=[],adminInputs=[],fetcher=globalThis.fetch,allowAdminBootstrap=true}){
  for(const authorization of directCandidates(directInputs,pairs)){
    try{if(await rpcProbe(endpoint,authorization,fetcher))return {authorization,cleanup:null,mode:'configured_app_credential'};}catch{}
  }
  if(allowAdminBootstrap){
    for(const token of adminTokens(adminInputs)){
      try{return await bootstrap(token,endpoint,fetcher);}catch(error){
        if(error?.message==='KALEIDO_EPHEMERAL_CREDENTIAL_REVOKE_FAILED')throw error;
      }
    }
  }
  throw Error('NUMINA_RPC_AUTHENTICATION_FAILED');
}

// Authorized production deployment trigger; no runtime behavior change.

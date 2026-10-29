import {validateConnectionManifest} from '../public/connection-model.js';

export async function readConnectionManifest(req,env){
  const response=await env.ASSETS.fetch(new Request(new URL('/security-surfaces.json',req.url),{method:'GET'}));
  if(!response.ok)throw Error('CONNECTION_MANIFEST_UNAVAILABLE');
  return validateConnectionManifest(await response.json());
}
export async function connectionsHttp(req,env){
  const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
  if(req.method!=='GET')return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405,headers:{...headers,Allow:'GET'}});
  if(new URL(req.url).search)return Response.json({error:'UNEXPECTED_PARAMETERS'},{status:400,headers});
  try{return Response.json(await readConnectionManifest(req,env),{headers});}
  catch{return Response.json({error:'CONNECTION_MANIFEST_UNAVAILABLE'},{status:503,headers});}
}

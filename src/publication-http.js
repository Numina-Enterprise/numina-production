import {controlActor} from './control-http.js';
import {readControl} from './control-store.js';
import {publicMetadata} from './public-privacy.js';
import {NUMINA_TREASURY_CONNECTION} from '../public/treasury-connection-model.js';
import {NUMINA_LAYERS} from '../public/architecture-layers.js';

export async function publicationHttp(req,env,privateArtifacts){
 const path=new URL(req.url).pathname,record=privateArtifacts[path];
 const headers={'Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Cloudflare-CDN-Cache-Control':'no-store','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff'};
 if(record){
  if(!['GET','HEAD'].includes(req.method))return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405,headers:{...headers,Allow:'GET, HEAD'}});
  try{
   const actor=await controlActor(req,env);
   if(env.NUMINA_REVIEW_SESSION===true||!env.NUMINA_CONTROL_OWNER||actor!==env.NUMINA_CONTROL_OWNER)return Response.json({error:'OWNER_VIEW_REQUIRED'},{status:403,headers});
   const current=await readControl(env.DB);
   if(current.manifest.root!==actor)return Response.json({error:'ROOT_CONFIGURATION_MISMATCH'},{status:503,headers});
   return new Response(req.method==='HEAD'?null:Uint8Array.from(atob(record.body),c=>c.charCodeAt(0)),{headers:{...headers,'Content-Type':record.type}});
  }catch(error){return Response.json({error:error.code??'OWNER_AUTH_UNAVAILABLE'},{status:[401,403].includes(error.status)?error.status:503,headers});}
 }
 if(!['GET','HEAD'].includes(req.method))return null;
 const model=path==='/api/treasury/v1/model'?NUMINA_TREASURY_CONNECTION:path==='/api/control/v2/architecture'?NUMINA_LAYERS:null;
 if(model)return new Response(req.method==='HEAD'?null:JSON.stringify(publicMetadata(model)),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 return null;
}

import {financialEvidenceHttp} from './financial-evidence.js';
import {reviewerHttp,reviewerContext} from './reviewer.js';
import {connectionsHttp} from './connections-http.js';
import {CORE_MANIFEST,CORE_CONTEXT} from './core-v18.js';
import {controlHttp,CONTROL_API_KEY_SHA256_PIN} from './control-http.js';
import {routeRc20} from './rc20.js';
import {routeRuntime} from './runtime-http.js';
import {appHttp} from './app-http.js';
import {nusdHttp} from './nusd-http.js';
import {frontierHttp} from './frontier-http.js';
import {numinaWebTelemetry} from './telemetry.js';
import {telemetryHttp} from './telemetry-http.js';
import {quantumHttp} from './quantum-http.js';
const security={"X-Numina-Version":"4.0.0","X-Numina-Profile":"numina-production","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=()","Strict-Transport-Security":"max-age=31536000","Content-Security-Policy":"default-src 'self'; script-src 'self' 'sha256-aYEMNzcsae3bOvwUaJFZmEVp6/1k57R95RqDhWRBin4='; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests"};

function response(body,status=200,extra={}){return new Response(JSON.stringify(body),{status,headers:{...security,'Content-Type':'application/json','Cache-Control':'no-store',...extra}});}
export default {
 async fetch(req,env){
  env={...env,NUMINA_CONTROL_API_KEY_SHA256:CONTROL_API_KEY_SHA256_PIN};
  const url=new URL(req.url),path=url.pathname;
  const span=path==='/api/ops/v1/telemetry'?{requestId:crypto.randomUUID(),finish(){}}:numinaWebTelemetry.begin({path,method:req.method,log:env.NUMINA_TELEMETRY_LOGS!=='false'});
  const requestId=span.requestId;let status=200;
  const finish=r=>{status=r.status;const headers=new Headers(r.headers);for(const [k,v]of Object.entries(security))headers.set(k,k==='Content-Security-Policy'&&path.startsWith('/api/control/v1/treasury-documents/')?"sandbox; default-src 'none'":v);if(!headers.get('Cache-Control')?.includes('no-store')&&!path.startsWith('/api/')&&!path.startsWith('/v1/')&&(path==='/app'||path==='/app.html'||path.endsWith('.js')))headers.set('Cache-Control','no-cache');headers.set('X-Request-Id',requestId);return new Response(r.body,{status:r.status,headers});};
  try{
   if(['numinalabs.xyz','www.numinalabs.xyz'].includes(url.hostname)&&url.protocol==='http:'){const target=new URL('https://'+url.hostname);target.pathname=path;target.search=url.search;return finish(new Response(null,{status:['GET','HEAD'].includes(req.method)?301:308,headers:{Location:target.href}}));}
   if(path==='/favicon.ico'){
    if(!['GET','HEAD'].includes(req.method))return finish(response({error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET, HEAD'}));
    return finish(new Response(null,{status:308,headers:{Location:'/favicon.svg'}}));
   }
   if(path.startsWith('/api/reviewer/v1/'))return finish(await reviewerHttp(req,env));
   if(path.startsWith('/api/')){
    const review=await reviewerContext(req,env);
    if(review?.error)return finish(review.error);
    if(review){req=review.req;env={...review.env,NUMINA_CONTROL_API_KEY_SHA256:CONTROL_API_KEY_SHA256_PIN};}

   }
   if(path.startsWith('/api/financial/v1/'))return finish(await financialEvidenceHttp(req,env));
   if(path==='/api/connections/v1/manifest')return finish(await connectionsHttp(req,env));
   if(path==='/api/ops/v1/telemetry')return finish(await telemetryHttp(req,env));
   if(path.startsWith('/api/ops/v1/quantum/'))return finish(await quantumHttp(req,env));
   // Retired public test surfaces stay closed even if an environment is misconfigured.
   if(path.startsWith('/api/v0.1/')||['/api/core/v1.8/eac/verify','/api/core/v1.8/stability/assess'].includes(path))return finish(response({error:'REFERENCE_RUNTIME_RETIRED',message:'Use the production workspace, internal authority controls or release documentation.',workspace:'/app',documentation:'/core'},410));
   if(path.startsWith('/api/control/v2/')||path==='/.well-known/agent-card.json')return finish(await frontierHttp(req,env));
   if(['/frontier','/frontier/','/control-room','/control-room/'].includes(path))return finish(await env.ASSETS.fetch(new Request(new URL('/frontier.html',req.url),req)));
   if(path.startsWith('/api/nusd/v1/'))return finish(await nusdHttp(req));
   if(path.startsWith('/api/app/v1/'))return finish(await appHttp(req,env));
   if(['/platform','/platform/','/platform.html'].includes(path))return finish(new Response(null,{status:308,headers:{Location:'/app'}}));
   if(['/pricing','/pricing/','/pricing.html'].includes(path)){
    if(!['GET','HEAD'].includes(req.method))return finish(response({error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET, HEAD'}));
    return finish(new Response(null,{status:308,headers:{Location:'/services'+url.search+'#pricing'}}));
   }
   if(['/v2/release/manifest','/v3/release/manifest','/v4/release/manifest'].includes(path)){
    if(!['GET','HEAD'].includes(req.method))return finish(response({error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET, HEAD'}));
    const artifact=await env.ASSETS.fetch(new Request(new URL('/downloads/application-release-v4.json',req.url),{method:req.method}));
    const headers=new Headers(artifact.headers);headers.set('Cache-Control','no-store');return finish(new Response(artifact.body,{status:artifact.status,headers}));
   }
   const runtime=await routeRuntime(req);if(runtime)return finish(runtime);
   if(path.startsWith('/v1/archive/rc20/')){
    const legacyUrl=new URL(req.url);legacyUrl.pathname='/v1/'+path.slice('/v1/archive/rc20/'.length);
    const legacy=await routeRc20(new Request(legacyUrl,req),env);if(legacy){const headers=new Headers(legacy.headers);headers.set('X-Numina-Release-Context','historical-rc20');return finish(new Response(legacy.body,{status:legacy.status,headers}));}
   }
   const rc20=await routeRc20(req,env);if(rc20)return finish(rc20);
   if(path.startsWith('/api/control/'))return finish(await controlHttp(req,env));
   if(path==='/api/core/v1.8/manifest'&&req.method==='GET')return finish(response(CORE_MANIFEST));
   if(path==='/api/core/v1.8/context'&&req.method==='GET')return finish(response(CORE_CONTEXT));
   if(path.startsWith('/api/'))return finish(response({error:'NOT_FOUND'},404));
   return finish(await env.ASSETS.fetch(req));
  }catch{return finish(response({error:'SERVICE_UNAVAILABLE',requestId},503));}
  finally{span.finish(status);}
 }
};

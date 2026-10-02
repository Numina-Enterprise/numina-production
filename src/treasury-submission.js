import {readFileSync} from 'node:fs';
import {readPrivateBankRoute} from './bank-route-config.js';
import {stable} from './control.js';
import {STRIPE_DEPOSIT_CAPABILITY} from './stripe-deposit-provider.js';
import {validateDepositRequest} from './treasury-deposit-store.js';

const record=JSON.parse(readFileSync(new URL('../release-evidence/treasury-submission-requests-2026-09-18.json',import.meta.url),'utf8'));

// The legacy Node surface forwards to the canonical owner-authenticated Worker.
// It never creates local receipts or a second idempotency store.
export async function treasurySubmissionHttp(req,res,{authorize=readPrivateBankRoute,fetcher=(...args)=>globalThis.fetch(...args)}={}){
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','private, no-store');
  res.setHeader('vary','Cookie, Authorization');
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('allow','GET, POST');
  const send=(status,body)=>{res.statusCode=status;return res.end(JSON.stringify(body));};
  if(!['GET','POST'].includes(req.method))return send(405,{error:'METHOD_NOT_ALLOWED'});
  if(req.method==='POST'&&!req.headers?.authorization&&!['https://numinalabs.xyz','https://www.numinalabs.xyz'].includes(req.headers?.origin)){
    return send(403,{error:'ORIGIN_REQUIRED',submissionPerformed:false});
  }
  try{await authorize(req);}
  catch(error){return send([401,403].includes(error.status)?error.status:503,{error:'OWNER_AUTH_UNAVAILABLE',submissionPerformed:false});}
  const key=new URL(req.url||'/','https://numinalabs.xyz').searchParams.get('idempotencyKey');
  if(req.method==='GET'&&!key)return send(200,{...record,depositWorkflow:STRIPE_DEPOSIT_CAPABILITY});
  const headers={Accept:'application/json'};
  for(const name of ['authorization','cookie','origin'])if(typeof req.headers?.[name]==='string')headers[name]=req.headers[name];
  // This is the Worker origin already used by the treasury/auth bridge. The
  // custom-domain Vercel rewrite would recurse back into this Node handler.
  const canonicalOrigin='https://personal-space-m7q9.skott34.chatgpt.site';
  if(headers.origin)headers.origin=canonicalOrigin;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    let body;
    if(req.method==='POST'){
      let input=req.body;
      if(input===undefined){let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>16384)throw Object.assign(Error(),{status:413});}input=JSON.parse(raw);}
      if(typeof input==='string')input=JSON.parse(input);
      validateDepositRequest(input);
      body=stable(input);if(Buffer.byteLength(body)>16384)throw Object.assign(Error(),{status:413});
      headers['Content-Type']='application/json';
    }
    const upstream=await fetcher(canonicalOrigin+'/api/treasury/v1/submissions'+(key?'?idempotencyKey='+encodeURIComponent(key):''),{method:req.method,headers,body,redirect:'manual',signal:controller.signal});
    if(upstream.redirected||upstream.status>=300&&upstream.status<400)throw Error('REDIRECT_REJECTED');
    const value=await upstream.json();return send(upstream.status,value);
  }catch(error){return send([400,403,409,413].includes(error.status)?error.status:503,{error:error.code??(error.status===413?'BODY_TOO_LARGE':'CANONICAL_DEPOSIT_WORKFLOW_UNAVAILABLE'),submissionPerformed:false,settled:false,receipt:null});}
  finally{clearTimeout(timer);controller.abort();}
}

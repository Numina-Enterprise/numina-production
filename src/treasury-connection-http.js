import {publicMetadata} from './public-privacy.js';
import {controlActor,controlBody} from './control-http.js';
import {readControl} from './control-store.js';
import {controlHash,controlError} from './control.js';
import {rateLimit} from './store.js';
import {STRIPE_DEPOSIT_CAPABILITY} from './stripe-deposit-provider.js';
import {readDepositIntent,prepareDepositInstructions,reconcileDeposit} from './treasury-deposit-store.js';
import {NUMINA_TREASURY_CONNECTION} from '../public/treasury-connection-model.js';
import {privateBankRouteConfiguration} from './bank-route-model.js';
import TREASURY_SUBMISSION_REQUESTS from '../release-evidence/treasury-submission-requests-2026-09-18.json' with {type:'json'};

export async function treasuryConnectionHttp(req,env,{authorize=controlActor,depositOptions={}}={}){
  const url=new URL(req.url),path=url.pathname;
  const send=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff'}});
  if(!['/api/treasury/v1/model','/api/treasury/v1/bank-route','/api/treasury/v1/submissions'].includes(path))return send({error:'NOT_FOUND'},404);
  if(req.method!=='GET'&&!(path==='/api/treasury/v1/submissions'&&req.method==='POST'))return send({error:'METHOD_NOT_ALLOWED'},405);
  if(path==='/api/treasury/v1/model')return send(publicMetadata(NUMINA_TREASURY_CONNECTION));
  if(req.method==='POST'&&!req.headers.has('authorization')&&req.headers.get('origin')!==new URL(req.url).origin)return send({error:'ORIGIN_REQUIRED',submissionPerformed:false},403);
  try{
    const actor=await authorize(req,env);
    if(env.NUMINA_REVIEW_SESSION===true||!env.NUMINA_CONTROL_OWNER||actor!==env.NUMINA_CONTROL_OWNER)return send({error:'OWNER_VIEW_REQUIRED'},403);
    if(path==='/api/treasury/v1/bank-route')return send(privateBankRouteConfiguration(env));
    if(req.method==='GET'&&!url.search)return send({...TREASURY_SUBMISSION_REQUESTS,depositWorkflow:STRIPE_DEPOSIT_CAPABILITY});
    if(!env.DB)controlError('DEPOSIT_STORAGE_UNAVAILABLE',503);
    const current=await readControl(env.DB);if(current.manifest.root!==actor)controlError('ROOT_CONFIGURATION_MISMATCH',503);
    if(!await rateLimit(env.DB,await controlHash('deposit:'+actor),Math.floor(Date.now()/1000)))controlError('RATE_LIMITED',429);
    if(req.method==='GET'){
      if([...url.searchParams.keys()].some(k=>k!=='idempotencyKey')||url.searchParams.getAll('idempotencyKey').length!==1)controlError('UNEXPECTED_PARAMETERS',400);
      return send({record:await readDepositIntent(env.DB,actor,url.searchParams.get('idempotencyKey'))});
    }
    if(url.search)controlError('UNEXPECTED_PARAMETERS',400);
    const body=await controlBody(req);
    if(body?.action==='submit')controlError('FUNDED_USD_SOURCE_AND_SUPPORTED_WRITE_PROVIDER_REQUIRED',409);
    const result=['prepare_external_funding','refresh_instructions'].includes(body?.action)?await prepareDepositInstructions(env.DB,actor,body,env,depositOptions):await reconcileDeposit(env.DB,actor,body,env,depositOptions);
    return send(result,result.replayed?200:201);
  }catch(error){return send({error:error.code??'OWNER_AUTH_UNAVAILABLE',submissionPerformed:false,settled:false,receipt:null},[400,401,403,404,408,409,413,415,429,502,503,504].includes(error.status)?error.status:503);}
}

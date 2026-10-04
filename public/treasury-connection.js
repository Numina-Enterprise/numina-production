import {NUMINA_TREASURY_CONNECTION as model,NUMINA_CANONICAL_TREASURY_VALUES as values,journalTreasuryMetadata} from './treasury-connection-model.js';
import {formatTreasuryModelWholeAmount,formatTreasuryProviderDisplayAmount} from './treasury-amount.js';
import {requestJson} from './http-client.js';
import {verifyTreasuryRecord} from './treasury-proof.js';

export function verifiedUsdcRoutes(record){
  if(record?.schema!=='numina.treasury.provider-routes.v1'||!(record.provider==='Stripe'||record.provider==='NUMINA'&&record.identity==='NUMINA'&&record.treasuryIdentity==='NUMINA'&&record.transportProvider==='Stripe')||record.connection!=='read_only'||
    record.canonical_treasury!==model.nativeJournal||!Array.isArray(record.routes)||record.routes.length>50||
    record.transfer_execution!==false||record.submission_performed!==false||record.receipt!==null||
    typeof record.observed_at!=='string'||!Number.isFinite(Date.parse(record.observed_at)))throw Error('Provider routes unavailable');
  return record.routes.filter(route=>route.currency==='usdc'&&route.settlement_currency==='usdc'&&
    route.status==='active'&&route.provider_reported_active===true).map(route=>{
      const evm=['ethereum','base','arbitrum','optimism','polygon','avalanche'].includes(route.network);
      const addressValid=evm?/^0x[0-9a-fA-F]{40}$/.test(route.address||''):route.network==='solana'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(route.address||'');
      if(!addressValid||
        !(route.memo===null||/^[A-Za-z0-9:._-]{1,256}$/.test(route.memo||'')))throw Error('Provider routes unavailable');
      return {address:route.address,network:route.network,memo:route.memo,observedAt:record.observed_at};
    });
}
export async function readConnectedTreasury({signal,request=requestJson,verify=verifyTreasuryRecord}={}){
  const native=await request(model.nativeJournal,{signal,timeoutMs:12000});
  if(!await verify(native,{allowUninitialized:true}))throw Error('Native treasury proof unavailable');
  const observed=await Promise.allSettled([
    request(model.providerBalances,{signal,timeoutMs:12000}),
    request(model.providerRoutes,{signal,timeoutMs:12000}),
    request(model.bankConfiguration,{signal,timeoutMs:12000})
  ]);
  const denied=observed.find(result=>result.status==='rejected'&&[401,403].includes(result.reason?.status));
  if(denied)throw denied.reason;
  return {native,stripe:observed[0].status==='fulfilled'?observed[0].value:null,bank:observed[2].status==='fulfilled'?observed[2].value:null,
    routes:observed[1].status==='fulfilled'?verifiedUsdcRoutes(observed[1].value):null};
}
const nativeHoldingText=unit=>unit==='NUSD'
  ?(typeof values.observation.projection?.balance==='string'?formatTreasuryModelWholeAmount(values.observation.projection.balance,'NUSD')+' · dated journal observation, revision '+values.observation.observedRevision:'See the owner-approved public journal summary')
  :formatTreasuryModelWholeAmount(values.components[unit].modeledTarget,unit)+' · historical allocation target; current and available balance unverified';
if(typeof document!=='undefined'&&document.getElementById('treasury-connection')){
  const element=id=>document.getElementById(id);
  const put=(id,text)=>{element(id).textContent=text;};
  for(const allocation of model.allocations)put(allocation.id+'-amount',formatTreasuryModelWholeAmount(allocation.amount,allocation.unit)+' · historical target');
  put('treasury-model-total',typeof values.observation.projection?.balance==='string'?formatTreasuryModelWholeAmount(values.observation.projection.balance,'NUSD')+' · dated native journal projection, revision '+values.observation.observedRevision:'See the owner-approved public journal summary');
  let controller,generation=0;
  const clear=()=>{put('native-connected-balance','Current treasury state unavailable');put('native-connected-proof','An authenticated current journal record is required. The dated snapshot is shown separately.');put('stripe-connected-balances',nativeHoldingText('USDC'));put('bank-connected-route',nativeHoldingText('USD'));element('stripe-connected-routes').replaceChildren();};
  async function refresh(){
    controller?.abort();controller=new AbortController();const current=++generation;clear();
    put('treasury-connection-status','Reading the owner-authenticated native journal and provider observations…');
    try{
      const result=await readConnectedTreasury({signal:controller.signal});
      if(current!==generation||controller.signal.aborted)return;
      const projection=result.native.projection;
      put('native-connected-balance',projection?.unit==='NUSD'?'Observed journal '+formatTreasuryModelWholeAmount(projection.balance,'NUSD'):'Journal not initialized');
      put('native-connected-proof','Journal verified · revision '+result.native.revision+' · '+(result.native.head??'No head'));
      const stripe=result.stripe;
      if(stripe?.schema==='numina.stripe.treasury.v1'&&stripe.account?.livemode===true){
        const amounts=['usd','usdc'].map(unit=>{const balance=stripe.balances?.available?.[unit];return balance?formatTreasuryProviderDisplayAmount(balance.value,unit):unit.toUpperCase()+' not reported';});
        put('stripe-connected-balances',nativeHoldingText('USDC')+' · provider observation '+amounts.join(' / ')+' · '+stripe.observed_at);
      }else put('stripe-connected-balances',nativeHoldingText('USDC')+' · provider observation unavailable');
      const bank=result.bank;
      put('bank-connected-route',nativeHoldingText('USD')+(bank?.schema==='numina.treasury.bank-route.v1'&&/^[0-9]{4}$/.test(bank.accountLast4)?' · linked savings ending '+bank.accountLast4:' · bank connection observation unavailable'));
      const routes=element('stripe-connected-routes');
      if(result.routes?.length)for(const route of result.routes){
        const item=document.createElement('p');item.textContent=route.network+' · '+route.address+(route.memo?' · memo '+route.memo:'')+' · observed '+route.observedAt;routes.append(item);
      }else{const item=document.createElement('p');item.textContent=result.routes?'No active USDC address reported':'Stripe route observation unavailable';routes.append(item);}
      const journal=journalTreasuryMetadata(projection);
      put('treasury-connection-status','NUMINA Native Treasury journal revision '+result.native.revision+' · '+journal.settlementStatus+' native settlement · '+(journal.submissionPerformed?'journal aggregate submission recorded':'no aggregate submission recorded in the journal')+'. USD and USDC allocation targets do not establish available provider funds.');
    }catch(error){
      if(current!==generation||controller.signal.aborted)return;clear();
      put('treasury-connection-status',[401,403].includes(error.status)?'Sign in as the owner to read private treasury balances and payment destinations.':'Treasury connection unavailable. No private balance or destination is being asserted. Refresh to retry.');
    }
  }
  element('refresh-treasury-connection').addEventListener('click',()=>void refresh());
  window.addEventListener('pagehide',()=>{generation++;controller?.abort();clear();});
  window.addEventListener('pageshow',event=>{if(event.persisted)void refresh();});
  void refresh();
}

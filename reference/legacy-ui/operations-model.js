'use strict';
const NuminaOperations=(()=>{
 const seed=[{id:'INV-2048',supplier:'Atlas Components',amount:84250,due:'Sep 14',po:'PO-7781 / received',beneficiary:'Verified',reason:'Three-way match complete. Eligible for dual review.',blocked:false,corridor:'EU'},{id:'INV-2049',supplier:'Meridian Freight',amount:18750,due:'Sep 15',po:'PO-7784 / disputed',beneficiary:'Verified',reason:'Carrier surcharge exceeds the agreed rate. Resolve the invoice exception before payment.',blocked:true,corridor:'EU'},{id:'INV-2050',supplier:'Pacific Materials',amount:125000,due:'Sep 16',po:'PO-7790 / received',beneficiary:'Verified',reason:'Amount exceeds the $100,000 per-instruction policy. Escalation is required; splitting to bypass the limit is not permitted.',blocked:true,corridor:'LATAM'},{id:'INV-2051',supplier:'Northline Packaging',amount:32400,due:'Sep 17',po:'PO-7793 / received',beneficiary:'Change pending',reason:'Supplier bank details changed. Independent verification is required before release.',blocked:true,corridor:'USA'},{id:'INV-2052',supplier:'Harbor Industrial',amount:42600,due:'Sep 18',po:'PO-7801 / received',beneficiary:'Verified',reason:'Three-way match complete. Eligible for dual review.',blocked:false,corridor:'USA'}];
 const routes=[{id:'bank',name:'Bank transfer',rate:.0015,fixed:25,window:'1–2 business days',description:'Existing banking route · modeled FX and handling'},{id:'stellar',name:'USDC / Stellar',rate:.0012,fixed:1.01,window:'Same day if payout is available',description:'Stablecoin route · modeled conversion, network and payout'},{id:'l2',name:'USDC / Ethereum L2',rate:.0014,fixed:1.15,window:'Same day if payout is available',description:'L2 route · modeled conversion, network and payout'}];
 class Model{
  constructor(){this.reset()}
  reset(){this.invoices=seed.map(x=>({...x,settled:false}));this.selected='INV-2048';this.route='bank';this.ap=false;this.treasury=false;this.halted=false;this.log=['Scenario loaded. Five synthetic invoices; no external connections.'];}
  get invoice(){return this.invoices.find(x=>x.id===this.selected)}
  select(id){if(!this.invoices.some(x=>x.id===id))throw Error('Unknown invoice');this.selected=id;this.clear();}
  clear(){this.ap=false;this.treasury=false;}
  choose(id){if(!routes.some(x=>x.id===id))throw Error('Unknown route');if(this.route!==id){this.route=id;this.clear();this.log.unshift('Route changed. Previous approvals invalidated.');}}
  approve(role,value){if(!['ap','treasury'].includes(role))throw Error('Unknown role');this[role]=Boolean(value);}
  fee(route){return this.invoice.amount*route.rate+route.fixed}
  release(){const i=this.invoice;let error=this.halted?'Circuit breaker active. No new instruction can proceed.':i.settled?'Duplicate blocked. This invoice is already reconciled.':i.blocked||i.amount>100000?'Payment blocked. '+i.reason:!this.ap||!this.treasury?'Both simulated approvals are required.':null;if(error){this.log.unshift(error);return {ok:false,message:error}}i.settled=true;this.clear();const message=i.id+' simulated settlement reconciled to '+i.po.split(' / ')[0]+'. No funds moved.';this.log.unshift(message);return {ok:true,message};}
 }
 return {Model,routes};
})();
if(typeof module!=='undefined')module.exports=NuminaOperations;

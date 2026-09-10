'use strict';
(()=>{
 const by=id=>document.getElementById(id),model=new NuminaOperations.Model(),money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
 const state=i=>i.settled?'Reconciled':i.blocked?'Exception':'Ready for review';
 function log(){by('ops-log').replaceChildren(...model.log.slice(0,8).map(text=>{const li=document.createElement('li');li.textContent=text;return li}));}
 function render(){
 const i=model.invoice,filter=by('ops-filter').value;
 by('ops-total').textContent=money(model.invoices.filter(x=>!x.settled).reduce((a,x)=>a+x.amount,0));
 by('ops-ready').textContent=model.invoices.filter(x=>!x.blocked&&!x.settled).length;
 by('ops-exceptions').textContent=model.invoices.filter(x=>x.blocked&&!x.settled).length;
 by('ops-invoices').replaceChildren();
 const rows=model.invoices.filter(x=>filter==='all'||filter==='ready'&&!x.blocked&&!x.settled||filter==='blocked'&&x.blocked&&!x.settled||filter==='settled'&&x.settled);
 for(const x of rows){const tr=document.createElement('tr');if(x.id===i.id)tr.className='selected-invoice';for(const value of [x.id+' / '+x.supplier,money(x.amount),x.due,state(x)]){const td=document.createElement('td');td.textContent=value;tr.append(td)}const cell=document.createElement('td'),button=document.createElement('button');button.className='small-button';button.textContent='Review';button.setAttribute('aria-label','Review '+x.id);button.setAttribute('aria-pressed',String(i.id===x.id));button.addEventListener('click',()=>{model.select(x.id);by('ops-status').textContent='Invoice selected. Both approvals cleared.';render()});cell.append(button);tr.append(cell);by('ops-invoices').append(tr)}
 if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='No invoices match this filter.';tr.append(td);by('ops-invoices').append(tr)}
 for(const [id,value] of Object.entries({'ops-id':i.id,'ops-supplier':i.supplier,'ops-amount':money(i.amount),'ops-match':i.po,'ops-beneficiary':i.beneficiary,'ops-reason':i.settled?'Reconciled in this simulation. Duplicate submission is blocked.':i.reason}))by(id).textContent=value;
 by('ops-routes').replaceChildren(...NuminaOperations.routes.map(r=>{const label=document.createElement('label');label.className='route-option';const input=document.createElement('input');input.type='radio';input.name='invoice-route';input.value=r.id;input.checked=r.id===model.route;input.addEventListener('change',()=>{model.choose(r.id);by('ops-status').textContent='Route selected. Both approvals cleared.';render()});const text=document.createElement('span'),name=document.createElement('b'),detail=document.createElement('small'),cost=document.createElement('strong');name.textContent=r.name;detail.textContent=r.description;cost.textContent=money(model.fee(r));text.append(name,detail);label.append(input,text,cost);return label}));
 const route=NuminaOperations.routes.find(x=>x.id===model.route);by('ops-fee').textContent=money(model.fee(route));by('ops-window').textContent=route.window;
 by('ops-ap').checked=model.ap;by('ops-treasury').checked=model.treasury;
 by('ops-release').textContent=model.halted?'Execution halted':i.settled?'Reconciled / duplicate protected':'Simulate settlement';log();
 }
 by('ops-filter').addEventListener('change',render);
 by('ops-ap').addEventListener('change',()=>model.approve('ap',by('ops-ap').checked));by('ops-treasury').addEventListener('change',()=>model.approve('treasury',by('ops-treasury').checked));
 by('ops-release').addEventListener('click',()=>{by('ops-status').textContent=model.release().message;render()});
 by('halt').addEventListener('change',()=>{model.halted=by('halt').checked;model.log.unshift(model.halted?'Global circuit breaker activated.':'Global circuit breaker released.');render()});
 by('ops-reset').addEventListener('click',()=>{model.reset();model.halted=by('halt').checked;by('ops-filter').value='all';by('ops-status').textContent='Scenario reset. Global circuit breaker setting preserved.';render()});
 render();
})();

import {COUNTRY_CODES} from './country-codes.js';
import {workspaceSignInUrl} from './workspace-session.js';
export function selectService(offers,href){
 const entry=new URL(href),requested=entry.searchParams.get('service');
 const current=({diagnostic:'diagnostic_enterprise',audit:'audit_enterprise'})[requested]??requested;
 const chosen=typeof current==='string'&&Object.hasOwn(offers,current)?current:Object.keys(offers)[0];
 const allowedAnchors=new Set(['#main','#request-form','#service-work','#runtime-release-title','#linux-runtime-build','#app-network-title','#native-treasury-panel','#stripe-treasury-panel','#app-treasury-title']);
 const anchor=allowedAnchors.has(entry.hash)?entry.hash:'#request-form';
 return {chosen,signInUrl:workspaceSignInUrl(href,'/app?service='+encodeURIComponent(chosen)+anchor)};
}
export function offerLabel(offer){
 return offer.requestOnly?offer.name+' · NUSD scope review':offer.name+' · '+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(offer.amount/100);
}
export function countryOptions(){const names=new Intl.DisplayNames(['en'],{type:'region'});return COUNTRY_CODES.map(code=>[code,names.of(code)]).sort((a,b)=>a[1].localeCompare(b[1],'en'));}

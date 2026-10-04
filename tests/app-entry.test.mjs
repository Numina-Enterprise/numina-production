import test from 'node:test';import assert from 'node:assert/strict';
import {selectService,countryOptions,offerLabel} from '../public/app-entry.js';
import {APP_OFFERS} from '../src/app-core.js';
test('only exact custom workspace hosts use the verified fixed hosted sign-in origin',()=>{
 for(const origin of ['https://numinalabs.xyz','https://www.numinalabs.xyz']){
  const link=new URL(selectService(APP_OFFERS,origin+'/app?service=audit&return_to=https://evil.test#service-work').signInUrl,origin);
  assert.equal(link.origin,'https://personal-space-m7q9.skott34.chatgpt.site');assert.equal(link.pathname,'/signin-with-chatgpt');assert.equal(link.searchParams.get('return_to'),'/app?service=audit_enterprise#service-work');
 }
 for(const origin of ['https://personal-space-m7q9.skott34.chatgpt.site','https://numina.test','https://numinalabs.xyz.evil.test']){
  const link=selectService(APP_OFFERS,origin+'/app?service=audit#service-work').signInUrl;
  assert.ok(link.startsWith('/signin-with-chatgpt?'));assert.equal(new URL(link,origin).origin,origin);
 }
});
test('paid service choice survives the authentication return path',()=>{for(const [requested,chosen] of [['diagnostic','diagnostic_enterprise'],['audit','audit_enterprise'],['diagnostic_enterprise','diagnostic_enterprise'],['audit_enterprise','audit_enterprise']]){const result=selectService(APP_OFFERS,'https://numinalabs.xyz/app?service='+requested);assert.equal(result.chosen,chosen);const returnTo=new URL(result.signInUrl,'https://numinalabs.xyz').searchParams.get('return_to');assert.equal(returnTo,'/app?service='+chosen+'#request-form');assert.equal(selectService(APP_OFFERS,new URL(returnTo,'https://numinalabs.xyz')).chosen,chosen);}});
test('NUSD intake retains service selection and never displays a zero-dollar price',()=>{for(const service of ['authorization_check','result_access','workflow_delivery']){assert.match(offerLabel(APP_OFFERS[service]),/NUSD scope review/);assert.doesNotMatch(offerLabel(APP_OFFERS[service]),/\$/);const selected=selectService(APP_OFFERS,'https://numinalabs.xyz/app?service='+service);assert.equal(selected.chosen,service);assert.match(decodeURIComponent(selected.signInUrl),new RegExp('service='+service));}assert.match(offerLabel(APP_OFFERS.diagnostic_enterprise),/\$5,000/);assert.match(offerLabel(APP_OFFERS.audit_enterprise),/\$25,000/);});
test('unrecognized service and redirect input cannot change the sign-in destination',()=>{for(const value of ['https://evil.test','__proto__','constructor','unknown']){const result=selectService(APP_OFFERS,'https://numinalabs.xyz/app?service='+encodeURIComponent(value)+'&return_to=https://evil.test');assert.equal(result.chosen,'diagnostic_enterprise');assert.equal(new URL(result.signInUrl,'https://numinalabs.xyz').origin,'https://personal-space-m7q9.skott34.chatgpt.site');assert.equal(new URL(result.signInUrl,'https://numinalabs.xyz').searchParams.get('return_to'),'/app?service=diagnostic_enterprise#request-form');}});
test('authentication keeps allowed workspace deep links and rejects untrusted redirect context',()=>{
 for(const origin of ['https://numinalabs.xyz','https://personal-space-m7q9.skott34.chatgpt.site'])for(const hash of ['#request-form','#service-work','#linux-runtime-build','#native-treasury-panel']){
  const result=selectService(APP_OFFERS,origin+'/app?service=audit&return_to=https://evil.test'+hash);
  assert.equal(new URL(result.signInUrl,origin).searchParams.get('return_to'),'/app?service=audit_enterprise'+hash);
 }
 for(const hash of ['#https://evil.test','#unknown','#%2F%2Fevil.test']){
  const result=selectService(APP_OFFERS,'https://numinalabs.xyz/app?service=diagnostic'+hash);
  assert.equal(new URL(result.signInUrl,'https://numinalabs.xyz').searchParams.get('return_to'),'/app?service=diagnostic_enterprise#request-form');
 }
});
test('country selection uses distinct region codes with readable names',()=>{const countries=countryOptions();assert.equal(countries.length,249);assert.equal(new Set(countries.map(([code])=>code)).size,249);assert.equal(countries.find(([code])=>code==='US')[1],'United States');assert.equal(countries.find(([code])=>code==='GB')[1],'United Kingdom');for(const [code,name]of countries){assert.match(code,/^[A-Z]{2}$/);assert.ok(name.length>2);}});

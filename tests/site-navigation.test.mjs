import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/worker.js';
const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
const routes=['/app','/frontier','/economy','/services','/integrations','/build','/control','/labs'];
const institutionalPages=new Set(['index.html','government.html','financial-institutions.html','partners.html','developers.html','trust.html','uk-eu.html','mena.html','apac.html','contact.html']);
const institutionalRoutes=['/government','/financial-institutions','/partners','/developers','/trust','/contact'];

test('every website page shares the Numina design and complete primary navigation',()=>{
  for(const file of readdirSync(new URL('../public/',import.meta.url)).filter(name=>name.endsWith('.html'))){
    const html=read(file),header=html.match(/<header\b[^>]*>(.*?)<\/header>/s)?.[1];
    assert.ok(header,file);assert.match(header,/Intelligence in Motion/,file);
    if(institutionalPages.has(file)){
      assert.match(html,/href="\/enterprise.css"/,file);
      const nav=header.match(/<nav[^>]*aria-label="Main navigation"[^>]*>(.*?)<\/nav>/s)?.[1];
      assert.ok(nav,file+' Main navigation');
      assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(m=>m[1]),institutionalRoutes,file);
      assert.ok([...nav.matchAll(/aria-current="page"/g)].length<=1,file);
      assert.doesNotMatch(html,/<nav[^>]*aria-label="Mobile navigation"/,file);
      assert.doesNotMatch(html,/<a[^>]*href="(?:https:\/\/(?:www\.)?numinalabs.xyz)?\/pricing(?:["#?])/);
      continue;
    }
    if(!/href="\/motion.css"/.test(html)){
      assert.match(header,/<nav[^>]*aria-label="Main navigation"/,file);
      assert.doesNotMatch(html,/<a[^>]*href="(?:https:\/\/(?:www\.)?numinalabs.xyz)?\/pricing(?:["#?])/);
      continue;
    }
    for(const label of ['Main navigation','Mobile navigation']){
      const nav=header.match(new RegExp('<nav[^>]*aria-label="'+label+'"[^>]*>(.*?)</nav>','s'))?.[1];
      assert.ok(nav,file+' '+label);assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(m=>m[1]),routes,file);
      assert.equal([...nav.matchAll(/aria-current="page"/g)].length,1,file);
    }
    assert.doesNotMatch(html,/<a[^>]*href="(?:https:\/\/(?:www\.)?numinalabs.xyz)?\/pricing(?:["#?])/);
  }
  assert.notEqual(read('index.html'),read('frontier.html'));
  assert.match(read('index.html'),/class="service-pane"/);
  assert.match(read('index.html'),/Institutional digital-asset infrastructure/);
});

test('services and pricing combine scope, terms and the existing enterprise request routes once',()=>{
  const html=read('services.html');
  for(const id of ['pricing','book','implementation','delivery'])assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,1,id);
  for(const service of ['diagnostic_enterprise','audit_enterprise'])assert.equal([...html.matchAll(new RegExp('/app\\?service='+service+'#request-form','g'))].length,1,service);
  for(const text of ['$5,000','$25,000','International requests are reviewed before checkout','customer acceptance','Enterprise Integration','Frontier Program'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(read('sitemap.xml'),/numinalabs.xyz\/pricing/);
});

test('old pricing addresses preserve query parameters and direct readers to the combined page',async()=>{
  for(const path of ['/pricing','/pricing/','/pricing.html'])for(const method of ['GET','HEAD']){
    const response=await worker.fetch(new Request('https://numina.test'+path+'?ref=existing-link',{method}),{});
    assert.equal(response.status,308);assert.equal(response.headers.get('Location'),'/services?ref=existing-link#pricing');
  }
  const write=await worker.fetch(new Request('https://numina.test/pricing',{method:'POST',body:'unrelated data'}),{});
  assert.equal(write.status,405);assert.equal(write.headers.get('Location'),null);
});

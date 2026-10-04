import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/worker.js';
const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
const routes=['/app','/frontier','/economy','/services','/integrations','/build','/control','/labs'];
const mainRoutes=['/platform','/services','/integrations','/build','/app'];
const mainCurrent=new Set(['platform.html','services.html','integrations.html','build.html','app.html']);
const mobileCurrent=new Set(['frontier.html','economy.html','services.html','integrations.html','build.html','app.html','control.html','labs.html']);

test('every website page shares the Numina design and complete primary navigation',()=>{
  for(const file of readdirSync(new URL('../public/',import.meta.url)).filter(name=>name.endsWith('.html'))){
    const html=read(file),header=html.match(/<header\b[^>]*>(.*?)<\/header>/s)?.[1];
    assert.ok(header,file);assert.match(header,/Intelligence in Motion/,file);assert.match(html,/href="\/motion.css"/,file);
    for(const label of ['Main navigation','Mobile navigation']){
      const nav=header.match(new RegExp('<nav[^>]*aria-label="'+label+'"[^>]*>(.*?)</nav>','s'))?.[1];
      const landing=['index.html','frontier.html'].includes(file);
      const expected=label==='Main navigation'?(landing?['#platform',...mainRoutes.slice(1)]:mainRoutes):routes;
      assert.ok(nav,file+' '+label);assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(m=>m[1]),expected,file);
      const currentPages=label==='Main navigation'?mainCurrent:mobileCurrent;
      assert.equal([...nav.matchAll(/aria-current="page"/g)].length,Number(currentPages.has(file)),file+' '+label);
    }
    assert.doesNotMatch(html,/<a[^>]*href="(?:https:\/\/(?:www\.)?numinalabs.xyz)?\/pricing(?:["#?])/);
  }
  for(const page of ['index.html','frontier.html'])assert.match(read(page),/numina4-core\.webp/);
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


test('government and institutional contact links resolve to distinct descriptive destinations',()=>{
 const html=read('contact.html');
 for(const [id,title] of [['government','Government inquiries'],['institutions','Financial institution inquiries']]){
  assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,1);
  assert.match(html,new RegExp('<article id="'+id+'" tabindex="-1"><h3>'+title+'</h3>'));
 }
});

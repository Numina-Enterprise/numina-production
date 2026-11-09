import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/worker.js';
const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
const routes=['/services','/labs'];
const institutionalPages=new Set(['index.html','government.html','financial-institutions.html','partners.html','developers.html','trust.html','uk-eu.html','mena.html','apac.html','contact.html']);
const institutionalRoutes=['/government','/financial-institutions','/partners','/ecosystem','/developers','/trust','/contact'];

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
      assert.ok([...nav.matchAll(/aria-current="page"/g)].length<=1,file);
    }
    assert.doesNotMatch(html,/<a[^>]*href="(?:https:\/\/(?:www\.)?numinalabs.xyz)?\/pricing(?:["#?])/);
  }
  assert.notEqual(read('index.html'),read('frontier.html'));
  assert.match(read('index.html'),/class="service-pane"/);
  assert.match(read('index.html'),/Accountable intelligence/);
  for(const name of readdirSync(new URL('../public/',import.meta.url)).filter(n=>n.endsWith('.html'))){
    const html=read(name);
    assert.doesNotMatch(html,/1,500T|\b500T|NUSD|Numina USD|Bank of America|Stripe Treasury|treasury|designated account|block height|root fingerprint|production head|chatgpt\.site|Iowa, USA|S K Consulting|S\. ?K\. Consulting|United Nations|\bSDG\b|Sustainable Development Goals|humanitarian/i,name);
    // KYC/AML gate: no KYC, custody, deposit, yield or investment offers on public pages.
    assert.doesNotMatch(html,/\bKYC\b|\b(?:we|numina(?: labs)?)\s+(?:offer|offers|provide|provides)\s+[^.<]{0,40}\b(?:custody|custodial|deposits?|yields?|investments?)\b|\b(?:earn|guaranteed)\s+[^.<]{0,30}\b(?:yield|returns?|interest)\b|\d+(?:\.\d+)?\s?%\s?(?:APY|APR|yield|returns?)\b|\b(?:deposit|send|transfer)\s+(?:your\s+)?(?:funds|money|crypto|USD|USDC)\s+(?:to|with)\s+(?:us|numina)\b|\binvest\s+(?:with|in)\s+(?:us|numina)\b|\btoken\s+(?:sale|offering|presale)\b/i,name);
    assert.doesNotMatch(html,/href="\/(?:app|control|economy|blockchain|redemption|wallet-signing|financial-services|treasury|treasury-simulation|deployment-readiness|transfer-receipts|status)(?:[#?"])/,name);
  }
});

test('services and pricing combine scope, terms and the existing enterprise request routes once',()=>{
  const html=read('services.html');
  for(const id of ['pricing','book','implementation','delivery'])assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,1,id);
  assert.doesNotMatch(html,/\/app\?service=/);assert.ok(html.includes('href="/contact">Start a diagnostic')&&html.includes('href="/contact">Start an audit'));
  for(const text of ['$1,500','$7,500','International requests are reviewed before checkout','customer acceptance','Enterprise Integration','Frontier Program'])assert.ok(html.includes(text),text);
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

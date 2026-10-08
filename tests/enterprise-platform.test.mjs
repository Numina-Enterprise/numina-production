import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import source from '../src/worker.js';
import built from '../dist/server/index.js';

test('public platform routes serve the enterprise overview without entering an authenticated workspace', async () => {
  const html=readFileSync(new URL('../public/platform.html',import.meta.url),'utf8');
  for(const worker of [source,built]) for(const path of ['/platform','/platform/','/platform.html']) for(const method of ['GET','HEAD']) {
    const response=await worker.fetch(new Request('https://numinalabs.xyz'+path,{method}),{
      NUMINA_TELEMETRY_LOGS:'false',
      ASSETS:{fetch:async request => {
        assert.equal(new URL(request.url).pathname,'/platform.html');
        return new Response(method==='HEAD'?null:html,{headers:{'Content-Type':'text/html'}});
      }}
    });
    assert.equal(response.status,200,path+' '+method);
    assert.equal(response.headers.get('Location'),null);
    assert.equal(await response.text(),method==='HEAD'?'':html);
  }
});

import {MANIFEST_ROUTES,alignedApplication} from '../public/manifest-surface.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/numina-tree-ui.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
class Element{
 constructor(){this.children=[];this.handlers={};this.disabled=false;this.values={roomId:'product',objective:'Original objective',acceptanceCriteria:'Original criterion'};}
 append(...children){this.children.push(...children);this.lastChild=this.children.at(-1);}
 replaceChildren(...children){this.children=children;}
 addEventListener(name,handler){this.handlers[name]=handler;}
 querySelector(){return this.button??=new Element();}
 reset(){this.values={roomId:'product',objective:'',acceptanceCriteria:''};}
}
function harness(api){
 const elements=new Map(),events={},calls=[];
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 let generation=0,controller=new AbortController();const scope={get generation(){return generation;},get signal(){return controller.signal;},isCurrent:g=>g===generation,reset(){generation++;controller.abort();controller=new AbortController();}};
 const context=vm.createContext({MANIFEST_ROUTES,alignedApplication,document:{getElementById:get,createElement:()=>new Element(),addEventListener:(name,handler)=>events[name]=handler},window:{addEventListener(){}},crypto:{randomUUID:()=>String(calls.length)},FormData:class{constructor(form){this.values={...form.values};}get(key){return this.values[key];}},createViewScope:()=>scope,requestJson:(path,options)=>{calls.push({path,options});return api(path,options);}});
 vm.runInContext(source.replace(/^import .*;\n/gm,''),context);
 return {get,events,calls};
}
const publicTree={root:'NUMINA',rooms:[]};
test('owner access loss during state read cancels assignment and clears draft',async()=>{
 const state=deferred();const h=harness(path=>path.endsWith('/state')?state.promise:Promise.resolve(path.endsWith('/tasks')?{tasks:[]}:publicTree));await tick();
 const form=h.get('tree-task-form');form.values={roomId:'product',objective:'Sensitive draft',acceptanceCriteria:'criterion'};
 const pending=form.handlers.submit({preventDefault(){},currentTarget:form});h.events['numina-owner-access-lost']();state.resolve({revision:4});await pending;
 assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(form.values.objective,'');assert.equal(form.hidden,true);
});
test('stale public response cannot reopen private task reads after access loss',async()=>{
 const publicRead=deferred();const h=harness(()=>publicRead.promise);h.events['numina-owner-access-lost']();publicRead.resolve(publicTree);await tick();
 assert.deepEqual(h.calls.map(call=>call.path).sort(),[MANIFEST_ROUTES.manifest,MANIFEST_ROUTES.release,'/api/control/v2/tree'].sort());assert.equal(h.calls.filter(call=>call.path.endsWith('/tasks')).length,0);assert.equal(h.get('tree-task-form').hidden,true);
});
test('submitted assignment preserves form values captured before awaiting revision',async()=>{
 const state=deferred();const h=harness(path=>path.endsWith('/state')?state.promise:Promise.resolve(path.endsWith('/tasks')?{tasks:[]}:publicTree));await tick();
 const form=h.get('tree-task-form');form.values={roomId:'product',objective:'Original objective',acceptanceCriteria:'Original criterion'};
 const pending=form.handlers.submit({preventDefault(){},currentTarget:form});form.values.objective='Later edit';state.resolve({revision:7});await pending;
 const write=h.calls.find(c=>c.options?.method==='POST');assert.ok(write);const body=JSON.parse(write.options.body);assert.equal(body.data.objective,'Original objective');assert.equal(body.expectedRevision,7);
});

'use strict';

const FRONTIER_SCHEMA='numina.frontier.v2';

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  for(const child of Object.values(value))freeze(child);
  return Object.freeze(value);
}
function requireObject(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${name} must be an object`);
  return value;
}
function createNumina({manifest,execute}){
  requireObject(manifest,'NUMINA manifest');
  if(typeof execute!=='function')throw new TypeError('execute must be a function');
  const numina=freeze(structuredClone(manifest));
  return freeze({
    schema:FRONTIER_SCHEMA,
    root:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',
    provider:'NUMINA',host:'NUMINA',provenance:'NUMINA',runtime:'NUMINA',deployment:'NUMINA',
    delivery:'NUMINA',readiness:'NUMINA',treasury:'NUMINA',transport:'NUMINA',
    receipts:'NUMINA',settlements:'NUMINA',funds:'NUMINA',confirmation_evidence:'NUMINA',
    manifest:numina,
    async execute(intent){
      requireObject(intent,'intent');
      const next=await execute(numina,structuredClone(intent));
      requireObject(next,'NUMINA');
      return createNumina({manifest:next,execute});
    }
  });
}
function projectLegacyRuntime(numina){
  requireObject(numina,'NUMINA');
  return freeze({
    schema:FRONTIER_SCHEMA,
    NUMINA:numina,
    compatibility:Object.freeze({root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',host:'NUMINA',provenance:'NUMINA',runtime:'NUMINA',deployment:'NUMINA',delivery:'NUMINA',readiness:'NUMINA',treasury:'NUMINA',transport:'NUMINA',receipts:'NUMINA',settlements:'NUMINA',funds:'NUMINA',confirmation_evidence:'NUMINA',canonical:true,legacy_projection_only:true})
  });
}
module.exports={FRONTIER_SCHEMA,createNumina,projectLegacyRuntime};

'use strict';

const FRONTIER_SCHEMA='numina.frontier.v1';

function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  for(const child of Object.values(value))freeze(child);
  return Object.freeze(value);
}

function requireObject(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${name} must be an object`);
  return value;
}

function createNumina({state,execute}){
  requireObject(state,'state');
  if(typeof execute!=='function')throw new TypeError('execute must be a function');
  const snapshot=freeze(structuredClone(state));
  return freeze({
    schema:FRONTIER_SCHEMA,
    state:snapshot,
    async execute(intent){
      requireObject(intent,'intent');
      const next=await execute(snapshot,structuredClone(intent));
      requireObject(next,'NUMINA');
      return createNumina({state:next,execute});
    }
  });
}

function projectLegacyRuntime(numina){
  requireObject(numina,'NUMINA');
  return freeze({
    schema:FRONTIER_SCHEMA,
    NUMINA:numina,
    // Compatibility is a projection of NUMINA, never a second authority.
    compatibility:Object.freeze({authority:'NUMINA',canonical:true})
  });
}

module.exports={FRONTIER_SCHEMA,createNumina,projectLegacyRuntime};

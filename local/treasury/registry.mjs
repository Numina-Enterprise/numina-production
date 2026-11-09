import {readFileSync} from 'node:fs';
export const REGISTRY=JSON.parse(readFileSync(new URL('./registry.json',import.meta.url),'utf8'));
export const TOOLS=new Map(REGISTRY.tools.map(t=>[t.name,Object.freeze({...t})]));
export const toolSpec=name=>{const t=TOOLS.get(name);if(!t)throw Object.assign(new Error(`unknown tool ${name}`),{code:'UNKNOWN_TOOL'});return t;};
export const isWrite=t=>t.access!=='read';
export const movesMoney=t=>t.movesMoney===true;

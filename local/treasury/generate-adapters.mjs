// Generates local/treasury/adapters/<tool>.mjs and adapters/index.mjs from registry.json.
// `--check` exits 1 when the generated files drift from the registry.
import {readFileSync,writeFileSync,existsSync,readdirSync,unlinkSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const registry=JSON.parse(readFileSync(path.join(here,'registry.json'),'utf8'));
const dir=path.join(here,'adapters');
const HEADER='// GENERATED from local/treasury/registry.json by local/treasury/generate-adapters.mjs. Do not edit by hand.\n';
const NAME=/^[a-z][a-z0-9_]{1,63}$/;
export function render(){
  const files={};
  for(const t of registry.tools){
    if(!NAME.test(t.name))throw new Error(`bad tool name ${t.name}`);
    files[`${t.name}.mjs`]=`${HEADER}// ${t.group}: ${t.description}\n// status: ${t.status} | access: ${t.access} | moves money: ${t.movesMoney===true?'yes':'no'} | Stripe human confirmation: ${t.stripeHumanConfirmation}\n// source: ${t.source}\nimport {makeAdapter} from '../adapter-core.mjs';\nexport default makeAdapter(${JSON.stringify(t.name)});\n`;
  }
  files['index.mjs']=HEADER+registry.tools.map((t,i)=>`import a${i} from './${t.name}.mjs';`).join('\n')+`\nexport const ADAPTERS=Object.freeze({${registry.tools.map((t,i)=>`${JSON.stringify(t.name)}:a${i}`).join(',')}});\n`;
  return files;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const files=render();const check=process.argv.includes('--check');let drift=[];
  mkdirSync(dir,{recursive:true});
  for(const [n,c] of Object.entries(files)){const f=path.join(dir,n);if(!existsSync(f)||readFileSync(f,'utf8')!==c){drift.push(n);if(!check)writeFileSync(f,c);}}
  for(const n of readdirSync(dir))if(!(n in files)){drift.push(n+' (stale)');if(!check)unlinkSync(path.join(dir,n));}
  if(check&&drift.length){console.error('adapters out of date: '+drift.join(', '));process.exit(1);}
  console.log(check?'adapters match registry':`generated ${Object.keys(files).length} files${drift.length?` (${drift.length} changed)`:''}`);
}

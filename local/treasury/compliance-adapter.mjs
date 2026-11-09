// Compliance screening adapter. Per Sam's 2026-11-09 09:45 CST instruction the result is
// INFORMATIONAL: it is recorded in the audit log and never blocks a call. If a local compliance
// module exists at local/compliance/index.mjs exporting screen({tool,profile,args}) (or gate()),
// it is used; otherwise the result is {status:"not_installed"}. Errors are recorded, not thrown.
import {existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function createComplianceAdapter({repo,module:injected}={}){
  let mod=injected;
  return async function screen(call){
    try{
      if(!mod){
        const entry=repo&&path.join(repo,'local/compliance/index.mjs');
        if(!entry||!existsSync(entry))return {status:'not_installed',blocking:false};
        mod=await import(pathToFileURL(entry).href);
      }
      const fn=mod.screen||mod.gate;
      if(typeof fn!=='function')return {status:'no_screen_export',blocking:false};
      const r=await fn(call);
      return {status:'screened',blocking:false,result:summarize(r)};
    }catch(e){return {status:'error',blocking:false,error:String(e?.message||e).slice(0,200)};}
  };
}
const summarize=r=>r&&typeof r==='object'?{pass:r.pass??r.ok??null,score:r.score??null,reasons:Array.isArray(r.reasons)?r.reasons.slice(0,10):undefined}:{value:r};

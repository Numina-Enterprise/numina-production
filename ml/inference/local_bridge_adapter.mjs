import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {dispatchInference} from "./cross_platform_contract.mjs";

/** Trusted-server adapter. Principal comes only from verified server auth. */
export function createLocalInference({principal,authorize,receipt,python="python3",bridge=resolve("ml/inference/numina_bridge.py"),timeoutMs=120000,spawnProcess=spawn}) {
  const infer=({request})=>new Promise((resolveResult,reject)=>{
    if(request.modality!=="text") return reject(new Error("local GGUF bridge supports text only"));
    const child=spawnProcess(python,[bridge],{stdio:["pipe","pipe","pipe"],shell:false,env:process.env});
    let stdout="",stderr="",finished=false;
    const timer=setTimeout(()=>child.kill("SIGKILL"),timeoutMs);
    const finish=(err,result)=>{if(finished)return;finished=true;clearTimeout(timer);err?reject(err):resolveResult(result)};
    child.on("error",e=>finish(e));
    child.stdout.on("data",chunk=>{stdout+=chunk;if(stdout.length>1048576)child.kill("SIGKILL")});
    child.stderr.on("data",chunk=>{stderr+=chunk;if(stderr.length>4096)stderr=stderr.slice(-4096)});
    child.on("close",code=>{
      if(code!==0)return finish(new Error("local inference bridge failed; exit "+code));
      try {
        const value=JSON.parse(stdout);
        if(value.error)throw new Error("inference bridge rejected request");
        finish(null,value);
      }catch(e){finish(e)}
    });
    child.stdin.on("error",()=>{});
    child.stdin.end(JSON.stringify({prompt:request.prompt,max_tokens:128}));
  });
  return request=>dispatchInference(request,{principal,authorize,infer,receipt});
}

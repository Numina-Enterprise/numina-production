import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import solc from 'solc';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..');
export function compileSource(sourceName,content,contractName){
  if(solc.version()!=='0.8.37+commit.f401782d.Emscripten.clang')throw Error('Compiler version mismatch');
  const settings={optimizer:{enabled:true,runs:200},evmVersion:'london',metadata:{bytecodeHash:'ipfs'},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','metadata']}}};
  const input={language:'Solidity',sources:{[sourceName]:{content}},settings};
  const output=JSON.parse(solc.compile(JSON.stringify(input),{import:name=>{
    if(!name.startsWith('@openzeppelin/contracts/')||name.split('/').includes('..'))return {error:'Unsupported import'};
    try{return {contents:fs.readFileSync(path.join(here,'node_modules',name),'utf8')}}catch{return {error:'Import missing'}};
  }}));
  const errors=output.errors?.filter(error=>error.severity==='error')??[];
  if(errors.length)throw Error(errors.map(error=>error.formattedMessage).join('\n'));
  const compiled=output.contracts[sourceName][contractName];
  return {schema:'numina.nusd.settlement-candidate.v1',contractName,sourceName,compiler:solc.version(),compilerSettings:settings,
    sourceSha256:createHash('sha256').update(content).digest('hex'),abi:compiled.abi,
    bytecode:'0x'+compiled.evm.bytecode.object,deployedBytecode:'0x'+compiled.evm.deployedBytecode.object,
    metadata:JSON.parse(compiled.metadata),dependencies:{'@openzeppelin/contracts':'5.4.0'}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const sourceName='contracts/NuminaSettlement.sol',source=fs.readFileSync(path.join(root,sourceName),'utf8');
  const artifact=compileSource(sourceName,source,'NuminaSettlement');
  fs.writeFileSync(path.join(root,'artifacts/NuminaSettlement.json'),JSON.stringify(artifact,null,2)+'\n');
  console.log('Compiled NuminaSettlement for London EVM; no network transaction.');
}

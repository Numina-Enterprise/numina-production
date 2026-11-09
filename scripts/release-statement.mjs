// Writes the in-toto Statement v1 for the current build (run after `npm run build`, on a clean
// commit). Subjects: every file in dist/client and dist/server. Usage:
//   node scripts/release-statement.mjs [--timestamp <ISO-8601>] [--out <path>]
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {ROOT,STATEMENT_TYPE,PREDICATE_TYPE,KEY_OWNER,collectSubjects,sourceTree,releasePaths,sha256,parseArgs} from './release-lib.mjs';
import {fileURLToPath} from 'node:url';

export function buildStatement({root=ROOT,timestamp=new Date().toISOString()}={}){
  const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
  return {_type:STATEMENT_TYPE,subject:collectSubjects(root),predicateType:PREDICATE_TYPE,predicate:{
    product:'numina-production',version,release:'numina-v'+version,builder:{id:'local'},timestamp,
    sourceTree:sourceTree(root,version),subjectRoots:['dist/client','dist/server'],
    keyLabel:KEY_OWNER+'-Ed25519',keyLabelNote:'A label only. A valid signature proves possession of the private key, not the identity of the holder.',
    excluded:['release-evidence/','dist/private-downloads/ (not published)'],
    attestation:'release-evidence/RELEASE-ATTESTATION.md'}};
}
export function writeStatement({root=ROOT,timestamp,out}={}){
  const statement=buildStatement({root,timestamp});
  const file=path.join(root,out||releasePaths(statement.predicate.version).statement);
  const bytes=Buffer.from(JSON.stringify(statement,null,2)+'\n');
  mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,bytes);
  return {file,sha256:sha256(bytes),subjects:statement.subject.length,sourceTree:statement.predicate.sourceTree};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2));
  const result=writeStatement({timestamp:args.timestamp?.[0],out:args.out?.[0]});
  console.log(JSON.stringify({statement:path.relative(ROOT,result.file),sha256:result.sha256,subjects:result.subjects,sourceTreeSha256:result.sourceTree.sha256,gitCommit:result.sourceTree.gitCommit},null,2));
}

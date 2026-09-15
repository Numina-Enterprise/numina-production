import {lstatSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

export function resetBuildOutput(projectDirectory){
  const project=realpathSync(projectDirectory),output=resolve(project,'dist');
  if(dirname(output)!==project)throw Error('Build output must be inside the project');
  const existing=lstatSync(output,{throwIfNoEntry:false});
  if(existing&&(!existing.isDirectory()||existing.isSymbolicLink()||realpathSync(output)!==output))throw Error('Build output must be a real project directory');
  // Only generated output is removed. Recursive removal does not follow child symlinks.
  rmSync(output,{recursive:true,force:true});
  mkdirSync(output,{recursive:true});
  return output;
}

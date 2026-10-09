// Compatibility entry point: the former mutable verifier is superseded.
// Positional output paths are refused; dated deployment receipts remain unchanged.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCurrentObservation} from './observe-current.mjs';
export {observeNusdCurrentState,runCurrentObservation} from './observe-current.mjs';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.exitCode=await runCurrentObservation({args:process.argv.slice(2)});
}

import {connectIBMQuantum} from '../src/ibm-quantum.js';
const result=await connectIBMQuantum(process.env);
console.log(JSON.stringify(result,null,2));
process.exitCode=result.connected?0:1;

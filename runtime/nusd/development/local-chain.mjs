import {fileURLToPath} from 'node:url';
import {createHardhatRuntimeEnvironment} from './node_modules/hardhat/dist/src/hre.js';

// Local in-process test chain only: no RPC listener, fork, external key or network.
const runtime=await createHardhatRuntimeEnvironment({
 networks:{local:{type:'edr-simulated',chainId:1337,hardfork:'london',accounts:{count:9},allowBlocksWithSameTimestamp:true,loggingEnabled:false}},
 solidity:'0.8.37'
},{},fileURLToPath(new URL('.',import.meta.url)));
export async function localChain(){
 const connection=await runtime.network.create('local');
 return {request:request=>connection.provider.request(request),disconnect:()=>connection.close()};
}

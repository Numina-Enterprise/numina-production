// Read-only verification of bridge deployment receipts and Base USDC liquidity.
// No signing, deployment, token transfer, or journal mutation.
import fs from 'node:fs';
import path from 'node:path';
import {JsonRpcProvider, Contract, getAddress, keccak256} from 'ethers';

const receiptDir=path.resolve(process.env.NUMINA_BRIDGE_RECEIPT_DIR||'');
if(!process.env.NUMINA_BRIDGE_RECEIPT_DIR)throw Error('NUMINA_BRIDGE_RECEIPT_DIR_REQUIRED');
const required=n=>{if(!process.env[n])throw Error(n+'_REQUIRED');return process.env[n];};
const EXPECTED={
  numina:{chainId:962421430,contract:'NuminaBaseBridgeEscrow',rpc:'NUMINA_RPC_URL',
    token:'0x491c1DF1b5CA77AF797f052c2310ca17039C931b'},
  base:{chainId:8453,contract:'NuminaBaseUSDCVault',rpc:'BASE_RPC_URL',
    token:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'}
};
const STRIPE='0x736BD8F274DCE00a8bB374EDd85DF0d2e631018e';
const REQUIRED_USDC=1500000000000000n*10n**6n;
const results={schema:'numina.bridge.read-only-verification.v1',checkedAt:new Date().toISOString(),
  expectedUSDCBaseUnits:REQUIRED_USDC.toString(),checks:[]};
for(const [name,cfg] of Object.entries(EXPECTED)){
  const file=path.join(receiptDir,name+'-'+cfg.contract+'.json');
  if(!fs.existsSync(file))throw Error('DEPLOYMENT_RECEIPT_MISSING_'+name.toUpperCase());
  const recorded=JSON.parse(fs.readFileSync(file,'utf8'));
  if(recorded.status!=='DEPLOYMENT_RECEIPT_CONFIRMED' ||
     recorded.chainId!==cfg.chainId || recorded.contract!==cfg.contract ||
     !/^0x[0-9a-f]{64}$/i.test(recorded.transactionHash||'')) {
    throw Error('INVALID_DEPLOYMENT_RECEIPT_'+name.toUpperCase());
  }
  const provider=new JsonRpcProvider(required(cfg.rpc),cfg.chainId);
  const chain=await provider.getNetwork();
  if(chain.chainId!==BigInt(cfg.chainId))throw Error('NETWORK_MISMATCH_'+name);
  const networkReceipt=await provider.getTransactionReceipt(recorded.transactionHash);
  if(!networkReceipt || networkReceipt.status!==1 ||
     getAddress(networkReceipt.contractAddress||'')!==getAddress(recorded.deploymentAddress)) {
    throw Error('ONCHAIN_DEPLOYMENT_RECEIPT_MISMATCH_'+name);
  }
  const contractAddress=getAddress(recorded.deploymentAddress);
  const code=await provider.getCode(contractAddress);
  if(code==='0x' || keccak256(code)!==recorded.runtimeKeccak256)throw Error('RUNTIME_HASH_MISMATCH_'+name);
  const abi=name==='base'
    ? ['function paused() view returns (bool)','function usdc() view returns (address)',
       'function STRIPE_TREASURY() view returns (address)']
    : ['function paused() view returns (bool)','function nusd() view returns (address)'];
  const contract=new Contract(contractAddress,abi,provider);
  const boundToken=getAddress(name==='base'?await contract.usdc():await contract.nusd());
  if(boundToken!==getAddress(cfg.token))throw Error('TOKEN_BINDING_MISMATCH_'+name);
  if(name==='base' && getAddress(await contract.STRIPE_TREASURY())!==getAddress(STRIPE))throw Error('STRIPE_BINDING_MISMATCH');
  const paused=await contract.paused();
  if(paused!==true)throw Error('CONTRACT_NOT_PAUSED_'+name.toUpperCase());
  const record={network:name,chainId:cfg.chainId,contractAddress,transactionHash:networkReceipt.hash,
    blockNumber:networkReceipt.blockNumber,receiptStatus:networkReceipt.status,
    runtimeKeccak256:keccak256(code),paused:true};
  if(name==='base'){
    const usdc=new Contract(cfg.token,['function balanceOf(address) view returns (uint256)'],provider);
    const vaultBalance=await usdc.balanceOf(contractAddress);
    record.vaultUSDCBaseUnits=vaultBalance.toString();
    record.requestedReleaseUSDCBaseUnits=REQUIRED_USDC.toString();
    record.fundedForRequestedRelease=vaultBalance>=REQUIRED_USDC;
  }
  results.checks.push(record);
}
const baseCheck=results.checks.find(check=>check.network==='base');
if(!baseCheck)throw Error('BASE_CHECK_MISSING');
results.status=baseCheck.fundedForRequestedRelease
  ? 'DEPLOYMENTS_CONFIRMED_LIQUIDITY_SUFFICIENT_NO_RELEASE'
  : 'DEPLOYMENTS_CONFIRMED_LIQUIDITY_INSUFFICIENT_NO_RELEASE';
console.log(JSON.stringify(results,null,2));

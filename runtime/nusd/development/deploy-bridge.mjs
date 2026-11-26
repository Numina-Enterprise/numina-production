// Controlled bridge deployment. Never mints, locks or releases tokens.
// Default: read-only preflight. --broadcast requires an encrypted local signer.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {JsonRpcProvider, Wallet, ContractFactory, Contract, getAddress, keccak256} from 'ethers';

const here=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(here,'../../..');
const nusdAddress='0x491c1DF1b5CA77AF797f052c2310ca17039C931b';
const usdcAddress='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const stripeAddress='0x736BD8F274DCE00a8bB374EDd85DF0d2e631018e';
const expectedGenesis='0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1';
const mode=process.argv.includes('--broadcast')?'broadcast':'preflight';
const network=process.argv.find(x=>x.startsWith('--network='))?.slice('--network='.length);
if(!['numina','base'].includes(network))throw Error('Specify --network=numina or --network=base');
const broadcasting=mode==='broadcast';
if(broadcasting && (!process.argv.includes('--confirm-new-deployment') || process.env.NUMINA_BRIDGE_BROADCAST!=='YES')) {
  throw Error('Broadcast requires --confirm-new-deployment and NUMINA_BRIDGE_BROADCAST=YES');
}
const required=name=>{const v=process.env[name];if(!v)throw Error('Missing '+name);return v;};
const address=name=>getAddress(required(name));
const sha256=data=>createHash('sha256').update(data).digest('hex');
const config=network==='numina'
  ? {chainId:962421430, rpc:'NUMINA_RPC_URL', name:'NuminaBaseBridgeEscrow',
     args:()=>[getAddress(nusdAddress),address('NUMINA_BRIDGE_ADMIN'),address('NUMINA_BRIDGE_OPERATOR'),
               address('NUMINA_BRIDGE_PAUSER'),BigInt(required('NUMINA_BRIDGE_ADMIN_DELAY_SECONDS'))],
     existing:'NUMINA_EXISTING_ESCROW'}
  : {chainId:8453, rpc:'BASE_RPC_URL', name:'NuminaBaseUSDCVault',
     args:()=>[address('BASE_VAULT_ADMIN'),address('BASE_VAULT_RELEASER'),
               address('BASE_VAULT_PAUSER'),BigInt(required('BASE_VAULT_ADMIN_DELAY_SECONDS'))],
     existing:'BASE_EXISTING_VAULT'};
const sourcePath=path.join(repoRoot,'runtime/nusd/contracts',config.name+'.sol');
const artifactPath=path.join(repoRoot,'runtime/nusd/artifacts',config.name+'.json');
const source=fs.readFileSync(sourcePath);
const artifactBytes=fs.readFileSync(artifactPath);
const artifact=JSON.parse(artifactBytes);
if(artifact.contractName!==config.name ||
   artifact.sourceSha256!==sha256(source) ||
   artifact.compiler!=='0.8.37+commit.f401782d.Emscripten.clang' ||
   artifact.compilerSettings?.optimizer?.runs!==200 ||
   artifact.compilerSettings?.evmVersion!=='london' ||
   !/^0x[0-9a-f]+$/i.test(artifact.bytecode)) {
  throw Error('Compiled artifact / source / compiler settings mismatch');
}
// RPC URLs must point at an owner-controlled authenticated gateway; never hardcode secrets.
const provider=new JsonRpcProvider(required(config.rpc),config.chainId,{staticNetwork:false});
const chain=await provider.getNetwork();
if(chain.chainId!==BigInt(config.chainId))throw Error('RPC_CHAIN_MISMATCH');
const genesis=await provider.getBlock(0);
if(!genesis?.hash)throw Error('MISSING_GENESIS');
if(network==='numina' && genesis.hash.toLowerCase()!==expectedGenesis)throw Error('NUMINA_GENESIS_MISMATCH');
const erc20=new Contract(network==='numina'?nusdAddress:usdcAddress,
  ['function decimals() view returns (uint8)','function balanceOf(address) view returns (uint256)',
   'function totalSupply() view returns (uint256)'],provider);
if((await provider.getCode(await erc20.getAddress()))==='0x')throw Error('TOKEN_CODE_MISSING');
if(Number(await erc20.decimals())!==(network==='numina'?18:6))throw Error('TOKEN_DECIMALS_MISMATCH');
const amountNusd=1500000000000000n * 10n**18n;
const amountUsdc=1500000000000000n * 10n**6n;
const args=config.args();
const existing=process.env[config.existing];
if(existing){
  const existingAddress=getAddress(existing);
  const code=await provider.getCode(existingAddress);
  if(code==='0x')throw Error('EXISTING_CONTRACT_CODE_MISSING');
  const deployed=new Contract(existingAddress,artifact.abi,provider);
  if(await deployed.paused()!==true)throw Error('EXISTING_CONTRACT_NOT_PAUSED');
  if(network==='numina'){
    if(getAddress(await deployed.nusd())!==getAddress(nusdAddress))throw Error('EXISTING_NUSD_BINDING_MISMATCH');
  }else{
    if(getAddress(await deployed.usdc())!==getAddress(usdcAddress) ||
       getAddress(await deployed.STRIPE_TREASURY())!==getAddress(stripeAddress)) {
      throw Error('EXISTING_BASE_BINDING_MISMATCH');
    }
  }
  if(broadcasting)throw Error('EXISTING_DEPLOYMENT_SET: refusing duplicate broadcast');
  console.log(JSON.stringify({status:'EXISTING_CONTRACT_OBSERVED_NOT_DEPLOYED_HERE',network,chainId:config.chainId,
    address:existingAddress,runtimeKeccak256:keccak256(code),paused:true,
    independentDeploymentReceiptRequired:true},null,2));
  process.exit(0);
}
const report={schema:'numina.bridge.deployment-preflight.v1',network,chainId:config.chainId,
  genesisHash:genesis.hash,contract:config.name,sourceSha256:sha256(source),
  artifactSha256:sha256(artifactBytes),constructorArgs:args.map(String),
  existingDeploymentChecked:false,expectedNusdBaseUnits:amountNusd.toString(),
  requiredUsdcBaseUnits:amountUsdc.toString(),stripeRecipient:stripeAddress,
  action:mode,sourceContractsUnchanged:true};
if(!broadcasting){
  console.log(JSON.stringify({...report,status:'PREFLIGHT_ONLY_NO_SIGN_NO_BROADCAST',
    needsSignerAndGasCheck:true,needsExistingDeploymentReconciliation:true,
    needsVerifiedUSDCVaultLiquidity:true},null,2));
  process.exit(0);
}
const keyfile=path.resolve(required('NUMINA_BRIDGE_KEYSTORE'));
if(!fs.statSync(keyfile).isFile())throw Error('KEYSTORE_NOT_FILE');
const signer=await Wallet.fromEncryptedJson(fs.readFileSync(keyfile,'utf8'),
  required('NUMINA_BRIDGE_KEYSTORE_PASSWORD'));
const wallet=signer.connect(provider);
if((await provider.getBalance(wallet.address))<=0n)throw Error('DEPLOYER_GAS_BALANCE_ZERO');
const factory=new ContractFactory(artifact.abi,artifact.bytecode,wallet);
const unsigned=await factory.getDeployTransaction(...args);
const gasEstimate=await provider.estimateGas({...unsigned,from:wallet.address});
if(gasEstimate<=0n)throw Error('INVALID_GAS_ESTIMATE');
const destDir=path.resolve(required('NUMINA_BRIDGE_RECEIPT_DIR'));
if(destDir===repoRoot || destDir.startsWith(repoRoot+path.sep))throw Error('RECEIPTS_MUST_REMAIN_OUTSIDE_REPOSITORY');
fs.mkdirSync(destDir,{recursive:true,mode:0o700});
const receiptPath=path.join(destDir,network+'-'+config.name+'.json');
if(fs.existsSync(receiptPath))throw Error('RECEIPT_EXISTS: refusing duplicate deployment');
console.error('Preflight successful; broadcasting '+config.name+' on chain '+config.chainId);
const contract=await factory.deploy(...args);
const tx=contract.deploymentTransaction();
if(!tx)throw Error('NO_DEPLOYMENT_TRANSACTION');
const receipt=await tx.wait(network==='numina'?12:3);
if(!receipt || receipt.status!==1)throw Error('DEPLOYMENT_RECEIPT_UNSUCCESSFUL');
const deployedAddress=await contract.getAddress();
const runtimeCode=await provider.getCode(deployedAddress);
if(runtimeCode==='0x')throw Error('DEPLOYED_CODE_MISSING');
const readback=new Contract(deployedAddress,artifact.abi,provider);
if(await readback.paused()!==true)throw Error('DEPLOYED_CONTRACT_NOT_PAUSED');
if(network==='numina'){
  if(getAddress(await readback.nusd())!==getAddress(nusdAddress))throw Error('DEPLOYED_NUSD_BINDING_MISMATCH');
}else{
  if(getAddress(await readback.usdc())!==getAddress(usdcAddress) ||
     getAddress(await readback.STRIPE_TREASURY())!==getAddress(stripeAddress)) {
    throw Error('DEPLOYED_BASE_BINDING_MISMATCH');
  }
}
const evidence={...report,status:'DEPLOYMENT_RECEIPT_CONFIRMED',deployer:wallet.address,
  deploymentAddress:deployedAddress,transactionHash:receipt.hash,blockNumber:receipt.blockNumber,
  receiptStatus:receipt.status,confirmationsRequested:network==='numina'?12:3,
  gasUsed:receipt.gasUsed.toString(),runtimeKeccak256:keccak256(runtimeCode),paused:true,
  tokenMintedByThisScript:false,treasuryTransferPerformed:false,usdcReleasePerformed:false};
fs.writeFileSync(receiptPath,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(evidence,null,2));

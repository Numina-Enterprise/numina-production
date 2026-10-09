import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from '../runtime/nusd/development/node_modules/ganache/dist/node/core.js';
import {BrowserProvider,ContractFactory,id} from '../runtime/nusd/development/node_modules/ethers/lib.esm/index.js';
import {compileSource} from '../runtime/nusd/development/compile.mjs';

const read=p=>fs.readFileSync(new URL('../runtime/nusd/'+p,import.meta.url),'utf8');
const escrow=JSON.parse(read('artifacts/NuminaBaseBridgeEscrow.json'));
const vault=JSON.parse(read('artifacts/NuminaBaseUSDCVault.json'));
const sent=async p=>(await p).wait();
const NUSD=10n**18n,USDC=10n**6n;
const STRIPE='0x736BD8F274DCE00a8bB374EDd85DF0d2e631018e';
const BASE_USDC='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const mock=compileSource('MockToken.sol',`// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MockToken is ERC20 {
 uint8 private immutable digits;
 constructor(uint8 d) ERC20("TEST","T") { digits=d; }
 function decimals() public view override returns(uint8){ return digits; }
 function seed(address to,uint amount) external { _mint(to,amount); }
}`,'MockToken','test.mock-token.v1');

test('Numina escrow maps 18-decimal NUSD to 6-decimal USDC exactly and prevents replay mutation',async t=>{
 const engine=ganache.provider({logging:{quiet:true},chain:{chainId:962421430,hardfork:'london'},wallet:{deterministic:true,totalAccounts:6}});
 t.after(()=>engine.disconnect());
 const provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});
 const s=await Promise.all(Array.from({length:6},(_,i)=>provider.getSigner(i)));
 const a=await Promise.all(s.map(x=>x.getAddress()));
 const deploy=async(artifact,args=[])=>{const c=await new ContractFactory(artifact.abi,artifact.bytecode,s[0]).deploy(...args);await c.waitForDeployment();return c;};
 const nusd=await deploy(mock,[18]); await sent(nusd.seed(a[4],2_000_000n*NUSD));
 const bridge=await deploy(escrow,[await nusd.getAddress(),a[0],a[1],a[2],0]);
 await sent(bridge.grantRole(await bridge.PARTICIPANT_ROLE(),a[4]));
 await sent(bridge.unpause());
 await sent(nusd.connect(s[4]).approve(await bridge.getAddress(),2_000_000n*NUSD));
 assert.equal(await bridge.quoteUsdc(1_500_000n*NUSD),1_500_000n*USDC);
 await sent(bridge.connect(s[4]).lock(id('deposit-1'),1_500_000n*NUSD,STRIPE));
 const d=await bridge.deposits(id('deposit-1'));
 assert.equal(d.usdcAmount,1_500_000n*USDC);
 assert.equal(d.status,1n);
 assert.equal(await nusd.balanceOf(await bridge.getAddress()),1_500_000n*NUSD);
 await assert.rejects(bridge.connect(s[4]).lock.staticCall(id('deposit-1'),1_400_000n*NUSD,STRIPE));
});

test('Base vault pins chain 8453, native USDC and Stripe recipient and releases pre-funded USDC idempotently',async t=>{
 const engine=ganache.provider({logging:{quiet:true},chain:{chainId:8453,hardfork:'london'},wallet:{deterministic:true,totalAccounts:6}});
 t.after(()=>engine.disconnect());
 const provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});
 const s=await Promise.all(Array.from({length:6},(_,i)=>provider.getSigner(i)));
 const a=await Promise.all(s.map(x=>x.getAddress()));
 const temp=await new ContractFactory(mock.abi,mock.bytecode,s[0]).deploy(6); await temp.waitForDeployment();
 const runtime=await provider.getCode(await temp.getAddress());
 const ok=await engine.request({method:'evm_setAccountCode',params:[BASE_USDC,runtime]});
 assert.notEqual(ok,false);
 const usdc=new (await import('../runtime/nusd/development/node_modules/ethers/lib.esm/index.js')).Contract(BASE_USDC,mock.abi,s[0]);
 await sent(usdc.seed(a[0],2_000_000n*USDC));
 const v=await new ContractFactory(vault.abi,vault.bytecode,s[0]).deploy(a[0],a[1],a[2],0); await v.waitForDeployment();
 await sent(usdc.transfer(await v.getAddress(),1_500_000n*USDC));
 await sent(v.unpause());
 const source=id('numina-lock-tx');
 await sent(v.connect(s[1]).release(id('deposit-1'),source,1_500_000n*USDC));
 assert.equal(await usdc.balanceOf(STRIPE),1_500_000n*USDC);
 const retry=await sent(v.connect(s[1]).release(id('deposit-1'),source,1_500_000n*USDC));
 assert.equal(retry.logs.length,0);
 await assert.rejects(v.connect(s[1]).release.staticCall(id('deposit-1'),id('changed'),1_500_000n*USDC));
});

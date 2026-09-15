import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import ganache from '../runtime/nusd/development/node_modules/ganache/dist/node/core.js';
import {BrowserProvider,ContractFactory,id,ZeroAddress} from '../runtime/nusd/development/node_modules/ethers/lib.esm/index.js';
import {loadTokenArtifact,validateTokenArtifact} from '../runtime/nusd/scripts/token-artifact.mjs';
import {compileSource} from '../runtime/nusd/development/compile.mjs';
const base=new URL('../runtime/nusd/',import.meta.url),read=path=>fs.readFileSync(new URL(path,base));
const token=loadTokenArtifact(),settlement=JSON.parse(read('artifacts/NuminaSettlement.json'));
const sent=async promise=>(await promise).wait();
async function fixture(t){
  const engine=ganache.provider({logging:{quiet:true},chain:{chainId:1337,hardfork:'london'},wallet:{deterministic:true,totalAccounts:8}});
  t.after(()=>engine.disconnect());const provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
  const people=await Promise.all(Array.from({length:7},(_,i)=>provider.getSigner(i))),addresses=await Promise.all(people.map(p=>p.getAddress()));
  const [admin,issuer,minter,pauser,payer,recipient,outsider]=people;
  async function deploy(artifact,args=[]){const result=await new ContractFactory(artifact.abi,artifact.bytecode,admin).deploy(...args);await result.waitForDeployment();return result;}
  const coin=await deploy(token,[1000000n,0n,addresses[4],...addresses.slice(0,4),0,id('local-test-policy')]);
  const payment=await deploy(settlement,[await coin.getAddress()]);
  async function mint(amount,reference=id('issuance')){const block=await provider.getBlock('latest');await sent(coin.connect(issuer).authorizeIssuance(reference,addresses[4],amount,block.timestamp+3600));await sent(coin.connect(minter).mintAuthorized(reference));}
  return {engine,provider,people,addresses,admin,issuer,minter,pauser,payer,recipient,outsider,coin,payment,mint,deploy};
}
test('retained token artifact pins exact source bytes; settlement rebuild matches its published bytecode',()=>{
  assert.equal(token.sourceSha256,createHash('sha256').update(read('contracts/NuminaUSD.sol')).digest('hex'));
  assert.throws(()=>validateTokenArtifact(read('artifacts/NuminaUSD.json'),Buffer.concat([read('contracts/NuminaUSD.sol'),Buffer.from(' ')])),/MISMATCH/);
  const compiled=compileSource('contracts/NuminaSettlement.sol',read('contracts/NuminaSettlement.sol').toString(),'NuminaSettlement');
  assert.deepEqual(compiled,settlement);
});
test('issuance enforces distinct roles, pause, bounded authorization, exact mint and supply cap',async t=>{
  const f=await fixture(t),{coin,addresses,issuer,minter,outsider,pauser}=f;
  assert.equal(await coin.totalSupply(),0n);assert.equal(await coin.decimals(),6n);assert.equal(await coin.paused(),true);
  await assert.rejects(coin.connect(outsider).unpause());await sent(coin.unpause());
  await assert.rejects(coin.grantRole(await coin.MINTER_ROLE(),addresses[1]));
  await assert.rejects(coin.connect(outsider).authorizeIssuance(id('bad'),addresses[4],1n,2000000000));
  const block=await f.provider.getBlock('latest');
  await sent(coin.connect(issuer).authorizeIssuance(id('first'),addresses[4],600000n,block.timestamp+300));
  await assert.rejects(coin.connect(issuer).authorizeIssuance(id('overflow'),addresses[4],500000n,block.timestamp+300));
  await assert.rejects(coin.connect(issuer).mintAuthorized(id('first')));
  await sent(coin.connect(minter).mintAuthorized(id('first')));assert.equal(await coin.authorizedSupply(),0n);
  await assert.rejects(coin.connect(minter).mintAuthorized(id('first')));
  await assert.rejects(coin.connect(issuer).authorizeIssuance(id('first'),addresses[4],1n,block.timestamp+300));
  await sent(coin.connect(f.payer).transfer(addresses[5],100n));assert.equal(await coin.balanceOf(addresses[5]),100n);
  await sent(coin.connect(pauser).pause());await assert.rejects(coin.connect(f.payer).transfer(addresses[5],1n));
  assert.equal(await coin.totalSupply(),600000n);
});
test('cancelled and expired authorizations release reservations without minting or reusing IDs',async t=>{
  const f=await fixture(t);await sent(f.coin.unpause());const time=(await f.provider.getBlock('latest')).timestamp;
  for(const name of ['cancel','expire'])await sent(f.coin.connect(f.issuer).authorizeIssuance(id(name),f.addresses[4],200n,time+10));
  await sent(f.coin.connect(f.pauser).cancelIssuance(id('cancel')));
  await f.engine.request({method:'evm_increaseTime',params:[11]});await f.engine.request({method:'evm_mine',params:[]});
  await assert.rejects(f.coin.connect(f.minter).mintAuthorized(id('expire')));
  await sent(f.coin.connect(f.outsider).expireIssuance(id('expire')));assert.equal(await f.coin.authorizedSupply(),0n);assert.equal(await f.coin.totalSupply(),0n);
});
test('settlement transfers existing tokens once, scopes IDs to payer, and rejects changed retries',async t=>{
  const f=await fixture(t);await sent(f.coin.unpause());await f.mint(1000n);await sent(f.coin.connect(f.payer).approve(await f.payment.getAddress(),1000n));
  const call=()=>f.payment.connect(f.payer).settle(id('deposit'),f.addresses[5],250n);
  const first=await sent(call());assert.equal(first.logs.length,2);assert.equal(await f.coin.balanceOf(f.addresses[5]),250n);
  const retry=await sent(call());assert.equal(retry.logs.length,0);assert.equal(await f.coin.balanceOf(f.addresses[5]),250n);
  assert.equal(await f.coin.totalSupply(),1000n);assert.equal(await f.coin.balanceOf(await f.payment.getAddress()),0n);
  await assert.rejects(f.payment.connect(f.payer).settle(id('deposit'),f.addresses[5],251n));
  await assert.rejects(f.payment.connect(f.payer).settle(id('deposit'),f.addresses[6],250n));
  assert.equal((await f.payment.settlements(f.addresses[6],id('deposit'))).completed,false);
});
test('unfunded, unapproved, invalid and paused settlements cannot leave completed records',async t=>{
  const f=await fixture(t),ref=id('deposit'),pay=f.payment.connect(f.payer);
  await assert.rejects(pay.settle(ref,f.addresses[5],100n));assert.equal((await f.payment.settlements(f.addresses[4],ref)).completed,false);
  await sent(f.coin.unpause());await f.mint(100n);await assert.rejects(pay.settle(ref,f.addresses[5],100n));
  await sent(f.coin.connect(f.payer).approve(await f.payment.getAddress(),200n));
  await assert.rejects(pay.settle(ref,f.addresses[5],101n));
  for(const recipient of [ZeroAddress,f.addresses[4],await f.payment.getAddress()])await assert.rejects(pay.settle(ref,recipient,1n));
  await assert.rejects(pay.settle(ref,f.addresses[5],0n));
  await sent(f.coin.connect(f.pauser).pause());await assert.rejects(pay.settle(ref,f.addresses[5],100n));
  assert.equal((await f.payment.settlements(f.addresses[4],ref)).completed,false);assert.equal(await f.coin.balanceOf(f.addresses[5]),0n);
});
test('a token that reports success without delivering the exact amount cannot complete settlement',async t=>{
  const f=await fixture(t);
  const mock=compileSource('Adversarial.sol','pragma solidity 0.8.37; contract Adversarial { mapping(address=>uint) public balanceOf; function transferFrom(address,address to,uint amount) external returns(bool){balanceOf[to]+=amount-1; return true;} }','Adversarial');
  const bad=await f.deploy(mock),payment=await f.deploy(settlement,[await bad.getAddress()]);
  await assert.rejects(payment.connect(f.payer).settle(id('bad'),f.addresses[5],10n));
  assert.equal((await payment.settlements(f.addresses[4],id('bad'))).completed,false);assert.equal(await bad.balanceOf(f.addresses[5]),0n);
});

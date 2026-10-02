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
async function fixture(t,{adminDelay=0}={}){
  const engine=ganache.provider({logging:{quiet:true},chain:{chainId:1337,hardfork:'london'},wallet:{deterministic:true,totalAccounts:8}});
  t.after(()=>engine.disconnect());const provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
  const people=await Promise.all(Array.from({length:7},(_,i)=>provider.getSigner(i))),addresses=await Promise.all(people.map(p=>p.getAddress()));
  const [admin,issuer,minter,pauser,payer,recipient,outsider]=people;
  async function deploy(artifact,args=[]){const result=await new ContractFactory(artifact.abi,artifact.bytecode,admin).deploy(...args);await result.waitForDeployment();return result;}
  const coin=await deploy(token,[1000000n,0n,addresses[4],...addresses.slice(0,4),adminDelay,id('local-test-policy')]);
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
  assert.equal(await coin.totalSupply(),0n);assert.equal(await coin.decimals(),18n);assert.equal(await coin.paused(),true);
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
test('local incident recovery contains token movement, retires pending issuance and replaces a compromised minter',async t=>{
  const f=await fixture(t),{coin,addresses,issuer,minter,pauser,payer,recipient,outsider}=f;
  const rejectsWith=(promise,name)=>assert.rejects(promise,error=>coin.interface.parseError(error.data)?.name===name);
  await sent(coin.unpause());await f.mint(1000n,id('recovery-funding'));
  await sent(coin.connect(payer).approve(addresses[5],100n));
  const time=(await f.provider.getBlock('latest')).timestamp,cancelled=id('recovery-cancel'),expired=id('recovery-expire');
  await sent(coin.connect(issuer).authorizeIssuance(cancelled,addresses[4],200n,time+3600));
  await sent(coin.connect(issuer).authorizeIssuance(expired,addresses[4],300n,time+3600));
  await sent(coin.connect(pauser).pause());
  for(const attempt of [
    ()=>coin.connect(payer).transfer.staticCall(addresses[5],10n),
    ()=>coin.connect(recipient).transferFrom.staticCall(addresses[4],addresses[5],10n),
    ()=>coin.connect(payer).burn.staticCall(10n),
    ()=>coin.connect(recipient).burnFrom.staticCall(addresses[4],10n),
    ()=>coin.connect(minter).mintAuthorized.staticCall(cancelled)
  ])await rejectsWith(attempt(),'EnforcedPause');
  assert.equal(await coin.balanceOf(addresses[4]),1000n);assert.equal(await coin.balanceOf(addresses[5]),0n);
  assert.equal(await coin.allowance(addresses[4],addresses[5]),100n);assert.equal(await coin.totalSupply(),1000n);
  assert.equal(await coin.authorizedSupply(),500n);

  await sent(coin.connect(pauser).cancelIssuance(cancelled));
  assert.equal((await coin.issuances(cancelled)).status,3n);assert.equal(await coin.authorizedSupply(),300n);
  const minterRole=await coin.MINTER_ROLE();
  await sent(coin.revokeRole(minterRole,addresses[2]));await sent(coin.grantRole(minterRole,addresses[6]));
  assert.equal(await coin.hasRole(minterRole,addresses[2]),false);assert.equal(await coin.hasRole(minterRole,addresses[6]),true);
  await f.engine.request({method:'evm_increaseTime',params:[3601]});await f.engine.request({method:'evm_mine',params:[]});
  await sent(coin.connect(payer).expireIssuance(expired));
  assert.equal((await coin.issuances(expired)).status,4n);assert.equal(await coin.authorizedSupply(),0n);
  for(const signer of [issuer,minter,pauser,payer,recipient,outsider]){
    await rejectsWith(coin.connect(signer).unpause.staticCall(),'AccessControlUnauthorizedAccount');
  }
  assert.equal(await coin.paused(),true);await sent(coin.unpause());assert.equal(await coin.paused(),false);

  const resumedTime=(await f.provider.getBlock('latest')).timestamp;
  for(const reference of [cancelled,expired]){
    await rejectsWith(coin.connect(issuer).authorizeIssuance.staticCall(reference,addresses[4],1n,resumedTime+3600),'IssuanceReferenceAlreadyUsed');
    await rejectsWith(coin.connect(outsider).mintAuthorized.staticCall(reference),'IssuanceNotAuthorized');
  }
  const resumed=id('recovery-resumed');
  await sent(coin.connect(issuer).authorizeIssuance(resumed,addresses[4],250n,resumedTime+3600));
  await rejectsWith(coin.connect(minter).mintAuthorized.staticCall(resumed),'AccessControlUnauthorizedAccount');
  await sent(coin.connect(outsider).mintAuthorized(resumed));
  assert.equal((await coin.issuances(resumed)).status,2n);assert.equal(await coin.authorizedSupply(),0n);
  assert.equal(await coin.totalSupply(),1250n);assert.equal(await coin.balanceOf(addresses[4]),1250n);
  await sent(coin.connect(payer).transfer(addresses[5],10n));
  await sent(coin.connect(recipient).transferFrom(addresses[4],addresses[5],20n));
  await sent(coin.connect(payer).burn(10n));
  assert.equal(await coin.balanceOf(addresses[4]),1210n);assert.equal(await coin.balanceOf(addresses[5]),30n);
  assert.equal(await coin.allowance(addresses[4],addresses[5]),80n);assert.equal(await coin.totalSupply(),1240n);
});

test('local administrator recovery enforces the transfer delay and removes the former administrator authority',async t=>{
  const f=await fixture(t,{adminDelay:86400}),{coin,addresses,outsider}=f;
  const rejectsWith=(promise,name)=>assert.rejects(promise,error=>coin.interface.parseError(error.data)?.name===name);
  assert.equal(await coin.defaultAdminDelay(),86400n);assert.equal(await coin.paused(),true);
  const transfer=await sent(coin.beginDefaultAdminTransfer(addresses[6]));
  const transferBlock=await f.provider.getBlock(transfer.blockNumber),pending=await coin.pendingDefaultAdmin();
  assert.equal(pending.newAdmin,addresses[6]);assert.equal(pending.schedule,BigInt(transferBlock.timestamp)+86400n);
  await rejectsWith(coin.connect(outsider).acceptDefaultAdminTransfer.staticCall(),'AccessControlEnforcedDefaultAdminDelay');
  assert.equal(await coin.defaultAdmin(),addresses[0]);
  const latest=(await f.provider.getBlock('latest')).timestamp;
  await f.engine.request({method:'evm_increaseTime',params:[Number(pending.schedule)-latest+1]});
  await f.engine.request({method:'evm_mine',params:[]});
  await sent(coin.connect(outsider).acceptDefaultAdminTransfer());
  const adminRole=await coin.DEFAULT_ADMIN_ROLE();
  assert.equal(await coin.defaultAdmin(),addresses[6]);assert.equal(await coin.hasRole(adminRole,addresses[0]),false);
  assert.equal(await coin.hasRole(adminRole,addresses[6]),true);
  assert.equal((await coin.pendingDefaultAdmin()).newAdmin,ZeroAddress);assert.equal((await coin.pendingDefaultAdmin()).schedule,0n);
  await rejectsWith(coin.unpause.staticCall(),'AccessControlUnauthorizedAccount');assert.equal(await coin.paused(),true);
  await sent(coin.connect(outsider).unpause());assert.equal(await coin.paused(),false);
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

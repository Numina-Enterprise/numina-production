import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {localChain} from '../runtime/nusd/development/local-chain.mjs';
import {BrowserProvider,ContractFactory,id,ZeroAddress,ZeroHash} from '../runtime/nusd/development/node_modules/ethers/lib.esm/index.js';
import {compileSource} from '../runtime/nusd/development/compile.mjs';
import {loadTokenArtifact} from '../runtime/nusd/scripts/token-artifact.mjs';

const read=p=>fs.readFileSync(new URL('../runtime/nusd/'+p,import.meta.url),'utf8');
const token=loadTokenArtifact(),usdcConversion=JSON.parse(read('artifacts/NuminaUSDCConversion.json')),
  usdRedemption=JSON.parse(read('artifacts/NuminaUSDRedemption.json'));
const NUSD=1_000_000_000_000_000_000n,USDC=1_000_000n,cap=500_000_000_000_000n*NUSD;
const sent=async p=>(await p).wait();
const mock=compileSource('TestReserve.sol',`// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract TestReserve is ERC20 {
 uint8 private precision; uint public mode; address public callback; bytes public payload; bytes4 public callbackError;
 constructor(uint8 digits) ERC20("LOCAL TEST TOKEN", "TEST") { precision=digits; }
 function decimals() public view override returns(uint8) {return precision;}
 function seed(address to,uint amount) external {_mint(to,amount);}
 function burn(uint amount) external {if(mode!=3)_burn(msg.sender,amount);}
 function configure(uint next,address target,bytes calldata data) external {mode=next;callback=target;payload=data;}
 function _update(address from,address to,uint amount) internal override {
   if(mode==1&&from!=address(0)&&to!=address(0)&&amount>0){super._update(from,to,amount-1);super._update(from,address(0),1);}
   else super._update(from,to,amount);
   if(mode==2&&from==callback&&to!=address(0)){
     (bool ok,bytes memory result)=callback.call(payload);require(!ok,"reentrant call succeeded");
     if(result.length>=4)callbackError=bytes4(result);
   }
 }
}`,'TestReserve');

async function fixture(t,{supply=1000n*NUSD}={}) {
 const engine=await localChain();
 t.after(()=>engine.disconnect());const provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const people=await Promise.all(Array.from({length:8},(_,i)=>provider.getSigner(i))),a=await Promise.all(people.map(x=>x.getAddress()));
 const [admin,operator,confirmer,pauser,holder,recipient,outsider,other]=people;
 const deploy=async(artifact,args=[])=>{const c=await new ContractFactory(artifact.abi,artifact.bytecode,admin).deploy(...args);await c.waitForDeployment();return c;};
 const nusd=await deploy(token,[cap,supply,a[4],...a.slice(0,4),0,id('LOCAL TEST POLICY')]);
 const usdc=await deploy(mock,[6]);await sent(usdc.seed(a[1],1000n*USDC));await sent(usdc.seed(a[4],1000n*USDC));
 const vault=await deploy(usdcConversion,[await nusd.getAddress(),await usdc.getAddress(),a[0],a[1],a[3],0]);
 const escrow=await deploy(usdRedemption,[await nusd.getAddress(),...a.slice(0,4),0]);
 await sent(vault.grantRole(await vault.PARTICIPANT_ROLE(),a[4]));
 await sent(escrow.grantRole(await escrow.HOLDER_ROLE(),a[4]));await sent(nusd.unpause());
 await sent(nusd.connect(holder).approve(await vault.getAddress(),cap));await sent(nusd.connect(holder).approve(await escrow.getAddress(),cap));
 await sent(usdc.connect(holder).approve(await vault.getAddress(),cap));await sent(usdc.connect(operator).approve(await vault.getAddress(),cap));
 const fund=async(amount=100n*USDC)=>sent(vault.connect(operator).addLiquidity(true,amount));
 const enable=async()=>{await sent(vault.unpause());await sent(escrow.unpause());};
 const request=async(name='claim',amount=10n*NUSD)=>sent(escrow.connect(holder).requestRedemption(id(name),amount,id('salted-private-bank-instruction-reference')));
 const begin=async(name='claim',ref='payment')=>sent(escrow.connect(operator).beginPayment(a[4],id(name),id(ref)));
 const attest=async({name='claim',ref='payment',evidence='LOCAL-TEST-bank-outcome',cents=1000n,paid=true}={})=>sent(escrow.connect(confirmer).attestBankOutcome(a[4],id(name),id(ref),id(evidence),cents,paid));
 return {engine,provider,people,a,admin,operator,confirmer,pauser,holder,recipient,outsider,other,nusd,usdc,vault,escrow,deploy,fund,enable,request,begin,attest};
}

test('conversion artifacts reproduce exact reviewed source and deploy below the EVM code-size limit',()=>{
 for(const artifact of [usdcConversion,usdRedemption]){
  const built=compileSource(artifact.sourceName,read(artifact.sourceName),artifact.contractName);built.schema=artifact.schema;
  assert.deepEqual(built,artifact);assert.ok((built.deployedBytecode.length-2)/2<24576);
 }
});

test('USDC conversion exchanges 18-decimal NUSD and 6-decimal USDC at exact 1:1 whole-unit parity',async t=>{
 const f=await fixture(t);await f.fund();await f.enable();const v=await f.vault.getAddress(),supply=await f.nusd.totalSupply();
 assert.equal(await f.vault.quote(true,12n*NUSD),12n*USDC);
 assert.equal(await f.vault.quote(false,2n*USDC),2n*NUSD);
 await assert.rejects(f.vault.quote(true,12n*NUSD+1n));
 await sent(f.vault.connect(f.holder).convert(id('swap'),true,12n*NUSD,f.a[5]));
 assert.equal(await f.usdc.balanceOf(f.a[5]),12n*USDC);assert.equal(await f.nusd.balanceOf(v),12n*NUSD);
 const retry=await sent(f.vault.connect(f.holder).convert(id('swap'),true,12n*NUSD,f.a[5]));assert.equal(retry.logs.length,0);
 for(const args of [[false,12n*USDC,f.a[5]],[true,11n*NUSD,f.a[5]],[true,12n*NUSD,f.a[6]]]){
  await assert.rejects(f.vault.connect(f.holder).convert.staticCall(id('swap'),...args));
 }
 await sent(f.vault.connect(f.holder).convert(id('reverse'),false,2n*USDC,f.a[5]));
 assert.equal(await f.nusd.balanceOf(f.a[5]),2n*NUSD);assert.equal(await f.nusd.totalSupply(),supply);
 assert.equal(await f.nusd.balanceOf(v),10n*NUSD);assert.equal(await f.usdc.balanceOf(v),90n*USDC);
 assert.equal((await f.vault.conversions(f.a[6],id('swap'))).completed,false);
});

test('USDC conversion rejects unfunded, unapproved, paused and unauthorized writes without creating a record',async t=>{
 const f=await fixture(t);await f.enable();const before=await f.nusd.balanceOf(f.a[4]);
 await assert.rejects(f.vault.connect(f.holder).convert.staticCall(id('no-reserves'),true,NUSD,f.a[5]));
 assert.equal(await f.nusd.balanceOf(f.a[4]),before);assert.equal((await f.vault.conversions(f.a[4],id('no-reserves'))).completed,false);
 await f.fund();await assert.rejects(f.vault.connect(f.outsider).convert.staticCall(id('outsider'),true,NUSD,f.a[5]));
 await sent(f.nusd.connect(f.holder).approve(await f.vault.getAddress(),0));
 await assert.rejects(f.vault.connect(f.holder).convert.staticCall(id('no-allowance'),true,NUSD,f.a[5]));
 for(const r of [ZeroAddress,await f.vault.getAddress()])await assert.rejects(f.vault.connect(f.holder).convert.staticCall(id('invalid'),true,1n,r));
 await assert.rejects(f.vault.connect(f.operator).removeLiquidity.staticCall(true,1n,f.a[1]));
 await sent(f.vault.connect(f.pauser).pause());
 await assert.rejects(f.vault.connect(f.holder).convert.staticCall(id('paused'),true,NUSD,f.a[5]));
 await assert.rejects(f.vault.connect(f.outsider).removeLiquidity.staticCall(true,1n,f.a[6]));
 await sent(f.vault.connect(f.operator).removeLiquidity(true,1n,f.a[1]));
 await assert.rejects(f.vault.grantRole.staticCall(await f.vault.LIQUIDITY_ROLE(),f.a[0]));
 await assert.rejects(f.vault.connect(f.operator).unpause.staticCall());
});

test('configuration rejects same tokens, wrong decimals, absent contracts and overlapping privileged roles',async t=>{
 const f=await fixture(t),n=await f.nusd.getAddress(),u=await f.usdc.getAddress(),wrong=await f.deploy(mock,[18]);
 for(const [left,right,manager] of [[n,n,f.a[1]],[n,await wrong.getAddress(),f.a[1]],[n,ZeroAddress,f.a[1]],[n,u,f.a[0]]]){
  await assert.rejects(f.deploy(usdcConversion,[left,right,f.a[0],manager,f.a[3],0]));
 }
 await assert.rejects(f.deploy(usdRedemption,[n,f.a[0],f.a[1],f.a[1],f.a[3],0]));
 await assert.rejects(f.escrow.grantRole.staticCall(await f.escrow.CONFIRMER_ROLE(),f.a[1]));
 await assert.rejects(f.escrow.grantRole.staticCall(id('unsupported-role'),f.a[6]));
});

test('inexact output rolls back input, balances and operation state; fee-bearing liquidity is rejected',async t=>{
 const f=await fixture(t);await f.fund();await f.enable();const vault=await f.vault.getAddress(),before=await f.nusd.balanceOf(f.a[4]);
 await sent(f.usdc.configure(1,ZeroAddress,'0x'));
 await assert.rejects(sent(f.vault.connect(f.holder).convert(id('fee'),true,NUSD,f.a[5],{gasLimit:1000000})));
 assert.equal(await f.nusd.balanceOf(f.a[4]),before);assert.equal(await f.nusd.balanceOf(vault),0n);
 assert.equal(await f.usdc.balanceOf(f.a[5]),0n);assert.equal(await f.usdc.balanceOf(vault),100n*USDC);
 assert.equal((await f.vault.conversions(f.a[4],id('fee'))).completed,false);
 await assert.rejects(sent(f.vault.connect(f.operator).addLiquidity(true,USDC,{gasLimit:1000000})));
 assert.equal(await f.usdc.balanceOf(vault),100n*USDC);
});

test('token callback cannot reenter a conversion even when the token address has participant eligibility',async t=>{
 const f=await fixture(t);await f.fund();await f.enable();const vault=await f.vault.getAddress(),u=await f.usdc.getAddress();
 await sent(f.vault.grantRole(await f.vault.PARTICIPANT_ROLE(),u));
 const call=f.vault.interface.encodeFunctionData('convert',[id('reenter'),true,NUSD,f.a[5]]);
 await sent(f.usdc.configure(2,vault,call));await sent(f.vault.connect(f.holder).convert(id('outer'),true,NUSD,f.a[5]));
 assert.equal(await f.usdc.callbackError(),id('ReentrancyGuardReentrantCall()').slice(0,10));
 assert.equal((await f.vault.conversions(u,id('reenter'))).completed,false);assert.equal(await f.usdc.balanceOf(f.a[5]),USDC);
});

test('USD requests preserve exact cents including 500T arithmetic, and cancellable claims survive pause and eligibility revocation',async t=>{
 const f=await fixture(t);await f.enable();
 assert.equal(await f.escrow.quoteUsdCents(cap),50_000_000_000_000_000n);
 for(const amount of [0n,1n,9_999_999_999_999_999n,10_000_000_000_000_001n])await assert.rejects(f.escrow.quoteUsdCents(amount));
 await f.request();assert.equal(await f.escrow.totalEscrowedNusd(),10n*NUSD);
 const retry=await f.request();assert.equal(retry.logs.length,0);
 await assert.rejects(f.escrow.connect(f.holder).requestRedemption.staticCall(id('claim'),11n*NUSD,id('salted-private-bank-instruction-reference')));
 await sent(f.escrow.revokeRole(await f.escrow.HOLDER_ROLE(),f.a[4]));await sent(f.escrow.connect(f.pauser).pause());
 await sent(f.escrow.connect(f.holder).cancel(id('claim')));
 assert.equal(await f.escrow.totalEscrowedNusd(),0n);assert.equal(await f.nusd.balanceOf(f.a[4]),1000n*NUSD);
 assert.equal((await f.escrow.redemptions(f.a[4],id('claim'))).status,6n);
 assert.equal((await sent(f.escrow.connect(f.holder).cancel(id('claim')))).logs.length,0);
});

test('processing USD claims cannot refund on timeout; only a distinct confirmer can attest the exact bank outcome and burn once',async t=>{
 const f=await fixture(t);await f.enable();await f.request();await f.begin();
 assert.equal((await f.begin()).logs.length,0);
 await f.engine.request({method:'evm_increaseTime',params:[30*86400]});await f.engine.request({method:'evm_mine',params:[]});
 await assert.rejects(f.escrow.connect(f.holder).cancel.staticCall(id('claim')));
 await assert.rejects(f.escrow.connect(f.holder).claimRefund.staticCall(id('claim')));
 const args=[f.a[4],id('claim'),id('payment'),id('LOCAL-TEST-bank-outcome'),1000n,true];
 for(const signer of [f.admin,f.operator,f.pauser,f.holder,f.outsider])await assert.rejects(f.escrow.connect(signer).attestBankOutcome.staticCall(...args));
 await assert.rejects(f.escrow.connect(f.confirmer).attestBankOutcome.staticCall(...args.slice(0,4),999n,true));
 await assert.rejects(f.escrow.connect(f.confirmer).attestBankOutcome.staticCall(f.a[4],id('claim'),id('different-payment'),args[3],1000n,true));
 await assert.rejects(f.escrow.connect(f.confirmer).attestBankOutcome.staticCall(f.a[4],id('claim'),args[2],ZeroHash,1000n,true));
 const before=await f.nusd.totalSupply();await f.attest();assert.equal(await f.nusd.totalSupply(),before-10n*NUSD);
 assert.equal(await f.escrow.totalEscrowedNusd(),0n);assert.equal((await f.escrow.redemptions(f.a[4],id('claim'))).status,3n);
 assert.equal((await f.attest()).logs.length,0);await assert.rejects(f.attest({paid:false}));
 await assert.rejects(f.attest({evidence:'changed-retry'}));await assert.rejects(f.escrow.connect(f.holder).claimRefund.staticCall(id('claim')));
 await f.request('second');await assert.rejects(f.begin('second','payment'));await f.begin('second','second-payment');
 await assert.rejects(f.attest({name:'second',ref:'second-payment'}));
 assert.equal((await f.escrow.redemptions(f.a[4],id('second'))).status,2n);
});

test('failed USD payments restore the exact escrow once; failed token movement preserves refund and attestation state',async t=>{
 const f=await fixture(t);await f.enable();await f.request();await f.begin();await f.attest({paid:false});
 assert.equal(await f.escrow.totalEscrowedNusd(),10n*NUSD);assert.equal(await f.nusd.totalSupply(),1000n*NUSD);
 await assert.rejects(f.attest({paid:true}));await sent(f.nusd.connect(f.pauser).pause());
 await assert.rejects(sent(f.escrow.connect(f.holder).claimRefund(id('claim'),{gasLimit:1000000})));
 assert.equal((await f.escrow.redemptions(f.a[4],id('claim'))).status,4n);assert.equal(await f.escrow.totalEscrowedNusd(),10n*NUSD);
 await sent(f.escrow.revokeRole(await f.escrow.HOLDER_ROLE(),f.a[4]));await sent(f.escrow.connect(f.pauser).pause());await sent(f.nusd.unpause());
 await sent(f.escrow.connect(f.holder).claimRefund(id('claim')));assert.equal(await f.nusd.balanceOf(f.a[4]),1000n*NUSD);
 assert.equal(await f.escrow.totalEscrowedNusd(),0n);assert.equal((await sent(f.escrow.connect(f.holder).claimRefund(id('claim')))).logs.length,0);
});

test('role rotation cannot let a payment initiator confirm its own existing request',async t=>{
 const f=await fixture(t);await f.enable();await f.request();await f.begin();
 assert.equal((await f.escrow.redemptions(f.a[4],id('claim'))).paymentOperator,f.a[1]);
 await sent(f.escrow.revokeRole(await f.escrow.OPERATOR_ROLE(),f.a[1]));
 await sent(f.escrow.grantRole(await f.escrow.CONFIRMER_ROLE(),f.a[1]));
 for(const paid of [true,false])await assert.rejects(f.escrow.connect(f.operator).attestBankOutcome.staticCall(f.a[4],id('claim'),id('payment'),id('self-confirmation'),1000n,paid));
 assert.equal((await f.escrow.redemptions(f.a[4],id('claim'))).status,2n);
 assert.equal(await f.escrow.usedEvidenceHashes(id('self-confirmation')),false);
 await f.attest();assert.equal((await f.escrow.redemptions(f.a[4],id('claim'))).status,3n);
});

test('a paused token cannot be recorded as burned; an unsuccessful finalization does not consume evidence',async t=>{
 const f=await fixture(t);await f.enable();await f.request();await f.begin();await sent(f.nusd.connect(f.pauser).pause());
 await assert.rejects(f.attest());assert.equal((await f.escrow.redemptions(f.a[4],id('claim'))).status,2n);
 assert.equal(await f.escrow.usedEvidenceHashes(id('LOCAL-TEST-bank-outcome')),false);assert.equal(await f.escrow.totalEscrowedNusd(),10n*NUSD);
 await sent(f.nusd.unpause());await f.attest();assert.equal(await f.nusd.totalSupply(),990n*NUSD);
});

test('the same NUSD cannot fund both USD escrow and USDC conversion',async t=>{
 const f=await fixture(t,{supply:100n*NUSD});await f.fund();await f.enable();await f.request('usd',60n*NUSD);
 await assert.rejects(sent(f.vault.connect(f.holder).convert(id('double-spend'),true,50n*NUSD,f.a[5],{gasLimit:1000000})));
 await sent(f.vault.connect(f.holder).convert(id('remaining'),true,40n*NUSD,f.a[5]));
 assert.equal(await f.nusd.balanceOf(f.a[4]),0n);assert.equal(await f.usdc.balanceOf(f.a[5]),40n*USDC);
 assert.equal(await f.escrow.totalEscrowedNusd(),60n*NUSD);assert.equal(await f.nusd.balanceOf(await f.vault.getAddress()),40n*NUSD);
 await f.begin('usd');await f.attest({name:'usd',cents:6000n});assert.equal(await f.nusd.totalSupply(),40n*NUSD);
});

test('an 18-decimal token that falsely reports a burn cannot complete a USD paid attestation',async t=>{
 const f=await fixture(t),falseBurn=await f.deploy(mock,[18]);
 await sent(falseBurn.seed(f.a[4],NUSD));
 const fake=await f.deploy(usdRedemption,[await falseBurn.getAddress(),...f.a.slice(0,4),0]);
 await sent(fake.grantRole(await fake.HOLDER_ROLE(),f.a[4]));await sent(fake.unpause());
 await sent(falseBurn.connect(f.holder).approve(await fake.getAddress(),NUSD));
 await sent(fake.connect(f.holder).requestRedemption(id('fake-burn'),NUSD,id('destination')));
 await sent(fake.connect(f.operator).beginPayment(f.a[4],id('fake-burn'),id('attempt')));
 await sent(falseBurn.configure(3,ZeroAddress,'0x'));
 await assert.rejects(sent(fake.connect(f.confirmer).attestBankOutcome(f.a[4],id('fake-burn'),id('attempt'),id('evidence'),100n,true,{gasLimit:1000000})));
 assert.equal((await fake.redemptions(f.a[4],id('fake-burn'))).status,2n);
 assert.equal(await fake.totalEscrowedNusd(),NUSD);assert.equal(await fake.usedEvidenceHashes(id('evidence')),false);
 assert.equal(await falseBurn.balanceOf(await fake.getAddress()),NUSD);
});

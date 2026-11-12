import {test} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther} from 'ethers';
import {compile} from '../scripts/compile.js';
const compiled=compile();
const rejectsTx = action => assert.rejects(async () => { const tx=await action(); await tx.wait(); });
async function setup(t,capacity=2){const rpc=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'}});t.after(()=>rpc.disconnect());const provider=new BrowserProvider(rpc);const a=await provider.getSigner(0),b=await provider.getSigner(1);const c=await new ContractFactory(compiled.abi,compiled.evm.bytecode.object,a).deploy(3600,capacity);await c.waitForDeployment();return {rpc,provider,a,b,c};}
test('contrat : refuse paiement incorrect et achats hors limites',async t=>{const {c}=await setup(t);await rejectsTx(()=>c.buyTickets(1,{value:parseEther('.02')}));await rejectsTx(()=>c.buyTickets(0));await rejectsTx(()=>c.buyTickets(3,{value:parseEther('.03')}));});
test('contrat : achat, fermeture, tirage, retrait unique',async t=>{const {rpc,c}=await setup(t);await(await c.buyTickets(2,{value:parseEther('.02')})).wait();assert.equal(await c.totalTickets(),2n);assert.ok(await c.drawBlock()>0n);await rejectsTx(()=>c.buyTickets(1,{value:parseEther('.01')}));await rejectsTx(()=>c.draw());for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});await(await c.draw({gasLimit:300000})).wait();assert.equal(await c.settled(),true);assert.equal(await c.credits(await c.winner()),parseEther('.02'));await(await c.withdraw()).wait();assert.equal(await c.credits(await c.winner()),0n);await rejectsTx(()=>c.withdraw());await rejectsTx(()=>c.draw());});
test('contrat : expiration et remboursement sans double paiement',async t=>{const {rpc,c}=await setup(t,1);await(await c.buyTickets(1,{value:parseEther('.01')})).wait();for(let i=0;i<260;i++)await rpc.request({method:'evm_mine',params:[]});await rejectsTx(()=>c.draw());await(await c.refund()).wait();const player=await c.tickets(0);assert.equal(await c.credits(player),parseEther('.01'));await rejectsTx(()=>c.refund());await(await c.withdraw()).wait();});
test('contrat : clôture temporelle et programmation ouverte',async t=>{const {rpc,c,b}=await setup(t,10);await(await c.buyTickets(1,{value:parseEther('.01')})).wait();await rejectsTx(()=>c.scheduleDraw());await rpc.request({method:'evm_increaseTime',params:[3601]});await rpc.request({method:'evm_mine',params:[]});await rejectsTx(()=>c.buyTickets(1,{value:parseEther('.01')}));await(await c.connect(b).scheduleDraw({gasLimit:100000})).wait();assert.ok(await c.drawBlock()>0n);});

// --- Cas limites supplémentaires ---

test('contrat : configuration invalide refusée au déploiement',async t=>{
 const {a}=await setup(t);const factory=new ContractFactory(compiled.abi,compiled.evm.bytecode.object,a);
 await assert.rejects(factory.deploy(0,10));await assert.rejects(factory.deploy(3600,0));await assert.rejects(factory.deploy(3600,10001));
});

test('contrat : un non-gagnant ne peut rien retirer et le contrat est vidé après retrait',async t=>{
 const {rpc,provider,a,b,c}=await setup(t);
 await(await c.buyTickets(1,{value:parseEther('.01')})).wait();
 await(await c.connect(b).buyTickets(1,{value:parseEther('.01')})).wait();
 for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
 await(await c.draw({gasLimit:300000})).wait();
 const winner=await c.winner();const loser=winner===await a.getAddress()?b:a;
 await rejectsTx(()=>c.connect(loser).withdraw());
 await(await c.connect(winner===await a.getAddress()?a:b).withdraw()).wait();
 assert.equal(await provider.getBalance(await c.getAddress()),0n);
});

test('contrat : programmation impossible sans ticket vendu',async t=>{
 const {rpc,c}=await setup(t,10);
 await rpc.request({method:'evm_increaseTime',params:[3601]});await rpc.request({method:'evm_mine',params:[]});
 await rejectsTx(()=>c.scheduleDraw({gasLimit:100000}));
});

test('contrat : le remboursement émet l’événement Refunded',async t=>{
 const {rpc,a,c}=await setup(t,1);
 await(await c.buyTickets(1,{value:parseEther('.01')})).wait();
 for(let i=0;i<260;i++)await rpc.request({method:'evm_mine',params:[]});
 await(await c.refund()).wait();
 const events=await c.queryFilter(c.filters.Refunded());
 assert.equal(events.length,1);assert.equal(events[0].args.player,await a.getAddress());assert.equal(events[0].args.amount,parseEther('.01'));
});

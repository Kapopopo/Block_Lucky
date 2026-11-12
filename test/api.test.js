import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';
async function fixture(t,options={}){
 const dir=mkdtempSync(path.join(tmpdir(),'blocklucky-'));const server=createApp({file:path.join(dir,'state.json'),...options}).listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
 t.after(()=>{server.closeAllConnections();server.close();rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const makeClient=()=>{let cookie='';const call=async(url,body)=>{const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {status:res.status,data:await res.json()};};call.newSession=makeClient;return call;};
 return makeClient();
}
test('achat validé, solde débité et chances cohérentes',async t=>{const call=await fixture(t);assert.equal((await call('/api/state')).data.balance,1);assert.equal((await call('/api/tickets',{quantity:5})).status,201);const {data}=await call('/api/state');assert.equal(data.balance,.95);assert.equal(data.myTickets,5);assert.equal(data.pot,.05);assert.equal(data.participants,1);});
test('rejette les quantités invalides sans débiter',async t=>{const call=await fixture(t);for(const quantity of [0,-1,1.5,21,'5'])assert.equal((await call('/api/tickets',{quantity})).status,400);assert.equal((await call('/api/state')).data.balance,1);});
test('capacité atteinte : tirage, crédit et nouvelle édition',async t=>{const call=await fixture(t,{capacity:2});await call('/api/tickets',{quantity:2});const {data}=await call('/api/state');assert.equal(data.round,2);assert.equal(data.balance,1);assert.equal(data.totalTickets,0);assert.equal(data.history[0].prize,.02);assert.equal(data.history[0].winner,data.address);});
test('refuse le dépassement de capacité',async t=>{const call=await fixture(t,{capacity:2});assert.equal((await call('/api/tickets',{quantity:3})).status,409);});
test('échéance atteinte : règlement au prochain appel',async t=>{const call=await fixture(t,{duration:100});await call('/api/tickets',{quantity:1});await new Promise(r=>setTimeout(r,130));assert.equal((await call('/api/state')).data.history.length,1);});
test('historique personnel : achat et gain enregistrés avec référence',async t=>{const call=await fixture(t,{capacity:2});await call('/api/tickets',{quantity:2,round:1});const {data}=await call('/api/state');assert.equal(data.transactions.length,2);assert.equal(data.transactions[0].type,'win');assert.equal(data.transactions[0].amount,.02);assert.equal(data.transactions[1].type,'purchase');assert.equal(data.transactions[1].amount,-.02);assert.equal(data.transactions[1].quantity,2);assert.match(data.transactions[1].id,/^[0-9a-f]{16}$/);assert.equal(data.transactions[0].round,1);});
test('achat : refuse un tirage obsolète sans débit et fournit les numéros',async t=>{const call=await fixture(t);const invalid=await call('/api/tickets',{quantity:2,round:99});assert.equal(invalid.status,409);let {data}=await call('/api/state');assert.equal(data.balance,1);assert.deepEqual(data.transactions,[]);await call('/api/tickets',{quantity:2,round:1});data=(await call('/api/state')).data;assert.deepEqual(data.myTicketNumbers,[1,2]);assert.equal(data.transactions.length,1);});
test('un achat rejoué après règlement ne débite pas une seconde fois',async t=>{
 const call=await fixture(t,{capacity:2});const body={quantity:2,round:1,requestId:'a'.repeat(32)};
 const first=await call('/api/tickets',body);assert.equal(first.status,201);
 const retry=await call('/api/tickets',body);assert.equal(retry.status,200);assert.equal(retry.data.receipt.id,first.data.receipt.id);
 const {data}=await call('/api/state');assert.equal(data.balance,1);assert.equal(data.history.length,1);assert.equal(data.transactions.length,2);
 assert.equal((await call('/api/tickets',{...body,quantity:1})).status,409);
 assert.equal((await call('/api/tickets',{quantity:1,requestId:'invalide'})).status,400);
});
test('reçus privés : numéros exacts, montant et contrôle de session',async t=>{
 const call=await fixture(t);const other=call.newSession();
 const {data:{receipt}}=await call('/api/tickets',{quantity:3});
 assert.deepEqual(receipt.ticketNumbers,[1,2,3]);assert.equal(receipt.amount,-.03);
 assert.equal((await call('/api/receipts/'+receipt.id)).data.id,receipt.id);
 assert.equal((await other('/api/receipts/'+receipt.id)).status,404);
 assert.equal((await call('/api/receipts/absent')).status,404);
});
test('tirage multi-participants : archives, numéro gagnant et notifications privées',async t=>{
 const first=await fixture(t,{capacity:2});const second=first.newSession();
 await first('/api/tickets',{quantity:1});await second('/api/tickets',{quantity:1});
 let a=(await first('/api/state')).data;const b=(await second('/api/state')).data;
 assert.deepEqual(a.participations[0].ticketNumbers,[1]);assert.deepEqual(b.participations[0].ticketNumbers,[2]);
 const winner=a.history[0].winningTicket;assert.ok(winner===1||winner===2);
 assert.equal(a.participations[0].status,winner===1?'won':'lost');assert.equal(b.participations[0].status,winner===2?'won':'lost');
 assert.equal(a.notifications.length,1);assert.equal(a.notifications[0].read,false);assert.notEqual(a.notifications[0].id,b.notifications[0].id);
 await first('/api/notifications/read',{ids:[b.notifications[0].id]});assert.equal((await second('/api/state')).data.notifications[0].read,false);
 await first('/api/notifications/read',{ids:[a.notifications[0].id]});a=(await first('/api/state')).data;assert.equal(a.notifications[0].read,true);
 assert.equal((await first('/api/notifications/read',{ids:'all'})).status,400);
});

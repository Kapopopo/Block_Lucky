import {BrowserProvider,Contract,formatEther,parseEther} from '/vendor/ethers.js';
const $=id=>document.getElementById(id);
let state,mode='demo',quantity=1,busy=false,config,contract,provider,account,currentView='lottery',toastTimer,pendingPurchase;
const labels={lottery:'Jouer',tickets:'Mes tickets',history:'Les tirages',transparency:'Paramètres',guide:'Comment ça marche'};
const eth=n=>Number(n).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
const short=a=>a?`${a.slice(0,6)}…${a.slice(-4)}`:'—';
const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message,error=false){$('toast').textContent=message;$('toast').className='show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').className='',6500);}
function show(view){if(!labels[view])return;currentView=view;document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${view}`);document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===view));$('pageLabel').textContent=labels[view];if(location.hash!=='#'+view)history.pushState(null,'','#'+view);window.scrollTo({top:0,behavior:'instant'});}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));
function setQuantity(n){quantity=Math.max(1,Math.min(20,Math.floor(Number(n)||1)));$('quantity').value=quantity;$('total').textContent=eth(quantity*.01)+' ETH';updateEstimate();document.querySelectorAll('[data-quantity]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.quantity)===quantity));}
$('minus').onclick=()=>setQuantity(quantity-1);$('plus').onclick=()=>setQuantity(quantity+1);$('quantity').onchange=e=>setQuantity(e.target.value);document.querySelectorAll('[data-quantity]').forEach(b=>b.onclick=()=>setQuantity(b.dataset.quantity));
async function api(url,options){const response=await fetch(url,options);const data=await response.json();if(!response.ok)throw new Error(data.error||'Le serveur est indisponible.');return data;}
function render(){if(!state)return;
  $('drawStatus').innerHTML=state.closed?'VENTES CLÔTURÉES':'<i></i> VENTES OUVERTES';
  $('mode').disabled=busy;
  $('round').textContent=String(state.round).padStart(3,'0');$('pot').textContent=eth(state.pot);$('sold').innerHTML=`${state.totalTickets} <small>/ ${state.capacity}</small>`;
  $('participants').textContent=state.participants??'—';$('mine').innerHTML=`${state.myTickets} <small>ticket${state.myTickets>1?'s':''}</small>`;$('ticketBadge').textContent=state.myTickets;
  $('progress').style.width=100*state.totalTickets/state.capacity+'%';$('remaining').textContent=`${state.capacity-state.totalTickets} tickets disponibles`;
  $('odds').textContent=state.myTickets?`${(100*state.myTickets/state.totalTickets).toLocaleString('fr-FR',{maximumFractionDigits:1})} % des tickets du tirage`:'Aucun ticket';
  $('walletLabel').textContent=mode==='demo'?`${eth(state.balance)} ETH`:account?short(account):'Connecter MetaMask';
  $('buy').disabled=busy||state.closed||false;$('buy').innerHTML=busy?'Transaction en cours…':state.closed?'Ventes clôturées':`Acheter ${quantity} ticket${quantity>1?'s':''} <span>→</span>`;
  $('activity').innerHTML=state.activity.length?state.activity.map(a=>`<div class="activity-row"><span class="participant"><span class="avatar">${safe(a.address.slice(2,4).toUpperCase())}</span>${safe(short(a.address))}</span><span class="ticket-chip">${a.quantity} ticket${a.quantity>1?'s':''}</span><span>${Math.max(0,Math.floor((Date.now()-a.date)/60000))} min</span></div>`).join(''):`<div class="empty">${mode==='chain'?'Aucun achat pour le moment.':'Aucun achat pour le moment.'}</div>`;
  $('myTickets').innerHTML=state.myTickets?Array.from({length:state.myTickets},(_,i)=>`<article class="ticket"><small>TIRAGE ${String(state.round).padStart(3,'0')} · EN COURS</small><strong>N° ${String(state.myTicketNumbers?.[i]??i+1).padStart(3,'0')}</strong><small>${safe(short(state.address))} · 0,01 ETH</small></article>`).join(''):'<div class="empty"><span class="empty-symbol">▤</span>Aucun ticket pour ce tirage.</div>';
  renderHistory();
  renderTransactions();
  renderParticipations();
  renderNotifications();
  $('availableBalance').textContent=eth(state.balance)+' ETH';
  $('ticketSummary').textContent=`Tirage #${String(state.round).padStart(3,'0')} · ${state.myTickets} ticket${state.myTickets>1?'s':''}`;
  $('networkLabel').textContent=mode==='demo'?'Réseau de test':'Local · 31337';
  updateEstimate();
  countdown();
}
function countdown(){if(!state)return;const seconds=Math.max(0,Math.floor((state.endsAt-Date.now())/1000));$('countdown').innerHTML=`${String(Math.floor(seconds/3600)).padStart(2,'0')} <small>h</small> : ${String(Math.floor(seconds/60)%60).padStart(2,'0')} <small>m</small> : ${String(seconds%60).padStart(2,'0')} <small>s</small>`;}
async function readChain(){
  if(!config)throw new Error('Contrat absent : lancez npm run chain puis npm run deploy.');
  if(!provider||!account)return;
  const network=await provider.getNetwork();if(Number(network.chainId)!==config.chainId)throw new Error('Sélectionnez le réseau local 31337 dans MetaMask.');
  const [total,deadline,capacity,drawBlock,settled,myTickets,balance,winner,logs]=await Promise.all([contract.totalTickets(),contract.deadline(),contract.maxTickets(),contract.drawBlock(),contract.settled(),contract.ticketCount(account),provider.getBalance(account),contract.winner(),contract.queryFilter(contract.filters.TicketPurchased(),0,'latest')]);
  const players=new Set(logs.map(l=>l.args.player));
  const activity=await Promise.all(logs.slice(-12).reverse().map(async l=>({address:l.args.player,quantity:Number(l.args.quantity),date:Number((await l.getBlock()).timestamp)*1000})));
  const winners=await contract.queryFilter(contract.filters.WinnerSelected(),0,'latest');
  const history=await Promise.all(winners.map(async l=>({round:1,winner:l.args.player,prize:Number(formatEther(l.args.prize)),tickets:Number(total),date:Number((await l.getBlock()).timestamp)*1000})));
  const transactions=await Promise.all(logs.filter(l=>l.args.player.toLowerCase()===account.toLowerCase()).map(async l=>({id:l.transactionHash,type:'purchase',round:1,quantity:Number(l.args.quantity),amount:-Number(l.args.quantity)*.01,date:Number((await l.getBlock()).timestamp)*1000})));
  for(const result of history)if(result.winner.toLowerCase()===account.toLowerCase())transactions.push({id:'result-'+result.round,type:'win',round:1,quantity:0,amount:result.prize,date:result.date});
  transactions.sort((a,b)=>b.date-a.date);
  state={transactions,round:1,totalTickets:Number(total),endsAt:Number(deadline)*1000,capacity:Number(capacity),myTickets:Number(myTickets),pot:settled?0:Number(total)*.01,participants:players.size,balance:Number(formatEther(balance)),address:account,activity,history,closed:settled||drawBlock>0n||Date.now()>=Number(deadline)*1000};
  if(settled)$('contractAddress').textContent=`Contrat : ${config.address} · Gagnant : ${winner}`;
  render();
}
async function refresh(){const selected=mode;try{if(mode==='demo'){const data=await api('/api/state');if(mode!==selected)return;state=data;render();}else await readChain();}catch(e){toast(e.message,true);}}
async function connect(){
  if(!window.ethereum)throw new Error('Installez MetaMask pour utiliser la blockchain locale. La démonstration reste disponible.');
  if(!config)throw new Error('Déployez le contrat avec npm run chain puis npm run deploy.');
  const chainId=await window.ethereum.request({method:'eth_chainId'});
  if(Number(chainId)!==config.chainId){try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x7a69'}]});}catch(e){if(e.code!==4902)throw e;await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:'0x7a69',chainName:'BlockLucky Local',rpcUrls:['http://127.0.0.1:8545'],nativeCurrency:{name:'Ether de test',symbol:'ETH',decimals:18}}]});}}
  provider=new BrowserProvider(window.ethereum);const signer=await provider.getSigner();account=await signer.getAddress();contract=new Contract(config.address,config.abi,signer);await readChain();
}
function errorMessage(e){return e.code==='ACTION_REJECTED'||e.code===4001?'Transaction annulée.':e.shortMessage||e.message||'L’opération a échoué.';}
$('buy').onclick=()=>{
  if(busy||!state)return;
  setQuantity($('quantity').value);
  if($('buy').disabled)return;
  pendingPurchase={quantity,round:state.round,mode,requestId:crypto.randomUUID().replaceAll('-','')};
  $('purchaseSummary').innerHTML=`<div class="summary-row"><span>Tirage</span><strong>#${String(state.round).padStart(3,'0')}</strong></div><div class="summary-row"><span>Tickets</span><strong>${quantity} × 0,01 ETH</strong></div><div class="summary-row summary-total"><span>Total</span><strong>${eth(quantity*.01)} ETH</strong></div><div class="summary-row"><span>Solde après achat${mode==='chain'?' hors frais':''}</span><strong>${eth(state.balance-quantity*.01)} ETH</strong></div>`;
  $('purchaseNetwork').textContent=mode==='demo'?'Réseau de test · crédits sans valeur monétaire.':'Réseau local · frais de transaction en supplément.';
  $('confirmPurchase').textContent='Confirmer · '+eth(quantity*.01)+' ETH';
  $('purchaseDialog').showModal();
};
function closePurchase(){if(!busy){$('purchaseDialog').close();pendingPurchase=null;}}
$('closePurchase').onclick=closePurchase;$('cancelPurchase').onclick=closePurchase;
$('purchaseDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else pendingPurchase=null;});
$('confirmPurchase').onclick=async()=>{
  if(busy||!pendingPurchase)return;
  const purchase={...pendingPurchase};
  if(purchase.mode!==mode||purchase.round!==state?.round){closePurchase();toast('Le tirage a changé. Vérifiez votre achat.',true);return;}
  busy=true;$('confirmPurchase').disabled=true;$('confirmPurchase').textContent='Confirmation en cours…';$('closePurchase').disabled=true;$('cancelPurchase').disabled=true;render();
  try{
    if(mode==='demo'){
      const result=await api('/api/tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quantity:purchase.quantity,round:purchase.round,requestId:purchase.requestId})});toast(result.message);
    }else{
      if(!contract)await connect();
      await(await contract.buyTickets(purchase.quantity,{value:parseEther((purchase.quantity*.01).toFixed(2))})).wait();toast('Achat confirmé.');
    }
    $('purchaseDialog').close();pendingPurchase=null;await refresh();
  }catch(e){toast(errorMessage(e),true);await refresh();}
  finally{busy=false;$('confirmPurchase').disabled=false;$('confirmPurchase').textContent='Confirmer · '+eth(purchase.quantity*.01)+' ETH';$('closePurchase').disabled=false;$('cancelPurchase').disabled=false;render();}
};
$('mode').onchange=async e=>{mode=e.target.value;contract=null;provider=null;account=null;if(mode==='chain'){state=null;$('walletLabel').textContent='Connecter MetaMask';$('buy').disabled=false;$('buy').innerHTML='Connecter et acheter ↗';try{await connect();}catch(e){toast(errorMessage(e),true);mode='demo';$('mode').value='demo';await refresh();}}else await refresh();$('chainActions').hidden=mode!=='chain';};
$('wallet').onclick=async()=>{try{if(mode==='chain'&&!account)await connect();if(!state)return;$('dialogDescription').textContent=mode==='demo'?'Réseau de test · crédits sans valeur monétaire.':'MetaMask · Réseau local 31337 · ETH de test.';$('dialogBalance').textContent=eth(state.balance)+' ETH';$('dialogAddress').textContent=state.address;$('walletDialog').showModal();}catch(e){toast(errorMessage(e),true);}};
$('closeDialog').onclick=()=>$('walletDialog').close();$('walletDialog').addEventListener('click',e=>{if(e.target===$('walletDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('copyAddress').onclick=async()=>{try{await navigator.clipboard.writeText(state.address);toast('Adresse copiée.');}catch{toast('La copie est indisponible dans ce navigateur.',true);}};
for(const [id,method] of Object.entries({scheduleDraw:'scheduleDraw',draw:'draw',refund:'refund',withdraw:'withdraw'}))$(id).onclick=async()=>{if(busy)return;busy=true;$(id).disabled=true;try{if(!contract)await connect();await(await contract[method]()).wait();toast('Transaction confirmée.');await refresh();}catch(e){toast(errorMessage(e),true);}finally{busy=false;$(id).disabled=false;}};
if(window.ethereum){window.ethereum.on('accountsChanged',()=>{if(mode==='chain'&&account){contract=null;account=null;connect().catch(e=>{toast(errorMessage(e),true);mode='demo';$('mode').value='demo';$('chainActions').hidden=true;refresh();});}});window.ethereum.on('chainChanged',()=>{if(mode==='chain'&&account){contract=null;account=null;provider=null;mode='demo';$('mode').value='demo';$('chainActions').hidden=true;toast('Réseau modifié. Retour à la démonstration.');refresh();}});}
try{const response=await fetch('/contract.json');if(response.ok){config=await response.json();$('contractAddress').textContent=`Réseau local ${config.chainId} · Contrat : ${config.address}`;}}catch{}

function updateEstimate(){
  if(!state)return;
  const remaining=Math.max(0,state.capacity-state.totalTickets);
  const affordable=Math.min(20,remaining,Math.floor((state.balance+1e-9)/.01));
  const valid=quantity<=affordable&&!state.closed;
  const share=state.totalTickets+quantity>0?(state.myTickets+quantity)/(state.totalTickets+quantity)*100:0;
  $('estimatedOdds').textContent=valid?share.toLocaleString('fr-FR',{maximumFractionDigits:1})+' %':'—';
  $('chanceProgress').style.width=(valid?share:0)+'%';
  $('maxQuantity').disabled=affordable<1||busy||state.closed;
  $('buy').disabled=busy||!valid;
  $('buy').innerHTML=busy?'Achat en cours…':state.closed?'Tirage clôturé':quantity>remaining?'Tickets insuffisants':quantity>affordable?'Solde insuffisant':`Acheter ${quantity} ticket${quantity>1?'s':''} <span>→</span>`;
  $('minus').disabled=quantity<=1||busy;$('plus').disabled=quantity>=20||busy;
}
function renderHistory(){
  if(!state)return;
  const query=$('historySearch').value.trim().toLowerCase();
  const mine=$('historyFilter').value==='mine';
  const rows=state.history.filter(h=>(!mine||h.winner.toLowerCase()===state.address.toLowerCase())&&(!query||String(h.round).includes(query)||h.winner.toLowerCase().includes(query)));
  $('history').innerHTML=rows.length?rows.map(h=>`<div class="history-row"><b>Tirage #${String(h.round).padStart(3,'0')}</b><span>${safe(short(h.winner))}${h.winner.toLowerCase()===state.address.toLowerCase()?' · Vous':''}</span><span>${h.tickets} tickets · ${new Date(h.date).toLocaleDateString('fr-FR')}</span><strong>${eth(h.prize)} ETH</strong></div>`).join(''):`<div class="empty"><span class="empty-symbol">↺</span>${state.history.length?'Aucun résultat correspondant.':'Aucun tirage terminé.'}</div>`;
}
function downloadCsv(filename,rows){
  const csv='\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('maxQuantity').onclick=()=>{if(state)setQuantity(Math.max(1,Math.min(20,state.capacity-state.totalTickets,Math.floor((state.balance+1e-9)/.01))));};
$('saveQuantity').onclick=()=>{try{localStorage.setItem('blocklucky.quantity',String(quantity));$('savedQuantity').textContent=quantity+' mémorisé'+(quantity>1?'s':'');toast('Choix mémorisé pour votre prochaine visite.');}catch{toast('La mémorisation est indisponible.',true);}};
$('historySearch').oninput=renderHistory;$('historyFilter').onchange=renderHistory;
$('exportTickets').onclick=()=>{if(!state?.myTickets){toast('Aucun ticket à exporter.',true);return;}downloadCsv('blocklucky-tickets.csv',[['Tirage','Ticket personnel','Portefeuille','Prix ETH','Réseau'],...Array.from({length:state.myTickets},(_,i)=>[state.round,state.myTicketNumbers?.[i]??i+1,state.address,'0.01',mode==='demo'?'Démonstration':'Local 31337'])]);};
$('exportHistory').onclick=()=>{if(!state)return;const query=$('historySearch').value.trim().toLowerCase();const rows=state.history.filter(h=>($('historyFilter').value!=='mine'||h.winner.toLowerCase()===state.address.toLowerCase())&&(!query||String(h.round).includes(query)||h.winner.toLowerCase().includes(query)));if(!rows.length){toast('Aucun résultat à exporter.',true);return;}downloadCsv('blocklucky-resultats.csv',[['Tirage','Gagnant','Tickets','Gain ETH','Date'],...rows.map(h=>[h.round,h.winner,h.tickets,h.prize,new Date(h.date).toISOString()])]);};
try{const saved=Number(localStorage.getItem('blocklucky.quantity'));if(saved>=1&&saved<=20){setQuantity(saved);$('savedQuantity').textContent=saved+' mémorisé'+(saved>1?'s':'');}}catch{}


function renderTransactions(){
  if(!state)return;
  const type=$('transactionFilter').value;
  const rows=(state.transactions||[]).filter(t=>type==='all'||t.type===type);
  $('transactions').innerHTML=rows.length?rows.map(t=>`<div class="ledger-row ${t.type==='win'?'win':''}"><span class="ledger-sign">${t.type==='win'?'+':'−'}</span><div><b>${t.type==='win'?'Gain du tirage':`Achat de ${t.quantity} ticket${t.quantity>1?'s':''}`}</b><small>Tirage #${String(t.round).padStart(3,'0')} · ${safe(short(t.id))}</small></div><span>${new Date(t.date).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span><strong>${t.amount>0?'+':'−'}${eth(Math.abs(t.amount))} ETH${t.type==='purchase'?`<button class="receipt-button" data-receipt="${safe(t.id)}">Reçu ↓</button>`:''}</strong></div>`).join(''):'<div class="empty">Aucune opération.</div>';
}
$('transactionFilter').onchange=renderTransactions;
$('calendarReminder').onclick=()=>{
  if(!state||state.closed||state.endsAt<=Date.now()){toast('Ce tirage est clôturé.',true);return;}
  const stamp=n=>new Date(n).toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}/,'');
  const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//BlockLucky//Tirages//FR','BEGIN:VEVENT',`UID:blocklucky-${mode}-${state.round}-${Math.floor(state.endsAt/1000)}@local`,`DTSTAMP:${stamp(Date.now())}`,`DTSTART:${stamp(state.endsAt)}`,`DTEND:${stamp(state.endsAt+60000)}`,`SUMMARY:BlockLucky - Tirage ${state.round}`,'DESCRIPTION:Cloture prevue du tirage. Elle peut intervenir avant si tous les tickets sont vendus.','BEGIN:VALARM','TRIGGER:-PT5M','ACTION:DISPLAY','DESCRIPTION:Tirage BlockLucky dans 5 minutes','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const url=URL.createObjectURL(new Blob([content],{type:'text/calendar;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='blocklucky-tirage-'+state.round+'.ics';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Rappel prêt à ajouter au calendrier.');
};
window.addEventListener('popstate',()=>show(labels[location.hash.slice(1)]?location.hash.slice(1):'lottery'));
window.addEventListener('hashchange',()=>{if(labels[location.hash.slice(1)])show(location.hash.slice(1));else show('lottery');});
show(labels[location.hash.slice(1)]?location.hash.slice(1):'lottery');


function getParticipations(){
  if(mode==='demo')return state?.participations||[];
  if(!state?.myTickets)return [];
  const result=state.history[0];
  return [{round:1,quantity:state.myTickets,ticketNumbers:[],status:result?(result.winner.toLowerCase()===state.address.toLowerCase()?'won':'lost'):'pending',...(result||{})}];
}
function renderParticipations(){
  if(!state)return;
  const filter=$('participationFilter').value;
  const entries=getParticipations().filter(p=>filter==='all'||p.status===filter);
  $('pastParticipations').innerHTML=entries.length?entries.map(p=>`<article class="round-card"><div class="section-title"><h2>Tirage #${String(p.round).padStart(3,'0')}</h2><span class="round-status ${safe(p.status)}">${p.status==='pending'?'En cours':p.status==='won'?'Gagné':'Terminé'}</span></div><div class="round-summary"><span>${p.quantity} ticket${p.quantity>1?'s':''}</span><strong>${p.status==='won'?'+'+eth(p.prize)+' ETH':eth(p.quantity*.01)+' ETH engagés'}</strong></div><div class="round-actions">${p.status==='pending'?'<button class="text-button" data-open-current>Voir mes tickets →</button>':`<button class="text-button" data-result="${p.round}">Voir le résultat →</button>`}</div></article>`).join(''):'<div class="empty">Aucun tirage dans cette catégorie.</div>';
}
function renderNotifications(){
  if(!state)return;
  const notifications=mode==='demo'?(state.notifications||[]):state.history.filter(h=>state.myTickets>0).map(h=>({id:'chain-'+h.round,round:h.round,type:h.winner.toLowerCase()===state.address.toLowerCase()?'won':'lost',prize:h.prize,date:h.date,read:true}));
  const unread=notifications.filter(n=>!n.read).length;
  $('notificationCount').textContent=unread;$('notificationCount').hidden=unread===0;
  $('notificationButton').setAttribute('aria-label',unread?`Notifications : ${unread} non lue${unread>1?'s':''}`:'Notifications');
  $('notificationList').innerHTML=notifications.length?notifications.map(n=>`<button class="notification-item ${n.read?'':'unread'}" data-result="${n.round}"><span class="notification-state ${n.type==='won'?'won':''}">${n.type==='won'?'+':'✓'}</span><span><b>${n.type==='won'?`Vous remportez ${eth(n.prize)} ETH`:`Le tirage #${String(n.round).padStart(3,'0')} est terminé`}</b><small>Tirage #${String(n.round).padStart(3,'0')} · ${new Date(n.date).toLocaleDateString('fr-FR')}</small></span><span>→</span></button>`).join(''):'<div class="empty">Vos résultats apparaîtront ici.</div>';
}
function openResult(round){
  const entry=getParticipations().find(p=>p.round===round&&p.status!=='pending');
  if(!entry){toast('Ce résultat n’est plus disponible.',true);return;}
  $('notificationsDialog').close();
  $('resultTitle').textContent='Tirage #'+String(round).padStart(3,'0');
  $('resultDetails').innerHTML=`<div class="result-outcome ${entry.status==='won'?'won':''}">${entry.status==='won'?`Vous remportez ${eth(entry.prize)} ETH`:'Tirage terminé'}</div><div class="summary-row"><span>Cagnotte</span><strong>${eth(entry.prize)} ETH</strong></div><div class="summary-row"><span>Gagnant</span><strong>${safe(short(entry.winner))}</strong></div>${entry.winningTicket?`<div class="summary-row"><span>Ticket gagnant</span><strong>N° ${String(entry.winningTicket).padStart(3,'0')}</strong></div>`:''}<div class="summary-row"><span>Votre participation</span><strong>${entry.quantity} tickets · ${eth(entry.quantity*.01)} ETH</strong></div>${entry.ticketNumbers?.length?`<p class="result-ticket-label">Vos numéros</p><div class="result-ticket-numbers">${entry.ticketNumbers.map(n=>`<span class="${n===entry.winningTicket?'winner-number':''}">${String(n).padStart(3,'0')}</span>`).join('')}</div>`:''}`;
  $('resultDialog').showModal();
}
$('participationFilter').onchange=renderParticipations;
$('pastParticipations').addEventListener('click',e=>{const result=e.target.closest('[data-result]');if(result)openResult(Number(result.dataset.result));if(e.target.closest('[data-open-current]'))$('myTickets').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});});
$('notificationList').addEventListener('click',e=>{const result=e.target.closest('[data-result]');if(result)openResult(Number(result.dataset.result));});
$('notificationButton').onclick=async()=>{
  renderNotifications();$('notificationsDialog').showModal();
  if(mode==='demo'){
    const ids=(state?.notifications||[]).filter(n=>!n.read).map(n=>n.id);
    if(ids.length)try{await api('/api/notifications/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});for(const n of state.notifications)if(ids.includes(n.id))n.read=true;renderNotifications();}catch(e){toast(e.message,true);}
  }
};
$('closeNotifications').onclick=()=>$('notificationsDialog').close();$('closeResult').onclick=()=>$('resultDialog').close();
$('transactions').addEventListener('click',async e=>{
  const button=e.target.closest('[data-receipt]');if(!button||button.disabled)return;
  button.disabled=true;
  try{
    const receipt=mode==='demo'?await api('/api/receipts/'+encodeURIComponent(button.dataset.receipt)):{...state.transactions.find(t=>t.id===button.dataset.receipt),address:state.address,network:'Local 31337',contract:config?.address};
    const url=URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='blocklucky-recu-'+button.dataset.receipt+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){toast(e.message,true);}finally{button.disabled=false;}
});

await refresh();setInterval(countdown,1000);setInterval(()=>{if(!busy)refresh();},10000);

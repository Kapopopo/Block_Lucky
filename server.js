import express from 'express';
import {randomBytes,randomInt} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
export function createApp({file=path.join(root,'data/state.json'),duration=3600000,capacity=100}={}) {
  mkdirSync(path.dirname(file),{recursive:true});
  let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{round:1,endsAt:Date.now()+duration,tickets:[],history:[],sessions:{},activity:[]};
  function save(){writeFileSync(file+'.tmp',JSON.stringify(state));renameSync(file+'.tmp',file);}
  function settle(){
    if(state.tickets.length && (Date.now()>=state.endsAt || state.tickets.length>=capacity)){
      const winningTicket=randomInt(state.tickets.length)+1;
      const winner=state.tickets[winningTicket-1];
      const prize=state.tickets.length;
      state.sessions[winner].balance+=prize;
      const recipient=state.sessions[winner];
      recipient.transactions=[{id:randomBytes(8).toString('hex'),type:'win',round:state.round,amount:prize/100,quantity:0,date:Date.now()},...(recipient.transactions||[])].slice(0,100);
      for(const player of new Set(state.tickets)){
        const participant=state.sessions[player];
        let entry=participant.participations?.find(p=>p.round===state.round);
        if(!entry){entry={round:state.round,quantity:state.tickets.filter(id=>id===player).length,ticketNumbers:state.tickets.flatMap((id,i)=>id===player?[i+1]:[])};participant.participations=[entry,...(participant.participations||[])].slice(0,100);}
        Object.assign(entry,{status:player===winner?'won':'lost',winner:state.sessions[winner].address,winningTicket,totalTickets:prize,prize:prize/100,date:Date.now()});
        participant.notifications=[{id:randomBytes(8).toString('hex'),round:state.round,type:entry.status,prize:player===winner?prize/100:0,winningTicket,date:Date.now(),read:false},...(participant.notifications||[])].slice(0,50);
      }
      state.history.unshift({round:state.round,winningTicket,winner:state.sessions[winner].address,prize:prize/100,tickets:state.tickets.length,date:Date.now()});
      state.history=state.history.slice(0,30);state.round++;state.tickets=[];state.endsAt=Date.now()+duration;save();
    } else if(!state.tickets.length && Date.now()>=state.endsAt){state.endsAt=Date.now()+duration;save();}
  }
  const app=express();app.disable('x-powered-by');app.use(express.json({limit:'2kb'}));
  app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','same-origin');next();});
  app.use('/api',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(req.method==='POST' && req.get('origin') && req.get('origin')!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Origine non autorisée.'});
    let id=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('bl_session='))?.slice(11);
    if(!id || !Object.hasOwn(state.sessions,id)){id=randomBytes(24).toString('hex');state.sessions[id]={address:'0x'+randomBytes(20).toString('hex'),balance:100};save();res.cookie('bl_session',id,{httpOnly:true,sameSite:'strict',maxAge:30*86400000,secure:req.secure});}
    req.player=id;settle();next();
  });
  app.get('/api/state',(req,res)=>{
    const me=state.sessions[req.player];
    res.json({round:state.round,endsAt:state.endsAt,capacity,ticketPrice:0.01,totalTickets:state.tickets.length,participants:new Set(state.tickets).size,pot:state.tickets.length/100,myTickets:state.tickets.filter(x=>x===req.player).length,balance:me.balance/100,address:me.address,history:state.history,activity:state.activity.slice(0,12),transactions:me.transactions||[],participations:me.participations||[],notifications:me.notifications||[],myTicketNumbers:state.tickets.flatMap((player,index)=>player===req.player?[index+1]:[])});
  });
  app.post('/api/tickets',(req,res)=>{
    const quantity=req.body.quantity;
    if(!Number.isInteger(quantity)||quantity<1||quantity>20)return res.status(400).json({error:'Choisissez entre 1 et 20 tickets.'});
    const me=state.sessions[req.player];
    const requestId=req.body.requestId;
    if(requestId!==undefined && (typeof requestId!=='string'||!(/^[a-f0-9]{32}$/i).test(requestId)))return res.status(400).json({error:'Référence de requête invalide.'});
    const previous=requestId&&(me.receipts||[]).find(r=>r.requestId===requestId);
    if(previous){
      if(previous.quantity!==quantity || (req.body.round!==undefined&&previous.round!==req.body.round))return res.status(409).json({error:'Cette référence correspond à un autre achat.'});
      return res.status(200).json({message:'Cet achat est déjà enregistré.',receipt:previous});
    }
    if(req.body.round!==undefined && req.body.round!==state.round)return res.status(409).json({error:'Le tirage a changé. Vérifiez votre achat.'});
    if(state.tickets.length+quantity>capacity)return res.status(409).json({error:'Il ne reste pas assez de tickets.'});
    if(me.balance<quantity)return res.status(400).json({error:'Solde insuffisant.'});
    const receipt={id:randomBytes(8).toString('hex'),requestId,type:'purchase',round:state.round,amount:-quantity/100,quantity,date:Date.now(),address:me.address,network:'Démonstration — crédits de test',ticketNumbers:Array.from({length:quantity},(_,i)=>state.tickets.length+i+1)};
    me.receipts=[receipt,...(me.receipts||[])].slice(0,100);
    let entry=me.participations?.find(p=>p.round===state.round);
    if(!entry){entry={round:state.round,quantity:state.tickets.filter(id=>id===req.player).length,ticketNumbers:state.tickets.flatMap((id,i)=>id===req.player?[i+1]:[]),status:'pending',date:receipt.date};me.participations=[entry,...(me.participations||[])].slice(0,100);}
    entry.quantity+=quantity;entry.ticketNumbers.push(...receipt.ticketNumbers);
    me.transactions=[receipt,...(me.transactions||[])].slice(0,100);
    me.balance-=quantity;state.tickets.push(...Array(quantity).fill(req.player));
    state.activity.unshift({address:me.address,quantity,date:Date.now(),round:state.round});state.activity=state.activity.slice(0,50);save();settle();
    res.status(201).json({message:`${quantity} ticket${quantity>1?'s':''} enregistré${quantity>1?'s':''}.`,receipt});
  });
  app.post('/api/notifications/read',(req,res)=>{
    const me=state.sessions[req.player];
    // Acknowledge only the notifications the client actually opened.
    if(!Array.isArray(req.body.ids)||req.body.ids.length>50||req.body.ids.some(id=>typeof id!=='string'))return res.status(400).json({error:'Notifications invalides.'});
    const ids=new Set(req.body.ids);
    for(const notification of me.notifications||[])if(ids.has(notification.id))notification.read=true;
    save();res.json({ok:true});
  });
  app.get('/api/receipts/:id',(req,res)=>{
    const receipt=(state.sessions[req.player].receipts||[]).find(r=>r.id===req.params.id);
    if(!receipt)return res.status(404).json({error:'Reçu introuvable.'});
    res.json(receipt);
  });
  app.get('/contract-source',(req,res)=>res.type('text/plain').sendFile(path.join(root,'contracts/BlockLucky.sol')));
  app.get('/vendor/ethers.js',(req,res)=>res.sendFile(path.join(root,'node_modules/ethers/dist/ethers.min.js')));
  app.use(express.static(path.join(root,'public')));
  app.use((err,req,res,next)=>res.status(400).json({error:'Requête invalide.'}));
  return app;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))createApp().listen(Number(process.env.PORT)||3000,'127.0.0.1',()=>console.log('BlockLucky → http://localhost:3000'));

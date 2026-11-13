// Tests des nouvelles fonctionnalités du serveur : comptes, admin, annonces,
// connexion avec Ethereum, robinet, limite par joueur et temps réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { createApp } from '../server.js';

/** Lance un serveur sur un port libre avec des fichiers temporaires, et renvoie un « navigateur » de test. */
async function fixture(t, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'blocklucky-'));
  const server = createApp({ file: path.join(dir, 'state.json'), contractFile: path.join(dir, 'contract.json'), ...options }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const makeClient = () => {
    let cookie = '';
    const call = async (url, body, method) => {
      const res = await fetch(base + url, {
        method: method || (body ? 'POST' : 'GET'),
        headers: { cookie, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      return { status: res.status, data: await res.json() };
    };
    call.newSession = makeClient;
    return call;
  };
  const call = makeClient();
  return Object.assign(call, { base, dir });
}

/** Joueur démo avec un compte (un invité a un portefeuille vide et ne peut pas acheter). */
async function player(t, options) {
  const call = await fixture(t, options);
  await call('/api/account/register', { email: 'joueur@exemple.fr', pseudo: 'Joueur', password: 'motdepasse1' });
  return call;
}

async function adminAndPlayer(t, options) {
  const admin = await fixture(t, options);
  await admin('/api/account/register', { email: 'admin@exemple.fr', pseudo: 'Admin', password: 'motdepasse1' });
  const player = admin.newSession();
  await player('/api/account/register', { email: 'joueur@exemple.fr', pseudo: 'Joueur', password: 'motdepasse2' });
  return { admin, player };
}

// --- Limite par joueur ---

test('limite de tickets par joueur : refus au-delà, sans débit', async t => {
  const call = await player(t, { maxPerPlayer: 5 });
  assert.equal((await call('/api/tickets', { quantity: 3 })).status, 201);
  const refused = await call('/api/tickets', { quantity: 3 });
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /Limite atteinte : 5 tickets/);
  const { data } = await call('/api/state');
  assert.equal(data.balance, 0.97);
  assert.equal(data.rules.maxPerPlayer, 5);
  assert.equal((await call('/api/tickets', { quantity: 2 })).status, 201);
});

// --- Comptes ---

test('invité : portefeuille vide, achat refusé, 1 ETH fictif offert une seule fois à l’inscription', async t => {
  const call = await fixture(t);
  let state = (await call('/api/state')).data;
  assert.equal(state.balance, 0);
  const refused = await call('/api/tickets', { quantity: 1 });
  assert.equal(refused.status, 403);
  assert.match(refused.data.error, /Crée un compte/);
  assert.equal((await call('/api/state')).data.totalTickets, 0);

  await call('/api/account/register', { email: 'alice@exemple.fr', pseudo: 'Alice', password: 'motdepasse1' });
  state = (await call('/api/state')).data;
  assert.equal(state.balance, 1);
  assert.deepEqual(state.transactions.map(x => x.type), ['welcome']);

  // Déconnexion : nouvelle session invitée vide ; reconnexion : solde retrouvé, pas de second cadeau.
  await call('/api/account/logout', {});
  assert.equal((await call('/api/state')).data.balance, 0);
  await call('/api/account/login', { email: 'alice@exemple.fr', password: 'motdepasse1' });
  state = (await call('/api/state')).data;
  assert.equal(state.balance, 1);
  assert.equal(state.transactions.length, 1);
});

test('ancien fichier : les invités sont entièrement vidés, les comptes gardent tout', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blocklucky-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  writeFileSync(file, JSON.stringify({ round: 2, endsAt: Date.now() + 60000, tickets: [], history: [{ round: 1, winner: '0x02', prize: 1.2, tickets: 120 }], activity: [], sessions: {
    neuf: { address: '0x01', balance: 100 },
    joueur: { address: '0x02', balance: 120, transactions: [{ type: 'win' }], participations: [{ round: 1 }], receipts: [{ id: 'r' }], notifications: [{ round: 1 }] },
    compte: { address: '0x03', balance: 80, account: 'alice@exemple.fr', transactions: [{ type: 'welcome' }] },
  } }));
  const server = createApp({ file, contractFile: path.join(dir, 'contract.json') }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const stateOf = async id => (await fetch(`http://127.0.0.1:${server.address().port}/api/state`, { headers: { cookie: `bl_session=${id}` } })).json();
  assert.equal((await stateOf('neuf')).balance, 0); // invité qui n'a jamais joué
  const guest = await stateOf('joueur');            // invité qui a déjà joué : tout est vidé
  assert.equal(guest.balance, 0);
  assert.deepEqual([guest.transactions, guest.participations, guest.notifications], [[], [], []]);
  assert.notEqual(guest.address, '0x02'); // nouvelle adresse : l'ancien gain n'est plus affiché comme le sien
  assert.equal(guest.history[0].winner, '0x02'); // l'historique public, lui, ne change pas
  const account = await stateOf('compte');          // compte : tout est conservé
  assert.equal(account.balance, 0.8);
  assert.equal(account.transactions.length, 1);
  assert.equal(account.address, '0x03');
});

test('comptes : premier compte admin, solde de bienvenue, connexion sur un autre appareil', async t => {
  const call = await fixture(t);
  const created = await call('/api/account/register', { email: 'Alice@Exemple.fr', pseudo: 'Alice', password: 'motdepasse1' });
  assert.equal(created.status, 201);
  assert.equal(created.data.account.role, 'admin');
  await call('/api/tickets', { quantity: 4 });
  let session = (await call('/api/session')).data;
  assert.equal(session.account.email, 'alice@exemple.fr');
  assert.equal(session.isAdmin, true);

  const other = call.newSession();
  assert.equal((await other('/api/account/register', { email: 'bob@exemple.fr', pseudo: 'Bob', password: 'motdepasse2' })).data.account.role, 'player');
  assert.equal((await other('/api/account/register', { email: 'x@exemple.fr', pseudo: 'Xavier', password: 'motdepasse9' })).status, 409); // déjà connecté
  const third = call.newSession();
  assert.equal((await third('/api/account/register', { email: 'alice@exemple.fr', pseudo: 'Alice2', password: 'motdepasse3' })).status, 409);
  assert.equal((await third('/api/account/register', { email: 'carole@exemple.fr', pseudo: 'C', password: 'motdepasse3' })).status, 400);
  assert.equal((await third('/api/account/register', { email: 'pas-un-email', pseudo: 'Carole', password: 'motdepasse3' })).status, 400);
  assert.equal((await third('/api/account/register', { email: 'carole@exemple.fr', pseudo: 'Carole', password: 'court' })).status, 400);

  // Un autre « appareil » se connecte au compte d'Alice et retrouve son solde et ses tickets.
  const device = call.newSession();
  assert.equal((await device('/api/account/login', { email: 'alice@exemple.fr', password: 'mauvais-mot' })).status, 401);
  assert.equal((await device('/api/account/login', { email: 'ALICE@exemple.fr', password: 'motdepasse1' })).status, 200);
  const state = (await device('/api/state')).data;
  assert.equal(state.balance, 0.96);
  assert.equal(state.myTickets, 4);
  assert.equal(state.pseudo, 'Alice');

  await device('/api/account/logout', {});
  session = (await device('/api/session')).data;
  assert.equal(session.account, null);
  assert.equal((await device('/api/state')).data.balance, 0); // nouvelle session invitée : portefeuille vide
});

test('comptes : blocage après 5 mauvais mots de passe', async t => {
  const call = await fixture(t);
  await call('/api/account/register', { email: 'a@exemple.fr', pseudo: 'Alice', password: 'motdepasse1' });
  const attacker = call.newSession();
  for (let i = 0; i < 5; i++) assert.equal((await attacker('/api/account/login', { email: 'a@exemple.fr', password: 'faux' + i })).status, 401);
  assert.equal((await attacker('/api/account/login', { email: 'a@exemple.fr', password: 'motdepasse1' })).status, 429);
});

// --- Espace admin ---

test('admin : réservé aux administrateurs', async t => {
  const { player } = await adminAndPlayer(t);
  assert.equal((await player('/api/admin/stats')).status, 403);
  assert.equal((await player('/api/admin/cancel', {})).status, 403);
  assert.equal((await player('/api/admin/announcements', { title: 'Pirate', message: 'Hack' })).status, 403);
});

test('admin : réglages appliqués tout de suite, ou au prochain tirage si des tickets sont vendus', async t => {
  const { admin, player } = await adminAndPlayer(t);
  let res = await admin('/api/admin/settings', { capacity: 50, durationMinutes: 30, maxPerPlayer: 10 });
  assert.equal(res.data.appliedNow, true);
  assert.deepEqual((await player('/api/state')).data.rules, { capacity: 50, maxPerPlayer: 10, duration: 1800000 });
  await player('/api/tickets', { quantity: 2 });
  res = await admin('/api/admin/settings', { capacity: 80, durationMinutes: 60, maxPerPlayer: 20 });
  assert.equal(res.data.appliedNow, false);
  assert.equal((await player('/api/state')).data.rules.capacity, 50);
  assert.equal((await admin('/api/admin/settings', { capacity: 10, durationMinutes: 60, maxPerPlayer: 11 })).status, 400);
  const stats = (await admin('/api/admin/stats')).data;
  assert.equal(stats.ticketsSold, 2);
  assert.equal(stats.accounts, 2);
  assert.equal(stats.buyers, 1);
  assert.equal(stats.settings.capacity, 80);
});

test('admin : annuler rembourse chaque joueur, sans désigner de gagnant', async t => {
  const { admin, player } = await adminAndPlayer(t);
  assert.equal((await admin('/api/admin/cancel', {})).status, 409);
  await player('/api/tickets', { quantity: 4 });
  assert.equal((await admin('/api/admin/cancel', {})).status, 200);
  const data = (await player('/api/state')).data;
  assert.equal(data.balance, 1);
  assert.equal(data.round, 2);
  assert.equal(data.totalTickets, 0);
  assert.equal(data.history[0].cancelled, true);
  assert.equal(data.history[0].winner, null);
  assert.equal(data.notifications[0].type, 'cancelled');
  assert.equal(data.transactions[0].type, 'refund');
  assert.equal(data.participations[0].status, 'cancelled');
});

test('admin : annonces publiées puis supprimées', async t => {
  const { admin, player } = await adminAndPlayer(t);
  assert.equal((await admin('/api/admin/announcements', { title: '', message: 'x' })).status, 400);
  const { data } = await admin('/api/admin/announcements', { title: 'Grand tirage', message: 'Ce soir à 20 h !' });
  let session = (await player('/api/session')).data;
  assert.equal(session.announcements[0].title, 'Grand tirage');
  assert.equal(session.announcements[0].author, 'Admin');
  assert.equal((await admin('/api/admin/announcements/' + data.announcement.id, undefined, 'DELETE')).status, 200);
  session = (await player('/api/session')).data;
  assert.equal(session.announcements.length, 0);
});

test('admin : QR codes à imprimer enregistrés, conservés à la remise à zéro, puis supprimés', async t => {
  const { admin, player } = await adminAndPlayer(t);
  assert.equal((await player('/api/admin/posters')).status, 403);
  assert.equal((await player('/api/admin/posters', { place: 'Mairie', url: 'https://exemple.fr/' })).status, 403);
  assert.equal((await admin('/api/admin/posters', { place: '', url: 'https://exemple.fr/' })).status, 400);
  assert.equal((await admin('/api/admin/posters', { place: 'Mairie', url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await admin('/api/admin/posters', { place: 'Mairie', url: 'pas une adresse' })).status, 400);
  assert.equal((await admin('/api/admin/posters', { place: 'Mairie', url: 'https://exemple.fr/', message: 'x'.repeat(141) })).status, 400);

  const { status, data } = await admin('/api/admin/posters', { place: 'Mairie d’EtherBay', url: 'https://exemple.fr', message: 'Tirage à 20 h' });
  assert.equal(status, 201);
  assert.equal(data.poster.url, 'https://exemple.fr/');
  await admin('/api/admin/posters', { place: 'Médiathèque', url: 'http://192.168.1.20:3000/' });
  assert.equal((await admin('/api/admin/reset', {})).status, 200);
  let list = (await admin('/api/admin/posters')).data.posters;
  assert.deepEqual(list.map(p => p.place), ['Médiathèque', 'Mairie d’EtherBay']);

  assert.equal((await admin('/api/admin/posters/' + data.poster.id, undefined, 'DELETE')).status, 200);
  assert.equal((await admin('/api/admin/posters/' + data.poster.id, undefined, 'DELETE')).status, 404);
  list = (await admin('/api/admin/posters')).data.posters;
  assert.deepEqual(list.map(p => p.place), ['Médiathèque']);
});

// --- Connexion avec Ethereum (SIWE) et robinet ---

test('connexion avec Ethereum : signature vérifiée, usage unique', async t => {
  const call = await fixture(t);
  const wallet = Wallet.createRandom();
  const { data } = await call('/api/wallet/challenge', { address: wallet.address, chainId: 31337 });
  assert.match(data.message, /wants you to sign in with your Ethereum account/);
  assert.equal((await call('/api/wallet/verify', { signature: await Wallet.createRandom().signMessage(data.message) })).status, 401);
  const signature = await wallet.signMessage(data.message);
  assert.equal((await call('/api/wallet/verify', { signature })).status, 200);
  assert.equal((await call('/api/session')).data.wallet.address, wallet.address);
  assert.equal((await call('/api/wallet/verify', { signature })).status, 400); // pas de rejeu
  assert.equal((await call('/api/wallet/challenge', { address: '0x123', chainId: 31337 })).status, 400);
});

test('robinet : inactif sans contrat, puis exige la connexion avec Ethereum', async t => {
  const call = await fixture(t);
  assert.equal((await call('/api/faucet', {})).status, 409);
  writeFileSync(path.join(call.dir, 'contract.json'), JSON.stringify({ network: 'local', chainId: 31337, rpcUrl: 'http://127.0.0.1:1' }));
  assert.equal((await call('/api/faucet', {})).status, 401);
  const session = (await call('/api/session')).data;
  assert.equal(session.faucet.enabled, true);
  assert.equal(session.faucet.claimed, false);
});

// --- Temps réel ---

test('temps réel : un achat est annoncé immédiatement aux autres navigateurs', async t => {
  const call = await player(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(call.base + '/api/stream', { signal: controller.signal });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  await call('/api/tickets', { quantity: 1 });
  const deadline = Date.now() + 3000;
  while (!text.includes('event: update') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  assert.match(text, /event: update\ndata: \{"reason":"purchase"/);
});

test('temps réel : le tirage tombe à l’échéance même sans visite', async t => {
  const call = await player(t, { duration: 300, tickMs: 50 });
  await call('/api/tickets', { quantity: 1 });
  await new Promise(resolve => setTimeout(resolve, 600));
  // Aucune requête entre-temps : c'est la minuterie du serveur qui a effectué le tirage.
  const { readFileSync } = await import('node:fs');
  const saved = JSON.parse(readFileSync(path.join(call.dir, 'state.json'), 'utf8'));
  assert.equal(saved.history.length, 1);
  assert.equal(saved.round, 2);
});

// --- Tuto MetaMask mobile ---

test('tuto mobile : adresses réseau seulement si HOST ouvre le serveur au Wi-Fi, QR code servi en module', async t => {
  const closed = await fixture(t, { env: {} });
  assert.deepEqual((await closed('/api/lan')).data, { exposed: false, urls: [] });

  const open = await fixture(t, { env: { HOST: '0.0.0.0' } });
  const { data } = await open('/api/lan');
  assert.equal(data.exposed, true);
  for (const url of data.urls) assert.match(url, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);

  const qr = await fetch(open.base + '/vendor/qrcode.js');
  assert.match(qr.headers.get('content-type'), /javascript/);
  assert.match(await qr.text(), /export default qrcode;\s*$/);
});

// --- Remise à zéro de la démo ---

test('admin : remise à zéro de la démo, statistiques vides, comptes conservés', async t => {
  const { admin, player } = await adminAndPlayer(t, { capacity: 2 });
  await player('/api/tickets', { quantity: 2 }); // tirage complet : un gagnant, des statistiques
  const guest = admin.newSession();
  await guest('/api/state');
  assert.equal((await player('/api/admin/reset', {})).status, 403); // réservé à l'admin
  assert.equal((await admin('/api/admin/stats')).data.roundsPlayed, 1);

  assert.equal((await admin('/api/admin/reset', {})).status, 200);
  const stats = (await admin('/api/admin/stats')).data;
  assert.deepEqual([stats.ticketsSold, stats.roundsPlayed, stats.roundsCancelled, stats.paidOut, stats.buyers], [0, 0, 0, 0, 0]);
  assert.equal(stats.accounts, 2);
  assert.equal(stats.visitors, 2); // la session invitée a disparu, celles des comptes restent

  const state = (await player('/api/state')).data;
  assert.equal(state.round, 1);
  assert.deepEqual([state.history, state.activity, state.participations], [[], [], []]);
  assert.equal(state.balance, 1);
  assert.deepEqual(state.transactions.map(x => x.type), ['welcome']);
  assert.equal((await player('/api/session')).data.account.pseudo, 'Joueur'); // toujours connecté
});

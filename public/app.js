// ---------------------------------------------------------------------------
// BlockLucky — interface web
// Deux modes :
//   • démo       : l'API Express tient les comptes (ETH fictif) ;
//   • blockchain : MetaMask + smart contract BlockLucky (Ganache ou Sepolia).
// ---------------------------------------------------------------------------
import { BrowserProvider, Contract, formatEther, parseEther, keccak256, AbiCoder } from '/vendor/ethers.js';
import { Tour } from './tour.js';
import * as fx from './fx.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
const TICKET_PRICE = 0.01;
const MAX_PER_PURCHASE = 20;
const LOG_CHUNK = 9000;         // les RPC publics refusent de lire plus de 10 000 blocs d'un coup
const DRAW_WINDOW = 256;        // l'EVM ne garde le hash que des 256 derniers blocs
const REFRESH_EVERY = 6000;     // ms

const NETWORKS = {
  31337: { name: 'Ganache (local)', short: 'Local · 31337', explorer: null, blockTime: 'instantané sur Ganache' },
  11155111: { name: 'Sepolia', short: 'Sepolia', explorer: 'https://sepolia.etherscan.io', blockTime: 'environ 12 secondes sur Sepolia' },
};

const VIEWS = { lottery: 'Tableau de bord', tickets: 'Mes tickets', history: 'Résultats', settings: 'Réglages', guide: 'Règles & lexique' };

const PHASES = {
  open: { label: 'Ventes ouvertes', cls: 'status-live', live: true },
  closable: { label: 'Ventes closes', cls: 'status-warn' },
  scheduled: { label: 'Tirage programmé', cls: 'status-warn' },
  drawable: { label: 'Tirage prêt', cls: 'status-live', live: true },
  settled: { label: 'Gagnant désigné', cls: 'status-win' },
  expired: { label: 'Remboursements ouverts', cls: 'status-danger' },
  empty: { label: 'Terminé sans ticket', cls: '' },
};

/** Messages d'erreur du contrat traduits pour un débutant. */
const REVERT_MESSAGES = {
  'Sales closed': 'Les ventes de ce tirage sont closes.',
  'Invalid quantity': 'Quantité invalide, ou plus assez de tickets disponibles.',
  'Wrong payment': 'Le montant envoyé ne correspond pas au prix des tickets.',
  'Not ready': 'Le tirage ne peut pas encore être programmé : la clôture n’est pas atteinte ou aucun ticket n’a été vendu.',
  'Draw unavailable': 'Le tirage n’est pas encore disponible : le bloc programmé doit d’abord être créé.',
  'Refund unavailable': 'Le remboursement n’est possible que si personne n’a lancé le tirage dans les 256 blocs.',
  'Nothing to refund': 'Tu n’as aucun ticket à te faire rembourser.',
  'Nothing to withdraw': 'Tu n’as aucun gain à retirer.',
  'Transfer failed': 'Le transfert vers ton portefeuille a échoué.',
};

const TX_STEPS = [
  ['Signature', 'Confirme la transaction dans la fenêtre MetaMask.'],
  ['Validation par le réseau', 'Un validateur inscrit ta transaction dans un nouveau bloc.'],
  ['Confirmé', 'C’est inscrit dans la blockchain, pour toujours.'],
];

const CHAIN_ACTIONS = {
  scheduleDraw: {
    title: 'Programmer le tirage',
    text: 'Le contrat choisit un bloc futur : son empreinte, encore inconnue, désignera le gagnant.',
    send: contract => contract.scheduleDraw({ gasLimit: 120000 }),
    done: 'Tirage programmé ! Il pourra être lancé dans deux blocs.',
  },
  draw: {
    title: 'Lancer le tirage',
    text: 'Le contrat lit l’empreinte du bloc programmé et en déduit le ticket gagnant.',
    send: contract => contract.draw({ gasLimit: 300000 }),
    done: 'Tirage effectué !',
  },
  refund: {
    title: 'Me faire rembourser',
    text: 'Personne n’a lancé le tirage à temps : ta mise est créditée dans le contrat.',
    send: contract => contract.refund({ gasLimit: 120000 }),
    done: 'Remboursement crédité. Retire-le maintenant vers ton portefeuille.',
  },
  withdraw: {
    title: 'Retirer mes gains',
    text: 'Le contrat t’envoie les ETH qui t’attendent.',
    send: contract => contract.withdraw(),
    done: 'Les ETH sont arrivés dans ton portefeuille !',
  },
};

const CYCLE = [
  ['Ventes', 'Ouvertes 1 h, ou jusqu’à 100 tickets.'],
  ['Programmation', 'Un joueur programme le tirage sur un bloc futur.'],
  ['Attente', 'Le bloc choisi doit être créé.'],
  ['Tirage', 'Son empreinte désigne le ticket gagnant.'],
  ['Retrait', 'Le gagnant retire la cagnotte.'],
];

const TOUR_STEPS = [
  { view: 'lottery', title: 'Bienvenue sur BlockLucky', text: ['BlockLucky est une loterie de démonstration : tu achètes des tickets, un ticket est tiré au sort, et son propriétaire gagne toute la cagnotte.', 'Aucun argent réel n’est en jeu. Ce tuto dure une minute.'] },
  { view: 'lottery', target: '#walletCard', title: 'Ton portefeuille', text: ['Voici ton solde. En mode démo, tu reçois 1 ETH fictif pour jouer.', 'L’ETH est la monnaie de la blockchain Ethereum. Ici, il n’a aucune valeur.'] },
  { view: 'lottery', target: '#potCard', title: 'La cagnotte', text: ['Chaque ticket acheté ajoute 0,01 ETH à la cagnotte, et le gagnant remporte 100 %.', 'Le tirage a lieu au bout d’une heure, ou dès que les 100 tickets sont vendus.'] },
  { view: 'lottery', target: '#quantityZone', title: 'Choisis tes tickets', text: ['Utilise + et −, ou un raccourci. Tu peux prendre de 1 à 20 tickets par achat.'] },
  { view: 'lottery', target: '#estimate', title: 'Tes chances', text: ['Ta part = tes tickets ÷ tous les tickets du tirage. Plus tu en as, plus tes chances montent.'] },
  { view: 'lottery', target: '#buy', title: 'Acheter', text: ['Un récapitulatif s’affiche avant de confirmer : rien n’est débité sans ton accord.'] },
  { view: 'lottery', target: '#activityCard', title: 'En direct', text: ['Les achats de tous les joueurs apparaissent ici. Les adresses sont des identifiants anonymes.'] },
  { view: 'lottery', target: ['.side-nav [data-view="tickets"]', '.mobile-nav [data-view="tickets"]'], title: 'Mes tickets', text: ['Retrouve tes numéros de tickets, tes tirages passés et tes reçus.'] },
  { view: 'lottery', target: ['.side-nav [data-view="history"]', '.mobile-nav [data-view="history"]'], title: 'Résultats', text: ['L’historique de tous les tirages et de leurs gagnants.'] },
  { view: 'lottery', target: '#notificationButton', title: 'Notifications', text: ['Tu es prévenu ici quand un tirage auquel tu participes se termine.'] },
  { view: 'settings', target: '#modeOptions', title: 'Le mode blockchain', text: ['Envie d’aller plus loin ? Passe en mode « Blockchain » avec MetaMask.', 'Les règles sont alors appliquées par un smart contract : un programme public que personne ne peut modifier, pas même l’organisateur.'] },
  { view: 'lottery', target: '#themeToggle', title: 'À toi de jouer !', text: ['Ce bouton change le thème clair ou sombre.', 'Tu peux relancer ce tuto à tout moment depuis « Revoir le tuto » ou les Réglages.'] },
];

// ---------------------------------------------------------------------------
// État de l'application
// ---------------------------------------------------------------------------
const app = {
  mode: 'demo',
  state: null,          // données affichées (même forme dans les deux modes)
  config: null,         // contrat déployé (public/contract.json) ou null
  quantity: 1,
  busy: false,
  view: 'lottery',
  pending: null,        // achat en attente de confirmation
  refreshing: null,
  refreshAgain: false,
  seenDraw: undefined,  // dernier tirage connu, pour déclencher l'animation une seule fois
  seenActivity: null,
  zeroRefreshed: null,
  chain: {
    provider: null, contract: null, account: null,
    info: null,              // phase du tirage, blocs, crédits…
    timeOffset: 0,           // décalage entre l'horloge de la blockchain et celle du navigateur
    events: [], scannedTo: null, blocks: new Map(), wrongNetwork: false,
  },
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const fmtEth = n => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = n => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
const pad = n => String(n).padStart(3, '0');
const short = address => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—';
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const sameAddress = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const network = () => NETWORKS[app.config?.chainId] || { name: `Réseau ${app.config?.chainId}`, short: `Réseau ${app.config?.chainId}`, explorer: null, blockTime: 'quelques secondes' };
const now = () => Date.now() + (app.mode === 'chain' ? app.chain.timeOffset : 0);
const networkLabel = () => (app.mode === 'demo' ? 'Démonstration' : network().short);
const explorerUrl = (kind, value) => network().explorer && app.mode === 'chain' ? `${network().explorer}/${kind}/${value}` : null;

const store = {
  get(key) { try { return localStorage.getItem('blocklucky.' + key); } catch { return null; } },
  set(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem('blocklucky.' + key);
      else localStorage.setItem('blocklucky.' + key, value);
      return true;
    } catch { return false; }
  },
};

/** Ne réécrit le HTML que s'il a changé (évite de rejouer les animations toutes les 6 s). */
function setHTML(el, html) {
  if (el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

function avatar(address, extraClass = '') {
  const hue = parseInt(address.slice(2, 6), 16) % 360;
  return `<span class="avatar ${extraClass}" style="--h:${hue}">${esc(address.slice(2, 4).toUpperCase())}</span>`;
}

function timeAgo(date) {
  const seconds = Math.max(0, (now() - date) / 1000);
  if (seconds < 45) return 'à l’instant';
  if (seconds < 3600) return `il y a ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `il y a ${Math.round(seconds / 3600)} h`;
  return new Date(date).toLocaleDateString('fr-FR');
}

const empty = (icon, text, extra = '') =>
  `<div class="empty"><span class="empty-icon"><svg class="icon"><use href="#${icon}"/></svg></span><p>${text}</p>${extra}</div>`;

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCsv(filename, rows) {
  const csv = '﻿' + rows.map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(';')).join('\r\n');
  download(filename, csv, 'text/csv;charset=utf-8');
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
let toastTimer;
function toast(message, kind = 'info') {
  const el = $('toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 7000 : 4500);
}

/** Erreur de fond (actualisation automatique) : une bannière plutôt qu'une pluie de toasts. */
function setConnectionError(message) {
  $('connectionBanner').hidden = !message;
  if (message) $('connectionMessage').textContent = message;
  $('retryConnection').textContent = app.chain.wrongNetwork ? 'Changer de réseau' : 'Réessayer';
}

function errorMessage(error) {
  if (!error) return 'L’opération a échoué.';
  const code = error.code ?? error.error?.code ?? error.info?.error?.code;
  if (code === 'ACTION_REJECTED' || code === 4001) return 'Action annulée dans MetaMask.';
  if (code === -32002) return 'Une demande MetaMask est déjà en attente : ouvre l’extension pour y répondre.';
  if (code === 'INSUFFICIENT_FUNDS') return 'Solde insuffisant pour payer les tickets et les frais de transaction.';
  const text = [error.reason, error.shortMessage, error.info?.error?.message, error.message].filter(Boolean).join(' ');
  for (const [reason, message] of Object.entries(REVERT_MESSAGES)) if (text.includes(reason)) return message;
  if (/insufficient funds/i.test(text)) return 'Solde insuffisant pour payer les tickets et les frais de transaction.';
  if (code === 'CALL_EXCEPTION') return 'Le contrat a refusé l’opération : ses conditions ne sont pas remplies pour l’instant.';
  if (code === 'NETWORK_ERROR' || code === 'SERVER_ERROR' || code === 'TIMEOUT' || /Failed to fetch|NetworkError/i.test(text)) {
    return app.config?.chainId === 31337 && app.mode === 'chain'
      ? 'Ganache ne répond pas : vérifie que « npm run chain » tourne.'
      : 'Connexion au réseau impossible. Vérifie ta connexion internet.';
  }
  return error.shortMessage || error.message || 'L’opération a échoué.';
}

// ---------------------------------------------------------------------------
// Thème clair / sombre
// ---------------------------------------------------------------------------
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : prefersDark.matches;

function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;
  else delete root.dataset.theme;
  store.set('theme', choice === 'light' || choice === 'dark' ? choice : null);
  $$('[data-theme-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === (root.dataset.theme || 'system'))));
  $('themeColor').content = isDark() ? '#060b09' : '#eef4f1';
}

function switchTheme(choice) {
  if (document.startViewTransition && !fx.reducedMotion()) document.startViewTransition(() => applyTheme(choice));
  else applyTheme(choice);
}

$('themeToggle').addEventListener('click', () => { switchTheme(isDark() ? 'light' : 'dark'); fx.pulse($('themeToggle')); });
$$('[data-theme-choice]').forEach(b => b.addEventListener('click', () => switchTheme(b.dataset.themeChoice)));
prefersDark.addEventListener('change', () => applyTheme(store.get('theme') || 'system'));

// ---------------------------------------------------------------------------
// Navigation entre les vues
// ---------------------------------------------------------------------------
const hashView = () => {
  const hash = location.hash.slice(1);
  if (hash === 'transparency') return 'settings'; // ancien lien
  return VIEWS[hash] ? hash : 'lottery';
};

function show(view, { push = true } = {}) {
  if (!VIEWS[view]) view = 'lottery';
  const changed = view !== app.view;
  app.view = view;
  $$('.view').forEach(el => { el.hidden = el.id !== `view-${view}`; });
  $$('.nav-link').forEach(el => {
    const active = el.dataset.view === view;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  $('pageTitle').textContent = VIEWS[view];
  document.title = `BlockLucky — ${VIEWS[view]}`;
  if (push && location.hash !== '#' + view) history.pushState(null, '', '#' + view);
  if (changed) window.scrollTo({ top: 0, behavior: 'instant' });
}

document.addEventListener('click', event => {
  const link = event.target.closest('[data-view]');
  if (!link) return;
  event.preventDefault();
  show(link.dataset.view);
});
window.addEventListener('popstate', () => show(hashView(), { push: false }));

// ---------------------------------------------------------------------------
// Quantité de tickets
// ---------------------------------------------------------------------------
function affordableTickets() {
  const s = app.state;
  if (!s) return MAX_PER_PURCHASE;
  const remaining = Math.max(0, s.capacity - s.totalTickets);
  const byBalance = Math.floor((s.balance + 1e-9) / TICKET_PRICE);
  return Math.min(MAX_PER_PURCHASE, remaining, byBalance);
}

function setQuantity(value, { animate = true } = {}) {
  const next = Math.max(1, Math.min(MAX_PER_PURCHASE, Math.floor(Number(value)) || 1));
  const changed = next !== app.quantity;
  app.quantity = next;
  $('quantity').value = next;
  if (changed && animate) fx.pulse($('quantity'));
  renderPurchase();
}

$('minus').addEventListener('click', () => setQuantity(app.quantity - 1));
$('plus').addEventListener('click', () => setQuantity(app.quantity + 1));
$('quantity').addEventListener('input', event => { if (event.target.value !== '') setQuantity(event.target.value, { animate: false }); });
$('quantity').addEventListener('change', event => setQuantity(event.target.value, { animate: false }));
$$('[data-quantity]').forEach(b => b.addEventListener('click', () => setQuantity(b.dataset.quantity)));
$('maxQuantity').addEventListener('click', () => setQuantity(Math.max(1, affordableTickets())));
$('saveQuantity').addEventListener('click', () => {
  if (store.set('quantity', String(app.quantity))) {
    $('savedQuantity').textContent = `(${app.quantity} mémorisé${app.quantity > 1 ? 's' : ''})`;
    toast('Quantité mémorisée pour ta prochaine visite.', 'success');
  } else toast('La mémorisation est indisponible dans ce navigateur.', 'error');
});

// ---------------------------------------------------------------------------
// Chargement des données
// ---------------------------------------------------------------------------
async function api(url, body) {
  let response;
  try {
    response = await fetch(url, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' });
  } catch {
    throw new Error('Le serveur BlockLucky ne répond pas. Vérifie que « npm run dev » tourne.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Le serveur est indisponible.');
  return data;
}

async function loadConfig() {
  try {
    const response = await fetch('/contract.json', { cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** Actualise les données. Les appels simultanés sont regroupés pour ne pas surcharger MetaMask. */
function refresh(options) {
  if (app.refreshing) { app.refreshAgain = true; return app.refreshing; }
  app.refreshing = doRefresh(options).finally(() => {
    app.refreshing = null;
    if (app.refreshAgain) { app.refreshAgain = false; refresh(); }
  });
  return app.refreshing;
}

async function doRefresh({ silent = true } = {}) {
  const mode = app.mode;
  try {
    let next;
    if (mode === 'demo') next = { ...(await api('/api/state')), closed: false };
    else if (app.chain.contract) next = await readChain();
    else return;
    if (app.mode !== mode) return; // le mode a changé pendant le chargement
    app.state = next;
    setConnectionError(null);
    render();
    detectDraw();
  } catch (error) {
    if (app.mode !== mode) return;
    const message = errorMessage(error);
    setConnectionError(message);
    if (!silent) toast(message, 'error');
    render();
  }
}

// ---------------------------------------------------------------------------
// Blockchain (MetaMask)
// ---------------------------------------------------------------------------
async function ensureNetwork() {
  const wanted = app.config.chainId;
  const current = Number(await window.ethereum.request({ method: 'eth_chainId' }));
  if (current === wanted) return;
  const chainId = '0x' + wanted.toString(16);
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    if (error.code === 4902 && wanted === 31337) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId, chainName: 'Ganache local (BlockLucky)', rpcUrls: ['http://127.0.0.1:8545'], nativeCurrency: { name: 'Ether de test', symbol: 'ETH', decimals: 18 } }],
      });
    } else if (error.code === 4902) {
      throw new Error(`Le réseau ${network().name} n’est pas activé dans MetaMask. Active « Afficher les réseaux de test », puis réessaie.`);
    } else if (error.code === 4001) {
      throw new Error(`Pour continuer, accepte de passer sur le réseau ${network().name} dans MetaMask.`);
    } else throw error;
  }
}

async function attachAccount(address) {
  const c = app.chain;
  c.provider = new BrowserProvider(window.ethereum, 'any'); // 'any' : supporte les changements de réseau
  const signer = await c.provider.getSigner(address);
  c.account = await signer.getAddress();
  c.contract = new Contract(app.config.address, app.config.abi, signer);
}

async function connect({ silent = false } = {}) {
  if (!window.ethereum) throw new Error('MetaMask n’est pas installé dans ce navigateur. Installe l’extension depuis metamask.io, ou reste en mode démo.');
  if (!app.config) throw new Error('Aucun contrat n’est déployé. Lance « npm run deploy » (Ganache) ou « npm run deploy:sepolia », puis recharge la page.');
  const accounts = await window.ethereum.request({ method: silent ? 'eth_accounts' : 'eth_requestAccounts' });
  if (!accounts?.length) throw new Error('Aucun compte MetaMask n’est autorisé pour ce site.');
  if (!silent) await ensureNetwork();
  await attachAccount(accounts[0]);
}

function disconnectChain() {
  Object.assign(app.chain, { provider: null, contract: null, account: null, info: null, wrongNetwork: false });
}

async function getBlock(number) {
  const c = app.chain;
  if (!c.blocks.has(number)) c.blocks.set(number, await c.provider.getBlock(number));
  return c.blocks.get(number);
}

/** Lit les nouveaux événements du contrat, par tranches de 9 000 blocs (limite des RPC publics). */
async function syncEvents(latest) {
  const c = app.chain;
  const iface = c.contract.interface;
  let from = c.scannedTo + 1;
  while (from <= latest) {
    const to = Math.min(latest, from + LOG_CHUNK - 1);
    const logs = await c.provider.getLogs({ address: app.config.address, fromBlock: from, toBlock: to });
    for (const log of logs) {
      let parsed = null;
      try { parsed = iface.parseLog(log); } catch { /* événement inconnu */ }
      if (parsed) c.events.push({ name: parsed.name, args: parsed.args, blockNumber: log.blockNumber, hash: log.transactionHash });
    }
    c.scannedTo = to;
    from = to + 1;
  }
}

/** Recalcule le ticket gagnant à partir du hash du bloc : le tirage est vérifiable par tous. */
async function verifyDraw(drawBlock, total) {
  try {
    const block = await getBlock(drawBlock);
    const encoded = AbiCoder.defaultAbiCoder().encode(['bytes32', 'address'], [block.hash, app.config.address]);
    const index = BigInt(keccak256(encoded)) % BigInt(total);
    return { hash: block.hash, drawBlock, index: Number(index), winningTicket: Number(index) + 1 };
  } catch {
    return null;
  }
}

async function readChain() {
  const c = app.chain;
  const chainId = Number((await c.provider.getNetwork()).chainId);
  c.wrongNetwork = chainId !== app.config.chainId;
  if (c.wrongNetwork) throw new Error(`MetaMask est sur le mauvais réseau : sélectionne « ${network().name} ».`);

  const latest = await c.provider.getBlock('latest');
  // Sur Ganache, le temps peut être avancé (evm_increaseTime) : on suit l'horloge de la blockchain.
  c.timeOffset = Math.max(0, latest.timestamp * 1000 - Date.now());
  if (c.scannedTo === null) c.scannedTo = (app.config.deployBlock ?? Math.max(0, latest.number - LOG_CHUNK)) - 1;

  const k = c.contract;
  const [total, deadline, capacity, drawBlock, settled, winner, credits, ticketCount, balance] = await Promise.all([
    k.totalTickets(), k.deadline(), k.maxTickets(), k.drawBlock(), k.settled(), k.winner(),
    k.credits(c.account), k.ticketCount(c.account), c.provider.getBalance(c.account),
  ]);
  await syncEvents(latest.number);
  await Promise.all([...new Set(c.events.map(e => e.blockNumber))].map(getBlock));
  const dateOf = blockNumber => c.blocks.get(blockNumber).timestamp * 1000;

  // Rejoue les événements dans l'ordre pour retrouver les numéros de tickets.
  let counter = 0;
  const purchases = [];
  const myNumbers = [];
  const mine = [];
  const players = new Set();
  const refunds = [];
  const withdrawals = [];
  let winEvent = null;
  for (const e of c.events) {
    if (e.name === 'TicketPurchased') {
      const quantity = Number(e.args.quantity);
      const numbers = Array.from({ length: quantity }, (_, i) => counter + i + 1);
      counter += quantity;
      players.add(e.args.player.toLowerCase());
      const entry = { address: e.args.player, quantity, numbers, date: dateOf(e.blockNumber), key: e.hash };
      purchases.push(entry);
      if (sameAddress(e.args.player, c.account)) { mine.push(entry); myNumbers.push(...numbers); }
    } else if (e.name === 'WinnerSelected') winEvent = e;
    else if (e.name === 'Refunded' && sameAddress(e.args.player, c.account)) refunds.push(e);
    else if (e.name === 'Withdrawn' && sameAddress(e.args.player, c.account)) withdrawals.push(e);
  }

  // Phase du tirage, calculée pour le prochain bloc (celui qui contiendra la transaction).
  const db = Number(drawBlock);
  const nextBlock = latest.number + 1;
  let phase = 'open';
  if (settled) phase = 'settled';
  else if (db > 0 && nextBlock > db + DRAW_WINDOW) phase = 'expired';
  else if (db > 0 && nextBlock > db) phase = 'drawable';
  else if (db > 0) phase = 'scheduled';
  else if (now() >= Number(deadline) * 1000 || Number(total) >= Number(capacity)) phase = Number(total) > 0 ? 'closable' : 'empty';

  const verification = settled && Number(total) > 0 ? await verifyDraw(db, total) : null;
  const history = winEvent ? [{
    round: 1, winner: winEvent.args.player, prize: Number(formatEther(winEvent.args.prize)), tickets: Number(total),
    date: dateOf(winEvent.blockNumber), winningTicket: verification?.winningTicket, verification,
  }] : [];

  const iWon = winEvent && sameAddress(winEvent.args.player, c.account);
  const transactions = [
    ...mine.map(p => ({ id: p.key, type: 'purchase', round: 1, quantity: p.quantity, amount: -p.quantity * TICKET_PRICE, date: p.date, ticketNumbers: p.numbers })),
    ...(iWon ? [{ id: winEvent.hash, type: 'win', round: 1, quantity: 0, amount: history[0].prize, date: history[0].date }] : []),
    ...refunds.map(e => ({ id: e.hash, type: 'refund', round: 1, quantity: 0, amount: Number(formatEther(e.args.amount)), date: dateOf(e.blockNumber) })),
    ...withdrawals.map(e => ({ id: e.hash, type: 'withdraw', round: 1, quantity: 0, amount: Number(formatEther(e.args.amount)), date: dateOf(e.blockNumber) })),
  ].sort((a, b) => b.date - a.date);

  const status = settled ? (iWon ? 'won' : 'lost') : 'pending';
  const participations = myNumbers.length ? [{
    round: 1, quantity: myNumbers.length, ticketNumbers: myNumbers, status, date: mine[0].date,
    ...(history[0] ? { winner: history[0].winner, winningTicket: history[0].winningTicket, prize: history[0].prize, totalTickets: Number(total) } : {}),
  }] : [];

  const readIds = new Set(JSON.parse(store.get('read.' + app.config.address) || '[]'));
  const notificationId = `chain-${app.config.address}-${c.account}`;
  const notifications = settled && participations.length ? [{
    id: notificationId, round: 1, type: status, prize: history[0]?.prize ?? 0, winningTicket: history[0]?.winningTicket,
    date: history[0]?.date ?? Date.now(), read: readIds.has(notificationId),
  }] : [];

  c.info = { phase, drawBlock: db, blockNumber: latest.number, winner, credits: Number(formatEther(credits)), ticketCount: Number(ticketCount) };

  return {
    round: 1,
    endsAt: Number(deadline) * 1000,
    capacity: Number(capacity),
    totalTickets: Number(total),
    participants: players.size,
    pot: Number(total) * TICKET_PRICE,
    myTickets: myNumbers.length,
    myTicketNumbers: myNumbers,
    balance: Number(formatEther(balance)),
    address: c.account,
    activity: purchases.slice(-12).reverse(),
    history,
    transactions,
    participations,
    notifications,
    closed: phase !== 'open',
  };
}

async function setMode(next, { announce = false } = {}) {
  if (app.busy) return false;
  if (next === 'chain') {
    $$('.mode-option[data-mode="chain"]').forEach(b => b.classList.add('loading'));
    try {
      await connect();
    } catch (error) {
      toast(errorMessage(error), 'error');
      return false;
    } finally {
      $$('.mode-option').forEach(b => b.classList.remove('loading'));
    }
  } else {
    disconnectChain();
  }
  app.mode = next;
  store.set('mode', next);
  app.state = null;
  app.seenDraw = undefined;
  app.seenActivity = null;
  setConnectionError(null);
  render();
  await refresh({ silent: false });
  if (announce && app.state) {
    toast(next === 'chain' ? `Connecté à ${network().name} avec ${short(app.chain.account)}.` : 'Mode démonstration activé.', 'success');
  }
  return true;
}

$$('.mode-option').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.mode !== app.mode) setMode(b.dataset.mode, { announce: true });
}));

$('retryConnection').addEventListener('click', async () => {
  try {
    if (app.mode === 'chain' && app.chain.wrongNetwork) {
      await ensureNetwork();
      await attachAccount(app.chain.account);
    }
    await refresh({ silent: false });
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
});

if (window.ethereum?.on) {
  window.ethereum.on('accountsChanged', async accounts => {
    if (app.mode !== 'chain') return;
    if (!accounts.length) {
      await setMode('demo');
      toast('MetaMask s’est déconnecté du site : retour au mode démo.');
      return;
    }
    if (sameAddress(accounts[0], app.chain.account)) return;
    try {
      await attachAccount(accounts[0]);
      app.seenDraw = undefined;
      await refresh({ silent: false });
      toast(`Compte actif : ${short(accounts[0])}`);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  });
  window.ethereum.on('chainChanged', async () => {
    if (app.mode !== 'chain' || !app.chain.account) return;
    try { await attachAccount(app.chain.account); } catch { /* signalé par l'actualisation */ }
    refresh();
  });
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------
function currentPhase() {
  return PHASES[app.mode === 'chain' ? app.chain.info?.phase || 'open' : 'open'];
}

function getParticipations() {
  return app.state?.participations || [];
}

function render() {
  renderShell();
  renderSettings();
  if (!app.state) {
    $('buy').disabled = true;
    $('buy').textContent = app.mode === 'chain' ? 'Connexion au contrat…' : 'Chargement…';
    return;
  }
  renderWallet();
  renderPot();
  renderPurchase();
  renderParticipation();
  renderActivity();
  renderChainBanner();
  renderTickets();
  renderParticipations();
  renderTransactions();
  renderHistory();
  renderNotifications();
}

/** Éléments qui ne dépendent que du mode et du réseau. */
function renderShell() {
  const chain = app.mode === 'chain';
  $('networkPillText').textContent = chain ? network().short : 'Mode démo';
  $('networkChipText').textContent = chain ? `${network().name} · ETH de test` : 'Démo · ETH fictif';
  $('walletLabel').textContent = app.state ? `${fmtEth(app.state.balance)} ETH` : '—';
  $$('[data-ticket-badge]').forEach(badge => {
    const count = app.state?.myTickets ?? 0;
    if (badge.textContent !== String(count)) { badge.textContent = count; fx.pulse(badge); }
    badge.classList.toggle('has', count > 0);
  });
}

function renderWallet() {
  const s = app.state;
  fx.countTo($('balance'), s.balance, fmtEth);
  $('addressShort').textContent = short(s.address);
  $('addressAvatar').style.setProperty('--h', parseInt(s.address.slice(2, 6), 16) % 360);
  const wins = s.transactions.filter(t => t.type === 'win').reduce((sum, t) => sum + t.amount, 0);
  fx.countTo($('statTickets'), s.myTickets, n => String(Math.round(n)));
  fx.countTo($('statRounds'), s.participations.length, n => String(Math.round(n)));
  fx.countTo($('statWins'), wins, n => fmtEth(n) + ' ETH');
}

function renderPot() {
  const s = app.state;
  const phase = currentPhase();
  $('round').textContent = pad(s.round);
  fx.countTo($('pot'), s.pot, fmtEth);
  setHTML($('sold'), `${s.totalTickets} <span class="muted">/ ${s.capacity}</span>`);
  const percent = s.capacity ? (100 * s.totalTickets) / s.capacity : 0;
  $('progress').style.width = `${percent}%`;
  $('progressBar').setAttribute('aria-valuenow', String(Math.round(percent)));
  const remaining = Math.max(0, s.capacity - s.totalTickets);
  $('remaining').textContent = remaining ? `${plural(remaining, 'ticket')} disponible${remaining > 1 ? 's' : ''}` : 'Tous les tickets sont vendus';
  $('participants').textContent = s.participants;
  const status = $('drawStatus');
  status.className = `status ${phase.cls}`;
  setHTML(status, `${phase.live ? '<i></i>' : ''}${phase.label}`);
  renderCountdown();
}

function renderCountdown() {
  const s = app.state;
  if (!s) return;
  const el = $('countdown');
  if (s.closed) {
    setHTML(el, `<span class="countdown-closed">${esc(currentPhase().label)}</span>`);
    return;
  }
  const seconds = Math.max(0, Math.floor((s.endsAt - now()) / 1000));
  if (!el.querySelector('.seg')) {
    el._html = null;
    el.innerHTML = ['h', 'min', 's'].map(unit => `<span class="seg"><b>00</b><small>${unit}</small></span>`).join('<i>:</i>');
  }
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  el.querySelectorAll('.seg b').forEach((digit, i) => {
    const value = String(parts[i]).padStart(2, '0');
    if (digit.textContent !== value) { digit.textContent = value; fx.pulse(digit, 'tick'); }
  });
  // À zéro, le serveur démo effectue le tirage au prochain appel : on actualise tout de suite.
  if (seconds === 0 && app.zeroRefreshed !== s.endsAt) { app.zeroRefreshed = s.endsAt; refresh(); }
}

function purchaseBlocker() {
  const s = app.state;
  const remaining = Math.max(0, s.capacity - s.totalTickets);
  if (s.closed) return 'closed';
  if (remaining === 0) return 'full';
  if (app.quantity > remaining) return 'remaining';
  if (app.quantity > Math.floor((s.balance + 1e-9) / TICKET_PRICE)) return 'balance';
  return null;
}

function renderPurchase() {
  const s = app.state;
  if (!s) return;
  const q = app.quantity;
  const chain = app.mode === 'chain';
  const remaining = Math.max(0, s.capacity - s.totalTickets);
  const blocker = purchaseBlocker();
  const share = ((s.myTickets + q) / (s.totalTickets + q)) * 100;

  $('estimatedOdds').textContent = blocker ? '—' : fmtPct(share);
  $('chanceProgress').style.width = `${blocker ? 0 : share}%`;
  $('total').textContent = `${fmtEth(q * TICKET_PRICE)} ETH`;
  $('balanceAfter').textContent = blocker ? '—' : `${fmtEth(s.balance - q * TICKET_PRICE)} ETH`;

  const affordable = affordableTickets();
  $$('[data-quantity]').forEach(b => {
    b.classList.toggle('selected', Number(b.dataset.quantity) === q);
    b.disabled = app.busy || s.closed || Number(b.dataset.quantity) > Math.max(1, affordable);
  });
  $('maxQuantity').disabled = app.busy || s.closed || affordable < 1;
  $('minus').disabled = app.busy || q <= 1;
  $('plus').disabled = app.busy || q >= MAX_PER_PURCHASE;

  const buy = $('buy');
  buy.disabled = app.busy || Boolean(blocker);
  const labels = {
    closed: 'Ventes closes',
    full: 'Plus aucun ticket disponible',
    remaining: `Plus que ${plural(remaining, 'ticket')} disponible${remaining > 1 ? 's' : ''}`,
    balance: 'Solde insuffisant',
  };
  setHTML(buy, app.busy
    ? '<span class="spinner"></span>Achat en cours…'
    : blocker ? labels[blocker] : `Acheter ${plural(q, 'ticket')}<svg class="icon"><use href="#i-arrow"/></svg>`);

  const help = {
    closed: chain ? 'Les ventes de ce tirage sont terminées : la bannière en haut indique la suite.' : 'Les ventes de ce tirage sont terminées.',
    full: 'Tous les tickets sont vendus : le tirage va avoir lieu.',
    remaining: 'Réduis la quantité pour acheter les derniers tickets.',
    balance: chain ? 'Ton solde ne suffit pas. Réduis la quantité, ou récupère des ETH de test sur un faucet.' : 'Ton solde ne suffit pas. Réduis la quantité.',
  };
  $('buyHelp').textContent = blocker ? help[blocker] : chain ? 'Des frais de transaction (gas) s’ajoutent, en ETH de test.' : 'Rien n’est débité avant ta confirmation.';
  $('buyHelp').classList.toggle('warn', Boolean(blocker));
}

function renderParticipation() {
  const s = app.state;
  fx.countTo($('mine'), s.myTickets, n => String(Math.round(n)));
  $('mineLabel').textContent = s.myTickets > 1 ? 'tickets' : 'ticket';
  const status = $('participationStatus');
  const participation = getParticipations().find(p => p.round === s.round);
  if (!s.myTickets) {
    status.className = 'status';
    status.textContent = 'Aucun ticket';
    $('odds').textContent = s.closed ? 'Tu n’as pas participé à ce tirage.' : 'Achète un ticket pour participer.';
  } else if (participation?.status === 'won') {
    status.className = 'status status-win';
    status.textContent = 'Gagné !';
    $('odds').textContent = `Ton ticket n° ${pad(participation.winningTicket)} a gagné ${fmtEth(participation.prize)} ETH.`;
  } else if (participation?.status === 'lost') {
    status.className = 'status';
    status.textContent = 'Perdu';
    $('odds').textContent = 'Pas cette fois : retente ta chance au prochain tirage.';
  } else {
    status.className = 'status status-live';
    status.textContent = 'En jeu';
    const share = (100 * s.myTickets) / s.totalTickets;
    const oneIn = Math.max(1, Math.round(s.totalTickets / s.myTickets));
    $('odds').textContent = `${fmtPct(share)} des tickets du tirage, soit environ 1 chance sur ${oneIn}.`;
  }
}

function renderActivity() {
  const s = app.state;
  const firstRender = app.seenActivity === null;
  const seen = app.seenActivity || new Set();
  const rows = s.activity.map(a => {
    const key = a.key || `${a.address}-${a.date}-${a.quantity}`;
    const isNew = !firstRender && !seen.has(key);
    seen.add(key);
    const you = sameAddress(a.address, s.address) ? '<span class="you">toi</span>' : '';
    return `<div class="activity-row ${isNew ? 'new' : ''}">${avatar(a.address)}<b>${esc(short(a.address))}${you}</b><span class="ticket-chip">${plural(a.quantity, 'ticket')}</span><time>${timeAgo(a.date)}</time></div>`;
  });
  app.seenActivity = seen;
  setHTML($('activity'), rows.length ? rows.join('') : empty('i-ticket', 'Aucun achat pour le moment. Sois le premier !'));
}

function renderChainBanner() {
  const el = $('chainBanner');
  const info = app.chain.info;
  if (app.mode !== 'chain' || !info) { el.hidden = true; return; }
  const local = app.config.chainId === 31337;
  let icon = 'i-cube';
  let title = '';
  let text = '';
  let action = null;
  let warn = false;
  if (info.credits > 0) {
    icon = 'i-trophy';
    title = `${fmtEth(info.credits)} ETH t’attendent dans le contrat`;
    text = 'Clique pour les transférer vers ton portefeuille MetaMask.';
    action = ['withdraw', 'Retirer mes gains'];
  } else if (info.phase === 'closable') {
    title = 'Les ventes sont closes';
    text = 'N’importe quel joueur peut maintenant programmer le tirage : le contrat choisira un bloc futur pour désigner le gagnant.';
    action = ['scheduleDraw', 'Programmer le tirage'];
  } else if (info.phase === 'scheduled') {
    const left = info.drawBlock - info.blockNumber;
    warn = true;
    title = `Tirage programmé au bloc ${info.drawBlock}`;
    text = `Bloc actuel : ${info.blockNumber}. Encore ${plural(left, 'bloc')} avant de pouvoir lancer le tirage. `
      + (local ? 'Sur Ganache, un bloc n’est créé qu’à chaque transaction : mine des blocs avec <code>evm_mine</code> (voir le README).' : 'Sur Sepolia, un bloc arrive environ toutes les 12 secondes.');
  } else if (info.phase === 'drawable') {
    icon = 'i-sparkle';
    title = 'Le tirage peut être lancé';
    text = `Le bloc ${info.drawBlock} est passé. N’importe qui peut lancer le tirage, pendant encore ${plural(info.drawBlock + DRAW_WINDOW - info.blockNumber, 'bloc')}.`;
    action = ['draw', 'Lancer le tirage'];
  } else if (info.phase === 'expired') {
    warn = true;
    title = 'Le délai du tirage est dépassé';
    text = info.ticketCount > 0 ? 'Personne n’a lancé le tirage dans les 256 blocs. Tu peux récupérer ta mise.' : 'Personne n’a lancé le tirage dans les 256 blocs : chaque joueur peut se faire rembourser.';
    if (info.ticketCount > 0) action = ['refund', 'Me faire rembourser'];
  } else if (info.phase === 'settled') {
    icon = 'i-trophy';
    title = sameAddress(info.winner, app.chain.account) ? 'Tu as gagné ce tirage !' : 'Ce tirage est terminé';
    text = `Gagnant : ${esc(short(info.winner))}. Pour rejouer, déploie un nouveau contrat (<code>npm run deploy</code>), puis recharge la page.`;
  } else if (info.phase === 'empty') {
    warn = true;
    title = 'Tirage terminé sans participant';
    text = 'Aucun ticket n’a été vendu avant la clôture. Déploie un nouveau contrat pour relancer un tirage.';
  } else {
    el.hidden = true;
    return;
  }
  el.className = `action-banner${warn ? ' warn' : ''}`;
  setHTML(el, `<span class="banner-icon"><svg class="icon"><use href="#${icon}"/></svg></span><div class="banner-text"><b>${esc(title)}</b><p>${text}</p></div>`
    + (action ? `<button class="btn btn-primary" data-chain-action="${action[0]}">${action[1]}</button>` : ''));
  el.hidden = false;
}

function renderTickets() {
  const s = app.state;
  const numbers = s.myTicketNumbers || [];
  const participation = getParticipations().find(p => p.round === s.round && p.status !== 'pending');
  const winning = participation?.winningTicket;
  setHTML($('myTickets'), numbers.length
    ? numbers.map((n, i) => {
      const state = winning ? (n === winning ? 'won' : 'lost') : '';
      const label = winning ? (n === winning ? 'GAGNANT' : 'TERMINÉ') : 'EN JEU';
      return `<article class="ticket ${state}" style="--i:${Math.min(i, 24)}"><small>TIRAGE ${pad(s.round)} · ${label}</small><strong>N° ${pad(n)}</strong><small>${esc(short(s.address))} · 0,01 ETH</small></article>`;
    }).join('')
    : empty('i-ticket', 'Aucun ticket pour ce tirage.', '<a class="btn btn-primary btn-sm" href="#lottery" data-view="lottery">Acheter des tickets</a>'));
  $('ticketSummary').textContent = `Tirage n° ${pad(s.round)} · ${plural(s.myTickets, 'ticket')}`;
}

function renderParticipations() {
  const filter = $('participationFilter').value;
  const entries = getParticipations().filter(p => filter === 'all' || p.status === filter);
  const labels = { pending: ['En cours', 'status-live'], won: ['Gagné', 'status-win'], lost: ['Perdu', ''] };
  setHTML($('pastParticipations'), entries.length
    ? entries.map(p => {
      const [label, cls] = labels[p.status] || labels.pending;
      const amount = p.status === 'won' ? `+${fmtEth(p.prize)} ETH` : `${fmtEth(p.quantity * TICKET_PRICE)} ETH misés`;
      const button = p.status === 'pending'
        ? '<a class="btn btn-ghost btn-sm" href="#lottery" data-view="lottery">Suivre le tirage</a>'
        : `<button class="btn btn-ghost btn-sm" data-result="${p.round}">Voir le résultat</button>`;
      return `<article class="card round-card ${esc(p.status)}"><div class="card-head"><h3>Tirage n° ${pad(p.round)}</h3><span class="status ${cls}">${label}</span></div><div class="round-summary"><span>${plural(p.quantity, 'ticket')}</span><strong>${amount}</strong></div><div class="card-actions">${button}</div></article>`;
    }).join('')
    : empty('i-trophy', filter === 'all' ? 'Tu n’as encore participé à aucun tirage.' : 'Aucun tirage dans cette catégorie.'));
}

function renderTransactions() {
  const filter = $('transactionFilter').value;
  const rows = app.state.transactions.filter(t => filter === 'all' || t.type === filter);
  const labels = {
    purchase: t => `Achat de ${plural(t.quantity, 'ticket')}`,
    win: () => 'Gain du tirage',
    refund: () => 'Remboursement crédité',
    withdraw: () => 'Retrait vers ton portefeuille',
  };
  setHTML($('transactions'), rows.length
    ? rows.map(t => {
      const plus = t.type !== 'purchase';
      const date = new Date(t.date).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const reference = t.type === 'purchase' && t.ticketNumbers?.length ? `Tickets ${t.ticketNumbers.map(pad).join(', ')}` : `Réf. ${short(t.id)}`;
      return `<div class="ledger-row ${plus ? 'plus' : ''}"><span class="ledger-sign">${plus ? '+' : '−'}</span><div><b>${(labels[t.type] || labels.win)(t)}</b><small>Tirage n° ${pad(t.round)} · ${esc(reference)}</small></div><time>${date}</time><div class="ledger-amount">${plus ? '+' : '−'}${fmtEth(Math.abs(t.amount))} ETH${t.type === 'purchase' ? `<button class="receipt-button" data-receipt="${esc(t.id)}">Reçu ↓</button>` : ''}</div></div>`;
    }).join('')
    : empty('i-wallet', 'Aucune opération pour le moment.'));
}

function filteredHistory() {
  const s = app.state;
  const query = $('historySearch').value.trim().toLowerCase();
  const mineOnly = $('historyFilter').value === 'mine';
  return s.history.filter(h => (!mineOnly || sameAddress(h.winner, s.address))
    && (!query || String(h.round).includes(query) || pad(h.round).includes(query) || h.winner.toLowerCase().includes(query)));
}

function renderHistory() {
  const s = app.state;
  const rows = filteredHistory();
  setHTML($('history'), rows.length
    ? rows.map(h => {
      const mine = sameAddress(h.winner, s.address);
      const date = new Date(h.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      const ticket = h.winningTicket ? ` · ticket n° ${pad(h.winningTicket)}` : '';
      return `<article class="card history-row ${mine ? 'mine' : ''}"><span class="round-badge">#${pad(h.round)}</span><div><div class="winner">${avatar(h.winner)}${esc(short(h.winner))}${mine ? ' <span class="chip chip-accent">Toi</span>' : ''}</div><div class="meta">${plural(h.tickets, 'ticket')}${ticket} · ${date}</div></div><button class="btn btn-ghost btn-sm" data-result="${h.round}">Détails</button><strong class="prize">${fmtEth(h.prize)} ETH</strong></article>`;
    }).join('')
    : empty('i-trophy', s.history.length ? 'Aucun résultat ne correspond à ta recherche.' : 'Aucun tirage terminé pour le moment.'));
}

function renderNotifications() {
  const notifications = app.state.notifications || [];
  const unread = notifications.filter(n => !n.read).length;
  $('notificationCount').textContent = unread;
  $('notificationCount').hidden = unread === 0;
  $('notificationButton').setAttribute('aria-label', unread ? `Notifications : ${unread} non lue${unread > 1 ? 's' : ''}` : 'Notifications');
  setHTML($('notificationList'), notifications.length
    ? notifications.map(n => `<button class="notification-item ${n.read ? '' : 'unread'}" data-result="${n.round}"><span class="notification-state ${n.type === 'won' ? 'won' : ''}">${n.type === 'won' ? '+' : '✓'}</span><span><b>${n.type === 'won' ? `Tu remportes ${fmtEth(n.prize)} ETH !` : `Le tirage n° ${pad(n.round)} est terminé`}</b><small>Tirage n° ${pad(n.round)} · ${new Date(n.date).toLocaleDateString('fr-FR')}</small></span><svg class="icon"><use href="#i-arrow"/></svg></button>`).join('')
    : empty('i-bell', 'Tes résultats apparaîtront ici.'));
}

function renderSettings() {
  const chain = app.mode === 'chain';
  $$('.mode-option').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.mode === app.mode));
    b.disabled = app.busy;
  });
  $('chainOptionText').textContent = !window.ethereum
    ? 'MetaMask n’est pas détecté dans ce navigateur : installe l’extension pour activer ce mode.'
    : !app.config
      ? 'Aucun contrat déployé pour l’instant : lance « npm run deploy », puis recharge la page.'
      : `Les règles sont appliquées par un smart contract sur ${network().name} : personne ne peut tricher, pas même l’organisateur.`;
  $('networkDescription').textContent = chain
    ? `Connecté à ${network().name} avec le compte ${short(app.chain.account)}. Chaque achat est une vraie transaction sur cette blockchain de test (validation : ${network().blockTime}).`
    : 'Mode démo : le serveur BlockLucky gère des crédits fictifs. Pratique pour découvrir, mais il faut faire confiance au serveur.';

  if (!app.config) {
    setHTML($('contractInfo'), '<dt>État</dt><dd>Aucun contrat déployé. Lance <code>npm run chain</code> puis <code>npm run deploy</code>, ou <code>npm run deploy:sepolia</code>.</dd>');
    $('explorerLink').hidden = true;
  } else {
    setHTML($('contractInfo'), `<dt>Réseau</dt><dd>${esc(network().name)} (identifiant ${app.config.chainId})</dd>`
      + `<dt>Adresse</dt><dd><code>${esc(app.config.address)}</code></dd>`
      + `<dt>Déployé au bloc</dt><dd>${app.config.deployBlock ?? '—'}</dd>`
      + `<dt>Règles</dt><dd>0,01 ETH par ticket · ${app.state?.capacity ?? 100} tickets maximum · 1 à 20 tickets par achat</dd>`);
    const url = network().explorer ? `${network().explorer}/address/${app.config.address}` : null;
    $('explorerLink').hidden = !url;
    if (url) $('explorerLink').href = url;
  }

  const info = app.chain.info;
  $('chainCycle').hidden = !(chain && info);
  if (!chain || !info) return;
  const current = { open: 0, closable: 1, empty: 1, scheduled: 2, drawable: 3, expired: 3, settled: 4 }[info.phase];
  setHTML($('cycleSteps'), CYCLE.map(([title, text], i) => `<li class="${i < current ? 'done' : i === current ? 'current' : ''}"><b>${title}</b>${text}</li>`).join(''));
  const hints = {
    open: 'Les ventes sont ouvertes : achète des tickets depuis le tableau de bord.',
    closable: 'Les ventes sont closes. Clique sur « Programmer le tirage ».',
    empty: 'Aucun ticket vendu : ce tirage est terminé. Déploie un nouveau contrat pour rejouer.',
    scheduled: `Attends que le bloc ${info.drawBlock} soit créé (bloc actuel : ${info.blockNumber}).`,
    drawable: 'Le bloc est passé : clique sur « Lancer le tirage ».',
    expired: 'Délai dépassé : chaque joueur peut se faire rembourser, puis retirer.',
    settled: info.credits > 0 ? 'Le gagnant peut retirer sa cagnotte.' : 'Tirage terminé. Pour rejouer, déploie un nouveau contrat.',
  };
  $('cycleHint').textContent = hints[info.phase];
  $('scheduleDraw').disabled = app.busy || info.phase !== 'closable';
  $('draw').disabled = app.busy || info.phase !== 'drawable';
  $('refund').disabled = app.busy || !(info.phase === 'expired' && info.ticketCount > 0);
  $('withdraw').disabled = app.busy || !(info.credits > 0);
}

// ---------------------------------------------------------------------------
// Tirage : animation quand un résultat tombe
// ---------------------------------------------------------------------------
function detectDraw() {
  const latest = app.state.history[0];
  const key = latest ? `${app.mode}:${app.mode === 'chain' ? app.config.address : ''}:${latest.round}` : null;
  if (app.seenDraw === undefined) { app.seenDraw = key; return; } // premier chargement : pas d'animation
  if (!key || key === app.seenDraw) return;
  app.seenDraw = key;
  const participation = getParticipations().find(p => p.round === latest.round && p.status !== 'pending');
  if (!participation) {
    toast(`Le tirage n° ${pad(latest.round)} est terminé : ${short(latest.winner)} remporte ${fmtEth(latest.prize)} ETH.`);
    return;
  }
  const won = participation.status === 'won';
  fx.revealDraw({
    round: latest.round,
    total: latest.tickets,
    winningTicket: latest.winningTicket,
    myNumbers: participation.ticketNumbers || [],
    won,
    prize: latest.prize,
    winnerLabel: short(latest.winner),
    formatEth: fmtEth,
  }).then(() => { if (won) fx.walletMoney($('walletCard'), 'in'); });
}

// ---------------------------------------------------------------------------
// Achat
// ---------------------------------------------------------------------------
function setBusy(busy) {
  app.busy = busy;
  $$('#purchaseDialog [data-close]').forEach(b => { b.disabled = busy; });
  renderPurchase();
  renderSettings();
}

function resetTxSteps(list) {
  setHTML(list, TX_STEPS.map(([title, text], i) => `<li><span class="step-dot">${i + 1}</span><div><b>${title}</b><small>${text}</small></div></li>`).join(''));
  list._html = null;
}

function setTxStep(list, index) {
  [...list.children].forEach((li, i) => {
    li.classList.toggle('done', i < index);
    li.classList.toggle('active', i === index);
    li.querySelector('.step-dot').textContent = i < index ? '✓' : i === index ? '' : String(i + 1);
  });
}

/** Suit une transaction blockchain étape par étape : signature, validation, confirmation. */
async function trackTx(list, send) {
  resetTxSteps(list);
  list.hidden = false;
  list.children[1].querySelector('small').textContent = `Un validateur inscrit ta transaction dans un nouveau bloc (${network().blockTime}).`;
  setTxStep(list, 0);
  const tx = await send();
  setTxStep(list, 1);
  const url = explorerUrl('tx', tx.hash);
  if (url) list.children[1].querySelector('div').insertAdjacentHTML('beforeend', `<a href="${url}" target="_blank" rel="noopener">Suivre la transaction sur Etherscan ↗</a>`);
  const receipt = await tx.wait();
  if (receipt?.status !== 1) throw Object.assign(new Error('Transaction refusée'), { code: 'CALL_EXCEPTION' });
  setTxStep(list, TX_STEPS.length);
  return receipt;
}

$('buy').addEventListener('click', () => {
  if (app.busy || !app.state) return;
  setQuantity($('quantity').value, { animate: false });
  if ($('buy').disabled) return;
  const s = app.state;
  const q = app.quantity;
  const chain = app.mode === 'chain';
  app.pending = { quantity: q, round: s.round, mode: app.mode, requestId: crypto.randomUUID().replaceAll('-', '') };
  setHTML($('purchaseSummary'), `
    <div class="summary-row"><span>Tirage</span><strong>n° ${pad(s.round)}</strong></div>
    <div class="summary-row"><span>Tickets</span><strong>${q} × 0,01 ETH</strong></div>
    <div class="summary-row summary-total"><span>Total</span><strong>${fmtEth(q * TICKET_PRICE)} ETH</strong></div>
    <div class="summary-row"><span>Solde après achat${chain ? ' (hors frais)' : ''}</span><strong>${fmtEth(s.balance - q * TICKET_PRICE)} ETH</strong></div>`);
  $('purchaseNetwork').textContent = chain
    ? `Réseau ${network().name} : MetaMask va te demander de signer la transaction. De petits frais (gas) en ETH de test s’ajoutent.`
    : 'Démonstration : crédits fictifs, sans valeur monétaire.';
  $('purchaseSteps').hidden = true;
  $('confirmPurchase').disabled = false;
  $('confirmPurchase').textContent = `Confirmer · ${fmtEth(q * TICKET_PRICE)} ETH`;
  $('purchaseDialog').showModal();
});

$('confirmPurchase').addEventListener('click', async () => {
  const purchase = app.pending;
  if (app.busy || !purchase) return;
  if (purchase.mode !== app.mode || purchase.round !== app.state?.round) {
    closeDialog($('purchaseDialog'));
    toast('Le tirage a changé entre-temps. Vérifie ton achat.', 'error');
    return;
  }
  setBusy(true);
  const confirm = $('confirmPurchase');
  confirm.disabled = true;
  confirm.innerHTML = '<span class="spinner"></span>Confirmation…';
  try {
    if (purchase.mode === 'demo') {
      const result = await api('/api/tickets', { quantity: purchase.quantity, round: purchase.round, requestId: purchase.requestId });
      toast(result.message, 'success');
    } else {
      await trackTx($('purchaseSteps'), () => app.chain.contract.buyTickets(purchase.quantity, { value: parseEther((purchase.quantity * TICKET_PRICE).toFixed(2)) }));
      toast('Achat confirmé sur la blockchain !', 'success');
    }
    app.pending = null;
    setBusy(false);
    closeDialog($('purchaseDialog'));
    fx.walletMoney($('walletCard'), 'out');
    fx.flyTickets($('buy'), $$('[data-fly-target]').find(el => el.getBoundingClientRect().width > 0), purchase.quantity);
    await refresh({ silent: false });
  } catch (error) {
    toast(errorMessage(error), 'error');
    setBusy(false);
    closeDialog($('purchaseDialog'));
    refresh();
  } finally {
    if (app.busy) setBusy(false);
    confirm.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Actions du contrat (programmer, tirer, rembourser, retirer)
// ---------------------------------------------------------------------------
async function runChainAction(method) {
  const action = CHAIN_ACTIONS[method];
  if (!action || app.busy || app.mode !== 'chain' || !app.chain.contract) return;
  $('txTitle').textContent = action.title;
  $('txDescription').textContent = action.text;
  resetTxSteps($('txSteps'));
  $('txDialog').showModal();
  setBusy(true);
  try {
    await trackTx($('txSteps'), () => action.send(app.chain.contract));
    toast(action.done, 'success');
    if (method === 'withdraw') { fx.walletMoney($('walletCard'), 'in'); fx.confetti({ particles: 120 }); }
    await new Promise(resolve => setTimeout(resolve, 700));
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    setBusy(false);
    closeDialog($('txDialog'));
    refresh();
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-chain-action]');
  if (button && !button.disabled) runChainAction(button.dataset.chainAction);
});

// ---------------------------------------------------------------------------
// Fenêtres : portefeuille, notifications, résultats
// ---------------------------------------------------------------------------
function closeDialog(dialog) {
  if (dialog.open) dialog.close();
  if (dialog.id === 'purchaseDialog') app.pending = null;
}

$$('dialog.modal').forEach(dialog => {
  // Fermeture en cliquant à côté de la fenêtre.
  dialog.addEventListener('click', event => {
    if (event.target !== dialog || app.busy) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(dialog);
  });
  // Échap : interdit pendant une transaction.
  dialog.addEventListener('cancel', event => {
    if (app.busy) event.preventDefault();
    else if (dialog.id === 'purchaseDialog') app.pending = null;
  });
  dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { if (!app.busy) closeDialog(dialog); }));
});

async function copyAddress() {
  if (!app.state) return;
  try {
    await navigator.clipboard.writeText(app.state.address);
    toast('Adresse copiée.', 'success');
  } catch {
    toast('La copie est indisponible dans ce navigateur.', 'error');
  }
}
$('copyAddress').addEventListener('click', copyAddress);
$('addressChip').addEventListener('click', copyAddress);

$('wallet').addEventListener('click', () => {
  if (!app.state) return;
  const chain = app.mode === 'chain';
  $('dialogBalance').textContent = `${fmtEth(app.state.balance)} ETH`;
  $('dialogDescription').textContent = chain
    ? `Portefeuille MetaMask · ${network().name} · ETH de test.`
    : 'Portefeuille de démonstration : crédits fictifs, sans valeur. Il est lié à ce navigateur (effacer les cookies en crée un nouveau).';
  $('dialogAddress').textContent = app.state.address;
  const url = explorerUrl('address', app.state.address);
  $('dialogExplorer').hidden = !url;
  if (url) $('dialogExplorer').href = url;
  $('walletDialog').showModal();
});

$('notificationButton').addEventListener('click', async () => {
  if (!app.state) return;
  renderNotifications();
  $('notificationsDialog').showModal();
  const unread = app.state.notifications.filter(n => !n.read);
  if (!unread.length) return;
  try {
    if (app.mode === 'demo') {
      await api('/api/notifications/read', { ids: unread.map(n => n.id) });
    } else {
      const key = 'read.' + app.config.address;
      const read = new Set(JSON.parse(store.get(key) || '[]'));
      unread.forEach(n => read.add(n.id));
      store.set(key, JSON.stringify([...read]));
    }
    unread.forEach(n => { n.read = true; });
    setTimeout(renderNotifications, 1200); // laisse le temps de voir ce qui était nouveau
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
});

function openResult(round) {
  const s = app.state;
  const entry = s?.history.find(h => h.round === round);
  if (!entry) { toast('Ce résultat n’est plus disponible.', 'error'); return; }
  const participation = getParticipations().find(p => p.round === round);
  const won = sameAddress(entry.winner, s.address);
  closeDialog($('notificationsDialog'));
  $('resultTitle').textContent = `Tirage n° ${pad(round)}`;
  const v = entry.verification;
  setHTML($('resultDetails'), `
    <div class="result-outcome ${won ? 'won' : ''}">${won ? `Tu remportes ${fmtEth(entry.prize)} ETH !` : participation ? 'Pas cette fois…' : 'Tirage terminé'}</div>
    <div class="summary">
      <div class="summary-row"><span>Cagnotte</span><strong>${fmtEth(entry.prize)} ETH</strong></div>
      <div class="summary-row"><span>Gagnant</span><strong>${esc(short(entry.winner))}${won ? ' (toi)' : ''}</strong></div>
      ${entry.winningTicket ? `<div class="summary-row"><span>Ticket gagnant</span><strong>N° ${pad(entry.winningTicket)} sur ${entry.tickets}</strong></div>` : ''}
      ${participation ? `<div class="summary-row"><span>Ta participation</span><strong>${plural(participation.quantity, 'ticket')} · ${fmtEth(participation.quantity * TICKET_PRICE)} ETH</strong></div>` : ''}
    </div>
    ${participation?.ticketNumbers?.length ? `<p class="label">Tes numéros</p><div class="result-numbers">${participation.ticketNumbers.map(n => `<span class="${n === entry.winningTicket ? 'winner-number' : ''}">${pad(n)}</span>`).join('')}</div>` : ''}
    ${v ? `<div class="verify"><b>Vérification :</b> hash du bloc ${v.drawBlock} = ${esc(v.hash)}. keccak256(hash, adresse du contrat) modulo ${entry.tickets} = ${v.index}, donc ticket n° ${pad(v.winningTicket)}. N’importe qui peut refaire ce calcul.</div>` : ''}`);
  $('resultDialog').showModal();
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-result]');
  if (button) openResult(Number(button.dataset.result));
});

// ---------------------------------------------------------------------------
// Filtres, exports, reçus, calendrier
// ---------------------------------------------------------------------------
$('participationFilter').addEventListener('change', () => app.state && renderParticipations());
$('transactionFilter').addEventListener('change', () => app.state && renderTransactions());
$('historySearch').addEventListener('input', () => app.state && renderHistory());
$('historyFilter').addEventListener('change', () => app.state && renderHistory());

$('exportTickets').addEventListener('click', () => {
  const s = app.state;
  if (!s?.myTicketNumbers?.length) { toast('Aucun ticket à exporter.', 'error'); return; }
  downloadCsv(`blocklucky-tickets-${pad(s.round)}.csv`, [
    ['Tirage', 'Numéro de ticket', 'Portefeuille', 'Prix (ETH)', 'Réseau'],
    ...s.myTicketNumbers.map(n => [s.round, n, s.address, '0.01', networkLabel()]),
  ]);
});

$('exportHistory').addEventListener('click', () => {
  const rows = app.state ? filteredHistory() : [];
  if (!rows.length) { toast('Aucun résultat à exporter.', 'error'); return; }
  downloadCsv('blocklucky-resultats.csv', [
    ['Tirage', 'Gagnant', 'Ticket gagnant', 'Tickets', 'Gain (ETH)', 'Date'],
    ...rows.map(h => [h.round, h.winner, h.winningTicket ?? '', h.tickets, h.prize, new Date(h.date).toISOString()]),
  ]);
});

$('transactions').addEventListener('click', async event => {
  const button = event.target.closest('[data-receipt]');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const id = button.dataset.receipt;
    const receipt = app.mode === 'demo'
      ? await api('/api/receipts/' + encodeURIComponent(id))
      : {
        ...app.state.transactions.find(t => t.id === id),
        address: app.state.address,
        network: network().name,
        contract: app.config.address,
        explorer: explorerUrl('tx', id),
      };
    download(`blocklucky-recu-${id.slice(0, 18)}.json`, JSON.stringify(receipt, null, 2), 'application/json');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    button.disabled = false;
  }
});

$('calendarReminder').addEventListener('click', () => {
  const s = app.state;
  if (!s || s.closed || s.endsAt <= now()) { toast('Ce tirage est déjà clôturé.', 'error'); return; }
  const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BlockLucky//Tirages//FR', 'BEGIN:VEVENT',
    `UID:blocklucky-${app.mode}-${s.round}-${Math.floor(s.endsAt / 1000)}@localhost`,
    `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(s.endsAt)}`, `DTEND:${stamp(s.endsAt + 60000)}`,
    `SUMMARY:BlockLucky - Tirage ${s.round}`,
    'DESCRIPTION:Clôture prévue du tirage. Elle peut avoir lieu plus tôt si tous les tickets sont vendus.',
    'BEGIN:VALARM', 'TRIGGER:-PT5M', 'ACTION:DISPLAY', 'DESCRIPTION:Tirage BlockLucky dans 5 minutes', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  download(`blocklucky-tirage-${s.round}.ics`, ics, 'text/calendar;charset=utf-8');
  toast('Rappel prêt : ouvre le fichier pour l’ajouter à ton calendrier.', 'success');
});

// ---------------------------------------------------------------------------
// Tuto
// ---------------------------------------------------------------------------
const tour = new Tour({
  steps: TOUR_STEPS,
  showView: view => show(view, { push: false }), // le tuto n'ajoute pas d'entrées à l'historique du navigateur
  onEnd: () => {
    store.set('tourDone', '1');
    show('lottery', { push: false });
    history.replaceState(null, '', '#lottery');
  },
});
document.addEventListener('click', event => {
  if (!event.target.closest('[data-start-tour]')) return;
  $$('dialog[open]').forEach(d => d.close());
  tour.start();
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
document.addEventListener('pointerdown', event => {
  const target = event.target.closest('.btn, .quick-picks button, .step-btn');
  if (target) fx.ripple({ currentTarget: target, clientX: event.clientX, clientY: event.clientY });
});

async function init() {
  applyTheme(store.get('theme') || 'system');
  resetTxSteps($('purchaseSteps'));
  resetTxSteps($('txSteps'));
  fx.tilt($('walletCard'));
  fx.pointerGlow();

  const saved = Number(store.get('quantity'));
  if (saved >= 1 && saved <= MAX_PER_PURCHASE) {
    app.quantity = saved;
    $('savedQuantity').textContent = `(${saved} mémorisé${saved > 1 ? 's' : ''})`;
  }
  $('quantity').value = app.quantity;

  show(hashView(), { push: false });
  history.replaceState(null, '', '#' + app.view);

  app.config = await loadConfig();
  // Reconnexion silencieuse si l'utilisateur avait choisi le mode blockchain.
  if (store.get('mode') === 'chain' && window.ethereum && app.config) {
    try { await connect({ silent: true }); app.mode = 'chain'; } catch { store.set('mode', 'demo'); }
  }
  render();
  await refresh({ silent: false });

  setInterval(renderCountdown, 1000);
  setInterval(() => { if (!app.busy && !document.hidden) refresh(); }, REFRESH_EVERY);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  if (!store.get('tourDone')) setTimeout(() => tour.start(), 900);
}

init();

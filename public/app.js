// ---------------------------------------------------------------------------
// BlockLucky — interface web
// Deux modes :
//   • démo       : l'API Express tient les comptes (ETH fictif) ;
//   • blockchain : MetaMask + usine à tirages BlockLucky + oracle de hasard Chainlink VRF.
// Modules : common.js (outils), account.js (compte), onboarding.js (tuto MetaMask),
//           admin.js (espace admin), fx.js (effets), tour.js (visite guidée).
// ---------------------------------------------------------------------------
import { BrowserProvider, Contract, formatEther, parseEther } from '/vendor/ethers.js';
import { Tour } from './tour.js';
import * as fx from './fx.js';
import {
  TICKET_PRICE, MAX_PER_PURCHASE, $, $$, fmtEth, fmtPct, pad, short, plural, sameAddress, esc, displayName,
  store, setHTML, avatar, empty, download, downloadCsv, toast, api,
} from './common.js';
import { initAccount } from './account.js';
import { initOnboarding } from './onboarding.js';
import { initAdmin } from './admin.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
const LOG_CHUNK = 9000;        // les RPC publics refusent de lire plus de 10 000 blocs d'un coup
const STATUS = ['open', 'drawing', 'settled', 'cancelled']; // ordre de l'enum Status du contrat

const NETWORKS = {
  31337: { name: 'Ganache (local)', short: 'Local · 31337', explorer: null, blockTime: 'instantané sur Ganache' },
  11155111: { name: 'Sepolia', short: 'Sepolia', explorer: 'https://sepolia.etherscan.io', blockTime: 'environ 12 secondes sur Sepolia' },
};

const VIEWS = { lottery: 'Tableau de bord', tickets: 'Mes tickets', history: 'Résultats', settings: 'Réglages', guide: 'Règles & lexique', admin: 'Espace admin' };

const PHASES = {
  open: { label: 'Ventes ouvertes', cls: 'status-live', live: true },
  closable: { label: 'Ventes closes', cls: 'status-warn' },
  drawing: { label: 'Oracle en cours', cls: 'status-live', live: true },
  oracleTimeout: { label: 'Oracle sans réponse', cls: 'status-danger' },
  settled: { label: 'Gagnant désigné', cls: 'status-win' },
  cancelled: { label: 'Tirage annulé', cls: 'status-danger' },
  empty: { label: 'Terminé sans ticket', cls: '' },
  none: { label: 'Aucun tirage', cls: '' },
};

/** Messages d'erreur du contrat traduits pour un débutant. */
const REVERT_MESSAGES = {
  'Sales closed': 'Les ventes de ce tirage sont closes.',
  'Invalid quantity': 'Quantité invalide, ou plus assez de tickets disponibles.',
  'Player limit reached': 'Tu as atteint la limite de tickets par joueur pour ce tirage.',
  'Wrong payment': 'Le montant envoyé ne correspond pas au prix des tickets.',
  'Not ready': 'Le tirage ne peut pas encore être demandé : la clôture n’est pas atteinte ou aucun ticket n’a été vendu.',
  'Cannot cancel': 'Ce tirage est déjà terminé : il ne peut plus être annulé.',
  'Not allowed': 'Seul l’administrateur peut annuler, sauf si l’oracle n’a pas répondu depuis plus d’une heure.',
  'Refund unavailable': 'Le remboursement n’est possible que pour un tirage annulé.',
  'Nothing to refund': 'Tu n’as aucun ticket à te faire rembourser.',
  'Nothing to withdraw': 'Tu n’as aucun gain à retirer.',
  'Transfer failed': 'Le transfert vers ton portefeuille a échoué.',
  'Current draw still active': 'Un tirage est encore en cours : il doit se terminer avant d’en créer un autre.',
  'Only owner': 'Seul le propriétaire de l’usine à tirages (l’admin) peut faire ça.',
  'Invalid player limit': 'La limite par joueur doit être entre 1 et le nombre de tickets.',
  'Invalid configuration': 'Réglages invalides : durée et nombre de tickets (1 à 10 000) doivent être positifs.',
  'Nothing sent': 'Indique un montant à envoyer.',
  'Unknown or already fulfilled request': 'L’oracle a déjà répondu à cette demande.',
};

const TX_STEPS = [
  ['Signature', 'Confirme la transaction dans la fenêtre MetaMask.'],
  ['Validation par le réseau', 'Un validateur inscrit ta transaction dans un nouveau bloc.'],
  ['Confirmé', 'C’est inscrit dans la blockchain, pour toujours.'],
];

const CYCLE = [
  ['Ventes', 'Ouvertes jusqu’à l’échéance, ou jusqu’au dernier ticket.'],
  ['Demande à l’oracle', 'Le contrat demande un nombre aléatoire à Chainlink.'],
  ['Réponse de l’oracle', 'Le nombre arrive avec une preuve vérifiée.'],
  ['Gagnant', 'Le nombre désigne le ticket gagnant.'],
  ['Retrait', 'Le gagnant retire la cagnotte.'],
];

const TOUR_STEPS = [
  { view: 'lottery', title: 'Bienvenue sur BlockLucky', text: ['BlockLucky est une loterie de démonstration : tu achètes des tickets, un ticket est tiré au sort, et son propriétaire gagne toute la cagnotte.', 'Aucun argent réel n’est en jeu. Ce tuto dure une minute.'] },
  { view: 'lottery', target: '#walletCard', title: 'Ton portefeuille', text: ['Voici ton solde. En mode démo, il est vide tant que tu n’as pas de compte : à l’inscription, tu reçois 1 ETH fictif pour jouer.', 'L’ETH est la monnaie de la blockchain Ethereum. Ici, il n’a aucune valeur.'] },
  { view: 'lottery', target: '#potCard', title: 'La cagnotte', text: ['Chaque ticket acheté ajoute 0,01 ETH à la cagnotte, et le gagnant remporte 100 %.', 'Le tirage a lieu à l’échéance, ou dès que tous les tickets sont vendus.'] },
  { view: 'lottery', target: '#quantityZone', title: 'Choisis tes tickets', text: ['Utilise + et −, ou un raccourci. Tu peux prendre de 1 à 20 tickets par achat.', 'Une limite par joueur garantit que personne ne rafle tous les tickets.'] },
  { view: 'lottery', target: '#estimate', title: 'Tes chances', text: ['Ta part = tes tickets ÷ tous les tickets du tirage. Plus tu en as, plus tes chances montent.'] },
  { view: 'lottery', target: '#buy', title: 'Acheter', text: ['Un récapitulatif s’affiche avant de confirmer : rien n’est débité sans ton accord.'] },
  { view: 'lottery', target: '#activityCard', title: 'En direct', text: ['Les achats de tous les joueurs apparaissent ici instantanément, sans recharger la page.'] },
  { view: 'lottery', target: ['.side-nav [data-view="tickets"]', '.mobile-nav [data-view="tickets"]'], title: 'Mes tickets', text: ['Retrouve tes numéros de tickets, tes tirages passés et tes reçus.'] },
  { view: 'lottery', target: ['.side-nav [data-view="history"]', '.mobile-nav [data-view="history"]'], title: 'Résultats', text: ['L’historique de tous les tirages et de leurs gagnants.'] },
  { view: 'lottery', target: '#accountButton', title: 'Ton compte', text: ['Crée un compte gratuit pour jouer en démo : tu reçois 1 ETH fictif.', 'Ton solde et tes tickets te suivent ensuite sur n’importe quel appareil.'] },
  { view: 'lottery', target: '#notificationButton', title: 'Notifications', text: ['Tu es prévenu ici quand un tirage auquel tu participes se termine.'] },
  { view: 'settings', target: '#modeOptions', title: 'Le mode blockchain', text: ['Envie d’aller plus loin ? Passe en mode « Blockchain » avec MetaMask : un tuto te guide pas à pas.', 'Les règles sont alors appliquées par un smart contract, et le hasard vient d’un oracle vérifiable.'] },
  { view: 'lottery', target: '#themeToggle', title: 'À toi de jouer !', text: ['Ce bouton change le thème clair ou sombre.', 'Tu peux relancer ce tuto à tout moment depuis « Revoir le tuto » ou les Réglages.'] },
];

// ---------------------------------------------------------------------------
// État de l'application
// ---------------------------------------------------------------------------
const app = {
  mode: 'demo',
  state: null,          // données affichées (même forme dans les deux modes)
  session: null,        // compte, portefeuille vérifié, annonces, robinet
  config: null,         // contrats déployés (public/contract.json) ou null
  quantity: 1,
  busy: false,
  view: 'lottery',
  pending: null,        // achat en attente de confirmation
  refreshing: null,
  refreshAgain: false,
  live: false,          // flux temps réel connecté
  seenDraw: undefined,  // dernier tirage connu, pour déclencher l'animation une seule fois
  seenActivity: null,
  zeroRefreshed: null,
  chain: {
    provider: null, signer: null, factory: null, account: null,
    info: null, rounds: [], timeOffset: 0, wrongNetwork: false,
    lotteries: new Map(), events: [], factoryScannedTo: null, blocks: new Map(), oracleTimeout: null,
  },
};

// Sans contrat déployé, on parle du « réseau de test » plutôt que d'afficher un identifiant vide.
const network = () => NETWORKS[app.config?.chainId] || (app.config
  ? { name: `Réseau ${app.config.chainId}`, short: `Réseau ${app.config.chainId}`, explorer: null, blockTime: 'quelques secondes' }
  : { name: 'de test', short: 'Blockchain', explorer: null, blockTime: 'quelques secondes' });
const isLocalChain = () => app.config?.chainId === 31337;
const now = () => Date.now() + (app.mode === 'chain' ? app.chain.timeOffset : 0);
const networkLabel = () => (app.mode === 'demo' ? 'Démonstration' : network().short);
const explorerUrl = (kind, value) => network().explorer && app.mode === 'chain' ? `${network().explorer}/${kind}/${value}` : null;
const currentPhase = () => PHASES[app.mode === 'chain' ? app.chain.info?.phase || 'none' : 'open'];
const canAdmin = () => Boolean(app.session?.isAdmin || (app.mode === 'chain' && app.chain.info?.isOwner));

function timeAgo(date) {
  const seconds = Math.max(0, (now() - date) / 1000);
  if (seconds < 45) return 'à l’instant';
  if (seconds < 3600) return `il y a ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `il y a ${Math.round(seconds / 3600)} h`;
  return new Date(date).toLocaleDateString('fr-FR');
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

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
    return isLocalChain() && app.mode === 'chain'
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
  if (!VIEWS[view] || (view === 'admin' && !canAdmin())) view = 'lottery';
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
  if (view === 'admin') admin?.load(true);
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
const playerLimitLeft = () => Math.max(0, (app.state?.rules?.maxPerPlayer ?? MAX_PER_PURCHASE) - (app.state?.myTickets ?? 0));

function affordableTickets() {
  const s = app.state;
  if (!s) return MAX_PER_PURCHASE;
  const remaining = Math.max(0, s.capacity - s.totalTickets);
  const byBalance = Math.floor((s.balance + 1e-9) / TICKET_PRICE);
  return Math.min(MAX_PER_PURCHASE, remaining, byBalance, playerLimitLeft());
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
async function loadConfig() {
  try {
    const response = await fetch('/contract.json', { cache: 'no-store' });
    const config = response.ok ? await response.json() : null;
    return config?.factory ? config : null; // un ancien déploiement (sans usine) est ignoré
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
    const [session, next] = await Promise.all([
      api('/api/session'),
      mode === 'demo' ? api('/api/state').then(data => ({ ...data, closed: false })) : app.chain.factory ? readChain() : null,
    ]);
    if (app.mode !== mode) return; // le mode a changé pendant le chargement
    app.session = session;
    if (next) app.state = next;
    setConnectionError(null);
    render();
    if (next) detectDraw();
  } catch (error) {
    if (app.mode !== mode) return;
    const message = errorMessage(error);
    setConnectionError(message);
    if (!silent) toast(message, 'error');
    render();
  }
}

let refreshTimer;
/** Regroupe les événements temps réel rapprochés en une seule actualisation. */
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh(), 250);
}

// ---------------------------------------------------------------------------
// Temps réel (Server-Sent Events)
// ---------------------------------------------------------------------------
function setLive(live) {
  app.live = live;
  const status = $('liveStatus');
  status.className = live ? 'status status-live' : 'status';
  status.innerHTML = live ? '<i></i>En direct' : 'Reconnexion…';
  status.title = live ? 'Les nouveautés arrivent instantanément.' : 'Connexion temps réel perdue : actualisation toutes les 6 secondes.';
}

function connectStream() {
  if (!window.EventSource) return;
  const source = new EventSource('/api/stream');
  source.addEventListener('hello', () => { setLive(true); scheduleRefresh(); });
  source.addEventListener('error', () => setLive(false)); // le navigateur se reconnecte tout seul
  source.addEventListener('update', () => { if (app.mode === 'demo') scheduleRefresh(); });
  source.addEventListener('chain', () => { if (app.mode === 'chain') scheduleRefresh(); });
  source.addEventListener('announcement', () => scheduleRefresh());
}

// ---------------------------------------------------------------------------
// Blockchain (MetaMask)
// ---------------------------------------------------------------------------
/**
 * Adresse de Ganache pour MetaMask. Sur l'ordinateur : 127.0.0.1. Depuis un téléphone (site ouvert via
 * l'adresse réseau du PC), 127.0.0.1 désignerait le téléphone : on prend l'adresse du PC (npm run chain:lan).
 */
function localRpcUrl() {
  const host = location.hostname;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) ? 'http://127.0.0.1:8545' : `http://${host}:8545`;
}

async function ensureNetwork() {
  if (!window.ethereum) throw new Error('MetaMask n’est pas installé dans ce navigateur.');
  if (!app.config) throw new Error('Aucun contrat n’est déployé : lance « npm run deploy », puis recharge la page.');
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
        params: [{ chainId, chainName: 'Ganache local (BlockLucky)', rpcUrls: [localRpcUrl()], nativeCurrency: { name: 'Ether de test', symbol: 'ETH', decimals: 18 } }],
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
  c.signer = await c.provider.getSigner(address);
  c.account = await c.signer.getAddress();
  c.factory = new Contract(app.config.factory, app.config.abi.factory, c.signer);
}

async function connect({ silent = false } = {}) {
  if (!window.ethereum) throw Object.assign(new Error('MetaMask n’est pas installé dans ce navigateur.'), { needsOnboarding: true });
  if (!app.config) throw new Error('Aucun contrat n’est déployé. Lance « npm run deploy » (Ganache) ou « npm run deploy:sepolia », puis recharge la page.');
  const accounts = await window.ethereum.request({ method: silent ? 'eth_accounts' : 'eth_requestAccounts' });
  if (!accounts?.length) throw Object.assign(new Error('Aucun compte MetaMask n’est autorisé pour ce site.'), { needsOnboarding: true });
  if (!silent) await ensureNetwork();
  await attachAccount(accounts[0]);
}

function disconnectChain() {
  Object.assign(app.chain, { provider: null, signer: null, factory: null, account: null, info: null, wrongNetwork: false });
}

const lotteryContract = address => new Contract(address, app.config.abi.lottery, app.chain.signer);

async function getBlock(number) {
  const c = app.chain;
  if (!c.blocks.has(number)) c.blocks.set(number, await c.provider.getBlock(number));
  return c.blocks.get(number);
}

/** Lit les journaux d'événements par tranches de 9 000 blocs (limite des RPC publics). */
async function scanLogs(addresses, from, to, onLog) {
  for (let start = from; start <= to; start += LOG_CHUNK) {
    const end = Math.min(to, start + LOG_CHUNK - 1);
    const logs = await app.chain.provider.getLogs({ address: addresses.length === 1 ? addresses[0] : addresses, fromBlock: start, toBlock: end });
    logs.forEach(onLog);
  }
}

/** Découvre les tirages (événements de l'usine), puis lit les nouveaux événements de chaque tirage. */
async function syncEvents(latest) {
  const c = app.chain;
  const factoryIface = c.factory.interface;
  const lotteryIface = new Contract(app.config.factory, app.config.abi.lottery).interface;
  if (c.factoryScannedTo === null) c.factoryScannedTo = (app.config.deployBlock ?? Math.max(0, latest - LOG_CHUNK)) - 1;

  await scanLogs([app.config.factory], c.factoryScannedTo + 1, latest, log => {
    let parsed = null;
    try { parsed = factoryIface.parseLog(log); } catch { /* événement inconnu */ }
    if (parsed?.name !== 'LotteryCreated') return;
    const key = parsed.args.lottery.toLowerCase();
    if (!c.lotteries.has(key)) {
      c.lotteries.set(key, {
        address: parsed.args.lottery, round: Number(parsed.args.round), deadline: Number(parsed.args.deadline) * 1000,
        capacity: Number(parsed.args.capacity), maxPerPlayer: Number(parsed.args.maxTicketsPerPlayer), scannedTo: log.blockNumber - 1,
      });
    }
  });
  c.factoryScannedTo = Math.max(c.factoryScannedTo, latest); // jamais en arrière : pas d'événement compté deux fois

  // Les tirages déjà à jour sont lus ensemble, en une seule requête.
  const groups = new Map();
  for (const lottery of c.lotteries.values()) {
    if (lottery.scannedTo >= latest) continue;
    if (!groups.has(lottery.scannedTo)) groups.set(lottery.scannedTo, []);
    groups.get(lottery.scannedTo).push(lottery);
  }
  for (const [scannedTo, lotteries] of groups) {
    await scanLogs(lotteries.map(l => l.address), scannedTo + 1, latest, log => {
      let parsed = null;
      try { parsed = lotteryIface.parseLog(log); } catch { /* événement inconnu */ }
      if (parsed) c.events.push({ lottery: log.address.toLowerCase(), name: parsed.name, args: parsed.args, blockNumber: log.blockNumber, hash: log.transactionHash });
    });
    lotteries.forEach(l => { l.scannedTo = Math.max(l.scannedTo, latest); });
  }
}

/** Reconstitue chaque tirage (achats, résultat, annulation…) à partir des événements. */
function buildRounds(account) {
  const c = app.chain;
  const dateOf = blockNumber => c.blocks.get(blockNumber).timestamp * 1000;
  const rounds = [...c.lotteries.values()].sort((a, b) => a.round - b.round).map(l => ({
    ...l, purchases: [], win: null, cancelled: null, request: null, myRefunds: 0, myWithdrawals: 0, myRefundEvents: [], myWithdrawEvents: [],
  }));
  const byAddress = new Map(rounds.map(r => [r.address.toLowerCase(), r]));
  for (const e of c.events) {
    const r = byAddress.get(e.lottery);
    if (!r) continue;
    const mine = e.args.player && sameAddress(e.args.player, account);
    if (e.name === 'TicketPurchased') {
      const quantity = Number(e.args.quantity);
      const first = Number(e.args.firstTicket);
      r.purchases.push({ address: e.args.player, quantity, numbers: Array.from({ length: quantity }, (_, i) => first + i), date: dateOf(e.blockNumber), key: e.hash });
    } else if (e.name === 'DrawRequested') {
      r.request = { requestId: e.args.requestId.toString(), date: dateOf(e.blockNumber), hash: e.hash };
    } else if (e.name === 'WinnerSelected') {
      r.win = { winner: e.args.player, prize: Number(formatEther(e.args.prize)), winningTicket: Number(e.args.winningTicket), randomWord: e.args.randomWord.toString(), date: dateOf(e.blockNumber), hash: e.hash };
    } else if (e.name === 'LotteryCancelled') {
      r.cancelled = { by: e.args.by, date: dateOf(e.blockNumber), hash: e.hash };
    } else if (e.name === 'Refunded' && mine) {
      r.myRefunds += Number(formatEther(e.args.amount));
      r.myRefundEvents.push({ amount: Number(formatEther(e.args.amount)), date: dateOf(e.blockNumber), hash: e.hash });
    } else if (e.name === 'Withdrawn' && mine) {
      r.myWithdrawals += Number(formatEther(e.args.amount));
      r.myWithdrawEvents.push({ amount: Number(formatEther(e.args.amount)), date: dateOf(e.blockNumber), hash: e.hash });
    }
  }
  for (const r of rounds) {
    r.mine = r.purchases.filter(p => sameAddress(p.address, account));
    r.myNumbers = r.mine.flatMap(p => p.numbers);
    r.myStake = r.myNumbers.length * TICKET_PRICE;
    r.iWon = Boolean(r.win && sameAddress(r.win.winner, account));
    // Crédits restant à retirer dans ce tirage : gain + remboursement − retraits.
    r.credits = Math.max(0, Math.round(((r.iWon ? r.win.prize : 0) + r.myRefunds - r.myWithdrawals) * 1e6) / 1e6);
    r.refundable = Boolean(r.cancelled && r.myStake - r.myRefunds > 1e-9);
  }
  return rounds;
}

async function readChain() {
  const c = app.chain;
  const chainId = Number((await c.provider.getNetwork()).chainId);
  c.wrongNetwork = chainId !== app.config.chainId;
  if (c.wrongNetwork) throw new Error(`MetaMask est sur le mauvais réseau : sélectionne « ${network().name} ».`);

  const latest = await c.provider.getBlock('latest');
  // Sur Ganache, le temps peut être avancé (evm_increaseTime) : on suit l'horloge de la blockchain.
  c.timeOffset = Math.max(0, latest.timestamp * 1000 - Date.now());
  const [owner, balance] = await Promise.all([c.factory.owner(), c.provider.getBalance(c.account)]);
  // Un bloc de retard sur un réseau public : le serveur RPC qui lit les événements n'a pas toujours le tout dernier bloc.
  await syncEvents(isLocalChain() ? latest.number : latest.number - 1);
  await Promise.all([...new Set(c.events.map(e => e.blockNumber))].map(getBlock));

  const rounds = buildRounds(c.account);
  c.rounds = rounds;
  const current = rounds.at(-1) || null;

  // État en direct du tirage courant.
  let live = null;
  if (current) {
    const k = lotteryContract(current.address);
    if (c.oracleTimeout === null) c.oracleTimeout = Number(await k.ORACLE_TIMEOUT()) * 1000;
    const [status, total, requestedAt] = await Promise.all([k.status(), k.totalTickets(), k.drawRequestedAt()]);
    live = { status: STATUS[Number(status)], total: Number(total), requestedAt: Number(requestedAt) * 1000 };
  }

  let phase = 'none';
  if (live) {
    if (live.status === 'open') {
      if (now() >= current.deadline || live.total >= current.capacity) phase = live.total > 0 ? 'closable' : 'empty';
      else phase = 'open';
    } else if (live.status === 'drawing') {
      phase = now() >= live.requestedAt + c.oracleTimeout ? 'oracleTimeout' : 'drawing';
    } else phase = live.status;
  }

  const history = rounds.filter(r => r.win || r.cancelled).reverse().map(r => ({
    round: r.round, address: r.address, cancelled: Boolean(r.cancelled), tickets: r.purchases.reduce((n, p) => n + p.quantity, 0),
    winner: r.win?.winner ?? null, prize: r.win?.prize ?? 0, winningTicket: r.win?.winningTicket, randomWord: r.win?.randomWord,
    requestId: r.request?.requestId, date: (r.win || r.cancelled).date, hash: (r.win || r.cancelled).hash,
  }));

  const participations = rounds.filter(r => r.myNumbers.length).reverse().map(r => ({
    round: r.round, quantity: r.myNumbers.length, ticketNumbers: r.myNumbers, date: r.mine[0].date,
    status: r.win ? (r.iWon ? 'won' : 'lost') : r.cancelled ? 'cancelled' : 'pending',
    winner: r.win?.winner, winningTicket: r.win?.winningTicket, prize: r.win?.prize ?? 0,
  }));

  const transactions = rounds.flatMap(r => [
    ...r.mine.map(p => ({ id: p.key, type: 'purchase', round: r.round, quantity: p.quantity, amount: -p.quantity * TICKET_PRICE, date: p.date, ticketNumbers: p.numbers })),
    ...(r.iWon ? [{ id: r.win.hash, type: 'win', round: r.round, quantity: 0, amount: r.win.prize, date: r.win.date }] : []),
    ...r.myRefundEvents.map(e => ({ id: e.hash, type: 'refund', round: r.round, quantity: 0, amount: e.amount, date: e.date })),
    ...r.myWithdrawEvents.map(e => ({ id: e.hash, type: 'withdraw', round: r.round, quantity: 0, amount: e.amount, date: e.date })),
  ]).sort((a, b) => b.date - a.date);

  const readIds = new Set(JSON.parse(store.get('read.' + app.config.factory) || '[]'));
  const notifications = participations.filter(p => p.status !== 'pending').map(p => {
    const id = `chain-${app.config.factory}-${c.account}-${p.round}`;
    return { id, round: p.round, type: p.status, prize: p.status === 'cancelled' ? p.quantity * TICKET_PRICE : p.prize, winningTicket: p.winningTicket, date: history.find(h => h.round === p.round)?.date ?? p.date, read: readIds.has(id) };
  });

  c.info = {
    phase, owner, isOwner: sameAddress(owner, c.account), blockNumber: latest.number,
    lottery: current?.address ?? null, round: current?.round ?? null,
    requestId: current?.request?.requestId ?? null, requestedAt: live?.requestedAt ?? 0,
    credits: rounds.reduce((n, r) => n + r.credits, 0),
    creditTargets: rounds.filter(r => r.credits > 0).map(r => ({ address: r.address, round: r.round, amount: r.credits })),
    refundTargets: rounds.filter(r => r.refundable).map(r => ({ address: r.address, round: r.round, amount: r.myStake - r.myRefunds })),
  };

  const total = live?.total ?? 0;
  return {
    round: current?.round ?? 1,
    endsAt: current?.deadline ?? Date.now(),
    capacity: current?.capacity ?? 0,
    rules: { capacity: current?.capacity ?? 0, maxPerPlayer: current?.maxPerPlayer ?? 0 },
    totalTickets: total,
    participants: new Set((current?.purchases || []).map(p => p.address.toLowerCase())).size,
    pot: total * TICKET_PRICE,
    myTickets: current?.myNumbers.length ?? 0,
    myTicketNumbers: current?.myNumbers ?? [],
    balance: Number(formatEther(balance)),
    address: c.account,
    pseudo: app.session?.account?.pseudo ?? null,
    activity: (current?.purchases || []).slice(-12).reverse(),
    history,
    transactions,
    participations,
    notifications,
    closed: phase !== 'open',
  };
}

/** Réserve de l'oracle (affichée dans l'espace admin). */
async function readOracle() {
  const [link, native] = await app.chain.factory.oracleBalance();
  return { link: Number(formatEther(link)), native: Number(formatEther(native)) };
}

async function setMode(next, { announce = false } = {}) {
  if (app.busy) return false;
  if (next === 'chain') {
    $$('.mode-option[data-mode="chain"]').forEach(b => b.classList.add('loading'));
    try {
      await connect();
    } catch (error) {
      toast(errorMessage(error), 'error');
      if (error.needsOnboarding) onboarding.open(); // MetaMask absent ou non autorisé : on guide pas à pas
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
const getParticipations = () => app.state?.participations || [];

function render() {
  renderShell();
  renderSettings();
  account?.render();
  if (!app.state) {
    $('buy').disabled = true;
    $('buy').textContent = app.mode === 'chain' ? 'Connexion au contrat…' : 'Chargement…';
    return;
  }
  renderAnnouncement();
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
  admin?.render();
}

/** Éléments qui ne dépendent que du mode, du réseau et de la session. */
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
  $$('[data-admin-only]').forEach(el => { el.hidden = !canAdmin(); });
  // Tuto MetaMask terminé pour cette adresse : plus besoin de ses boutons.
  const onboarded = onboarding.isComplete();
  $$('[data-open-onboarding]').forEach(b => {
    b.hidden = onboarded;
    const parent = b.parentElement;
    if (parent.classList.contains('card-actions') && parent.children.length === 1) parent.hidden = onboarded;
  });
  if (app.view === 'admin' && !canAdmin() && app.session) show('lottery', { push: false });
}

/** Dernière annonce de l'admin, en haut du tableau de bord (masquable). */
function renderAnnouncement() {
  const el = $('announcementBanner');
  const dismissed = new Set(JSON.parse(store.get('dismissedAnnouncements') || '[]'));
  const latest = (app.session?.announcements || []).find(a => !dismissed.has(a.id));
  el.hidden = !latest;
  if (!latest) return;
  setHTML(el, `<span class="banner-icon"><svg class="icon"><use href="#i-megaphone"/></svg></span>
    <div class="banner-text"><b>${esc(latest.title)}</b><p>${esc(latest.message)}</p><small class="muted">${esc(latest.author)} · ${timeAgo(latest.date)}</small></div>
    <button class="dialog-close banner-close" data-dismiss-announcement="${esc(latest.id)}" aria-label="Masquer l’annonce"><svg class="icon"><use href="#i-close"/></svg></button>`);
}

document.addEventListener('click', event => {
  const id = event.target.closest('[data-dismiss-announcement]')?.dataset.dismissAnnouncement;
  if (!id) return;
  const dismissed = new Set(JSON.parse(store.get('dismissedAnnouncements') || '[]'));
  dismissed.add(id);
  store.set('dismissedAnnouncements', JSON.stringify([...dismissed].slice(-50)));
  renderAnnouncement();
});

/** Mode démo dans un navigateur qui a MetaMask : on rappelle que le solde est fictif et où trouver le mode blockchain. */
const metaMaskInDemo = () => app.mode === 'demo' && Boolean(window.ethereum);

function renderMetaMaskSwitch() {
  const box = $('walletSwitch');
  box.hidden = !metaMaskInDemo();
  if (box.hidden) return;
  setHTML(box, `<p>Ce solde est celui du <b>mode démo</b> (ETH fictif). MetaMask et tes ETH de test ne s’utilisent qu’en <b>mode blockchain</b>.</p><button class="btn btn-primary btn-sm" data-go-chain><svg class="icon"><use href="#i-cube"/></svg>Passer en mode blockchain</button>`);
}

/**
 * Redirection vers le choix « Blockchain · MetaMask » des Réglages : la page s'y rend, le bouton est mis en évidence
 * et reçoit le focus. Le joueur décide lui-même d'y passer : en mode démo, rien ne se connecte à MetaMask.
 */
function goToChainMode() {
  $$('dialog[open]').forEach(d => d.close());
  show('settings');
  const option = document.querySelector('.mode-option[data-mode="chain"]');
  setTimeout(() => {
    option.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    option.focus({ preventScroll: true });
    option.classList.remove('spotlight');
    void option.offsetWidth; // relance l'animation si on clique plusieurs fois
    option.classList.add('spotlight');
  }, 120);
}
document.addEventListener('click', event => {
  if (event.target.closest('[data-go-chain]')) goToChainMode();
});

function renderWallet() {
  const s = app.state;
  fx.countTo($('balance'), s.balance, fmtEth);
  $('walletCard').classList.toggle('wallet-empty', s.balance <= 0); // illustration sans billet
  renderMetaMaskSwitch();
  $('addressShort').textContent = short(s.address);
  $('addressAvatar').style.setProperty('--h', parseInt(s.address.slice(2, 6), 16) % 360);
  const pseudo = app.session?.account?.pseudo;
  $('walletGreeting').textContent = pseudo ? `Bonjour ${pseudo} ·` : '';
  const verified = app.mode === 'chain' && sameAddress(app.session?.wallet?.address, s.address);
  $('verifiedChip').hidden = !verified;
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
  $('remaining').textContent = remaining ? `${plural(remaining, 'ticket')} disponible${remaining > 1 ? 's' : ''}` : s.capacity ? 'Tous les tickets sont vendus' : 'Aucun tirage en cours';
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
  // À zéro, on actualise tout de suite pour afficher la suite (tirage démo, ou bouton « demander le tirage »).
  if (seconds === 0 && app.zeroRefreshed !== s.endsAt) { app.zeroRefreshed = s.endsAt; refresh(); }
}

/** Mode démo sans compte : portefeuille vide, il faut créer un compte pour recevoir 1 ETH fictif. */
const isDemoGuest = () => app.mode === 'demo' && Boolean(app.session) && !app.session.account;

function purchaseBlocker() {
  const s = app.state;
  const remaining = Math.max(0, s.capacity - s.totalTickets);
  if (s.closed) return 'closed';
  if (remaining === 0) return 'full';
  if (isDemoGuest()) return 'guest';
  if (playerLimitLeft() === 0) return 'limitReached';
  if (app.quantity > playerLimitLeft()) return 'limit';
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
  const limit = s.rules?.maxPerPlayer ?? MAX_PER_PURCHASE;
  const left = playerLimitLeft();
  const blocker = purchaseBlocker();
  const share = ((s.myTickets + q) / (s.totalTickets + q)) * 100;

  $('estimatedOdds').textContent = blocker ? '—' : fmtPct(share);
  $('chanceProgress').style.width = `${blocker ? 0 : share}%`;
  $('total').textContent = `${fmtEth(q * TICKET_PRICE)} ETH`;
  $('balanceAfter').textContent = blocker ? '—' : `${fmtEth(s.balance - q * TICKET_PRICE)} ETH`;

  // Limite par joueur
  setHTML($('limitInfo'), limit
    ? `<span>Limite : <b>${limit}</b> tickets par joueur · tu en as <b>${s.myTickets}</b></span><span class="limit-track"><i style="width:${Math.min(100, (100 * s.myTickets) / limit)}%"></i></span>`
    : '');

  const affordable = affordableTickets();
  $$('[data-quantity]').forEach(b => {
    b.classList.toggle('selected', Number(b.dataset.quantity) === q);
    b.disabled = app.busy || s.closed || Number(b.dataset.quantity) > Math.max(1, affordable);
  });
  $('maxQuantity').disabled = app.busy || s.closed || affordable < 1;
  $('minus').disabled = app.busy || q <= 1;
  $('plus').disabled = app.busy || q >= MAX_PER_PURCHASE;

  const buy = $('buy');
  buy.disabled = app.busy || (Boolean(blocker) && blocker !== 'guest'); // invité : le bouton ouvre l'inscription
  const labels = {
    guest: 'Créer un compte pour jouer',
    closed: 'Ventes closes',
    full: 'Plus aucun ticket disponible',
    limitReached: 'Limite de tickets atteinte',
    limit: `Plus que ${plural(left, 'ticket')} autorisé${left > 1 ? 's' : ''}`,
    remaining: `Plus que ${plural(remaining, 'ticket')} disponible${remaining > 1 ? 's' : ''}`,
    balance: 'Solde insuffisant',
  };
  setHTML(buy, app.busy
    ? '<span class="spinner"></span>Achat en cours…'
    : blocker ? labels[blocker] : `Acheter ${plural(q, 'ticket')}<svg class="icon"><use href="#i-arrow"/></svg>`);

  const help = {
    guest: metaMaskInDemo()
      ? 'En invité, ton portefeuille démo est vide. Crée un compte gratuit (1 ETH fictif offert), ou passe en mode blockchain pour jouer avec MetaMask.'
      : 'En invité, ton portefeuille démo est vide. Crée un compte gratuit : tu reçois 1 ETH fictif pour jouer.',
    closed: chain ? 'Les ventes de ce tirage sont terminées : la bannière en haut indique la suite.' : 'Les ventes de ce tirage sont terminées.',
    full: 'Tous les tickets sont vendus : le tirage va avoir lieu.',
    limitReached: `Tu as déjà ${limit} tickets : c’est le maximum par joueur, pour que chacun ait sa chance.`,
    limit: `La limite est de ${limit} tickets par joueur : réduis la quantité.`,
    remaining: 'Réduis la quantité pour acheter les derniers tickets.',
    balance: chain ? 'Ton solde ne suffit pas. Réduis la quantité, ou récupère des ETH de test (tuto MetaMask).' : 'Ton solde ne suffit pas. Réduis la quantité.',
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
  } else if (participation?.status === 'cancelled') {
    status.className = 'status status-danger';
    status.textContent = 'Annulé';
    $('odds').textContent = 'Ce tirage a été annulé : ta mise t’est rendue.';
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
    return `<div class="activity-row ${isNew ? 'new' : ''}">${avatar(a.address, '', a.pseudo)}<b>${esc(displayName(a.address, a.pseudo))}${you}</b><span class="ticket-chip">${plural(a.quantity, 'ticket')}</span><time>${timeAgo(a.date)}</time></div>`;
  });
  app.seenActivity = seen;
  setHTML($('activity'), rows.length ? rows.join('') : empty('i-ticket', 'Aucun achat pour le moment. Sois le premier !'));
}

function renderChainBanner() {
  const el = $('chainBanner');
  const info = app.chain.info;
  if (app.mode !== 'chain' || !info) { el.hidden = true; return; }
  let icon = 'i-cube';
  let title = '';
  let text = '';
  let action = null;
  let warn = false;
  const ownerAction = info.isOwner ? ['goAdmin', 'Créer un tirage'] : null;
  if (info.credits > 0) {
    icon = 'i-trophy';
    title = `${fmtEth(info.credits)} ETH t’attendent dans le contrat`;
    text = 'Clique pour les transférer vers ton portefeuille MetaMask.';
    action = ['withdraw', 'Retirer mes gains'];
  } else if (info.refundTargets.length) {
    warn = true;
    title = 'Un tirage auquel tu participais a été annulé';
    text = 'Ta mise est disponible : demande ton remboursement, puis retire-le.';
    action = ['refund', 'Me faire rembourser'];
  } else if (info.phase === 'none') {
    title = 'Aucun tirage en cours';
    text = info.isOwner ? 'Tu es l’administrateur : crée le premier tirage depuis l’espace admin.' : 'L’administrateur n’a pas encore créé de tirage. Reviens bientôt !';
    action = ownerAction;
  } else if (info.phase === 'closable') {
    title = 'Les ventes sont closes';
    text = 'N’importe quel joueur peut maintenant demander le tirage : le contrat demandera un nombre aléatoire à l’oracle Chainlink.';
    action = ['requestDraw', 'Demander le tirage'];
  } else if (info.phase === 'drawing') {
    icon = 'i-sparkle';
    const seconds = Math.max(0, Math.round((now() - info.requestedAt) / 1000));
    title = 'L’oracle prépare un nombre aléatoire…';
    text = `Demande n° ${esc(short(info.requestId || ''))} envoyée il y a ${seconds} s. `
      + (isLocalChain() ? 'En local, le serveur BlockLucky joue le rôle de l’oracle : la réponse arrive en quelques secondes.' : 'Chainlink attend 3 blocs de confirmation, puis répond avec une preuve : comptez 1 à 2 minutes.');
    if (isLocalChain() && seconds > 10) action = ['simulateOracle', 'Répondre à la place de l’oracle'];
  } else if (info.phase === 'oracleTimeout') {
    warn = true;
    title = 'L’oracle n’a pas répondu depuis plus d’une heure';
    text = 'N’importe qui peut annuler ce tirage : chaque joueur pourra alors récupérer sa mise.';
    action = ['cancel', 'Annuler le tirage'];
  } else if (info.phase === 'settled') {
    icon = 'i-trophy';
    const result = app.state.history[0];
    title = result && sameAddress(result.winner, app.chain.account) ? 'Tu as gagné ce tirage !' : 'Ce tirage est terminé';
    text = result ? `Ticket gagnant n° ${pad(result.winningTicket)} · ${esc(short(result.winner))} remporte ${fmtEth(result.prize)} ETH. Le prochain tirage sera créé par l’administrateur.` : '';
    action = ownerAction ? ['goAdmin', 'Créer le tirage suivant'] : null;
  } else if (info.phase === 'cancelled') {
    warn = true;
    title = 'Tirage annulé';
    text = 'Chaque joueur peut récupérer sa mise. Le prochain tirage sera créé par l’administrateur.';
    action = ownerAction;
  } else if (info.phase === 'empty') {
    warn = true;
    title = 'Tirage terminé sans participant';
    text = 'Aucun ticket n’a été vendu avant la clôture.';
    action = ownerAction;
  } else {
    el.hidden = true;
    return;
  }
  el.className = `action-banner${warn ? ' warn' : ''}`;
  setHTML(el, `<span class="banner-icon${info.phase === 'drawing' ? ' spinning' : ''}"><svg class="icon"><use href="#${icon}"/></svg></span><div class="banner-text"><b>${esc(title)}</b><p>${text}</p></div>`
    + (action ? (action[0] === 'goAdmin' ? `<a class="btn btn-primary" href="#admin" data-view="admin">${action[1]}</a>` : `<button class="btn btn-primary" data-chain-action="${action[0]}">${action[1]}</button>`) : ''));
  el.hidden = false;
}

function renderTickets() {
  const s = app.state;
  const numbers = s.myTicketNumbers || [];
  const participation = getParticipations().find(p => p.round === s.round && p.status !== 'pending');
  const winning = participation?.winningTicket;
  const cancelled = participation?.status === 'cancelled';
  setHTML($('myTickets'), numbers.length
    ? numbers.map((n, i) => {
      const state = cancelled ? 'lost' : winning ? (n === winning ? 'won' : 'lost') : '';
      const label = cancelled ? 'ANNULÉ' : winning ? (n === winning ? 'GAGNANT' : 'TERMINÉ') : 'EN JEU';
      return `<article class="ticket ${state}" style="--i:${Math.min(i, 24)}"><small>TIRAGE ${pad(s.round)} · ${label}</small><strong>N° ${pad(n)}</strong><small>${esc(short(s.address))} · 0,01 ETH</small></article>`;
    }).join('')
    : empty('i-ticket', 'Aucun ticket pour ce tirage.', '<a class="btn btn-primary btn-sm" href="#lottery" data-view="lottery">Acheter des tickets</a>'));
  $('ticketSummary').textContent = `Tirage n° ${pad(s.round)} · ${plural(s.myTickets, 'ticket')}`;
}

function renderParticipations() {
  const filter = $('participationFilter').value;
  const entries = getParticipations().filter(p => filter === 'all' || p.status === filter);
  const labels = { pending: ['En cours', 'status-live'], won: ['Gagné', 'status-win'], lost: ['Perdu', ''], cancelled: ['Annulé · remboursé', 'status-danger'] };
  setHTML($('pastParticipations'), entries.length
    ? entries.map(p => {
      const [label, cls] = labels[p.status] || labels.pending;
      const amount = p.status === 'won' ? `+${fmtEth(p.prize)} ETH` : `${fmtEth(p.quantity * TICKET_PRICE)} ETH ${p.status === 'cancelled' ? 'rendus' : 'misés'}`;
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
    welcome: () => 'Cadeau de bienvenue (compte créé)',
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
    && (!query || String(h.round).includes(query) || pad(h.round).includes(query) || (h.winner || '').toLowerCase().includes(query) || (h.winnerPseudo || '').toLowerCase().includes(query)));
}

function renderHistory() {
  const s = app.state;
  const rows = filteredHistory();
  setHTML($('history'), rows.length
    ? rows.map(h => {
      const date = new Date(h.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      if (h.cancelled) {
        return `<article class="card history-row cancelled"><span class="round-badge">#${pad(h.round)}</span><div><div class="winner"><span class="status status-danger">Annulé</span></div><div class="meta">${plural(h.tickets, 'ticket')} remboursé${h.tickets > 1 ? 's' : ''} · ${date}</div></div><button class="btn btn-ghost btn-sm" data-result="${h.round}">Détails</button><strong class="prize muted">—</strong></article>`;
      }
      const mine = sameAddress(h.winner, s.address);
      const ticket = h.winningTicket ? ` · ticket n° ${pad(h.winningTicket)}` : '';
      return `<article class="card history-row ${mine ? 'mine' : ''}"><span class="round-badge">#${pad(h.round)}</span><div><div class="winner">${avatar(h.winner, '', h.winnerPseudo)}${esc(displayName(h.winner, h.winnerPseudo))}${mine ? ' <span class="chip chip-accent">Toi</span>' : ''}</div><div class="meta">${plural(h.tickets, 'ticket')}${ticket} · ${date}</div></div><button class="btn btn-ghost btn-sm" data-result="${h.round}">Détails</button><strong class="prize">${fmtEth(h.prize)} ETH</strong></article>`;
    }).join('')
    : empty('i-trophy', s.history.length ? 'Aucun résultat ne correspond à ta recherche.' : 'Aucun tirage terminé pour le moment.'));
}

function renderNotifications() {
  const notifications = app.state.notifications || [];
  const unread = notifications.filter(n => !n.read).length;
  $('notificationCount').textContent = unread;
  $('notificationCount').hidden = unread === 0;
  $('notificationButton').setAttribute('aria-label', unread ? `Notifications : ${unread} non lue${unread > 1 ? 's' : ''}` : 'Notifications');
  const announcements = app.session?.announcements || [];
  const titles = {
    won: n => `Tu remportes ${fmtEth(n.prize)} ETH !`,
    lost: n => `Le tirage n° ${pad(n.round)} est terminé`,
    cancelled: n => `Tirage n° ${pad(n.round)} annulé : ${fmtEth(n.prize)} ETH rendus`,
  };
  setHTML($('notificationList'),
    (announcements.length ? `<p class="label">Annonces</p>${announcements.map(a => `<div class="notification-item announcement"><span class="notification-state"><svg class="icon"><use href="#i-megaphone"/></svg></span><span><b>${esc(a.title)}</b><small>${esc(a.message)}</small></span><span></span></div>`).join('')}<p class="label">Tes tirages</p>` : '')
    + (notifications.length
      ? notifications.map(n => `<button class="notification-item ${n.read ? '' : 'unread'}" data-result="${n.round}"><span class="notification-state ${n.type === 'won' ? 'won' : ''}">${n.type === 'won' ? '+' : n.type === 'cancelled' ? '↺' : '✓'}</span><span><b>${(titles[n.type] || titles.lost)(n)}</b><small>Tirage n° ${pad(n.round)} · ${new Date(n.date).toLocaleDateString('fr-FR')}</small></span><svg class="icon"><use href="#i-arrow"/></svg></button>`).join('')
      : empty('i-bell', 'Tes résultats apparaîtront ici.')));
}

function renderSettings() {
  const chain = app.mode === 'chain';
  $$('.mode-option').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.mode === app.mode));
    b.disabled = app.busy;
  });
  $('chainOptionText').textContent = !window.ethereum
    ? 'MetaMask n’est pas détecté dans ce navigateur : clique pour suivre le tuto d’installation.'
    : !app.config
      ? 'Aucun contrat déployé pour l’instant : lance « npm run deploy », puis recharge la page.'
      : `Les règles sont appliquées par un smart contract sur ${network().name}, et le hasard vient d’un oracle vérifiable.`;
  $('networkDescription').textContent = chain
    ? `Connecté à ${network().name} avec le compte ${short(app.chain.account)}. Chaque achat est une vraie transaction sur cette blockchain de test (validation : ${network().blockTime}).`
    : 'Mode démo : le serveur BlockLucky gère des crédits fictifs. Pratique pour découvrir, mais il faut faire confiance au serveur.';

  if (!app.config) {
    setHTML($('contractInfo'), '<dt>État</dt><dd>Aucun contrat déployé. Lance <code>npm run chain</code> puis <code>npm run deploy</code>, ou <code>npm run deploy:sepolia</code>.</dd>');
    $('explorerLink').hidden = true;
  } else {
    const info = app.chain.info;
    setHTML($('contractInfo'), `<dt>Réseau</dt><dd>${esc(network().name)} (identifiant ${app.config.chainId})</dd>`
      + `<dt>Usine à tirages</dt><dd><code>${esc(app.config.factory)}</code></dd>`
      + (info?.lottery ? `<dt>Tirage en cours</dt><dd><code>${esc(info.lottery)}</code></dd>` : '')
      + `<dt>Administrateur</dt><dd><code>${esc(short(app.config.owner))}</code></dd>`
      + `<dt>Oracle</dt><dd>${app.config.vrf?.mode === 'mock' ? 'Chainlink VRF simulé (local)' : 'Chainlink VRF v2.5'}</dd>`
      + (chain && app.state ? `<dt>Règles</dt><dd>0,01 ETH le ticket · ${app.state.capacity} tickets · ${app.state.rules.maxPerPlayer} max par joueur</dd>` : ''));
    const url = network().explorer ? `${network().explorer}/address/${app.config.factory}` : null;
    $('explorerLink').hidden = !url;
    if (url) $('explorerLink').href = url;
  }

  const info = app.chain.info;
  $('chainCycle').hidden = !(chain && info && info.phase !== 'none');
  if (!chain || !info) return;
  const current = { open: 0, closable: 1, empty: 1, drawing: 2, oracleTimeout: 2, settled: 4, cancelled: -1, none: -1 }[info.phase];
  setHTML($('cycleSteps'), CYCLE.map(([title, text], i) => `<li class="${i < current ? 'done' : i === current ? 'current' : ''}"><b>${title}</b>${text}</li>`).join(''));
  const hints = {
    open: 'Les ventes sont ouvertes : achète des tickets depuis le tableau de bord.',
    closable: 'Les ventes sont closes. Clique sur « Demander le tirage ».',
    empty: 'Aucun ticket vendu : ce tirage est terminé. L’administrateur peut en créer un nouveau.',
    drawing: 'La demande est partie : l’oracle répond avec un nombre aléatoire et sa preuve.',
    oracleTimeout: 'L’oracle n’a pas répondu à temps : n’importe qui peut annuler, puis chacun se fait rembourser.',
    settled: info.credits > 0 ? 'Le gagnant peut retirer sa cagnotte.' : 'Tirage terminé. L’administrateur crée le suivant.',
    cancelled: 'Tirage annulé : chaque joueur se fait rembourser, puis retire sa mise.',
  };
  $('cycleHint').textContent = hints[info.phase] || '';
  $('requestDrawButton').disabled = app.busy || info.phase !== 'closable';
  $('cancelDrawButton').disabled = app.busy || !(info.phase === 'oracleTimeout' || (info.isOwner && ['open', 'closable', 'drawing'].includes(info.phase)));
  $('refundButton').disabled = app.busy || !info.refundTargets.length;
  $('withdrawButton').disabled = app.busy || !(info.credits > 0);
}

// ---------------------------------------------------------------------------
// Tirage : animation quand un résultat tombe
// ---------------------------------------------------------------------------
function detectDraw() {
  const latest = app.state.history[0];
  const key = latest ? `${app.mode}:${app.mode === 'chain' ? app.config.factory : ''}:${latest.round}:${latest.cancelled ? 'x' : 'w'}` : null;
  if (app.seenDraw === undefined) { app.seenDraw = key; return; } // premier chargement : pas d'animation
  if (!key || key === app.seenDraw) return;
  app.seenDraw = key;
  const participation = getParticipations().find(p => p.round === latest.round && p.status !== 'pending');
  if (latest.cancelled) {
    toast(participation ? `Le tirage n° ${pad(latest.round)} a été annulé : ta mise t’est rendue.` : `Le tirage n° ${pad(latest.round)} a été annulé.`);
    return;
  }
  if (!participation) {
    toast(`Le tirage n° ${pad(latest.round)} est terminé : ${displayName(latest.winner, latest.winnerPseudo)} remporte ${fmtEth(latest.prize)} ETH.`);
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
    winnerLabel: displayName(latest.winner, latest.winnerPseudo),
    formatEth: fmtEth,
  }).then(() => { if (won) fx.walletMoney($('walletCard'), 'in'); });
}

// ---------------------------------------------------------------------------
// Transactions blockchain
// ---------------------------------------------------------------------------
function setBusy(busy) {
  app.busy = busy;
  $$('#purchaseDialog [data-close]').forEach(b => { b.disabled = busy; });
  renderPurchase();
  renderSettings();
  admin?.render();
}

function resetTxSteps(list) {
  list._html = null;
  list.innerHTML = TX_STEPS.map(([title, text], i) => `<li><span class="step-dot">${i + 1}</span><div><b>${title}</b><small>${text}</small></div></li>`).join('');
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

/** Sur Ganache, l'estimation du gaz ignore le temps avancé (evm_increaseTime) : on fixe une limite. */
const localGas = gasLimit => (isLocalChain() ? { gasLimit } : {});

const CHAIN_ACTIONS = {
  requestDraw: {
    title: 'Demander le tirage',
    text: 'Le contrat demande un nombre aléatoire à l’oracle Chainlink. Personne, pas même l’admin, ne peut connaître ni choisir ce nombre.',
    send: () => lotteryContract(app.chain.info.lottery).requestDraw(localGas(500000)),
    done: 'Demande envoyée à l’oracle : le résultat arrive bientôt.',
  },
  cancel: {
    title: 'Annuler le tirage',
    text: 'Le tirage sera annulé : chaque joueur pourra récupérer sa mise. Aucun gagnant ne sera désigné.',
    send: () => lotteryContract(app.chain.info.lottery).cancel(localGas(150000)),
    done: 'Tirage annulé : chaque joueur peut se faire rembourser.',
  },
  refund: {
    title: 'Me faire rembourser',
    text: 'Ta mise est créditée dans le contrat. Tu pourras ensuite la retirer vers ton portefeuille.',
    send: () => lotteryContract(app.chain.info.refundTargets[0].address).refund(),
    done: 'Remboursement crédité. Retire-le maintenant vers ton portefeuille.',
  },
  withdraw: {
    title: 'Retirer mes gains',
    text: 'Le contrat t’envoie les ETH qui t’attendent.',
    send: () => lotteryContract(app.chain.info.creditTargets[0].address).withdraw(),
    done: 'Les ETH sont arrivés dans ton portefeuille !',
  },
  createLottery: {
    title: 'Créer un nouveau tirage',
    text: 'L’usine déploie un nouveau contrat de tirage avec les règles choisies.',
    send: ({ duration, capacity, maxPerPlayer }) => app.chain.factory.createLottery(duration, capacity, maxPerPlayer, localGas(3000000)),
    done: 'Nouveau tirage créé : les ventes sont ouvertes !',
  },
  fundOracle: {
    title: 'Alimenter la réserve de l’oracle',
    text: 'Ces ETH de test paieront Chainlink à chaque tirage.',
    send: ({ amount }) => app.chain.factory.fundOracle({ value: parseEther(String(amount)) }),
    done: 'Réserve de l’oracle alimentée.',
  },
  simulateOracle: {
    title: 'Répondre à la place de l’oracle',
    text: 'Simulation locale uniquement : sur Ganache il n’y a pas de nœud Chainlink. Sur Sepolia, seul Chainlink peut répondre.',
    send: () => {
      const mock = new Contract(app.config.vrf.coordinator, app.config.abi.coordinator, app.chain.signer);
      const random = BigInt('0x' + [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''));
      return mock.fulfillRandomWords(app.chain.info.requestId, random);
    },
    done: 'Réponse de l’oracle simulée.',
  },
};

async function runChainAction(method, params = {}) {
  const action = CHAIN_ACTIONS[method];
  if (!action || app.busy || app.mode !== 'chain' || !app.chain.factory) return;
  $('txTitle').textContent = action.title;
  $('txDescription').textContent = action.text;
  resetTxSteps($('txSteps'));
  $('txDialog').showModal();
  setBusy(true);
  try {
    await trackTx($('txSteps'), () => action.send(params));
    toast(action.done, 'success');
    if (method === 'withdraw') { fx.walletMoney($('walletCard'), 'in'); fx.confetti({ particles: 120 }); }
    await new Promise(resolve => setTimeout(resolve, 700));
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    setBusy(false);
    closeDialog($('txDialog'));
    await refresh();
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-chain-action]');
  if (button && !button.disabled) runChainAction(button.dataset.chainAction);
});

// ---------------------------------------------------------------------------
// Achat
// ---------------------------------------------------------------------------
$('buy').addEventListener('click', () => {
  if (app.busy || !app.state) return;
  setQuantity($('quantity').value, { animate: false });
  if (purchaseBlocker() === 'guest') { account.open('register'); return; }
  if ($('buy').disabled) return;
  const s = app.state;
  const q = app.quantity;
  const chain = app.mode === 'chain';
  app.pending = { quantity: q, round: s.round, mode: app.mode, lottery: app.chain.info?.lottery, requestId: crypto.randomUUID().replaceAll('-', '') };
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
      // Le dernier ticket déclenche aussi la demande à l'oracle : on prévoit plus de gaz en local.
      await trackTx($('purchaseSteps'), () => lotteryContract(purchase.lottery).buyTickets(purchase.quantity, { value: parseEther((purchase.quantity * TICKET_PRICE).toFixed(2)), ...localGas(1500000) }));
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
    : app.session?.account
      ? `Portefeuille de démonstration du compte ${app.session.account.pseudo} : crédits fictifs, retrouvés sur tous tes appareils.`
      : 'Portefeuille de démonstration vide : crée un compte gratuit pour recevoir 1 ETH fictif et jouer.';
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
      const key = 'read.' + app.config.factory;
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
  closeDialog($('notificationsDialog'));
  $('resultTitle').textContent = `Résultat du tirage n° ${pad(round)}`;
  if (entry.cancelled) {
    setHTML($('resultDetails'), `<div class="result-outcome">Tirage annulé</div><div class="summary"><div class="summary-row"><span>Tickets vendus</span><strong>${entry.tickets}</strong></div>${participation ? `<div class="summary-row"><span>Ta mise rendue</span><strong>${fmtEth(participation.quantity * TICKET_PRICE)} ETH</strong></div>` : ''}</div><p class="muted small">Aucun gagnant n’a été désigné : chaque joueur récupère sa mise.</p>`);
    $('resultDialog').showModal();
    return;
  }
  const won = sameAddress(entry.winner, s.address);
  const chain = app.mode === 'chain';
  const verification = chain && entry.randomWord
    ? `<div class="verify"><b>Vérification du hasard :</b> l’oracle a fourni le nombre <code>${esc(entry.randomWord)}</code>. Reste de sa division par ${entry.tickets} tickets = ${(BigInt(entry.randomWord) % BigInt(entry.tickets)).toString()}, donc ticket n° ${pad(entry.winningTicket)}. N’importe qui peut refaire ce calcul.${app.config.vrf?.mode === 'chainlink' ? ` <a href="https://vrf.chain.link/sepolia/${esc(app.config.vrf.subscriptionId)}" target="_blank" rel="noopener">Voir la preuve chez Chainlink ↗</a>` : ' (Oracle simulé en local.)'}</div>`
    : !chain ? '<div class="verify">Mode démo : le ticket gagnant est tiré par le serveur avec un générateur aléatoire cryptographique. En mode blockchain, c’est l’oracle Chainlink qui le fournit, avec une preuve.</div>' : '';
  setHTML($('resultDetails'), `
    <div class="result-outcome ${won ? 'won' : ''}">${won ? `Tu remportes ${fmtEth(entry.prize)} ETH !` : participation ? 'Pas cette fois…' : 'Tirage terminé'}</div>
    <div class="summary">
      <div class="summary-row"><span>Cagnotte</span><strong>${fmtEth(entry.prize)} ETH</strong></div>
      <div class="summary-row"><span>Gagnant</span><strong>${esc(displayName(entry.winner, entry.winnerPseudo))}${won ? ' (toi)' : ''}</strong></div>
      ${entry.winningTicket ? `<div class="summary-row"><span>Ticket gagnant</span><strong>N° ${pad(entry.winningTicket)} sur ${entry.tickets}</strong></div>` : ''}
      ${participation ? `<div class="summary-row"><span>Ta participation</span><strong>${plural(participation.quantity, 'ticket')} · ${fmtEth(participation.quantity * TICKET_PRICE)} ETH</strong></div>` : ''}
    </div>
    ${participation?.ticketNumbers?.length ? `<p class="label">Tes numéros</p><div class="result-numbers">${participation.ticketNumbers.map(n => `<span class="${n === entry.winningTicket ? 'winner-number' : ''}">${pad(n)}</span>`).join('')}</div>` : ''}
    ${verification}`);
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
    ['Tirage', 'Statut', 'Gagnant', 'Ticket gagnant', 'Tickets', 'Gain (ETH)', 'Date'],
    ...rows.map(h => [h.round, h.cancelled ? 'Annulé' : 'Terminé', h.winner ?? '', h.winningTicket ?? '', h.tickets, h.prize, new Date(h.date).toISOString()]),
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
        factory: app.config.factory,
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
// Modules : compte, tuto MetaMask, espace admin, visite guidée
// ---------------------------------------------------------------------------
const ctx = {
  app, refresh, render, show, network, now, ensureNetwork, setMode, runChainAction, readOracle, errorMessage, goToChainMode,
  phase: currentPhase,
  openOnboarding: () => onboarding.open(),
};
const account = initAccount(ctx);
const onboarding = initOnboarding(ctx);
const admin = initAdmin(ctx);

document.addEventListener('click', event => {
  if (event.target.closest('[data-open-onboarding]')) { $$('dialog[open]').forEach(d => d.close()); onboarding.open(); }
});

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
  setLive(false);

  const saved = Number(store.get('quantity'));
  if (saved >= 1 && saved <= MAX_PER_PURCHASE) {
    app.quantity = saved;
    $('savedQuantity').textContent = `(${saved} mémorisé${saved > 1 ? 's' : ''})`;
  }
  $('quantity').value = app.quantity;

  app.config = await loadConfig();
  // Reconnexion silencieuse si l'utilisateur avait choisi le mode blockchain.
  if (store.get('mode') === 'chain' && window.ethereum && app.config) {
    try { await connect({ silent: true }); app.mode = 'chain'; } catch { store.set('mode', 'demo'); }
  }
  render();
  await refresh({ silent: false });
  show(hashView(), { push: false }); // après le chargement : l'espace admin dépend de la session
  history.replaceState(null, '', '#' + app.view);

  connectStream();
  setInterval(renderCountdown, 1000);
  // Filet de sécurité : actualisation lente si le temps réel est connecté, rapide sinon.
  const poll = () => {
    if (!app.busy && !document.hidden) refresh();
    setTimeout(poll, app.live ? 20000 : 6000);
  };
  setTimeout(poll, 6000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  if (!store.get('tourDone')) setTimeout(() => tour.start(), 900);
}

init();

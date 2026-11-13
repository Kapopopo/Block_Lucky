// Serveur BlockLucky.
//   • Mode démonstration : il tient les comptes (ETH fictif) dans un fichier JSON.
//   • Comptes joueurs (e-mail + mot de passe) et connexion avec Ethereum (signature MetaMask).
//   • Espace admin : réglages des tirages, annulation, annonces, statistiques.
//   • Robinet d'ETH de test, temps réel (SSE) et, en local, oracle de hasard simulé.
// Les montants de la démo sont stockés en unités entières de 0,01 ETH pour éviter les erreurs d'arrondi.
import express from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { isAddress, getAddress } from 'ethers';
import { loadEnv } from './server/env.js';
import { hashPassword, verifyPassword } from './server/passwords.js';
import { createSiweMessage, verifySiwe } from './server/siwe.js';
import { createHub } from './server/realtime.js';
import { createChainService } from './server/chain.js';
import { resetDemoData } from './server/reset.js';

const root = path.dirname(fileURLToPath(import.meta.url));

const TICKET_PRICE = 0.01;           // ETH fictif
export const STARTING_BALANCE = 100; // 100 unités = 1 ETH fictif, offert à la création du compte (invité : 0)
const MAX_TICKETS_PER_PURCHASE = 20;
const SESSION_COOKIE = 'bl_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 jours
const MAX_RECORDS = 100;             // reçus, transactions, participations conservés
const MAX_NOTIFICATIONS = 50;
const MAX_ACTIVITY = 50;
const MAX_HISTORY = 30;
const MAX_ANNOUNCEMENTS = 20;
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const PSEUDO_PATTERN = /^[\p{L}\p{N} ._-]{2,24}$/u;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const SIWE_TTL_MS = 10 * 60 * 1000;

/** Convertit des unités entières (centièmes) en ETH. */
const toEth = units => units / 100;
/** Identifiant aléatoire court (16 caractères hexadécimaux). */
const newId = () => randomBytes(8).toString('hex');
/** Ajoute un élément en tête de liste en gardant au plus `max` éléments. */
const prepend = (item, list, max) => [item, ...(list || [])].slice(0, max);
const isInteger = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const sameAddress = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);
/** Le serveur est-il joignable depuis le réseau local (HOST=0.0.0.0 ou une adresse précise) ? */
const isExposed = host => Boolean(host) && !['127.0.0.1', 'localhost', '::1'].includes(host);
/** Adresses IPv4 de l'ordinateur sur le réseau local : Wi-Fi et Ethernet d'abord, cartes virtuelles à la fin. */
const WIFI_CARD = /wi-?fi|wlan|wireless|^en0$/i;
const VIRTUAL_CARD = /virtual|vbox|vmware|vethernet|hyper-v|docker|wsl|tailscale|zerotier/i;
const cardRank = (name, address) => (WIFI_CARD.test(name) ? 0
  : VIRTUAL_CARD.test(name) || address.startsWith('192.168.56.') ? 2 : 1); // 192.168.56.x : plage de VirtualBox
const lanAddresses = () => Object.entries(networkInterfaces())
  .flatMap(([name, list]) => (list || []).map(i => ({ ...i, rank: cardRank(name, i.address) })))
  .filter(i => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
  .sort((a, b) => a.rank - b.rank)
  .map(i => i.address);

export function createApp({
  file = path.join(root, 'data/state.json'),
  duration = 3600000,  // durée d'un tirage : 1 heure
  capacity = 100,      // tickets par tirage
  maxPerPlayer = 25,   // limite de tickets par joueur et par tirage
  contractFile = path.join(root, 'public/contract.json'), // écrit par scripts/deploy.js
  env = process.env,
  watchChain = false,  // surveillance de la blockchain (désactivée dans les tests)
  tickMs = 1000,       // fréquence de vérification de l'échéance du tirage démo
} = {}) {
  // ---------------------------------------------------------------------
  // Stockage
  // ---------------------------------------------------------------------
  mkdirSync(path.dirname(file), { recursive: true });
  const state = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : { round: 1, endsAt: Date.now() + duration, tickets: [], history: [], sessions: {}, activity: [] };
  // Compléments ajoutés au fil des versions (un ancien fichier reste compatible).
  state.settings ??= { capacity, duration, maxPerPlayer };
  state.rules ??= { capacity: state.settings.capacity, maxPerPlayer: state.settings.maxPerPlayer };
  state.accounts ??= {};
  state.announcements ??= [];
  state.faucet ??= { claims: {}, day: '', spent: 0 };
  // Ancienne version : les invités recevaient 1 ETH fictif et pouvaient jouer.
  // Désormais, sans compte, le portefeuille démo est entièrement vide : solde, opérations, tickets, reçus, notifications.
  // Une seule fois : ces invités reçoivent aussi une nouvelle adresse démo, sinon les anciens résultats
  // (gagnant = adresse) les afficheraient encore comme gagnants.
  const renewGuestAddresses = (state.version ?? 1) < 2;
  for (const session of Object.values(state.sessions)) {
    if (session.account) continue;
    session.balance = 0;
    for (const key of ['transactions', 'participations', 'receipts', 'notifications']) delete session[key];
    if (renewGuestAddresses) session.address = '0x' + randomBytes(20).toString('hex');
  }
  state.version = 2;
  state.stats ??= { ticketsSold: state.history.reduce((n, h) => n + (h.tickets || 0), 0) + state.tickets.length, rounds: state.history.length, cancelled: 0, paidOut: 0 };

  /** Écriture atomique : on écrit un fichier temporaire puis on le renomme. */
  function save() {
    writeFileSync(file + '.tmp', JSON.stringify(state));
    renameSync(file + '.tmp', file);
  }

  const hub = createHub();
  const chain = createChainService({ contractFile, env, onChange: () => hub.broadcast('chain') });
  if (watchChain) chain.start();

  /** Numéros de tickets (à partir de 1) appartenant à un joueur dans le tirage courant. */
  const ticketNumbersOf = player => state.tickets.flatMap((id, i) => (id === player ? [i + 1] : []));
  const accountOf = player => (player?.account ? state.accounts[player.account] : null);
  const pseudoOf = player => accountOf(player)?.pseudo ?? null;
  function isAdmin(player) {
    if (accountOf(player)?.role === 'admin') return true;
    const config = chain.getConfig();
    return Boolean(player?.wallet && config?.owner && sameAddress(player.wallet, config.owner));
  }

  // ---------------------------------------------------------------------
  // Tirage démo
  // ---------------------------------------------------------------------

  /** Démarre un nouveau tirage avec les réglages choisis par l'admin. */
  function startRound() {
    state.round++;
    state.tickets = [];
    state.rules = { capacity: state.settings.capacity, maxPerPlayer: state.settings.maxPerPlayer };
    state.endsAt = Date.now() + state.settings.duration;
  }

  /** Effectue le tirage si la capacité est atteinte ou si le temps est écoulé. Renvoie ce qui s'est passé. */
  function settle() {
    const timeIsUp = Date.now() >= state.endsAt;
    const isFull = state.tickets.length >= state.rules.capacity;

    if (!state.tickets.length) {
      if (!timeIsUp) return null;
      state.endsAt = Date.now() + state.settings.duration; // aucun ticket : on relance le compte à rebours
      state.rules = { capacity: state.settings.capacity, maxPerPlayer: state.settings.maxPerPlayer };
      save();
      return 'reset';
    }
    if (!timeIsUp && !isFull) return null;

    const winningTicket = randomInt(state.tickets.length) + 1;
    const winner = state.tickets[winningTicket - 1];
    const prize = state.tickets.length; // en unités : 1 ticket = 1 unité
    const winnerSession = state.sessions[winner];
    const now = Date.now();

    winnerSession.balance += prize;
    winnerSession.transactions = prepend(
      { id: newId(), type: 'win', round: state.round, amount: toEth(prize), quantity: 0, date: now },
      winnerSession.transactions, MAX_RECORDS,
    );

    for (const player of new Set(state.tickets)) {
      const participant = state.sessions[player];
      let entry = participant.participations?.find(p => p.round === state.round);
      if (!entry) {
        entry = { round: state.round, quantity: state.tickets.filter(id => id === player).length, ticketNumbers: ticketNumbersOf(player) };
        participant.participations = prepend(entry, participant.participations, MAX_RECORDS);
      }
      const won = player === winner;
      Object.assign(entry, { status: won ? 'won' : 'lost', winner: winnerSession.address, winningTicket, totalTickets: prize, prize: toEth(prize), date: now });
      participant.notifications = prepend(
        { id: newId(), round: state.round, type: entry.status, prize: won ? toEth(prize) : 0, winningTicket, date: now, read: false },
        participant.notifications, MAX_NOTIFICATIONS,
      );
    }

    state.history = prepend(
      { round: state.round, winningTicket, winner: winnerSession.address, winnerPseudo: pseudoOf(winnerSession), prize: toEth(prize), tickets: state.tickets.length, date: now },
      state.history, MAX_HISTORY,
    );
    state.stats.rounds++;
    state.stats.paidOut += prize;
    startRound();
    save();
    return 'draw';
  }

  /** Annule le tirage en cours : chaque joueur récupère sa mise. L'admin ne choisit jamais de gagnant. */
  function cancelRound() {
    const now = Date.now();
    const total = state.tickets.length;
    for (const player of new Set(state.tickets)) {
      const participant = state.sessions[player];
      const count = state.tickets.filter(id => id === player).length;
      participant.balance += count;
      participant.transactions = prepend(
        { id: newId(), type: 'refund', round: state.round, amount: toEth(count), quantity: count, date: now },
        participant.transactions, MAX_RECORDS,
      );
      const entry = participant.participations?.find(p => p.round === state.round);
      if (entry) Object.assign(entry, { status: 'cancelled', date: now });
      participant.notifications = prepend(
        { id: newId(), round: state.round, type: 'cancelled', prize: toEth(count), date: now, read: false },
        participant.notifications, MAX_NOTIFICATIONS,
      );
    }
    state.history = prepend({ round: state.round, cancelled: true, winner: null, prize: 0, tickets: total, date: now }, state.history, MAX_HISTORY);
    state.stats.cancelled++;
    startRound();
    save();
  }

  // Le tirage tombe à l'heure, même si personne ne charge la page, et tout le monde est prévenu.
  const timer = setInterval(() => {
    try {
      const event = settle();
      if (event) hub.broadcast('update', { reason: event });
    } catch (error) {
      console.error(`Tirage automatique impossible : ${error.message}`);
    }
  }, tickMs);
  timer.unref?.();

  // ---------------------------------------------------------------------
  // Middlewares
  // ---------------------------------------------------------------------
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4kb' }));

  // À l'arrêt du serveur, on arrête aussi la minuterie du tirage et la surveillance de la blockchain.
  const listen = app.listen.bind(app);
  app.listen = (...args) => {
    const server = listen(...args);
    server.on('close', () => { clearInterval(timer); chain.stop(); });
    return server;
  };

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  // Toutes les routes /api : anti-CSRF, session, puis tirage éventuel.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (req.method !== 'GET' && origin && origin !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ error: 'Origine non autorisée.' });
    }
    let id = req.headers.cookie
      ?.split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(SESSION_COOKIE + '='))
      ?.slice(SESSION_COOKIE.length + 1);
    if (!id || !Object.hasOwn(state.sessions, id)) id = createSession(res, req);
    req.player = id;
    req.me = state.sessions[id];
    if (settle() === 'draw') hub.broadcast('update', { reason: 'draw' });
    next();
  });

  /** Crée une session invitée : portefeuille démo vide, crédité de 1 ETH fictif à la création du compte. */
  function createSession(res, req) {
    const id = randomBytes(24).toString('hex');
    state.sessions[id] = { address: '0x' + randomBytes(20).toString('hex'), balance: 0 };
    save();
    setSessionCookie(res, req, id);
    return id;
  }

  function setSessionCookie(res, req, id) {
    res.cookie(SESSION_COOKIE, id, { httpOnly: true, sameSite: 'strict', maxAge: SESSION_MAX_AGE, secure: req.secure });
  }

  const requireAdmin = (req, res, next) => (isAdmin(req.me) ? next() : res.status(403).json({ error: 'Réservé aux administrateurs.' }));

  // ---------------------------------------------------------------------
  // Jeu (mode démo)
  // ---------------------------------------------------------------------

  /** État du tirage courant et données personnelles du joueur. */
  app.get('/api/state', (req, res) => {
    const me = req.me;
    res.json({
      round: state.round,
      endsAt: state.endsAt,
      capacity: state.rules.capacity,
      rules: { capacity: state.rules.capacity, maxPerPlayer: state.rules.maxPerPlayer, duration: state.settings.duration },
      ticketPrice: TICKET_PRICE,
      totalTickets: state.tickets.length,
      participants: new Set(state.tickets).size,
      pot: toEth(state.tickets.length),
      myTickets: state.tickets.filter(id => id === req.player).length,
      balance: toEth(me.balance),
      address: me.address,
      pseudo: pseudoOf(me),
      history: state.history,
      activity: state.activity.slice(0, 12),
      transactions: me.transactions || [],
      participations: me.participations || [],
      notifications: me.notifications || [],
      myTicketNumbers: ticketNumbersOf(req.player),
    });
  });

  /** Achat de tickets. */
  app.post('/api/tickets', (req, res) => {
    const { quantity, requestId, round } = req.body;
    const me = req.me;

    if (!me.account) return res.status(403).json({ error: 'Crée un compte pour jouer : tu recevras 1 ETH fictif.' });
    if (!isInteger(quantity, 1, MAX_TICKETS_PER_PURCHASE)) return res.status(400).json({ error: 'Choisissez entre 1 et 20 tickets.' });
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-f0-9]{32}$/i.test(requestId))) {
      return res.status(400).json({ error: 'Référence de requête invalide.' });
    }

    // Idempotence : une requête déjà traitée renvoie son reçu sans nouveau débit.
    const previous = requestId && (me.receipts || []).find(r => r.requestId === requestId);
    if (previous) {
      if (previous.quantity !== quantity || (round !== undefined && previous.round !== round)) {
        return res.status(409).json({ error: 'Cette référence correspond à un autre achat.' });
      }
      return res.status(200).json({ message: 'Cet achat est déjà enregistré.', receipt: previous });
    }

    if (round !== undefined && round !== state.round) return res.status(409).json({ error: 'Le tirage a changé. Vérifiez votre achat.' });
    if (state.tickets.length + quantity > state.rules.capacity) return res.status(409).json({ error: 'Il ne reste pas assez de tickets.' });
    const owned = state.tickets.filter(id => id === req.player).length;
    if (owned + quantity > state.rules.maxPerPlayer) {
      return res.status(409).json({ error: `Limite atteinte : ${state.rules.maxPerPlayer} tickets maximum par joueur pour ce tirage (tu en as déjà ${owned}).` });
    }
    if (me.balance < quantity) return res.status(400).json({ error: 'Solde insuffisant.' });

    const receipt = {
      id: newId(), requestId, type: 'purchase', round: state.round, amount: -toEth(quantity), quantity, date: Date.now(),
      address: me.address, network: 'Démonstration — crédits de test',
      ticketNumbers: Array.from({ length: quantity }, (_, i) => state.tickets.length + i + 1),
    };
    me.receipts = prepend(receipt, me.receipts, MAX_RECORDS);

    let entry = me.participations?.find(p => p.round === state.round);
    if (!entry) {
      entry = { round: state.round, quantity: owned, ticketNumbers: ticketNumbersOf(req.player), status: 'pending', date: receipt.date };
      me.participations = prepend(entry, me.participations, MAX_RECORDS);
    }
    entry.quantity += quantity;
    entry.ticketNumbers.push(...receipt.ticketNumbers);

    me.transactions = prepend(receipt, me.transactions, MAX_RECORDS);
    me.balance -= quantity;
    state.tickets.push(...Array(quantity).fill(req.player));
    state.stats.ticketsSold += quantity;
    state.activity = prepend({ address: me.address, pseudo: pseudoOf(me), quantity, date: Date.now(), round: state.round }, state.activity, MAX_ACTIVITY);
    save();
    settle(); // tirage immédiat si la capacité vient d'être atteinte
    hub.broadcast('update', { reason: 'purchase' });

    const plural = quantity > 1 ? 's' : '';
    res.status(201).json({ message: `${quantity} ticket${plural} enregistré${plural}.`, receipt });
  });

  /** Marque comme lues uniquement les notifications ouvertes par le client. */
  app.post('/api/notifications/read', (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length > MAX_NOTIFICATIONS || ids.some(id => typeof id !== 'string')) {
      return res.status(400).json({ error: 'Notifications invalides.' });
    }
    const wanted = new Set(ids);
    for (const notification of req.me.notifications || []) if (wanted.has(notification.id)) notification.read = true;
    save();
    res.json({ ok: true });
  });

  /** Reçu d'achat, visible uniquement par son propriétaire. */
  app.get('/api/receipts/:id', (req, res) => {
    const receipt = (req.me.receipts || []).find(r => r.id === req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Reçu introuvable.' });
    res.json(receipt);
  });

  // ---------------------------------------------------------------------
  // Session : compte, portefeuille, annonces, robinet
  // ---------------------------------------------------------------------
  function faucetKey(address) {
    return `${chain.faucetSettings().chainId}:${address.toLowerCase()}`;
  }

  app.get('/api/session', (req, res) => {
    const me = req.me;
    const account = accountOf(me);
    const config = chain.getConfig();
    const faucet = chain.faucetSettings();
    res.json({
      account: account ? { email: me.account, pseudo: account.pseudo, role: account.role, createdAt: account.createdAt } : null,
      wallet: me.wallet ? { address: me.wallet, isOwner: Boolean(config?.owner && sameAddress(me.wallet, config.owner)) } : null,
      isAdmin: isAdmin(me),
      announcements: state.announcements.slice(0, 5),
      faucet: { enabled: faucet.enabled, amount: faucet.amount, network: faucet.network, claimed: Boolean(me.wallet && state.faucet.claims[faucetKey(me.wallet)]) },
    });
  });

  /** Création de compte : la session invitée devient celle du compte et reçoit 1 ETH fictif de bienvenue. */
  app.post('/api/account/register', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const pseudo = String(req.body.pseudo || '').trim();
    const password = String(req.body.password || '');
    if (req.me.account) return res.status(409).json({ error: 'Tu es déjà connecté à un compte. Déconnecte-toi d’abord.' });
    if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    if (!PSEUDO_PATTERN.test(pseudo)) return res.status(400).json({ error: 'Le pseudo doit faire 2 à 24 caractères (lettres, chiffres, espaces, . _ -).' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });
    if (state.accounts[email]) return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.' });

    // Le tout premier compte devient administrateur (ou les e-mails listés dans ADMIN_EMAILS).
    const adminEmails = String(env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    const firstAccount = !Object.values(state.accounts).some(a => a.role === 'admin');
    const role = adminEmails.includes(email) || (adminEmails.length === 0 && firstAccount) ? 'admin' : 'player';

    state.accounts[email] = { playerId: req.player, password: hashPassword(password), pseudo, role, createdAt: Date.now() };
    req.me.account = email;
    if (!req.me.welcomeCredited) {
      req.me.welcomeCredited = true;
      req.me.balance += STARTING_BALANCE;
      req.me.transactions = prepend(
        { id: newId(), type: 'welcome', round: state.round, amount: toEth(STARTING_BALANCE), quantity: 0, date: Date.now() },
        req.me.transactions, MAX_RECORDS,
      );
    }
    save();
    res.status(201).json({ account: { email, pseudo, role } });
  });

  const loginFailures = new Map();
  app.post('/api/account/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const failures = loginFailures.get(email);
    if (failures?.until > Date.now()) return res.status(429).json({ error: 'Trop d’essais. Réessaie dans quelques minutes.' });

    const account = state.accounts[email];
    if (!account || !verifyPassword(password, account.password)) {
      const count = (failures?.until > 0 && failures.until < Date.now() ? 0 : failures?.count || 0) + 1;
      loginFailures.set(email, { count, until: count >= LOGIN_MAX_FAILURES ? Date.now() + LOGIN_LOCK_MS : 0 });
      return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' }); // même message dans les deux cas
    }
    loginFailures.delete(email);
    if (!state.sessions[account.playerId]) state.sessions[account.playerId] = { address: '0x' + randomBytes(20).toString('hex'), balance: STARTING_BALANCE, account: email, welcomeCredited: true };
    setSessionCookie(res, req, account.playerId);
    res.json({ account: { email, pseudo: account.pseudo, role: account.role } });
  });

  app.post('/api/account/logout', (req, res) => {
    createSession(res, req); // nouvelle session invitée
    res.json({ ok: true });
  });

  /** Connexion avec Ethereum, étape 1 : le serveur prépare le message à signer. */
  app.post('/api/wallet/challenge', (req, res) => {
    const { address, chainId } = req.body;
    if (typeof address !== 'string' || !isAddress(address)) return res.status(400).json({ error: 'Adresse Ethereum invalide.' });
    if (!isInteger(chainId, 1, 2 ** 53)) return res.status(400).json({ error: 'Réseau invalide.' });
    const host = req.get('host');
    const message = createSiweMessage({ domain: host, uri: `${req.protocol}://${host}`, address, chainId, nonce: randomBytes(12).toString('hex'), ttlMs: SIWE_TTL_MS });
    req.me.siwe = { address: getAddress(address), message, expires: Date.now() + SIWE_TTL_MS };
    res.json({ message });
  });

  /** Étape 2 : on vérifie la signature. Elle prouve la possession de l'adresse, sans mot de passe. */
  app.post('/api/wallet/verify', (req, res) => {
    const challenge = req.me.siwe;
    if (!challenge || challenge.expires < Date.now()) return res.status(400).json({ error: 'Demande de connexion expirée. Recommence.' });
    if (typeof req.body.signature !== 'string' || !verifySiwe(challenge.message, req.body.signature, challenge.address)) {
      return res.status(401).json({ error: 'Signature invalide.' });
    }
    delete req.me.siwe; // un message signé ne peut servir qu'une fois
    req.me.wallet = challenge.address;
    save();
    res.json({ wallet: { address: challenge.address } });
  });

  app.post('/api/wallet/logout', (req, res) => {
    delete req.me.wallet;
    save();
    res.json({ ok: true });
  });

  /** Robinet : quelques ETH de test, une seule fois par adresse, pour pouvoir jouer tout de suite. */
  const faucetPending = new Set();
  app.post('/api/faucet', async (req, res) => {
    const settings = chain.faucetSettings();
    if (!settings.network) return res.status(409).json({ error: 'Aucun contrat déployé : le robinet est inactif.' });
    if (!settings.enabled) return res.status(503).json({ error: 'Robinet non configuré sur ce serveur (clé du compte robinet manquante).' });
    const address = req.me.wallet;
    if (!address) return res.status(401).json({ error: 'Connecte-toi d’abord avec Ethereum (signature MetaMask).' });
    const key = faucetKey(address);
    if (state.faucet.claims[key]) return res.status(409).json({ error: 'Cette adresse a déjà reçu des ETH du robinet.' });
    if (faucetPending.has(key)) return res.status(409).json({ error: 'Envoi déjà en cours.' });
    if (state.faucet.day !== today()) Object.assign(state.faucet, { day: today(), spent: 0 });
    if (state.faucet.spent + settings.amount > settings.dailyLimit) return res.status(429).json({ error: 'Le robinet a atteint sa limite du jour. Réessaie demain.' });

    faucetPending.add(key);
    try {
      if ((await chain.balanceOf(address)) >= settings.amount) return res.status(409).json({ error: 'Ton solde est déjà suffisant pour jouer.' });
      const hash = await chain.sendEth(address, settings.amount);
      state.faucet.claims[key] = { date: Date.now(), hash, amount: settings.amount };
      state.faucet.spent += settings.amount;
      save();
      res.json({ hash, amount: settings.amount });
    } catch (error) {
      res.status(502).json({ error: `Le robinet n’a pas pu envoyer les ETH : ${error.shortMessage || error.message}` });
    } finally {
      faucetPending.delete(key);
    }
  });

  /** Flux temps réel (Server-Sent Events). */
  app.get('/api/stream', hub.handler);

  // ---------------------------------------------------------------------
  // Espace admin
  // ---------------------------------------------------------------------
  app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const sessions = Object.values(state.sessions);
    const buyers = sessions.filter(s => (s.transactions || []).some(t => t.type === 'purchase'));
    if (state.faucet.day !== today()) Object.assign(state.faucet, { day: today(), spent: 0 });
    res.json({
      visitors: sessions.length,
      accounts: Object.keys(state.accounts).length,
      buyers: buyers.length,
      conversion: sessions.length ? buyers.length / sessions.length : 0,
      ticketsSold: state.stats.ticketsSold,
      roundsPlayed: state.stats.rounds,
      roundsCancelled: state.stats.cancelled,
      paidOut: toEth(state.stats.paidOut),
      averageTicketsPerBuyer: buyers.length ? state.stats.ticketsSold / buyers.length : 0,
      current: { round: state.round, tickets: state.tickets.length, capacity: state.rules.capacity, maxPerPlayer: state.rules.maxPerPlayer, participants: new Set(state.tickets).size, endsAt: state.endsAt },
      settings: { ...state.settings },
      faucet: { claims: Object.keys(state.faucet.claims).length, spentToday: state.faucet.spent },
      liveClients: hub.size(),
    });
  });

  /** Réglages des tirages : appliqués tout de suite si aucun ticket n'est vendu, sinon au prochain tirage. */
  app.post('/api/admin/settings', requireAdmin, (req, res) => {
    const { capacity: cap, durationMinutes, maxPerPlayer: perPlayer } = req.body;
    if (!isInteger(cap, 1, 10000)) return res.status(400).json({ error: 'Le nombre de tickets doit être entre 1 et 10 000.' });
    if (!isInteger(durationMinutes, 1, 7 * 24 * 60)) return res.status(400).json({ error: 'La durée doit être entre 1 minute et 7 jours.' });
    if (!isInteger(perPlayer, 1, cap)) return res.status(400).json({ error: 'La limite par joueur doit être entre 1 et le nombre de tickets.' });
    state.settings = { capacity: cap, duration: durationMinutes * 60000, maxPerPlayer: perPlayer };
    const appliedNow = state.tickets.length === 0;
    if (appliedNow) {
      state.rules = { capacity: cap, maxPerPlayer: perPlayer };
      state.endsAt = Date.now() + state.settings.duration;
    }
    save();
    hub.broadcast('update', { reason: 'settings' });
    res.json({ settings: state.settings, appliedNow });
  });

  app.post('/api/admin/cancel', requireAdmin, (req, res) => {
    if (!state.tickets.length) return res.status(409).json({ error: 'Aucun ticket vendu : rien à annuler.' });
    const round = state.round;
    cancelRound();
    hub.broadcast('update', { reason: 'cancelled' });
    res.json({ ok: true, round });
  });

  /** Remise à zéro de la démo : tirage n° 1, plus d'historique ni de statistiques (comptes et réglages conservés). */
  app.post('/api/admin/reset', requireAdmin, (req, res) => {
    resetDemoData(state, { startingBalance: STARTING_BALANCE, keepSession: req.player });
    save();
    hub.broadcast('update', { reason: 'reset' });
    res.json({ ok: true, round: state.round });
  });

  app.post('/api/admin/announcements', requireAdmin, (req, res) => {
    const title = String(req.body.title || '').trim();
    const message = String(req.body.message || '').trim();
    if (title.length < 1 || title.length > 80) return res.status(400).json({ error: 'Le titre doit faire entre 1 et 80 caractères.' });
    if (message.length < 1 || message.length > 500) return res.status(400).json({ error: 'Le message doit faire entre 1 et 500 caractères.' });
    const announcement = { id: newId(), title, message, date: Date.now(), author: pseudoOf(req.me) || 'Administrateur' };
    state.announcements = prepend(announcement, state.announcements, MAX_ANNOUNCEMENTS);
    save();
    hub.broadcast('announcement', { id: announcement.id });
    res.status(201).json({ announcement });
  });

  app.delete('/api/admin/announcements/:id', requireAdmin, (req, res) => {
    const before = state.announcements.length;
    state.announcements = state.announcements.filter(a => a.id !== req.params.id);
    if (state.announcements.length === before) return res.status(404).json({ error: 'Annonce introuvable.' });
    save();
    hub.broadcast('announcement', { id: req.params.id, removed: true });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------
  // Fichiers
  // ---------------------------------------------------------------------

  // Configuration du contrat déployé : `null` (et non une erreur 404) tant qu'aucun déploiement n'a eu lieu.
  app.get('/contract.json', (req, res) => {
    res.set('Cache-Control', 'no-store'); // un redéploiement est visible au rechargement
    if (!existsSync(contractFile)) return res.json(null);
    res.type('application/json').send(readFileSync(contractFile, 'utf8'));
  });
  app.get('/contract-source', (req, res) => res.type('text/plain').sendFile(path.join(root, 'contracts/BlockLucky.sol')));
  app.get('/vendor/ethers.js', (req, res) => res.sendFile(path.join(root, 'node_modules/ethers/dist/ethers.min.js')));
  // Générateur de QR codes (tuto MetaMask mobile), servi comme module ES.
  let qrSource = null;
  app.get('/vendor/qrcode.js', (req, res) => {
    qrSource ??= readFileSync(path.join(root, 'node_modules/qrcode-generator/qrcode.js'), 'utf8') + '\nexport default qrcode;\n';
    res.type('text/javascript').send(qrSource);
  });

  /** Adresses pour ouvrir le site depuis un téléphone du même réseau Wi-Fi (tuto MetaMask mobile). */
  app.get('/api/lan', (req, res) => {
    const exposed = isExposed(env.HOST);
    const port = req.socket.localPort;
    res.json({ exposed, urls: exposed ? lanAddresses().map(ip => `http://${ip}:${port}`) : [] });
  });
  app.use(express.static(path.join(root, 'public')));

  // Toute erreur (JSON invalide, corps trop gros…) renvoie un 400 générique.
  app.use((err, req, res, next) => res.status(400).json({ error: 'Requête invalide.' }));

  return app;
}

// Démarrage uniquement si le fichier est lancé directement (pas pendant les tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv(path.join(root, '.env'));
  const port = Number(process.env.PORT) || 3000;
  // Par défaut, seul cet ordinateur peut ouvrir le site. HOST=0.0.0.0 l'ouvre aux appareils du même réseau (téléphone).
  const host = process.env.HOST || '127.0.0.1';
  // DATA_FILE et CONTRACT_FILE permettent d'utiliser d'autres fichiers (tests, plusieurs instances).
  createApp({ watchChain: true, file: process.env.DATA_FILE || undefined, contractFile: process.env.CONTRACT_FILE || undefined })
    .listen(port, host, () => {
      console.log(`BlockLucky → http://localhost:${port}`);
      if (isExposed(host)) lanAddresses().forEach(ip => console.log(`  depuis un téléphone (même Wi-Fi) → http://${ip}:${port}`));
    });
}

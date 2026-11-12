// Serveur du mode démonstration de BlockLucky.
// Toute la partie (sessions, tickets, historique) est conservée dans un fichier JSON.
// Les montants sont stockés en unités entières de 0,01 ETH pour éviter les erreurs d'arrondi.
import express from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

const TICKET_PRICE = 0.01;           // ETH fictif
const STARTING_BALANCE = 100;        // 100 unités = 1 ETH fictif
const MAX_TICKETS_PER_PURCHASE = 20;
const SESSION_COOKIE = 'bl_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 jours
const MAX_RECORDS = 100;             // reçus, transactions, participations conservés
const MAX_NOTIFICATIONS = 50;
const MAX_ACTIVITY = 50;
const MAX_HISTORY = 30;

/** Convertit des unités entières (centièmes) en ETH. */
const toEth = units => units / 100;
/** Identifiant aléatoire court (16 caractères hexadécimaux). */
const newId = () => randomBytes(8).toString('hex');
/** Ajoute un élément en tête de liste en gardant au plus `max` éléments. */
const prepend = (item, list, max) => [item, ...(list || [])].slice(0, max);

export function createApp({
  file = path.join(root, 'data/state.json'),
  duration = 3600000, // durée d'un tirage : 1 heure
  capacity = 100,     // tickets par tirage
  contractFile = path.join(root, 'public/contract.json'), // écrit par scripts/deploy.js
} = {}) {
  // ---------------------------------------------------------------------
  // Stockage
  // ---------------------------------------------------------------------
  mkdirSync(path.dirname(file), { recursive: true });
  let state = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : { round: 1, endsAt: Date.now() + duration, tickets: [], history: [], sessions: {}, activity: [] };

  /** Écriture atomique : on écrit un fichier temporaire puis on le renomme. */
  function save() {
    writeFileSync(file + '.tmp', JSON.stringify(state));
    renameSync(file + '.tmp', file);
  }

  /** Numéros de tickets (à partir de 1) appartenant à un joueur dans le tirage courant. */
  const ticketNumbersOf = player => state.tickets.flatMap((id, i) => (id === player ? [i + 1] : []));

  // ---------------------------------------------------------------------
  // Tirage
  // ---------------------------------------------------------------------

  /** Effectue le tirage si la capacité est atteinte ou si le temps est écoulé. */
  function settle() {
    const timeIsUp = Date.now() >= state.endsAt;
    const isFull = state.tickets.length >= capacity;

    if (!state.tickets.length) {
      // Aucun ticket vendu : on relance simplement le compte à rebours.
      if (timeIsUp) {
        state.endsAt = Date.now() + duration;
        save();
      }
      return;
    }
    if (!timeIsUp && !isFull) return;

    const winningTicket = randomInt(state.tickets.length) + 1;
    const winner = state.tickets[winningTicket - 1];
    const prize = state.tickets.length; // en unités : 1 ticket = 1 unité
    const winnerSession = state.sessions[winner];
    const now = Date.now();

    // Crédit du gagnant.
    winnerSession.balance += prize;
    winnerSession.transactions = prepend(
      { id: newId(), type: 'win', round: state.round, amount: toEth(prize), quantity: 0, date: now },
      winnerSession.transactions,
      MAX_RECORDS,
    );

    // Résultat et notification pour chaque participant.
    for (const player of new Set(state.tickets)) {
      const participant = state.sessions[player];
      let entry = participant.participations?.find(p => p.round === state.round);
      if (!entry) {
        entry = {
          round: state.round,
          quantity: state.tickets.filter(id => id === player).length,
          ticketNumbers: ticketNumbersOf(player),
        };
        participant.participations = prepend(entry, participant.participations, MAX_RECORDS);
      }
      const won = player === winner;
      Object.assign(entry, {
        status: won ? 'won' : 'lost',
        winner: winnerSession.address,
        winningTicket,
        totalTickets: prize,
        prize: toEth(prize),
        date: now,
      });
      participant.notifications = prepend(
        { id: newId(), round: state.round, type: entry.status, prize: won ? toEth(prize) : 0, winningTicket, date: now, read: false },
        participant.notifications,
        MAX_NOTIFICATIONS,
      );
    }

    // Archive puis nouvelle édition.
    state.history = prepend(
      { round: state.round, winningTicket, winner: winnerSession.address, prize: toEth(prize), tickets: state.tickets.length, date: now },
      state.history,
      MAX_HISTORY,
    );
    state.round++;
    state.tickets = [];
    state.endsAt = Date.now() + duration;
    save();
  }

  // ---------------------------------------------------------------------
  // Middlewares
  // ---------------------------------------------------------------------
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2kb' }));

  // En-têtes de sécurité de base.
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  // Toutes les routes /api : anti-CSRF, session, puis tirage éventuel.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');

    // Refuse les POST envoyés depuis un autre site.
    const origin = req.get('origin');
    if (req.method === 'POST' && origin && origin !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ error: 'Origine non autorisée.' });
    }

    // Retrouve la session via le cookie, ou en crée une nouvelle.
    let id = req.headers.cookie
      ?.split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(SESSION_COOKIE + '='))
      ?.slice(SESSION_COOKIE.length + 1);

    if (!id || !Object.hasOwn(state.sessions, id)) {
      id = randomBytes(24).toString('hex');
      state.sessions[id] = { address: '0x' + randomBytes(20).toString('hex'), balance: STARTING_BALANCE };
      save();
      res.cookie(SESSION_COOKIE, id, { httpOnly: true, sameSite: 'strict', maxAge: SESSION_MAX_AGE, secure: req.secure });
    }

    req.player = id;
    settle(); // le tirage est traité au premier appel après l'échéance
    next();
  });

  // ---------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------

  /** État du tirage courant et données personnelles du joueur. */
  app.get('/api/state', (req, res) => {
    const me = state.sessions[req.player];
    res.json({
      round: state.round,
      endsAt: state.endsAt,
      capacity,
      ticketPrice: TICKET_PRICE,
      totalTickets: state.tickets.length,
      participants: new Set(state.tickets).size,
      pot: toEth(state.tickets.length),
      myTickets: state.tickets.filter(id => id === req.player).length,
      balance: toEth(me.balance),
      address: me.address,
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
    const me = state.sessions[req.player];

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_PURCHASE) {
      return res.status(400).json({ error: 'Choisissez entre 1 et 20 tickets.' });
    }
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

    if (round !== undefined && round !== state.round) {
      return res.status(409).json({ error: 'Le tirage a changé. Vérifiez votre achat.' });
    }
    if (state.tickets.length + quantity > capacity) {
      return res.status(409).json({ error: 'Il ne reste pas assez de tickets.' });
    }
    if (me.balance < quantity) {
      return res.status(400).json({ error: 'Solde insuffisant.' });
    }

    const receipt = {
      id: newId(),
      requestId,
      type: 'purchase',
      round: state.round,
      amount: -toEth(quantity),
      quantity,
      date: Date.now(),
      address: me.address,
      network: 'Démonstration — crédits de test',
      ticketNumbers: Array.from({ length: quantity }, (_, i) => state.tickets.length + i + 1),
    };
    me.receipts = prepend(receipt, me.receipts, MAX_RECORDS);

    // Participation du joueur pour ce tirage (créée au premier achat).
    let entry = me.participations?.find(p => p.round === state.round);
    if (!entry) {
      entry = {
        round: state.round,
        quantity: state.tickets.filter(id => id === req.player).length,
        ticketNumbers: ticketNumbersOf(req.player),
        status: 'pending',
        date: receipt.date,
      };
      me.participations = prepend(entry, me.participations, MAX_RECORDS);
    }
    entry.quantity += quantity;
    entry.ticketNumbers.push(...receipt.ticketNumbers);

    me.transactions = prepend(receipt, me.transactions, MAX_RECORDS);
    me.balance -= quantity;
    state.tickets.push(...Array(quantity).fill(req.player));
    state.activity = prepend({ address: me.address, quantity, date: Date.now(), round: state.round }, state.activity, MAX_ACTIVITY);
    save();
    settle(); // tirage immédiat si la capacité vient d'être atteinte

    const plural = quantity > 1 ? 's' : '';
    res.status(201).json({ message: `${quantity} ticket${plural} enregistré${plural}.`, receipt });
  });

  /** Marque comme lues uniquement les notifications ouvertes par le client. */
  app.post('/api/notifications/read', (req, res) => {
    const me = state.sessions[req.player];
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length > MAX_NOTIFICATIONS || ids.some(id => typeof id !== 'string')) {
      return res.status(400).json({ error: 'Notifications invalides.' });
    }
    const wanted = new Set(ids);
    for (const notification of me.notifications || []) {
      if (wanted.has(notification.id)) notification.read = true;
    }
    save();
    res.json({ ok: true });
  });

  /** Reçu d'achat, visible uniquement par son propriétaire. */
  app.get('/api/receipts/:id', (req, res) => {
    const receipt = (state.sessions[req.player].receipts || []).find(r => r.id === req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Reçu introuvable.' });
    res.json(receipt);
  });

  // Configuration du contrat déployé : `null` (et non une erreur 404) tant qu'aucun déploiement n'a eu lieu.
  app.get('/contract.json', (req, res) => {
    res.set('Cache-Control', 'no-store'); // un redéploiement est visible au rechargement
    if (!existsSync(contractFile)) return res.json(null);
    res.type('application/json').send(readFileSync(contractFile, 'utf8'));
  });

  // Fichiers statiques.
  app.get('/contract-source', (req, res) => res.type('text/plain').sendFile(path.join(root, 'contracts/BlockLucky.sol')));
  app.get('/vendor/ethers.js', (req, res) => res.sendFile(path.join(root, 'node_modules/ethers/dist/ethers.min.js')));
  app.use(express.static(path.join(root, 'public')));

  // Toute erreur (JSON invalide, corps trop gros…) renvoie un 400 générique.
  app.use((err, req, res, next) => res.status(400).json({ error: 'Requête invalide.' }));

  return app;
}

// Démarrage uniquement si le fichier est lancé directement (pas pendant les tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, '127.0.0.1', () => console.log(`BlockLucky → http://localhost:${port}`));
}

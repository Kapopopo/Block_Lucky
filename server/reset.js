// Remise à zéro de la démo (bouton de l'Espace admin, ou « npm run reset:demo » serveur arrêté).
// On repart du tirage n° 1, sans historique, sans activité et avec des statistiques à zéro.
// Conservés : les comptes (pseudo, mot de passe, rôle), les réglages des tirages, les annonces et le robinet
// (il concerne les ETH de test Sepolia, pas la démo).
import { randomBytes } from 'node:crypto';

/**
 * @param state           état complet de la démo (modifié sur place)
 * @param startingBalance solde de bienvenue d'un compte, en unités de 0,01 ETH
 * @param keepSession     session à garder même si c'est un invité (celle de l'admin qui demande la remise à zéro)
 */
export function resetDemoData(state, { startingBalance, keepSession = null }) {
  const now = Date.now();
  Object.assign(state, {
    round: 1,
    tickets: [],
    history: [],
    activity: [],
    endsAt: now + state.settings.duration,
    rules: { capacity: state.settings.capacity, maxPerPlayer: state.settings.maxPerPlayer },
    stats: { ticketsSold: 0, rounds: 0, cancelled: 0, paidOut: 0 },
  });
  for (const [id, session] of Object.entries(state.sessions)) {
    // Les invités n'ont rien à conserver : leurs sessions disparaissent (le compteur de visiteurs repart de zéro).
    if (!session.account && id !== keepSession) { delete state.sessions[id]; continue; }
    for (const key of ['transactions', 'participations', 'receipts', 'notifications']) delete session[key];
    session.balance = session.account ? startingBalance : 0;
    session.welcomeCredited = Boolean(session.account);
    if (session.account) {
      session.transactions = [{ id: randomBytes(8).toString('hex'), type: 'welcome', round: 1, amount: startingBalance / 100, quantity: 0, date: now }];
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Espace administrateur : règles des tirages, création, annulation, annonces, statistiques.
// Principe : l'admin organise, mais ne choisit jamais le gagnant (c'est l'oracle de hasard).
// ---------------------------------------------------------------------------
import { $, api, toast, esc, short, pad, fmtEth, fmtEthPrecise, fmtPct, setHTML, empty } from './common.js';

export function initAdmin(ctx) {
  let stats = null;
  let oracle = null;
  let lastLoad = 0;
  let cancelArmed = null;

  const app = ctx.app;
  const isChain = () => app.mode === 'chain';

  /** Charge les statistiques (démo) et la réserve de l'oracle (blockchain). */
  async function load(force = false) {
    if (!force && Date.now() - lastLoad < 3000) return render();
    lastLoad = Date.now();
    try { stats = app.session?.isAdmin ? await api('/api/admin/stats') : null; } catch { stats = null; }
    try { oracle = isChain() ? await ctx.readOracle() : null; } catch { oracle = null; }
    render();
  }

  const stat = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const timeLeft = endsAt => {
    const minutes = Math.max(0, Math.round((endsAt - ctx.now()) / 60000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  };

  /** Pré-remplit un champ seulement s'il n'est pas en train d'être modifié. */
  function prefill(form, values) {
    if (form.dataset.dirty === '1') return;
    for (const [name, value] of Object.entries(values)) form.elements[name].value = value;
  }

  function render() {
    if (app.view !== 'admin' || !app.state) return;
    const s = app.state;
    const form = $('adminDrawForm');
    const submit = $('adminDrawSubmit');

    if (!isChain()) {
      // ----- Mode démo -----
      const current = stats?.current;
      $('adminDrawTitle').textContent = `Tirage démo n° ${pad(s.round)}`;
      $('adminDrawStatus').className = 'status status-live';
      $('adminDrawStatus').innerHTML = '<i></i>Ventes ouvertes';
      setHTML($('adminDrawSummary'), current
        ? stat('Tickets vendus', `${current.tickets} / ${current.capacity}`) + stat('Joueurs', current.participants) + stat('Limite par joueur', current.maxPerPlayer) + stat('Clôture dans', timeLeft(current.endsAt))
        : '');
      $('adminOwnerNote').hidden = true;
      $('adminFormTitle').textContent = 'Règles des tirages';
      $('adminFormHint').textContent = 'Appliquées tout de suite si aucun ticket n’est vendu, sinon dès le prochain tirage.';
      submit.textContent = 'Enregistrer les règles';
      submit.disabled = false;
      [...form.elements].forEach(el => { el.disabled = false; });
      if (stats) prefill(form, { capacity: stats.settings.capacity, duration: Math.round(stats.settings.duration / 60000), maxPerPlayer: stats.settings.maxPerPlayer });
      $('adminCancelZone').hidden = !(current?.tickets > 0);
      $('adminStatsScope').textContent = 'Démo';
      $('adminResetZone').hidden = !stats;
      setHTML($('adminStats'), stats
        ? stat('Visiteurs', stats.visitors) + stat('Comptes créés', stats.accounts) + stat('Ont joué', `${stats.buyers} (${fmtPct(100 * stats.conversion)})`)
          + stat('Tickets vendus', stats.ticketsSold) + stat('Tirages joués', stats.roundsPlayed) + stat('Tirages annulés', stats.roundsCancelled)
          + stat('ETH redistribués', `${fmtEth(stats.paidOut)} ETH`) + stat('Tickets par joueur', stats.averageTicketsPerBuyer.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))
          + stat('Connectés en direct', stats.liveClients)
        : '<p class="muted small">Statistiques indisponibles.</p>');
      $('adminOracleCard').hidden = true;
    } else {
      // ----- Mode blockchain -----
      const info = app.chain.info || {};
      const phase = ctx.phase();
      const canCreate = ['none', 'settled', 'cancelled', 'empty'].includes(info.phase);
      const active = ['open', 'closable', 'drawing', 'oracleTimeout'].includes(info.phase);
      $('adminDrawTitle').textContent = info.round ? `Tirage blockchain n° ${pad(info.round)}` : 'Aucun tirage blockchain';
      $('adminDrawStatus').className = `status ${phase.cls}`;
      $('adminDrawStatus').innerHTML = `${phase.live ? '<i></i>' : ''}${phase.label}`;
      setHTML($('adminDrawSummary'), info.round
        ? stat('Tickets vendus', `${s.totalTickets} / ${s.capacity}`) + stat('Joueurs', s.participants) + stat('Limite par joueur', s.rules.maxPerPlayer) + stat('Contrat', `<code>${esc(short(info.lottery))}</code>`)
        : '');
      $('adminOwnerNote').hidden = info.isOwner;
      $('adminOwnerNote').innerHTML = `Seul le <b>propriétaire de l’usine à tirages</b> peut créer ou annuler un tirage blockchain. Connecte ce compte dans MetaMask : <code>${esc(info.owner || '—')}</code>.`;
      $('adminFormTitle').textContent = 'Créer un nouveau tirage';
      $('adminFormHint').textContent = canCreate
        ? 'Le tirage précédent est terminé : tu peux en créer un nouveau. C’est une transaction signée dans MetaMask.'
        : 'Un tirage est en cours : il doit se terminer (ou être annulé) avant d’en créer un autre.';
      submit.textContent = 'Créer le tirage (transaction)';
      submit.disabled = !(info.isOwner && canCreate) || app.busy;
      [...form.elements].forEach(el => { if (el !== submit) el.disabled = !info.isOwner; });
      prefill(form, { capacity: 100, duration: 60, maxPerPlayer: 25 });
      $('adminCancelZone').hidden = !(info.isOwner && active);

      const rounds = app.chain.rounds || [];
      const tickets = rounds.reduce((n, r) => n + r.purchases.reduce((m, p) => m + p.quantity, 0), 0);
      const players = new Set(rounds.flatMap(r => r.purchases.map(p => p.address.toLowerCase()))).size;
      const paid = rounds.reduce((n, r) => n + (r.win ? r.win.prize : 0), 0);
      $('adminStatsScope').textContent = ctx.network().name;
      $('adminResetZone').hidden = true; // la blockchain ne s'efface pas : seule la démo se remet à zéro
      setHTML($('adminStats'),
        stat('Tirages créés', rounds.length) + stat('Gagnants désignés', rounds.filter(r => r.win).length) + stat('Tirages annulés', rounds.filter(r => r.cancelled).length)
        + stat('Tickets vendus', tickets) + stat('Joueurs différents', players) + stat('ETH redistribués', `${fmtEth(paid)} ETH`));

      // Oracle
      const vrf = app.config?.vrf || {};
      $('adminOracleCard').hidden = false;
      $('adminOracleMode').textContent = vrf.mode === 'mock' ? 'Simulé (local)' : 'Chainlink VRF v2.5';
      setHTML($('adminOracleInfo'),
        `<dt>Fonctionnement</dt><dd>${vrf.mode === 'mock' ? 'Sur Ganache, il n’y a pas de nœud Chainlink : le serveur BlockLucky répond à la place de l’oracle, quelques secondes après la demande.' : 'À la fin des ventes, le contrat demande un nombre aléatoire à Chainlink. La réponse arrive avec une preuve vérifiée par le contrat.'}</dd>`
        + `<dt>Abonnement</dt><dd>n° ${esc(vrf.subscriptionId || '—')}${vrf.mode === 'chainlink' ? ` · <a href="https://vrf.chain.link/sepolia/${esc(vrf.subscriptionId)}" target="_blank" rel="noopener">voir sur vrf.chain.link ↗</a>` : ''}</dd>`
        + `<dt>Paiement</dt><dd>${vrf.nativePayment === false ? 'en LINK' : 'en ETH'}</dd>`
        + `<dt>Réserve</dt><dd>${oracle ? `${fmtEthPrecise(oracle.native)} ETH${oracle.link > 0 ? ` · ${fmtEthPrecise(oracle.link)} LINK` : ''}` : '—'}</dd>`);
      $('adminOracleHint').textContent = vrf.mode === 'mock'
        ? 'En local, la réserve ne sert pas : l’oracle simulé ne coûte rien.'
        : 'Chaque tirage coûte quelques millièmes d’ETH de test à la réserve. Si elle est vide, la demande reste en attente jusqu’à ce qu’on l’alimente.';
    }

    // ----- Annonces -----
    const canPublish = Boolean(app.session?.isAdmin);
    $('announcementForm').hidden = !canPublish;
    $('announcementLocked').hidden = canPublish;
    $('announcementLocked').innerHTML = 'Pour publier une annonce, connecte-toi avec le compte administrateur, ou <b>connecte-toi avec Ethereum</b> (bouton « Connexion » en haut) si tu es le propriétaire du contrat.';
    const list = app.session?.announcements || [];
    setHTML($('adminAnnouncements'), list.length
      ? list.map(a => `<div class="announcement-item"><div><b>${esc(a.title)}</b><p>${esc(a.message)}</p><small>${esc(a.author)} · ${new Date(a.date).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>${canPublish ? `<button class="btn btn-ghost btn-sm" data-delete-announcement="${esc(a.id)}">Supprimer</button>` : ''}</div>`).join('')
      : empty('i-bell', 'Aucune annonce publiée.'));
  }

  // ----- Actions -----
  $('adminDrawForm').addEventListener('input', event => { event.currentTarget.dataset.dirty = '1'; });

  $('adminDrawForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, Number(v)]));
    if (values.maxPerPlayer > values.capacity) { toast('La limite par joueur ne peut pas dépasser le nombre de tickets.', 'error'); return; }
    try {
      if (isChain()) {
        await ctx.runChainAction('createLottery', { duration: values.duration * 60, capacity: values.capacity, maxPerPlayer: values.maxPerPlayer });
      } else {
        const result = await api('/api/admin/settings', { capacity: values.capacity, durationMinutes: values.duration, maxPerPlayer: values.maxPerPlayer });
        toast(result.appliedNow ? 'Règles appliquées au tirage en cours.' : 'Règles enregistrées : elles s’appliqueront au prochain tirage.', 'success');
        await ctx.refresh();
      }
      form.dataset.dirty = '';
      await load(true);
    } catch (error) { toast(ctx.errorMessage(error), 'error'); }
  });

  $('adminCancel').addEventListener('click', async () => {
    const button = $('adminCancel');
    if (!cancelArmed) {
      // Double confirmation : un premier clic arme le bouton pendant 5 secondes.
      button.textContent = 'Confirmer : annuler et rembourser tout le monde';
      button.classList.add('armed');
      cancelArmed = setTimeout(() => { cancelArmed = null; button.textContent = 'Annuler et rembourser'; button.classList.remove('armed'); }, 5000);
      return;
    }
    clearTimeout(cancelArmed);
    cancelArmed = null;
    button.textContent = 'Annuler et rembourser';
    button.classList.remove('armed');
    try {
      if (isChain()) await ctx.runChainAction('cancel');
      else {
        await api('/api/admin/cancel', {});
        toast('Tirage annulé : chaque joueur a été remboursé.', 'success');
        await ctx.refresh();
      }
      await load(true);
    } catch (error) { toast(ctx.errorMessage(error), 'error'); }
  });

  let resetArmed = null;
  $('adminReset').addEventListener('click', async () => {
    const button = $('adminReset');
    const idle = () => { button.textContent = 'Tout remettre à zéro'; button.classList.remove('armed'); };
    if (!resetArmed) {
      // Double confirmation, comme pour l'annulation : le premier clic arme le bouton pendant 5 secondes.
      button.textContent = 'Confirmer : tout effacer et repartir du tirage n° 1';
      button.classList.add('armed');
      resetArmed = setTimeout(() => { resetArmed = null; idle(); }, 5000);
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = null;
    idle();
    try {
      await api('/api/admin/reset', {});
      app.seenDraw = undefined; // l'historique repart de zéro : pas d'animation de tirage à rejouer
      toast('Démo remise à zéro : tirage n° 1, statistiques vides.', 'success');
      await ctx.refresh();
      await load(true);
    } catch (error) { toast(ctx.errorMessage(error), 'error'); }
  });

  $('adminFundForm').addEventListener('submit', async event => {
    event.preventDefault();
    const amount = Number(new FormData(event.currentTarget).get('amount'));
    try {
      await ctx.runChainAction('fundOracle', { amount });
      await load(true);
    } catch (error) { toast(ctx.errorMessage(error), 'error'); }
  });

  $('announcementForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/admin/announcements', Object.fromEntries(new FormData(form)));
      form.reset();
      toast('Annonce publiée : tous les joueurs la voient tout de suite.', 'success');
      await ctx.refresh();
      render();
    } catch (error) { toast(error.message, 'error'); }
  });

  $('adminAnnouncements').addEventListener('click', async event => {
    const id = event.target.closest('[data-delete-announcement]')?.dataset.deleteAnnouncement;
    if (!id) return;
    try {
      await api('/api/admin/announcements/' + encodeURIComponent(id), undefined, 'DELETE');
      await ctx.refresh();
      render();
    } catch (error) { toast(error.message, 'error'); }
  });

  return { load, render };
}

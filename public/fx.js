// ---------------------------------------------------------------------------
// Effets visuels de BlockLucky : compteurs, confettis, tickets volants,
// révélation du tirage. Tout est désactivé si l'utilisateur préfère réduire les animations.
// ---------------------------------------------------------------------------

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Rejoue une animation CSS ponctuelle (classe ajoutée puis retirée). */
export function pulse(el, className = 'bump') {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth; // force le navigateur à redémarrer l'animation
  el.classList.add(className);
  el.addEventListener('animationend', () => el.classList.remove(className), { once: true });
}

/** Fait défiler un nombre jusqu'à sa nouvelle valeur. */
export function countTo(el, value, format, duration = 900) {
  if (!el) return;
  const from = el.dataset.value === undefined ? 0 : Number(el.dataset.value);
  el.dataset.value = value;
  cancelAnimationFrame(el._raf);
  if (reducedMotion() || from === value) { el.textContent = format(value); return; }
  const start = performance.now();
  const step = time => {
    const progress = Math.min(1, (time - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = format(from + (value - from) * eased);
    if (progress < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
  if (Math.abs(value - from) > 1e-9 && el.dataset.animated) pulse(el);
  el.dataset.animated = '1';
}

/** Petite onde au point de clic sur un bouton. */
export function ripple(event) {
  const button = event.currentTarget;
  if (reducedMotion() || button.disabled) return;
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const dot = document.createElement('span');
  dot.className = 'ripple';
  dot.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - rect.left - size / 2}px;top:${event.clientY - rect.top - size / 2}px`;
  button.append(dot);
  dot.addEventListener('animationend', () => dot.remove());
}

/** Des tickets s'envolent du bouton d'achat vers « Mes tickets ». */
export function flyTickets(from, to, count) {
  if (reducedMotion() || !from || !to) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const n = Math.min(count, 10);
  for (let i = 0; i < n; i++) {
    const ticket = document.createElement('div');
    ticket.className = 'fly-ticket';
    ticket.textContent = '✳';
    const x0 = a.left + a.width / 2 - 22 + (Math.random() - .5) * 60;
    const y0 = a.top + a.height / 2 - 14;
    const x1 = b.left + b.width / 2 - 22;
    const y1 = b.top + b.height / 2 - 14;
    const lift = 120 + Math.random() * 120;
    ticket.style.left = '0px';
    ticket.style.top = '0px';
    document.body.append(ticket);
    const animation = ticket.animate([
      { transform: `translate(${x0}px, ${y0}px) rotate(0deg) scale(.6)`, opacity: 0 },
      { transform: `translate(${x0 + (x1 - x0) * .3}px, ${Math.min(y0, y1) - lift}px) rotate(${(Math.random() - .5) * 120}deg) scale(1.15)`, opacity: 1, offset: .45 },
      { transform: `translate(${x1}px, ${y1}px) rotate(${(Math.random() - .5) * 40}deg) scale(.35)`, opacity: .2 },
    ], { duration: 900 + Math.random() * 300, delay: i * 70, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'both' });
    animation.onfinish = () => {
      ticket.remove();
      if (i === n - 1) pulse(to.querySelector('.nav-badge') || to);
    };
  }
}

/** Pluie de confettis plein écran. */
export function confetti({ particles = 180, colors = ['#34d399', '#10b981', '#fbbf24', '#f59e0b', '#ecfdf5', '#6ee7b7'] } = {}) {
  if (reducedMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = innerWidth * ratio;
  canvas.height = innerHeight * ratio;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const pieces = Array.from({ length: particles }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? -10 : innerWidth + 10,
      y: innerHeight * (.55 + Math.random() * .3),
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 9),
      vy: -(10 + Math.random() * 12),
      size: 6 + Math.random() * 8,
      color: colors[i % colors.length],
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - .5) * .4,
      shape: Math.random() > .5 ? 'rect' : 'circle',
    };
  });
  const start = performance.now();
  const frame = time => {
    const elapsed = time - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of pieces) {
      p.vy += .32; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rotation += p.spin;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 4200);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else { ctx.beginPath(); ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (elapsed < 4200) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Animation du porte-monnaie : un billet sort (achat) ou rentre (gain). */
export function walletMoney(card, direction = 'out') {
  if (!card || reducedMotion()) return;
  const className = direction === 'out' ? 'paying' : 'receiving';
  card.classList.remove('paying', 'receiving');
  void card.offsetWidth;
  card.classList.add(className);
  setTimeout(() => card.classList.remove(className), 1300);
}

/** Inclinaison 3D d'une carte qui suit la souris. */
export function tilt(card, strength = 5) {
  if (!card || !matchMedia('(hover: hover)').matches) return;
  card.addEventListener('pointermove', event => {
    if (reducedMotion()) return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - .5;
    const y = (event.clientY - rect.top) / rect.height - .5;
    card.style.setProperty('--ry', `${x * strength}deg`);
    card.style.setProperty('--rx', `${-y * strength}deg`);
  });
  card.addEventListener('pointerleave', () => {
    card.style.setProperty('--ry', '0deg');
    card.style.setProperty('--rx', '0deg');
  });
}

/** Halo lumineux qui suit le pointeur sur toutes les cartes. */
export function pointerGlow() {
  document.addEventListener('pointermove', event => {
    const card = event.target.closest?.('.card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    card.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }, { passive: true });
}

/**
 * Mise en scène d'un tirage : les numéros défilent, puis s'arrêtent sur le ticket gagnant.
 * Résout la promesse quand l'utilisateur ferme l'écran.
 */
export function revealDraw({ round, total, winningTicket, myNumbers = [], won, prize, winnerLabel, formatEth }) {
  return new Promise(resolve => {
    const pad = n => String(n).padStart(3, '0');
    const overlay = document.createElement('div');
    overlay.className = 'draw-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Résultat du tirage ${round}`);
    overlay.innerHTML = `
      <div class="draw-stage">
        <div class="draw-rays"></div>
        <p class="eyebrow">Tirage n° ${pad(round)}</p>
        <div class="draw-ticket">
          <small>TICKET GAGNANT</small>
          <div class="draw-number" aria-live="polite">${winningTicket ? '000' : '★'}</div>
          <small>${total} ticket${total > 1 ? 's' : ''} en jeu</small>
        </div>
        <h2 class="draw-title">Tirage en cours…</h2>
        <p class="draw-sub"></p>
        ${myNumbers.length ? `<div class="draw-chips">${myNumbers.slice(0, 40).map(n => `<span data-n="${n}">${pad(n)}</span>`).join('')}</div>` : ''}
        <button class="btn btn-primary btn-lg draw-close" hidden>Continuer</button>
      </div>`;
    document.body.append(overlay);
    const number = overlay.querySelector('.draw-number');
    const title = overlay.querySelector('.draw-title');
    const sub = overlay.querySelector('.draw-sub');
    const button = overlay.querySelector('.draw-close');

    const close = () => {
      overlay.classList.add('closing');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { overlay.remove(); resolve(); }, reducedMotion() ? 0 : 320);
    };
    const onKey = event => { if (event.key === 'Escape' || (event.key === 'Enter' && !button.hidden)) close(); };
    document.addEventListener('keydown', onKey);
    button.addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay && !button.hidden) close(); });

    const finish = () => {
      if (winningTicket) { number.textContent = pad(winningTicket); }
      number.classList.remove('rolling');
      pulse(number, 'landed');
      overlay.querySelector(`.draw-chips [data-n="${winningTicket}"]`)?.classList.add('hit');
      if (won) {
        overlay.classList.add('won');
        title.textContent = `Tu as gagné ${formatEth(prize)} ETH !`;
        sub.textContent = 'Toute la cagnotte est pour toi.';
        confetti();
        setTimeout(() => confetti({ particles: 120 }), 700);
      } else {
        title.textContent = 'Pas cette fois…';
        sub.textContent = `Le gagnant est ${winnerLabel}. Il remporte ${formatEth(prize)} ETH.`;
      }
      title.classList.add('reveal');
      button.hidden = false;
      button.focus();
    };

    if (reducedMotion() || !winningTicket) { finish(); return; }
    // Défilement qui ralentit progressivement (effet machine à sous).
    number.classList.add('rolling');
    let delay = 40;
    const roll = async () => {
      while (delay < 260) {
        number.textContent = pad(1 + Math.floor(Math.random() * total));
        await wait(delay);
        delay *= 1.09;
      }
      finish();
    };
    setTimeout(roll, 500);
  });
}

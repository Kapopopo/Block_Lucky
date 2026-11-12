// ---------------------------------------------------------------------------
// Tuto guidé : un projecteur éclaire une zone de l'écran, le reste est assombri.
// Navigation : Suivant / Précédent / Passer, flèches du clavier, Échap pour quitter.
// ---------------------------------------------------------------------------
import { reducedMotion } from './fx.js';

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const PADDING = 10;
const GAP = 16;

/** Premier élément visible parmi une liste de sélecteurs (sidebar sur ordinateur, barre du bas sur mobile…). */
function findTarget(selectors) {
  if (!selectors) return null;
  for (const selector of [].concat(selectors)) {
    for (const el of document.querySelectorAll(selector)) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
    }
  }
  return null;
}

export class Tour {
  constructor({ steps, showView, onEnd }) {
    this.steps = steps;
    this.showView = showView;
    this.onEnd = onEnd;
    this.index = 0;
    this.active = false;
    this.reposition = () => {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.place());
    };
    this.onKey = event => {
      if (!this.active) return;
      if (event.key === 'Escape') { event.preventDefault(); this.end(); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); this.next(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); this.prev(); }
    };
  }

  build() {
    this.blocker = Object.assign(document.createElement('div'), { className: 'tour-blocker' });
    this.spot = Object.assign(document.createElement('div'), { className: 'tour-spot' });
    this.card = Object.assign(document.createElement('div'), { className: 'tour-card' });
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-labelledby', 'tourTitle');
    this.card.innerHTML = `
      <span class="tour-step" id="tourCount"></span>
      <h3 id="tourTitle"></h3>
      <div id="tourText"></div>
      <div class="tour-progress" aria-hidden="true">${this.steps.map(() => '<i></i>').join('')}</div>
      <div class="tour-actions">
        <button class="tour-skip" data-tour="skip">Passer le tuto</button>
        <button class="btn btn-ghost btn-sm" data-tour="prev">Précédent</button>
        <button class="btn btn-primary btn-sm" data-tour="next">Suivant</button>
      </div>`;
    this.card.addEventListener('click', event => {
      const action = event.target.closest('[data-tour]')?.dataset.tour;
      if (action === 'skip') this.end();
      if (action === 'prev') this.prev();
      if (action === 'next') this.next();
    });
    this.blocker.addEventListener('click', () => this.card.querySelector('[data-tour="next"]').focus());
    document.body.append(this.blocker, this.spot, this.card);
  }

  start(index = 0) {
    if (this.active) return;
    this.active = true;
    this.previousFocus = document.activeElement;
    this.build();
    document.addEventListener('keydown', this.onKey);
    addEventListener('resize', this.reposition);
    addEventListener('scroll', this.reposition, true);
    this.go(index);
  }

  next() { this.index < this.steps.length - 1 ? this.go(this.index + 1) : this.end(true); }
  prev() { if (this.index > 0) this.go(this.index - 1); }

  async go(index) {
    this.index = index;
    const step = this.steps[index];
    const token = this.token = Symbol('step');
    if (step.view) this.showView(step.view);
    await nextFrame();
    if (token !== this.token) return;

    this.target = findTarget(step.target);
    if (this.target) {
      this.target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'instant' : 'smooth' });
      await wait(reducedMotion() ? 0 : 380);
      if (token !== this.token) return;
    }

    this.card.querySelector('#tourCount').textContent = `ÉTAPE ${index + 1} / ${this.steps.length}`;
    this.card.querySelector('#tourTitle').textContent = step.title;
    this.card.querySelector('#tourText').innerHTML = step.text.map(p => `<p>${p}</p>`).join('');
    this.card.querySelectorAll('.tour-progress i').forEach((bar, i) => bar.classList.toggle('on', i <= index));
    this.card.querySelector('[data-tour="prev"]').hidden = index === 0;
    const last = index === this.steps.length - 1;
    this.card.querySelector('[data-tour="next"]').textContent = last ? 'Terminer' : index === 0 ? 'C’est parti' : 'Suivant';
    this.card.querySelector('[data-tour="skip"]').hidden = last;
    this.card.classList.remove('enter');
    void this.card.offsetWidth;
    this.card.classList.add('enter');
    this.place();
    this.card.querySelector('[data-tour="next"]').focus({ preventScroll: true });
  }

  /** Positionne le projecteur sur la cible et la bulle à côté, sans sortir de l'écran. */
  place() {
    if (!this.active) return;
    const vw = innerWidth;
    const vh = innerHeight;
    const card = this.card.getBoundingClientRect();
    if (!this.target) {
      // Étape sans cible : bulle centrée, tout l'écran assombri.
      this.spot.classList.add('center');
      Object.assign(this.spot.style, { top: `${vh / 2}px`, left: `${vw / 2}px`, width: '0px', height: '0px' });
      Object.assign(this.card.style, { top: `${Math.max(12, (vh - card.height) / 2)}px`, left: `${Math.max(12, (vw - card.width) / 2)}px` });
      return;
    }
    this.spot.classList.remove('center');
    const r = this.target.getBoundingClientRect();
    const spot = {
      top: Math.max(4, r.top - PADDING),
      left: Math.max(4, r.left - PADDING),
      width: Math.min(vw - 8, r.width + PADDING * 2),
      height: Math.min(vh - 8, r.height + PADDING * 2),
    };
    Object.assign(this.spot.style, { top: `${spot.top}px`, left: `${spot.left}px`, width: `${spot.width}px`, height: `${spot.height}px` });

    // Place la bulle là où il y a le plus de place : dessous, dessus, à droite ou à gauche.
    const below = vh - (spot.top + spot.height);
    const above = spot.top;
    const right = vw - (spot.left + spot.width);
    let top;
    let left;
    if (below >= card.height + GAP) { top = spot.top + spot.height + GAP; left = spot.left; }
    else if (above >= card.height + GAP) { top = spot.top - card.height - GAP; left = spot.left; }
    else if (right >= card.width + GAP) { top = spot.top; left = spot.left + spot.width + GAP; }
    else if (spot.left >= card.width + GAP) { top = spot.top; left = spot.left - card.width - GAP; }
    else { top = vh - card.height - 12; left = (vw - card.width) / 2; }
    top = Math.min(Math.max(12, top), vh - card.height - 12);
    left = Math.min(Math.max(12, left), vw - card.width - 12);
    Object.assign(this.card.style, { top: `${top}px`, left: `${left}px` });
  }

  end(completed = false) {
    if (!this.active) return;
    this.active = false;
    this.token = null;
    document.removeEventListener('keydown', this.onKey);
    removeEventListener('resize', this.reposition);
    removeEventListener('scroll', this.reposition, true);
    this.blocker.remove();
    this.spot.remove();
    this.card.remove();
    this.previousFocus?.focus?.({ preventScroll: true });
    this.onEnd?.(completed);
  }
}

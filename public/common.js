// ---------------------------------------------------------------------------
// Outils partagés par tous les modules de l'interface.
// ---------------------------------------------------------------------------

export const TICKET_PRICE = 0.01;
export const MAX_PER_PURCHASE = 20;

export const $ = id => document.getElementById(id);
export const $$ = selector => [...document.querySelectorAll(selector)];
export const fmtEth = n => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtEthPrecise = n => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const fmtPct = n => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
export const pad = n => String(n).padStart(3, '0');
export const short = address => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—';
export const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
export const sameAddress = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Nom affiché : le pseudo s'il existe, sinon l'adresse raccourcie. */
export const displayName = (address, pseudo) => pseudo || short(address);

export const store = {
  get(key) { try { return localStorage.getItem('blocklucky.' + key); } catch { return null; } },
  set(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem('blocklucky.' + key);
      else localStorage.setItem('blocklucky.' + key, value);
      return true;
    } catch { return false; }
  },
};

/** Ne réécrit le HTML que s'il a changé (évite de rejouer les animations à chaque actualisation). */
export function setHTML(el, html) {
  if (!el || el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

export function avatar(address, extraClass = '', pseudo = null) {
  const hue = parseInt((address || '0x0000').slice(2, 6), 16) % 360;
  const letters = pseudo ? pseudo.slice(0, 2).toUpperCase() : (address || '').slice(2, 4).toUpperCase();
  return `<span class="avatar ${extraClass}" style="--h:${hue}">${esc(letters)}</span>`;
}

export const empty = (icon, text, extra = '') =>
  `<div class="empty"><span class="empty-icon"><svg class="icon"><use href="#${icon}"/></svg></span><p>${text}</p>${extra}</div>`;

export function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename, rows) {
  const csv = '﻿' + rows.map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(';')).join('\r\n');
  download(filename, csv, 'text/csv;charset=utf-8');
}

let toastTimer;
export function toast(message, kind = 'info') {
  const el = $('toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 7000 : 4500);
}

/** Appel à l'API du serveur. `body` → POST (ou `method`), sinon GET. */
export async function api(url, body, method) {
  let response;
  try {
    response = await fetch(url, body !== undefined || method
      ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined }
      : { cache: 'no-store' });
  } catch {
    throw new Error('Le serveur BlockLucky ne répond pas. Vérifie que « npm run dev » tourne.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Le serveur est indisponible.'), { status: response.status });
  return data;
}

// Tests de la sécurité et des données personnelles : mot de passe oublié, export et suppression du compte,
// limites de requêtes et politique de sécurité du contenu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

async function fixture(t, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'blocklucky-'));
  const mails = [];
  const server = createApp({ file: path.join(dir, 'state.json'), contractFile: path.join(dir, 'contract.json'), env: {}, sendMail: mail => mails.push(mail), ...options }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const makeClient = () => {
    let cookie = '';
    const call = async (url, body) => {
      const res = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      return { status: res.status, data: await res.json(), headers: res.headers };
    };
    call.newSession = makeClient;
    return call;
  };
  return Object.assign(makeClient(), { base, mails });
}
const alice = { pseudo: 'Alice', email: 'alice@exemple.fr', password: 'motdepasse1' };

test('mot de passe oublié : lien à usage unique, même réponse pour une adresse inconnue, connexion après changement', async t => {
  const call = await fixture(t);
  await call('/api/account/register', alice);
  await call('/api/account/logout', {});

  const unknown = await call('/api/account/forgot', { email: 'personne@exemple.fr' });
  const known = await call('/api/account/forgot', { email: 'ALICE@exemple.fr' });
  assert.equal(unknown.data.message, known.data.message); // on ne révèle pas quelles adresses sont inscrites
  assert.equal(call.mails.length, 1);
  const token = call.mails[0].link.match(/#reset=([a-f0-9]{48})$/)[1];

  assert.equal((await call('/api/account/reset', { token, password: 'court' })).status, 400);
  const reset = await call('/api/account/reset', { token, password: 'nouveaumotdepasse' });
  assert.equal(reset.status, 200);
  assert.equal((await call('/api/session')).data.account.pseudo, 'Alice'); // connecté directement
  assert.equal((await call('/api/account/reset', { token, password: 'encoreunautre' })).status, 400); // usage unique

  const other = call.newSession();
  assert.equal((await other('/api/account/login', { email: alice.email, password: alice.password })).status, 401);
  assert.equal((await other('/api/account/login', { email: alice.email, password: 'nouveaumotdepasse' })).status, 200);
});

test('données personnelles : export complet, suppression avec mot de passe, pseudo retiré des résultats', async t => {
  const call = await fixture(t, { capacity: 2 });
  assert.equal((await call('/api/account/export')).status, 401);
  await call('/api/account/register', alice);
  await call('/api/tickets', { quantity: 1 });

  const exported = await call('/api/account/export');
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  assert.equal(exported.data.account.email, alice.email);
  assert.equal(exported.data.demoWallet.balance, 0.99);
  assert.ok(!JSON.stringify(exported.data).includes('scrypt:'), 'aucune empreinte de mot de passe dans l’export');

  assert.equal((await call('/api/account/delete', { password: 'mauvais' })).status, 401);
  assert.equal((await call('/api/account/delete', { password: alice.password })).status, 409); // ticket en jeu
  await call('/api/tickets', { quantity: 1 }); // tirage complet : Alice gagne, plus de ticket en cours
  assert.equal((await call('/api/state')).data.history[0].winnerPseudo, 'Alice');

  assert.equal((await call('/api/account/delete', { password: alice.password })).status, 200);
  const after = await call('/api/state');
  assert.equal(after.data.balance, 0); // invité, portefeuille vide
  assert.equal(after.data.history[0].winnerPseudo, null); // le pseudo a disparu des résultats publics
  assert.equal((await call('/api/session')).data.account, null);
  assert.equal((await call('/api/account/login', { email: alice.email, password: alice.password })).status, 401);
  assert.equal((await call('/api/account/register', alice)).status, 201); // l'adresse e-mail est libre
});

test('limites de requêtes : trop de demandes « mot de passe oublié » → 429 avec Retry-After', async t => {
  const call = await fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/account/forgot', { email: 'x@exemple.fr' })).status, 200);
  const blocked = await call('/api/account/forgot', { email: 'x@exemple.fr' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('en-têtes de sécurité : CSP stricte, script du thème autorisé par son empreinte, désactivable', async t => {
  const call = await fixture(t);
  const res = await fetch(call.base + '/');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');

  const relaxed = await fixture(t, { env: { CSP: 'off' } });
  assert.equal((await fetch(relaxed.base + '/')).headers.get('content-security-policy'), null);
});

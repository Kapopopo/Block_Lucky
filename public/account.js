// ---------------------------------------------------------------------------
// Compte joueur (e-mail + mot de passe) et connexion avec Ethereum (signature MetaMask).
// ---------------------------------------------------------------------------
import { BrowserProvider } from '/vendor/ethers.js';
import { $, $$, api, toast, esc, short, avatar, sameAddress, download } from './common.js';

/**
 * Connexion avec Ethereum (« Sign-In with Ethereum ») :
 * 1. le serveur prépare un message unique ; 2. MetaMask le fait signer ; 3. le serveur vérifie la signature.
 * C'est gratuit : signer un message n'est pas une transaction.
 */
export async function signInWithEthereum() {
  if (!window.ethereum) throw new Error('MetaMask n’est pas installé : suis le tuto MetaMask pour l’installer.');
  const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const chainId = Number(await window.ethereum.request({ method: 'eth_chainId' }));
  const { message } = await api('/api/wallet/challenge', { address, chainId });
  const signer = await new BrowserProvider(window.ethereum).getSigner(address);
  const signature = await signer.signMessage(message);
  return api('/api/wallet/verify', { signature });
}

export function initAccount(ctx) {
  const dialog = $('accountDialog');
  let tab = 'register'; // register | login | forgot (mot de passe oublié) | reset (nouveau mot de passe)
  // Lien « mot de passe oublié » : #reset=<jeton>. On le lit tout de suite, avant que le site ne réécrive l'adresse.
  const readResetLink = () => location.hash.match(/^#reset=([a-f0-9]{48})$/)?.[1] || null;
  let resetToken = readResetLink();
  let welcome = false;
  let showForms = false; // connecté avec MetaMask : formulaires e-mail repliés par défaut

  const session = () => ctx.app.session;

  /** Adresse MetaMask de l'utilisateur, seulement en mode blockchain : en mode démo, MetaMask n'est pas utilisé. */
  function metamaskAddress() {
    const { app } = ctx;
    return app.mode === 'chain' ? app.chain.account || null : null;
  }

  function showError(message) {
    $('accountError').textContent = message || '';
    $('accountError').hidden = !message;
    if (message) showInfo('');
  }

  function showInfo(message) {
    $('accountInfo').textContent = message || '';
    $('accountInfo').hidden = !message;
  }

  function render() {
    const s = session();
    const account = s?.account;
    const metamask = metamaskAddress();
    const walletOnly = !account && Boolean(metamask) && !showForms && !welcome;
    $('accountGuest').hidden = Boolean(account) || welcome || walletOnly;
    $('accountProfile').hidden = !account || welcome;
    $('accountWalletProfile').hidden = !walletOnly;
    if (walletOnly) {
      const owner = ctx.app.mode === 'chain' && ctx.app.chain.info?.isOwner;
      const verified = sameAddress(s?.wallet?.address, metamask);
      $('walletProfileAvatar').innerHTML = avatar(metamask, 'avatar-xl');
      $('walletProfileAddress').textContent = short(metamask);
      $('walletProfileText').textContent = ctx.app.mode === 'chain'
        ? `Connecté avec MetaMask · ${ctx.network().name}${verified ? ' · adresse vérifiée' : ''}`
        : 'Adresse vérifiée par une signature MetaMask.';
      $('walletProfileRole').textContent = owner ? 'Administrateur (propriétaire du contrat)' : 'Joueur';
      $('walletProfileRole').className = `chip ${owner ? 'chip-gold' : 'chip-accent'}`;
    }
    $('accountWelcome').hidden = !welcome;
    $$('.tabs [data-account-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.accountTab === (tab === 'forgot' ? 'login' : tab))));
    $('accountGuest').querySelector('.tabs').hidden = tab === 'reset';
    $('registerForm').hidden = tab !== 'register';
    $('loginForm').hidden = tab !== 'login';
    $('forgotForm').hidden = tab !== 'forgot';
    $('resetForm').hidden = tab !== 'reset';
    if (!account) $('deleteForm').hidden = true;
    if (account) {
      $('profileAvatar').innerHTML = avatar(ctx.app.state?.address || '0x00', 'avatar-xl', account.pseudo);
      $('profilePseudo').textContent = account.pseudo;
      $('profileEmail').textContent = account.email;
      $('profileRole').textContent = account.role === 'admin' ? 'Administrateur' : 'Joueur';
      $('profileRole').className = `chip ${account.role === 'admin' ? 'chip-gold' : 'chip-accent'}`;
    }
    // Portefeuille Ethereum : en mode démo, pas de MetaMask, seulement le chemin vers le mode blockchain.
    const demo = ctx.app.mode !== 'chain';
    $('goChainButton').hidden = !demo;
    if (demo) {
      $('walletSectionTitle').textContent = 'Jouer avec MetaMask';
      $('walletSectionText').textContent = 'En mode démo, tu joues avec des ETH fictifs : MetaMask n’est pas utilisé. Pour te connecter avec MetaMask et jouer avec tes ETH de test, passe en mode blockchain.';
      $('siweButton').hidden = true;
      $('walletLogoutButton').hidden = true;
      renderButton();
      return;
    }
    const wallet = s?.wallet;
    $('walletSectionTitle').textContent = wallet ? 'Adresse vérifiée' : metamask ? 'Vérifier mon adresse' : 'Connexion avec Ethereum';
    $('walletSectionText').innerHTML = wallet
      ? `Connecté avec Ethereum : <b>${esc(short(wallet.address))}</b>${wallet.isOwner ? ' · <b>propriétaire du contrat (admin)</b>' : ''}. La signature prouve que cette adresse t’appartient.`
      : metamask
        ? 'Ton MetaMask est connecté. Pour recevoir des ETH de test du robinet, prouve que l’adresse est à toi en signant un message : c’est gratuit, aucune transaction, aucun frais.'
        : window.ethereum
          ? 'Signe un message avec MetaMask pour prouver que l’adresse est à toi. C’est gratuit : aucune transaction, aucun frais. Nécessaire pour le robinet d’ETH de test.'
          : 'MetaMask n’est pas installé dans ce navigateur. Le tuto MetaMask te guide pas à pas.';
    $('siweButton').hidden = Boolean(wallet) || !window.ethereum;
    // Le profil MetaMask a déjà son bouton « Se déconnecter » : pas de doublon en bas.
    $('walletLogoutButton').hidden = !metamask || walletOnly;
    renderButton();
  }

  /** Bouton de la barre du haut : pseudo du compte, sinon adresse MetaMask, sinon « Connexion ». */
  function renderButton() {
    const account = session()?.account;
    const metamask = account ? null : metamaskAddress();
    const button = $('accountButton');
    $('accountLabel').textContent = account ? account.pseudo : metamask ? short(metamask) : 'Connexion';
    button.querySelector('use').setAttribute('href', metamask ? '#i-fox' : '#i-user');
    button.classList.toggle('signed-in', Boolean(account || metamask));
    button.setAttribute('aria-label', account
      ? `Mon compte : ${account.pseudo}`
      : metamask ? `Connecté avec MetaMask : ${metamask}` : 'Créer un compte ou se connecter');
  }

  function open(nextTab) {
    welcome = false;
    showForms = Boolean(nextTab);
    if (nextTab) tab = nextTab;
    showError('');
    showInfo('');
    render();
    dialog.showModal();
  }

  async function submit(form, url, body, done) {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    showError('');
    try {
      await api(url, body);
      form.reset();
      await ctx.refresh({ silent: false });
      done();
    } catch (error) {
      showError(error.message);
    } finally {
      button.disabled = false;
    }
  }

  $$('[data-account-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.accountTab; showError(''); showInfo(''); render(); }));

  // ----- Mot de passe oublié -----
  $('forgotForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    showError('');
    try {
      const { message } = await api('/api/account/forgot', { email: form.elements.email.value });
      form.reset();
      showInfo(message);
    } catch (error) { showError(error.message); } finally { button.disabled = false; }
  });

  $('resetForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, '/api/account/reset', { token: resetToken, password: form.elements.password.value }, () => {
      resetToken = null;
      tab = 'login';
      render();
      toast('Nouveau mot de passe enregistré : tu es connecté.', 'success');
    });
  });

  // ----- Droits sur les données (RGPD) -----
  $('exportDataButton').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/account/export');
      if (!res.ok) throw new Error((await res.json()).error || 'Export impossible.');
      download('blocklucky-mes-donnees.json', await res.text(), 'application/json');
      toast('Tes données sont téléchargées (fichier JSON).', 'success');
    } catch (error) { toast(error.message, 'error'); }
  });

  $('deleteAccountToggle').addEventListener('click', () => {
    $('deleteForm').hidden = !$('deleteForm').hidden;
    if (!$('deleteForm').hidden) $('deleteForm').elements.password.focus();
  });
  $('deleteCancel').addEventListener('click', () => { $('deleteForm').reset(); $('deleteForm').hidden = true; });
  $('deleteForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/account/delete', { password: form.elements.password.value });
      form.reset();
      form.hidden = true;
      tab = 'register';
      await ctx.refresh({ silent: false });
      render();
      toast('Ton compte et ses données ont été supprimés.', 'success');
    } catch (error) { toast(error.message, 'error'); } finally { button.disabled = false; }
  });

  // Arrivée par le lien reçu (nouvel onglet, ou lien ouvert dans un onglet où le site est déjà chargé) :
  // on ouvre directement le choix du nouveau mot de passe, et le jeton disparaît de la barre d'adresse.
  function openResetLink() {
    const token = readResetLink() || resetToken;
    if (!token) return;
    resetToken = token;
    history.replaceState(null, '', location.pathname + location.search);
    if (dialog.open) dialog.close();
    open('reset');
  }
  window.addEventListener('hashchange', () => { if (readResetLink()) openResetLink(); });
  if (resetToken) setTimeout(openResetLink, 0);

  $('registerForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    submit(form, '/api/account/register', data, () => {
      welcome = true; // écran de bienvenue avec la suite : le tuto MetaMask
      render();
      toast(`Bienvenue ${data.pseudo} ! Ton compte est créé : 1 ETH fictif a été ajouté à ton portefeuille.`, 'success');
    });
  });

  $('loginForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    submit(form, '/api/account/login', Object.fromEntries(new FormData(form)), () => {
      render();
      toast(`Bon retour, ${session()?.account?.pseudo} !`, 'success');
    });
  });

  $('logoutButton').addEventListener('click', async () => {
    try {
      await api('/api/account/logout', {});
      await ctx.refresh({ silent: false });
      render();
      toast('Tu es déconnecté. Reconnecte-toi pour retrouver ton solde et tes tickets.');
    } catch (error) { toast(error.message, 'error'); }
  });

  $('siweButton').addEventListener('click', async () => {
    if (ctx.app.mode !== 'chain') { ctx.goToChainMode(); return; } // jamais de signature MetaMask en mode démo
    const button = $('siweButton');
    button.disabled = true;
    try {
      await signInWithEthereum();
      await ctx.refresh({ silent: false });
      render();
      toast('Adresse vérifiée : tu es connecté avec Ethereum.', 'success');
    } catch (error) {
      toast(ctx.errorMessage(error), 'error');
    } finally { button.disabled = false; }
  });

  /**
   * Déconnexion MetaMask : retour au mode démo, oubli de l'adresse vérifiée par le serveur,
   * puis retrait de l'autorisation du site dans MetaMask (il redemandera la permission la prochaine fois).
   */
  async function disconnectWallet(button) {
    const { app } = ctx;
    if (app.busy) { toast('Attends la fin de la transaction en cours avant de te déconnecter.', 'error'); return; }
    const wasChain = app.mode === 'chain';
    button.disabled = true;
    try {
      if (wasChain && !(await ctx.setMode('demo'))) return;
      if (session()?.wallet) await api('/api/wallet/logout', {});
      // Pris en charge par les versions récentes de MetaMask ; sinon on ignore l'erreur :
      // l'app est déjà en mode démo et ne se reconnectera pas toute seule au rechargement.
      await window.ethereum?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {});
      await ctx.refresh({ silent: false });
      showForms = false;
      dialog.close();
      toast(wasChain ? 'Tu es déconnecté de MetaMask. Tu joues maintenant en mode démo.' : 'Tu es déconnecté de MetaMask.', 'success');
    } catch (error) {
      toast(ctx.errorMessage(error), 'error');
    } finally {
      button.disabled = false;
      render();
    }
  }
  $$('[data-wallet-disconnect]').forEach(b => b.addEventListener('click', () => disconnectWallet(b)));

  $('showAccountForms').addEventListener('click', () => { showForms = true; showError(''); render(); });
  $('welcomeOnboarding').addEventListener('click',() => { dialog.close(); ctx.openOnboarding(); });
  $('welcomeLater').addEventListener('click', () => { welcome = false; render(); dialog.close(); });
  $('accountButton').addEventListener('click', () => open());

  return { open, render, renderButton, isSignedIn: address => sameAddress(session()?.wallet?.address, address) };
}

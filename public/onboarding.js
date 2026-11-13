// ---------------------------------------------------------------------------
// Tuto MetaMask : une checklist qui se valide toute seule, de l'installation à la première partie.
// Trois parcours selon l'endroit où le joueur utilise MetaMask :
//   • extension  : navigateur d'ordinateur (Chrome, Firefox, Edge, Brave) ;
//   • app mobile : navigateur intégré à l'app MetaMask (Safari ou Chrome n'ont pas MetaMask) ;
//   • application web (portfolio.metamask.io) : un tableau de bord qui se connecte lui-même à
//     l'extension ou à l'app. Il ne peut pas signer pour BlockLucky : le tuto aide à retrouver
//     le même compte dans l'extension.
// L'application vérifie chaque étape en direct (extension présente, compte autorisé, bon réseau…).
// ---------------------------------------------------------------------------
import { formatEther, isAddress, getAddress } from '/vendor/ethers.js';
import { $, $$, api, toast, esc, short, sameAddress, setHTML, store, fmtEthPrecise } from './common.js';
import { signInWithEthereum } from './account.js';

const MIN_BALANCE = 0.02; // de quoi acheter un ticket et payer les frais
const SEPOLIA_FAUCETS = [
  ['Robinet par minage (sans inscription)', 'https://sepolia-faucet.pk910.de/'],
  ['Robinet Google Cloud', 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia'],
];
const DOWNLOAD_URL = 'https://metamask.io/download/';
const WEB_APP_URL = 'https://portfolio.metamask.io/';

const PLATFORMS = {
  extension: 'Sur ordinateur, avec Chrome, Firefox, Edge ou Brave : MetaMask s’ajoute au navigateur comme une extension.',
  mobile: 'Sur téléphone, BlockLucky s’ouvre dans le navigateur intégré à l’app MetaMask : Safari et Chrome n’ont pas MetaMask.',
  web: 'L’application web MetaMask (portfolio.metamask.io) est un tableau de bord : elle affiche ton compte, mais elle passe elle-même par l’extension ou l’app pour signer, et n’affiche pas les réseaux de test. Ce tuto t’aide à jouer avec le même compte.',
};

// Où tourne la page ?
const ua = navigator.userAgent;
const inMetaMaskApp = /MetaMaskMobile/i.test(ua); // navigateur intégré de l'app MetaMask
const onPhone = inMetaMaskApp || /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
const onLocalHost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
/** Lien qui ouvre une adresse dans le navigateur de l'app MetaMask (docs.metamask.io, « Use deeplinks »). */
const appLink = url => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, '')}`;

/** Adresses MetaMask qui ont terminé toutes les étapes (mémorisées dans ce navigateur). */
const doneAddresses = () => { try { return JSON.parse(store.get('onboardingDone') || '[]'); } catch { return []; } };
function markDone(address) {
  const list = doneAddresses();
  if (!address || list.some(a => sameAddress(a, address))) return false;
  store.set('onboardingDone', JSON.stringify([...list, address.toLowerCase()].slice(-20)));
  return true;
}

/** QR code en SVG (bibliothèque chargée seulement quand on en a besoin). */
let qrLib = null;
async function qrSvg(text) {
  qrLib ??= (await import('/vendor/qrcode.js')).default;
  const qr = qrLib(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

export function initOnboarding(ctx) {
  const dialog = $('onboardingDialog');
  let timer = null;
  let busy = null; // étape en cours d'action
  let status = {};
  let platform = store.get('onboardingPlatform') || (onPhone ? 'mobile' : 'extension');
  let lan = null;  // adresses réseau du PC, pour ouvrir le site depuis un téléphone
  let qr = { text: null, svg: '' };

  /**
   * Vrai si l'adresse MetaMask active a fait toutes les étapes : on n'affiche plus le bouton du tuto.
   * Une fois terminé, ça reste acquis pour cette adresse (même si le solde baisse en jouant).
   */
  function isComplete() {
    const { app } = ctx;
    const address = app.mode === 'chain' ? app.chain.account : app.session?.wallet?.address;
    if (!address) return false;
    if (doneAddresses().some(a => sameAddress(a, address))) return true;
    // Étapes faites sans passer par le tuto : connecté, bon réseau, adresse vérifiée, assez d'ETH.
    const ready = app.mode === 'chain' && !app.chain.wrongNetwork && Boolean(app.state)
      && sameAddress(app.session?.wallet?.address, address) && app.state.balance >= MIN_BALANCE;
    return ready && markDone(address);
  }

  /** Adresse à ouvrir sur le téléphone : celle du site, ou l'adresse réseau du PC si on est sur localhost. */
  function phoneUrl() {
    if (!onLocalHost) return location.origin + location.pathname;
    return lan?.urls?.[0] ? lan.urls[0] + location.pathname : null;
  }

  /** Lit l'état réel : extension, compte, réseau, signature, solde. */
  async function evaluate() {
    const eth = window.ethereum;
    const config = ctx.app.config;
    const next = {
      installed: Boolean(eth), config: Boolean(config),
      walletCreated: store.get('walletCreated') === '1',
      appInstalled: inMetaMaskApp || store.get('mobileAppInstalled') === '1' || (onPhone && Boolean(eth)),
      webAddress: store.get('webAddress') || null,
    };
    if (eth) {
      try {
        const accounts = await eth.request({ method: 'eth_accounts' });
        next.account = accounts[0] || null;
        next.chainId = Number(await eth.request({ method: 'eth_chainId' }));
      } catch { next.account = null; }
    }
    next.connected = Boolean(next.account);
    next.sameAsWeb = !next.webAddress || sameAddress(next.account, next.webAddress);
    next.network = Boolean(config && next.chainId === config.chainId);
    next.signedIn = Boolean(next.account && sameAddress(ctx.app.session?.wallet?.address, next.account));
    if (next.connected && next.network) {
      try { next.balance = Number(formatEther(await eth.request({ method: 'eth_getBalance', params: [next.account, 'latest'] }))); } catch { next.balance = null; }
    }
    next.funded = next.balance >= MIN_BALANCE;
    next.playing = ctx.app.mode === 'chain' && sameAddress(ctx.app.chain.account, next.account);
    if (platform === 'mobile' && onLocalHost && !lan) {
      try { lan = await api('/api/lan'); } catch { lan = { exposed: false, urls: [] }; }
    }
    status = next;
    await prepareQr();
    render();
    if (steps().every(step => step.done) && markDone(next.account)) ctx.render(); // masque les boutons du tuto
  }

  /** Sur ordinateur, le tuto mobile affiche un QR code à scanner avec le téléphone (site en https). */
  async function prepareQr() {
    const url = phoneUrl();
    const text = platform === 'mobile' && !onPhone && url?.startsWith('https://') ? appLink(url) : null;
    if (text === qr.text) return;
    qr = { text, svg: '' };
    if (text) {
      try { qr.svg = await qrSvg(text); } catch { qr.svg = ''; } // sans QR code, l'adresse reste affichée
    }
  }

  async function act(id, action) {
    busy = id;
    render();
    try {
      await action();
    } catch (error) {
      toast(ctx.errorMessage(error), 'error');
    } finally {
      busy = null;
      await ctx.refresh();
      await evaluate();
    }
  }

  // --- Étapes -------------------------------------------------------------
  const copyable = url => `<div class="onboarding-url"><code>${esc(url)}</code><button class="btn btn-ghost btn-sm" data-copy="${esc(url)}"><svg class="icon"><use href="#i-copy"/></svg>Copier</button></div>`;

  /** Ouvrir BlockLucky dans l'app MetaMask : lien direct, QR code ou adresse à taper selon le cas. */
  function openInAppBody() {
    const url = phoneUrl();
    if (!url) {
      return `<p class="onboarding-warning"><b>Ton téléphone ne peut pas ouvrir « ${esc(location.host)} » :</b> cette adresse désigne l’appareil lui-même. Sur l’ordinateur qui lance BlockLucky, ajoute <code>HOST=0.0.0.0</code> dans le fichier <code>.env</code>, relance le serveur, puis rouvre ce tuto : l’adresse à utiliser sur le téléphone s’affichera ici (téléphone et ordinateur sur le même Wi-Fi).</p>`;
    }
    const https = url.startsWith('https://');
    if (onPhone && https) {
      return `<a class="btn btn-primary btn-sm" href="${esc(appLink(url))}"><svg class="icon"><use href="#i-fox"/></svg>Ouvrir dans l’app MetaMask</a><p class="muted small">Ou, dans l’app MetaMask : onglet « Navigateur », puis tape l’adresse :</p>${copyable(url)}`;
    }
    if (qr.svg) {
      return `<div class="onboarding-qr"><div class="qr-box">${qr.svg}</div><p class="muted small">Scanne ce QR code avec l’appareil photo de ton téléphone : il ouvre BlockLucky directement dans l’app MetaMask.</p></div>${copyable(url)}`;
    }
    // Site en http (réseau local) : le lien direct de MetaMask passe en https, il faut taper l'adresse.
    const others = onLocalHost ? (lan?.urls || []).slice(1).map(u => u + location.pathname) : [];
    return `<p class="muted small">Dans l’app MetaMask, ouvre l’onglet « Navigateur » et tape exactement cette adresse :</p>${copyable(url)}`
      + (onLocalHost ? `<p class="muted small">Le téléphone doit être sur le même Wi-Fi que l’ordinateur.${others.length ? ` Si la page ne s’ouvre pas, essaie : ${others.map(u => `<code>${esc(u)}</code>`).join(' · ')}` : ''}</p>` : '');
  }

  function steps() {
    const s = status;
    const networkName = ctx.network().name;
    const faucet = ctx.app.session?.faucet;
    const local = ctx.app.config?.chainId === 31337;
    const where = platform === 'mobile' ? 'Dans l’app MetaMask' : 'Dans MetaMask';
    // En mode démo, MetaMask n'est pas utilisé : les étapes qui le sollicitent passent d'abord en mode blockchain.
    const demo = ctx.app.mode !== 'chain';
    const chainFirst = '<button class="btn btn-primary btn-sm" data-step-action="chainMode">Passer en mode blockchain</button><p class="muted small">En mode démo, MetaMask n’est pas utilisé. Ce bouton passe en mode blockchain, puis MetaMask te demande d’autoriser BlockLucky.</p>';
    const all = {
      install: {
        done: s.installed, title: 'Installer l’extension MetaMask',
        why: 'MetaMask est un portefeuille : une extension de navigateur qui garde ta clé secrète et signe tes opérations.',
        body: `<a class="btn btn-primary btn-sm" href="${DOWNLOAD_URL}" target="_blank" rel="noopener">Télécharger l’extension ↗</a><button class="btn btn-ghost btn-sm" data-step-action="reload">C’est installé, vérifier</button>`,
      },
      installApp: {
        done: s.appInstalled, title: 'Installer l’app MetaMask sur ton téléphone',
        why: 'L’app MetaMask (iPhone et Android) contient ton portefeuille et un navigateur pour ouvrir des sites comme BlockLucky.',
        body: `<a class="btn btn-primary btn-sm" href="${DOWNLOAD_URL}" target="_blank" rel="noopener">App Store · Google Play ↗</a><button class="btn btn-ghost btn-sm" data-step-action="appInstalled">L’app est installée</button>`,
      },
      create: {
        done: s.walletCreated || s.connected, title: 'Créer ton portefeuille',
        why: `${where} : « Créer un nouveau portefeuille », choisis un mot de passe, puis recopie ta phrase secrète de 12 mots sur papier (ou utilise ton compte Google ou Apple si MetaMask te le propose).`,
        body: `<p class="onboarding-warning"><b>Important :</b> ne donne jamais ta phrase secrète ni ta clé privée, à personne. BlockLucky ne te les demandera jamais. Pour ce projet, crée un portefeuille réservé aux tests.</p>${local ? '<p class="muted small">En local avec Ganache : tu peux aussi « importer un compte » avec une des clés de test affichées par <code>npm run chain</code>.</p>' : ''}<button class="btn btn-primary btn-sm" data-step-action="created">J’ai créé mon portefeuille</button>`,
      },
      openInApp: {
        done: s.appInstalled && (inMetaMaskApp || (onPhone && s.installed)), title: 'Ouvrir BlockLucky dans l’app MetaMask',
        why: 'Sur téléphone, Safari et Chrome ne connaissent pas MetaMask : le site doit être ouvert dans le navigateur intégré à l’app.',
        body: openInAppBody(),
      },
      webAddress: {
        done: Boolean(s.webAddress),
        title: s.webAddress ? `Ton adresse : ${esc(short(s.webAddress))}` : 'Retrouver ton adresse dans l’application web',
        why: s.webAddress
          ? 'BlockLucky vérifiera que tu joues avec ce compte. <button class="link-button" data-step-action="forgetWebAddress">Changer d’adresse</button>'
          : 'Ouvre l’application web MetaMask : ton compte s’affiche en haut avec son adresse (0x…). Copie-la et colle-la ici : BlockLucky vérifiera que tu joues avec le même compte.',
        body: `<a class="btn btn-ghost btn-sm" href="${WEB_APP_URL}" target="_blank" rel="noopener">Ouvrir l’application web ↗</a>
          <form class="onboarding-address" data-step-form="webAddress"><input name="address" placeholder="0x…" autocomplete="off" spellcheck="false" aria-label="Adresse de ton compte MetaMask"><button class="btn btn-primary btn-sm">Enregistrer</button></form>
          <p class="muted small">Pas encore de compte MetaMask ? Choisis plutôt le tuto « Extension » ou « App mobile ».</p>`,
      },
      importAccount: {
        done: s.installed, title: 'Mettre ce compte dans l’extension MetaMask',
        why: 'L’application web ne peut pas signer pour BlockLucky : ton compte doit être dans l’extension de ce navigateur. Installe-la, puis choisis « Importer un portefeuille existant » avec ta phrase secrète, ou reconnecte-toi avec Google ou Apple si tu as créé ton compte ainsi. Si l’extension est déjà installée, cette étape est validée.',
        body: `<a class="btn btn-primary btn-sm" href="${DOWNLOAD_URL}" target="_blank" rel="noopener">Télécharger l’extension ↗</a><button class="btn btn-ghost btn-sm" data-step-action="reload">C’est installé, vérifier</button><button class="btn btn-ghost btn-sm" data-platform="mobile"><svg class="icon"><use href="#i-phone"/></svg>Jouer plutôt sur téléphone</button>`,
      },
      connect: {
        done: s.connected && (platform !== 'web' || s.sameAsWeb), title: 'Autoriser BlockLucky à voir ton adresse',
        why: (platform === 'mobile' ? 'Dans l’app, accepte la demande de connexion de BlockLucky. ' : '')
          + 'Le site ne voit que ton adresse publique (comme un numéro de compte), jamais ta clé secrète.'
          + (platform === 'web' && s.connected && !s.sameAsWeb
            ? `<span class="onboarding-warning">Le compte connecté (<b>${esc(short(s.account))}</b>) n’est pas celui de l’application web (<b>${esc(short(s.webAddress))}</b>). Dans MetaMask, choisis le bon compte, puis réessaie.</span>`
            : ''),
        body: demo ? chainFirst : '<button class="btn btn-primary btn-sm" data-step-action="connect">Connecter MetaMask</button>',
      },
      network: {
        done: s.network, title: `Choisir le réseau ${esc(networkName)}`,
        why: (local
          ? 'BlockLucky tourne sur une blockchain de test installée sur ton ordinateur (Ganache). MetaMask va l’ajouter pour toi.'
          : 'Sepolia est une blockchain publique de test : l’ETH y est gratuit. Si elle n’apparaît pas, active « Afficher les réseaux de test » dans MetaMask.')
          + (local && platform === 'mobile' ? ' Sur téléphone, lance Ganache avec <code>npm run chain:lan</code> pour qu’il soit joignable depuis le Wi-Fi.' : ''),
        body: !s.config ? '<p class="muted small">Aucun contrat n’est déployé : l’administrateur doit d’abord lancer <code>npm run deploy</code>.</p>' : demo ? chainFirst : `<button class="btn btn-primary btn-sm" data-step-action="network">Passer sur ${esc(networkName)}</button>`,
      },
      signin: {
        done: s.signedIn, title: 'Te connecter avec Ethereum',
        why: 'Tu signes un message gratuit : cela prouve que l’adresse est à toi, sans mot de passe. Aucune transaction, aucun frais.',
        body: demo ? chainFirst : '<button class="btn btn-primary btn-sm" data-step-action="signin">Signer pour me connecter</button>',
      },
      funds: {
        done: s.funded, title: 'Recevoir des ETH de test',
        why: `Il faut un peu d’ETH de test pour acheter un ticket et payer les frais (au moins ${MIN_BALANCE.toLocaleString('fr-FR')} ETH). Ton solde : <b>${s.balance == null ? '—' : fmtEthPrecise(s.balance) + ' ETH'}</b>.`
          + (platform === 'web' ? ' L’application web n’affiche pas les ETH de test : regarde ton solde ici ou dans MetaMask.' : ''),
        body: demo ? chainFirst : (faucet?.enabled && !faucet.claimed
          ? `<button class="btn btn-primary btn-sm" data-step-action="faucet">Recevoir ${String(faucet.amount).replace('.', ',')} ETH du robinet BlockLucky</button>`
          : faucet?.claimed ? '<p class="muted small">Tu as déjà utilisé le robinet BlockLucky pour cette adresse.</p>' : '<p class="muted small">Le robinet BlockLucky n’est pas disponible sur ce serveur.</p>')
          + (local ? '' : `<p class="muted small">Autres robinets gratuits : ${SEPOLIA_FAUCETS.map(([label, url]) => `<a href="${url}" target="_blank" rel="noopener">${label} ↗</a>`).join(' · ')}</p>`),
      },
      play: {
        done: s.playing, title: 'Jouer sur la blockchain',
        why: 'Tout est prêt : passe en mode blockchain. Chaque achat sera une vraie transaction, visible par tous.',
        body: '<button class="btn btn-primary btn-sm" data-step-action="play">Passer en mode blockchain</button>',
      },
    };
    const order = {
      extension: ['install', 'create', 'connect', 'network', 'signin', 'funds', 'play'],
      mobile: ['installApp', 'create', 'openInApp', 'connect', 'network', 'signin', 'funds', 'play'],
      web: ['webAddress', 'importAccount', 'connect', 'network', 'signin', 'funds', 'play'],
    }[platform];
    return order.map(id => ({ id, ...all[id] }));
  }

  function render() {
    if (!dialog.open) return;
    $$('.onboarding-platforms [data-platform]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.platform === platform)));
    $('onboardingIntro').textContent = PLATFORMS[platform];
    const list = steps();
    const current = list.findIndex(step => !step.done);
    const doneCount = list.filter(step => step.done).length;
    $('onboardingProgress').style.width = `${(100 * doneCount) / list.length}%`;
    $('onboardingCount').textContent = `${doneCount} / ${list.length} étapes`;
    $('onboardingAccount').textContent = status.account ? `Compte MetaMask : ${short(status.account)}` : '';
    const typed = $('onboardingSteps').querySelector('[data-step-form] input')?.value; // garde la saisie en cours
    setHTML($('onboardingSteps'), list.map((step, i) => {
      const state = step.done ? 'done' : i === current ? 'current' : 'todo';
      return `<li class="onboarding-step ${state}" data-step="${step.id}">
        <span class="step-dot">${step.done ? '✓' : i + 1}</span>
        <div><b>${step.title}</b><p>${step.why}</p>${state === 'current' ? `<div class="step-actions">${busy === step.id ? '<span class="spinner"></span> En cours…' : step.body}</div>` : ''}</div>
      </li>`;
    }).join(''));
    const input = $('onboardingSteps').querySelector('[data-step-form] input');
    if (input && typed && !input.value) input.value = typed;
    $('onboardingDone').hidden = current !== -1;
  }

  function choosePlatform(next) {
    if (!PLATFORMS[next] || next === platform) return;
    platform = next;
    store.set('onboardingPlatform', next);
    render();
    evaluate();
  }
  // Les onglets, et le bouton « Jouer plutôt sur téléphone » dans une étape.
  dialog.addEventListener('click', event => {
    const target = event.target.closest('[data-platform]');
    if (target) choosePlatform(target.dataset.platform);
    const copy = event.target.closest('[data-copy]');
    if (copy) navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('Adresse copiée.', 'success'), () => {});
  });

  $('onboardingSteps').addEventListener('submit', event => {
    const form = event.target.closest('[data-step-form="webAddress"]');
    if (!form) return;
    event.preventDefault();
    const value = form.elements.address.value.trim();
    if (!isAddress(value)) { toast('Ce n’est pas une adresse Ethereum : elle commence par 0x et compte 42 caractères.', 'error'); return; }
    store.set('webAddress', getAddress(value));
    form.reset();
    evaluate();
  });

  $('onboardingSteps').addEventListener('click', event => {
    const action = event.target.closest('[data-step-action]')?.dataset.stepAction;
    if (!action || busy) return;
    const actions = {
      reload: async () => location.reload(),
      created: async () => { store.set('walletCreated', '1'); },
      appInstalled: async () => { store.set('mobileAppInstalled', '1'); },
      forgetWebAddress: async () => { store.set('webAddress', ''); },
      connect: async () => { await window.ethereum.request({ method: 'eth_requestAccounts' }); },
      network: () => ctx.ensureNetwork(),
      signin: () => signInWithEthereum(),
      faucet: async () => {
        const { amount } = await api('/api/faucet', {});
        toast(`${String(amount).replace('.', ',')} ETH envoyés ! Ils arrivent en quelques secondes.`, 'success');
      },
      chainMode: async () => { await ctx.setMode('chain', { announce: true }); }, // le tuto reste ouvert pour la suite
      play: async () => {
        const ok = await ctx.setMode('chain', { announce: true });
        if (ok) { dialog.close(); ctx.show('lottery'); }
      },
    };
    act(event.target.closest('[data-step]').dataset.step, actions[action]);
  });

  function open() {
    $('onboardingDone').hidden = true;
    dialog.showModal();
    render();
    evaluate();
    clearInterval(timer);
    timer = setInterval(evaluate, 2000); // revérifie pendant que l'utilisateur agit dans MetaMask
  }

  dialog.addEventListener('close', () => clearInterval(timer));
  if (window.ethereum?.on) {
    window.ethereum.on('accountsChanged', () => dialog.open && evaluate());
    window.ethereum.on('chainChanged', () => dialog.open && evaluate());
  }
  $('onboardingFinish').addEventListener('click', () => { dialog.close(); ctx.show('lottery'); });

  return { open, isComplete, isReady: () => status.playing };
}

// Le serveur côté blockchain :
//   • surveille les contrats et prévient les navigateurs (temps réel) ;
//   • en local, joue le rôle de l'oracle Chainlink (il n'y a pas de nœud Chainlink sur Ganache) ;
//   • fait fonctionner le robinet BlockLucky (envoi d'ETH de test aux nouveaux joueurs).
import { readFileSync, statSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { JsonRpcProvider, Contract, Wallet, Network, ZeroAddress, parseEther, formatEther } from 'ethers';

const LOG_CHUNK = 9000; // les RPC publics refusent de lire plus de 10 000 blocs d'un coup
// Les RPC publics (publicnode, etc.) répartissent les requêtes sur plusieurs serveurs : le dernier bloc annoncé
// par l'un n'est pas toujours connu de celui qui lit les événements. On garde donc un bloc de retard (sauf en local)…
const HEAD_LAG_BLOCKS = 1;
// … et ces refus passagers ne sont pas des pannes : on réessaie simplement au tour suivant.
const TRANSIENT_RPC = /beyond current head|after last accepted block|header not found|unknown block/i;
/** Message lisible : ethers dit seulement « could not coalesce error », la vraie raison est dans l'erreur du RPC. */
const rpcReason = error => error?.error?.message || error?.info?.error?.message || '';
const MOCK_ORACLE_DELAY_MS = 2500; // le temps de « réfléchir », pour que l'étape soit visible

export function createChainService({ contractFile, env = process.env, onChange = () => {}, log = console }) {
  let config = null;
  let configMtime = 0;
  let provider = null;
  let providerUrl = null;
  let lastBlock = null;
  let timer = null;
  let lastError = '';
  const answered = new Set();

  /** Relit public/contract.json s'il a changé (après un nouveau déploiement). */
  function getConfig() {
    try {
      if (!existsSync(contractFile)) { config = null; configMtime = 0; return null; }
      const mtime = statSync(contractFile).mtimeMs;
      if (mtime !== configMtime) {
        config = JSON.parse(readFileSync(contractFile, 'utf8'));
        configMtime = mtime;
        provider = null;
        lastBlock = null;
        answered.clear();
      }
      return config;
    } catch {
      return null;
    }
  }

  const isLocal = () => getConfig()?.network === 'local';

  function rpcUrl(cfg) {
    if (cfg.network === 'local') return cfg.rpcUrl || 'http://127.0.0.1:8545';
    if (cfg.network === 'sepolia') return env.SEPOLIA_RPC_URL || null;
    return null;
  }

  function getProvider() {
    const cfg = getConfig();
    const url = cfg && rpcUrl(cfg);
    if (!url) return null;
    if (!provider || providerUrl !== url) {
      // staticNetwork : pas de détection répétée du réseau (évite des erreurs en boucle si Ganache est arrêté).
      provider = new JsonRpcProvider(url, Network.from(cfg.chainId), { staticNetwork: true });
      providerUrl = url;
    }
    return provider;
  }

  /** Compte qui paie le robinet et, en local, répond à la place de l'oracle. */
  async function getSigner() {
    const p = getProvider();
    if (!p) return null;
    // En local : un compte Ganache différent de celui du joueur, pour ne pas mélanger les numéros de transaction.
    if (isLocal()) return p.getSigner(Number(env.FAUCET_ACCOUNT_INDEX ?? 9));
    const key = env.FAUCET_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
    return key ? new Wallet(key, p) : null;
  }

  // ---------------------------------------------------------------------
  // Robinet
  // ---------------------------------------------------------------------
  function faucetSettings() {
    const cfg = getConfig();
    const local = cfg?.network === 'local';
    const hasKey = Boolean(env.FAUCET_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY);
    return {
      enabled: Boolean(cfg && rpcUrl(cfg) && (local || hasKey)),
      network: cfg?.network ?? null,
      chainId: cfg?.chainId ?? null,
      amount: Number(env.FAUCET_AMOUNT_ETH || (local ? 0.1 : 0.02)),
      dailyLimit: Number(env.FAUCET_DAILY_LIMIT_ETH || (local ? 100 : 0.2)),
    };
  }

  async function balanceOf(address) {
    return Number(formatEther(await getProvider().getBalance(address)));
  }

  async function sendEth(to, amountEth) {
    const signer = await getSigner();
    if (!signer) throw new Error('Robinet non configuré.');
    const tx = await signer.sendTransaction({ to, value: parseEther(String(amountEth)) });
    return tx.hash;
  }

  // ---------------------------------------------------------------------
  // Oracle simulé (local uniquement)
  // ---------------------------------------------------------------------
  function answerMockRequest(requestId) {
    const key = String(requestId);
    if (answered.has(key)) return;
    answered.add(key);
    setTimeout(async () => {
      try {
        const cfg = getConfig();
        const signer = await getSigner();
        const mock = new Contract(cfg.vrf.coordinator, cfg.abi.coordinator, signer);
        if ((await mock.consumerOf(requestId)) === ZeroAddress) return; // déjà servie
        const randomWord = BigInt('0x' + randomBytes(32).toString('hex'));
        await (await mock.fulfillRandomWords(requestId, randomWord)).wait();
        log.log(`Oracle simulé : requête n° ${requestId} servie.`);
      } catch (error) {
        answered.delete(key); // nouvel essai au prochain passage
        log.warn(`Oracle simulé : échec de la requête n° ${requestId} (${error.shortMessage || error.message}).`);
      }
    }, MOCK_ORACLE_DELAY_MS);
  }

  // ---------------------------------------------------------------------
  // Surveillance des contrats
  // ---------------------------------------------------------------------
  async function tick() {
    const cfg = getConfig();
    const p = getProvider();
    if (!cfg?.factory || !p) return;
    try {
      const latest = (await p.getBlockNumber()) - (isLocal() ? 0 : HEAD_LAG_BLOCKS);
      const firstRun = lastBlock === null;
      // Au démarrage, on relit l'historique récent pour servir une requête d'oracle restée en attente.
      if (firstRun) lastBlock = Math.max((cfg.deployBlock ?? latest) - 1, latest - 2000);
      if (latest <= lastBlock) return;

      const factory = new Contract(cfg.factory, cfg.abi.factory, p);
      const addresses = [cfg.factory, ...(await factory.lotteries())];
      const mock = cfg.vrf?.mode === 'mock' ? new Contract(cfg.vrf.coordinator, cfg.abi.coordinator, p) : null;
      if (mock) addresses.push(cfg.vrf.coordinator);

      let changed = false;
      for (let from = lastBlock + 1; from <= latest; from += LOG_CHUNK) {
        const to = Math.min(latest, from + LOG_CHUNK - 1);
        const logs = await p.getLogs({ address: addresses, fromBlock: from, toBlock: to });
        if (logs.length) changed = true;
        for (const entry of logs) {
          if (!mock || entry.address.toLowerCase() !== cfg.vrf.coordinator.toLowerCase()) continue;
          const parsed = mock.interface.parseLog(entry);
          if (parsed?.name === 'RandomWordsRequested') answerMockRequest(parsed.args.requestId);
        }
      }
      lastBlock = latest;
      if (changed && !firstRun) onChange();
      lastError = '';
    } catch (error) {
      const reason = rpcReason(error);
      if (TRANSIENT_RPC.test(reason)) return; // le RPC n'a pas encore ce bloc : prochain tour
      const message = reason ? `${reason} (${error.shortMessage || error.message})` : error.shortMessage || error.message;
      if (message !== lastError) log.warn(`Surveillance blockchain indisponible : ${message}`);
      lastError = message;
    }
  }

  function start() {
    if (timer) return;
    const loop = async () => {
      await tick();
      timer = setTimeout(loop, isLocal() ? 2000 : 6000);
      timer.unref?.();
    };
    loop();
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
  }

  return { getConfig, faucetSettings, balanceOf, sendEth, start, stop, tick };
}

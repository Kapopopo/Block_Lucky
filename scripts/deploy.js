// Déploiement de BlockLucky : l'usine à tirages, l'oracle de hasard et un premier tirage.
//   npm run deploy          → Ganache (31337) avec une imitation locale de Chainlink VRF
//   npm run deploy:sepolia  → testnet Sepolia (11155111) avec le vrai Chainlink VRF v2.5
// Les paramètres optionnels se règlent dans .env (voir .env.example).
import { JsonRpcProvider, ContractFactory, Wallet, ZeroHash, formatEther, parseEther } from 'ethers';
import { writeFileSync } from 'node:fs';
import { compile } from './compile.js';

// Valeurs officielles Chainlink VRF v2.5 pour Sepolia (docs.chain.link/vrf/v2-5/supported-networks).
const SEPOLIA_VRF = {
  coordinator: '0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B',
  keyHash: '0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae', // voie 500 gwei
};

const env = process.env;
const name = process.argv.includes('--network') ? process.argv[process.argv.indexOf('--network') + 1] : 'local';
const NETWORKS = {
  local: { chainId: 31337n, rpc: env.RPC_URL || 'http://127.0.0.1:8545' },
  sepolia: { chainId: 11155111n, rpc: env.SEPOLIA_RPC_URL, explorer: 'https://sepolia.etherscan.io' },
};
const target = NETWORKS[name];
if (!target) throw new Error(`Réseau inconnu : ${name}. Choix : ${Object.keys(NETWORKS).join(', ')}.`);
if (!target.rpc) throw new Error('SEPOLIA_RPC_URL manquant dans .env (voir .env.example).');

const DRAW = {
  duration: Number(env.DRAW_DURATION_SECONDS || 3600),
  capacity: Number(env.DRAW_CAPACITY || 100),
  maxPerPlayer: Number(env.DRAW_MAX_PER_PLAYER || 25),
};

const provider = new JsonRpcProvider(target.rpc);
const network = await provider.getNetwork();
// Garde-fou : on refuse tout autre réseau, en particulier le réseau principal avec de vrais ETH.
if (network.chainId !== target.chainId) throw new Error(`Réseau attendu ${target.chainId}, reçu ${network.chainId}. Déploiement annulé.`);

let signer;
if (name === 'local') {
  signer = await provider.getSigner(); // compte de test déverrouillé par Ganache
} else {
  if (!env.DEPLOYER_PRIVATE_KEY) throw new Error('DEPLOYER_PRIVATE_KEY manquant dans .env (voir .env.example).');
  signer = new Wallet(env.DEPLOYER_PRIVATE_KEY, provider);
  const balance = await provider.getBalance(signer.address);
  console.log(`Compte ${signer.address} · solde ${formatEther(balance)} ETH de test`);
  if (balance === 0n) throw new Error('Solde nul : récupérez des ETH Sepolia gratuits sur un faucet.');
}

const compiled = compile();
const deploy = async (contractName, ...args) => {
  const { abi, evm } = compiled[contractName];
  const contract = await new ContractFactory(abi, evm.bytecode.object, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
};

// 1. L'oracle de hasard.
let vrf;
if (name === 'local') {
  const mock = await deploy('VRFCoordinatorMock');
  vrf = { mode: 'mock', coordinator: await mock.getAddress(), keyHash: ZeroHash, subscriptionId: 0n, nativePayment: true };
  console.log(`Oracle simulé (local) : ${vrf.coordinator}`);
} else {
  vrf = {
    mode: 'chainlink',
    coordinator: env.VRF_COORDINATOR || SEPOLIA_VRF.coordinator,
    keyHash: env.VRF_KEY_HASH || SEPOLIA_VRF.keyHash,
    subscriptionId: BigInt(env.VRF_SUBSCRIPTION_ID || 0),
    nativePayment: env.VRF_NATIVE_PAYMENT !== 'false',
  };
}

// 2. L'usine (elle crée son abonnement Chainlink si aucun n'est fourni).
const factory = await deploy('BlockLuckyFactory', vrf.coordinator, vrf.keyHash, vrf.subscriptionId, vrf.nativePayment);
const deployBlock = (await factory.deploymentTransaction().wait()).blockNumber;
const subscriptionId = await factory.subscriptionId();
console.log(`Usine à tirages : ${await factory.getAddress()} (abonnement oracle n° ${subscriptionId})`);

// 3. Réserve de l'oracle : sur Sepolia, Chainlink est payé à chaque tirage.
const fund = name === 'local' ? '1' : env.VRF_FUND_ETH;
if (fund && Number(fund) > 0) {
  await (await factory.fundOracle({ value: parseEther(fund) })).wait();
  console.log(`Réserve de l'oracle alimentée : ${fund} ETH`);
} else if (name !== 'local') {
  console.warn('⚠ Réserve de l’oracle vide : alimente-la depuis l’Espace admin, ou relance avec VRF_FUND_ETH=0.1 dans .env.');
}

// 4. Premier tirage.
await (await factory.createLottery(DRAW.duration, DRAW.capacity, DRAW.maxPerPlayer)).wait();
console.log(`Premier tirage créé : ${DRAW.capacity} tickets, ${DRAW.maxPerPlayer} max par joueur, ${DRAW.duration / 60} min`);

// 5. Configuration lue par le site et par le serveur.
const config = {
  network: name,
  chainId: Number(network.chainId),
  rpcUrl: name === 'local' ? target.rpc : undefined, // l'URL Sepolia peut contenir une clé d'API : elle reste dans .env
  deployBlock,
  owner: await signer.getAddress(),
  factory: await factory.getAddress(),
  vrf: { mode: vrf.mode, coordinator: vrf.coordinator, subscriptionId: subscriptionId.toString(), nativePayment: vrf.nativePayment },
  abi: {
    factory: compiled.BlockLuckyFactory.abi,
    lottery: compiled.BlockLucky.abi,
    coordinator: compiled.VRFCoordinatorMock.abi,
  },
};
writeFileSync(env.CONTRACT_FILE || new URL('../public/contract.json', import.meta.url), JSON.stringify(config, null, 2));

console.log(`Administrateur (propriétaire de l'usine) : ${config.owner}`);
if (target.explorer) console.log(`Voir sur l'explorateur : ${target.explorer}/address/${config.factory}`);
if (vrf.mode === 'chainlink') console.log(`Abonnement Chainlink : https://vrf.chain.link/sepolia/${subscriptionId}`);

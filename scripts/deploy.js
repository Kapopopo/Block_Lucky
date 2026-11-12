// Déploiement du contrat BlockLucky.
//   npm run deploy          → blockchain locale Ganache (31337), compte déverrouillé
//   npm run deploy:sepolia  → testnet public Sepolia (11155111), clé lue dans .env
import { JsonRpcProvider, ContractFactory, Wallet, formatEther } from 'ethers';
import { writeFileSync } from 'node:fs';
import { compile } from './compile.js';

const NETWORKS = {
  local: { chainId: 31337n, rpc: process.env.RPC_URL || 'http://127.0.0.1:8545' },
  sepolia: { chainId: 11155111n, rpc: process.env.SEPOLIA_RPC_URL, explorer: 'https://sepolia.etherscan.io' },
};

const DURATION = 3600; // 1 heure
const CAPACITY = 100;

const name = process.argv.includes('--network') ? process.argv[process.argv.indexOf('--network') + 1] : 'local';
const target = NETWORKS[name];
if (!target) throw new Error(`Réseau inconnu : ${name}. Choix : ${Object.keys(NETWORKS).join(', ')}.`);
if (!target.rpc) throw new Error('SEPOLIA_RPC_URL manquant dans .env (voir .env.example).');

const provider = new JsonRpcProvider(target.rpc);
const network = await provider.getNetwork();
// Garde-fou : on refuse tout autre réseau, en particulier le réseau principal avec de vrais ETH.
if (network.chainId !== target.chainId) {
  throw new Error(`Réseau attendu ${target.chainId}, reçu ${network.chainId}. Déploiement annulé.`);
}

let signer;
if (name === 'local') {
  signer = await provider.getSigner(); // compte de test déverrouillé par Ganache
} else {
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error('DEPLOYER_PRIVATE_KEY manquant dans .env (voir .env.example).');
  signer = new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const balance = await provider.getBalance(signer.address);
  console.log(`Compte ${signer.address} · solde ${formatEther(balance)} ETH de test`);
  if (balance === 0n) throw new Error('Solde nul : récupérez des ETH Sepolia gratuits sur un faucet.');
}

const compiled = compile();
const contract = await new ContractFactory(compiled.abi, compiled.evm.bytecode.object, signer).deploy(DURATION, CAPACITY);
await contract.waitForDeployment();
// Bloc de création : l'interface lit l'historique à partir de ce bloc (les RPC publics limitent la plage lue).
const deployBlock = (await contract.deploymentTransaction().wait()).blockNumber;

const config = { address: await contract.getAddress(), chainId: Number(network.chainId), network: name, deployBlock, abi: compiled.abi };
writeFileSync(new URL('../public/contract.json', import.meta.url), JSON.stringify(config, null, 2));

console.log(`Contrat déployé sur ${name} : ${config.address}`);
if (target.explorer) console.log(`Voir sur l'explorateur : ${target.explorer}/address/${config.address}`);

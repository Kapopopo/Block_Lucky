// Remet la démo à zéro dans le fichier d'état (DATA_FILE, sinon data/state.json), après en avoir fait une copie.
// Le serveur garde l'état en mémoire : lance ce script serveur arrêté, ou utilise le bouton de l'Espace admin.
// Usage : npm run reset:demo
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetDemoData } from '../server/reset.js';
import { STARTING_BALANCE } from '../server.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = process.env.DATA_FILE || path.join(root, 'data/state.json');
if (!existsSync(file)) {
  console.log('Aucune donnée démo : rien à remettre à zéro.');
  process.exit(0);
}
const backup = file.replace(/\.json$/, `.avant-reset-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
copyFileSync(file, backup);
const state = JSON.parse(readFileSync(file, 'utf8'));
resetDemoData(state, { startingBalance: STARTING_BALANCE });
writeFileSync(file, JSON.stringify(state));
console.log(`Démo remise à zéro : tirage n° 1, historique et statistiques vides, ${Object.keys(state.accounts).length} compte(s) conservé(s) avec 1 ETH fictif.`);
console.log(`Copie de l'ancien état : ${path.relative(root, backup)}`);

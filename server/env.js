// Lecture minimale d'un fichier .env (CLÉ=valeur), sans dépendance externe.
import { existsSync, readFileSync } from 'node:fs';

export function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue; // ligne vide ou commentaire
    const [, key, raw] = match;
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    if (!(key in process.env)) process.env[key] = value; // une variable déjà définie a priorité
  }
}

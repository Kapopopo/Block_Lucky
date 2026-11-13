// Mots de passe : jamais stockés en clair. On garde une « empreinte » scrypt salée.
// scrypt est volontairement lent et gourmand en mémoire, ce qui freine les attaques par essais successifs.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex'); // sel unique : deux mots de passe identiques donnent deux empreintes différentes
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  // Comparaison en temps constant : ne révèle pas combien de caractères sont justes.
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

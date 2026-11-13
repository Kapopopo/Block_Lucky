// Protections du serveur : limitation du nombre de requêtes et politique de sécurité du contenu (CSP).
import { createHash } from 'node:crypto';

/**
 * Limite le nombre de requêtes par adresse IP sur une fenêtre de temps (compteurs en mémoire).
 * Protège l'inscription, la connexion, les signatures, les achats et le robinet contre les robots.
 * Au-delà : réponse 429 avec l'en-tête Retry-After (nombre de secondes avant de pouvoir réessayer).
 */
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'inconnu';
    const entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      hits.set(key, { count: 1, reset: now + windowMs });
    } else if (++entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); // ménage des vieilles entrées
    next();
  };
}

/**
 * Politique de sécurité du contenu : le navigateur n'exécute que les scripts du site (et le petit script du thème,
 * autorisé par son empreinte), ne contacte que le site lui-même, et refuse d'afficher le site dans un cadre.
 * Les polices viennent de Google Fonts. Les styles en ligne restent permis (attributs style="--i:…").
 */
export function contentSecurityPolicy(indexHtml) {
  const inline = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(([, code]) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src 'self' ${inline.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

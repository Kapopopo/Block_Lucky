// « Sign-In with Ethereum » (EIP-4361) : se connecter en signant un message avec son portefeuille.
// Pas de mot de passe : la signature prouve que l'on possède la clé secrète de l'adresse.
// Signer est gratuit et ne déclenche aucune transaction.
import { getAddress, verifyMessage } from 'ethers';

/** Construit le message standard que MetaMask affiche comme une « demande de connexion ». */
export function createSiweMessage({ domain, uri, address, chainId, nonce, issuedAt = new Date(), ttlMs = 10 * 60 * 1000 }) {
  const expiration = new Date(issuedAt.getTime() + ttlMs);
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    getAddress(address),
    '',
    'Connexion a BlockLucky. Signature gratuite : aucune transaction, aucun frais.',
    '',
    `URI: ${uri}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiration.toISOString()}`,
  ].join('\n');
}

/** Vrai si la signature du message a bien été produite par l'adresse attendue. */
export function verifySiwe(message, signature, expectedAddress) {
  try {
    return getAddress(verifyMessage(message, signature)) === getAddress(expectedAddress);
  } catch {
    return false;
  }
}

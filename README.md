# BlockLucky ✳

Loterie pédagogique de la ville fictive d’EtherBay, réalisée à partir du brief « KO Projet BlockLucky-3 ». Interface française, thème sombre noir et violet, avec animations et respect de la préférence de réduction des mouvements, responsive mobile/ordinateur.

## Lancer l’application

Prérequis : Node.js 20 ou supérieur et npm.

```bash
npm install
npm run dev
```

Ouvrir **http://localhost:3000**. Aucun compte, portefeuille externe ou clé API n’est nécessaire en démonstration. `npm start` lance le serveur sans surveillance de fichiers. La variable `PORT` change le port. Le serveur écoute uniquement sur l’interface locale.

## Fonctionnalités

- Tableau de bord : cagnotte, compte à rebours, capacité, participants et chances.
- Achat de 1 à 20 tickets à 0,01 ETH fictif, avec validation côté serveur.
- Estimation de la part après achat, quantité maximale selon le solde et les places, et choix de quantité mémorisé dans le navigateur.
- Export CSV des tickets et des résultats ; recherche par tirage ou adresse et filtre « Mes victoires ».
- Récapitulatif avant confirmation, contrôle du numéro de tirage et références des opérations.
- Historique personnel des achats et gains (100 opérations récentes), filtrable dans Mes tickets.
- Numéros de tickets dans le tirage pour le mode serveur et export du rappel de clôture au format calendrier `.ics`.
- Navigation par URL avec retour navigateur.
- Mes tirages : 100 participations récentes, statuts en cours/gagné/terminé, numéros conservés et détail du ticket gagnant.
- Notifications de résultat dans l’application (50 récentes), avec lecture synchronisée côté serveur.
- Reçus JSON privés téléchargeables pour les 100 derniers achats, avec numéros, montant et référence.
- Protection contre le double débit lors du renvoi d’une même requête d’achat (références conservées avec les 100 derniers reçus).
- Portefeuille de démonstration crédité initialement de 1 ETH fictif.
- Tirage automatique à 100 tickets ou après une heure, traité au prochain appel API ; la page actualise les données toutes les dix secondes.
- Générateur aléatoire `crypto.randomInt` en démonstration et crédit intégral de la cagnotte au gagnant.
- Historique des tirages et activité récente, pages Mes tickets, Paramètres et guide.
- Sessions avec cookie HttpOnly/SameSite ; stockage persistant dans `data/state.json`, écrit atomiquement. Les soldes sont calculés en unités entières de 0,01 ETH pour éviter les erreurs d’arrondi.
- Connexion MetaMask à un contrat Solidity sur Ganache : achat, programmation, tirage, retrait et remboursement après expiration.

Les archives et notifications persistantes sont disponibles en mode serveur. Le mode blockchain affiche la participation au contrat courant, son résultat et les reçus fondés sur les transactions du portefeuille connecté ; il ne dispose pas d’un indexeur multi-contrats. Les notifications sont internes à l’application, sans e-mail ni autorisation système. Les anciens achats antérieurs à l’ajout des reçus ne disposent pas rétroactivement de reçu détaillé.

Le solde et les tickets sont associés au cookie du navigateur : effacer les cookies crée une nouvelle session. Il n’y a pas de compte utilisateur ni de récupération de portefeuille démo. Les données de démonstration et les données blockchain sont indépendantes. Le serveur démo doit tourner en **une seule instance** ; le fichier JSON n’est pas une base adaptée à un déploiement distribué ou à 10 000 utilisateurs simultanés.

## Tester le smart contract localement

Dans trois terminaux :

```bash
# Terminal 1 : blockchain locale de test
npm run chain

# Terminal 2 : compilation Solidity et déploiement
npm run deploy

# Terminal 3 : application
npm run dev
```

Le déploiement utilise un compte déverrouillé Ganache et refuse tout réseau autre que **31337**. L’adresse et l’ABI sont écrites dans `public/contract.json`. Il n’y a pas de clé privée dans le code. Ganache affiche des comptes de test déterministes : importer l’un de ces comptes dans un profil MetaMask de développement. Ne jamais utiliser ces clés pour détenir des fonds réels.

Configurer MetaMask : RPC `http://127.0.0.1:8545`, identifiant `31337`, symbole `ETH`. Ouvrir « Paramètres » en bas de page, puis choisir « Blockchain locale » et autoriser la connexion. Si nécessaire, recharger après le déploiement. Après un redémarrage de Ganache, redéployer le contrat puis recharger l’application ; réinitialiser l’activité MetaMask si les nonces sont obsolètes.

Le contrat représente **un tirage** : durée 1 heure, capacité 100 tickets, 0,01 ETH par ticket. Après expiration de la durée, n’importe qui appelle `scheduleDraw()` depuis les Paramètres ; atteindre la capacité programme automatiquement le tirage. `draw()` devient disponible après le bloc programmé (`drawBlock = block de programmation + 2`). Ganache mine à chaque transaction : pour avancer pendant une démo, lancer trois fois :

```bash
curl -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":1}'
```

Le gagnant appelle `withdraw()` pour recevoir la cagnotte. Si personne n’a effectué le tirage dans la fenêtre des 256 blocs suivants, chaque acheteur peut appeler `refund()` puis `withdraw()`. Le contrat empêche les retraits et remboursements doubles. Pour une nouvelle édition blockchain, déployer un nouveau contrat. Le mode démo, lui, enchaîne automatiquement les éditions.

### Limite de l’aléatoire blockchain

Ce contrat est **un prototype pédagogique à ethers fictifs, sans audit**. Le hash d’un bloc futur peut être biaisé par un validateur. Ce mécanisme ne garantit pas l’impartialité requise pour une loterie avec de vrais enjeux. Voir la [documentation de sécurité Solidity](https://docs.soliditylang.org/en/latest/security-considerations.html#private-information-and-randomness). Une exploitation publique demanderait un oracle VRF vérifiable, une stratégie d’expiration adaptée à cet oracle, un audit indépendant et l’analyse du cadre applicable. Ne pas envoyer d’argent réel.

## Validation

```bash
npm test
```

Les tests exécutent réellement le contrat compilé sur une blockchain Ganache éphémère : paiement incorrect, quantités invalides, clôture, tirage, retrait unique, expiration et remboursement. Les tests HTTP utilisent des fichiers temporaires et couvrent les achats, le débit, la capacité et le règlement temporel. Ils couvrent également les achats rejoués, les archives personnelles, les reçus privés et la lecture des notifications. Ils ne modifient pas les données de l’application.

## Structure

```text
public/          Interface HTML/CSS/JS, ethers servi localement
server.js        Serveur Express et API de démonstration
contracts/       Smart contract Solidity
scripts/         Compilation et déploiement local
test/            Tests HTTP et blockchain
docs/           Notes de soutenance
data/           État démo généré, ignoré par Git
```

Aucune compilation frontend n’est requise. Les polices Google Fonts sont optionnelles ; l’interface utilise des polices système si elles ne sont pas disponibles. Aucun actif visuel externe n’est requis.

## API de démonstration

- `GET /api/state` : session, état du tirage, solde, activité et historique.
- `POST /api/tickets` avec `{"quantity": 5, "round": 1, "requestId": "0123456789abcdef0123456789abcdef"}` : achat avec contrôle du tirage et référence anti-doublon. L’interface génère cette référence automatiquement.
- `GET /api/receipts/:id` : reçu du propriétaire de la session uniquement.
- `POST /api/notifications/read` avec `{"ids": ["identifiant"]}` : marquer les notifications consultées comme lues.
- `GET /contract-source` : source Solidity lisible.

## Livrable de soutenance

Voir [docs/SOUTENANCE.md](docs/SOUTENANCE.md) pour le scénario de présentation, la réponse aux attentes de la ville, les indicateurs et les limites.

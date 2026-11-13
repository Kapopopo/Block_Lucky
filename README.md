# BlockLucky ✳

Loterie pédagogique de la ville fictive d’EtherBay, réalisée à partir du brief « KO Projet BlockLucky-3 ». Interface française de type « dashboard wallet » vert émeraude, thèmes clair et sombre, animations respectant la préférence de réduction des mouvements, responsive mobile/ordinateur. **Aucun argent réel : uniquement des ETH fictifs ou de test.**

## Lancer l’application

Prérequis : Node.js 20 ou supérieur et npm.

```bash
npm install
npm run dev
```

Ouvrir **http://localhost:3000**. Le mode démo fonctionne sans portefeuille ni clé : il suffit de créer un compte, qui reçoit 1 ETH fictif (un invité a un portefeuille vide). `npm start` lance le serveur sans surveillance de fichiers. La variable `PORT` change le port. Par défaut, le serveur écoute uniquement sur l’interface locale ; `HOST=0.0.0.0` dans `.env` l’ouvre aux appareils du même Wi-Fi (pour jouer depuis un téléphone, à réserver à un réseau de confiance).

## Fonctionnalités

### Pour les joueurs
- **Deux modes** : démo (crédits fictifs tenus par le serveur) et blockchain (MetaMask + smart contracts, sur Ganache ou Sepolia).
- Achat de 1 à 20 tickets à 0,01 ETH, récapitulatif avant confirmation, protection contre le double débit.
- **Limite de tickets par joueur** et par tirage (25 par défaut), affichée sous le sélecteur et vérifiée par le serveur et par le contrat.
- **Compte joueur** (pseudo, e-mail, mot de passe) : obligatoire pour jouer en démo, il reçoit 1 ETH fictif de bienvenue. Solde et tickets retrouvés sur tous les appareils.
- **Connexion avec Ethereum** (Sign-In with Ethereum), en mode blockchain uniquement : signature gratuite qui prouve la possession d’une adresse. En mode démo, MetaMask n’est jamais sollicité : un bouton mène au choix « Blockchain » des Réglages.
- **Tuto MetaMask**, trois parcours qui se valident tout seuls, choisis automatiquement selon l’appareil :
  - **Extension** (ordinateur) : installation, réseau, signature, ETH de test, première partie ;
  - **App mobile** : ouvrir BlockLucky dans le navigateur de l’app MetaMask (lien direct ou QR code si le site est en https, sinon adresse à taper ; en local, adresse Wi-Fi du PC) ;
  - **Application web** (portfolio.metamask.io) : c’est un tableau de bord qui ne signe pas pour les autres sites et n’affiche pas les réseaux de test ; le tuto fait retrouver le même compte dans l’extension et vérifie que l’adresse correspond.
- **Robinet BlockLucky** : envoi d’ETH de test, une fois par adresse vérifiée.
- **Temps réel** : achats, tirages, annulations et annonces arrivent instantanément (Server-Sent Events).
- Tuto guidé avec projecteur, infobulles « ? », lexique, messages d’erreur du contrat traduits.
- Mes tickets, Mes tirages, Mes opérations, reçus JSON, export CSV, rappel calendrier `.ics`, notifications.
- **Données personnelles** : page d’information (barre latérale et inscription), « Télécharger mes données » (JSON), « Supprimer mon compte » (avec mot de passe, le pseudo disparaît aussi des résultats), « Mot de passe oublié » (lien à usage unique valable 30 minutes ; prototype sans service d’e-mail : le lien s’affiche dans la console du serveur).

### Pour l’administrateur
- **Espace admin** : règles des tirages (tickets, durée, limite par joueur), création d’un tirage blockchain, annulation avec remboursement de tous, annonces, statistiques, réserve de l’oracle.
- **QR codes à imprimer** (Espace admin) : « Créer un QR code » pour chaque lieu de la ville (lieu, lien, message facultatif), avec aperçu en direct. Les QR codes sont enregistrés sur le serveur et se réimpriment quand on veut : « Imprimer l’affiche » (une affiche A4 par lieu, avec les étapes pour jouer), « Tout imprimer », ou « Image PNG ». Si le site tourne sur cet ordinateur, le lien proposé est l’adresse Wi-Fi (`HOST=0.0.0.0`), et un avertissement apparaît si le lien ne peut pas s’ouvrir depuis un téléphone.
- L’admin **ne peut pas** choisir le gagnant, clôturer avant l’heure ou prendre la cagnotte.
- **Remise à zéro de la démo** (Espace admin, double confirmation) : retour au tirage n° 1, historique et statistiques vidés, comptes conservés avec 1 ETH fictif. Serveur arrêté : `npm run reset:demo` (une copie de l’ancien état est gardée dans `data/`). La blockchain locale, elle, repart de zéro en relançant `npm run chain` puis `npm run deploy`.
- Démo : le premier compte créé est administrateur (ou les e-mails de `ADMIN_EMAILS`). Blockchain : le propriétaire de l’usine à tirages (le compte qui a déployé).

### Frais réduits et clôture automatique
- **Tirages « clones »** : l’usine déploie une seule fois un tirage modèle, puis chaque nouveau tirage en est une copie légère (proxy EIP-1167 de 45 octets) configurée une seule fois. Créer un tirage coûte environ **271 000 gas au lieu de 7 millions** (26 fois moins), et le déploiement complet 2,5 millions au lieu de 15.
- **Remboursement en une transaction** : après une annulation, « Me faire rembourser » renvoie directement la mise sur le portefeuille (35 000 gas). Les contrats déployés avant cette version gardent l’ancien fonctionnement (créditer, puis retirer) : le site gère les deux.
- **Clôture automatique** : l’usine est compatible **Chainlink Automation** (`checkUpkeep` / `performUpkeep`). À l’échéance, l’action due est exécutée sans que personne n’ait à cliquer : demander le hasard s’il y a des tickets, annuler si l’oracle reste muet une heure. N’importe qui peut l’exécuter, mais le contrat revérifie toujours la condition. En local, et sur Sepolia quand une clé est configurée (`AUTO_CLOSE`), c’est le serveur BlockLucky qui joue ce rôle ; sinon, enregistrer une tâche « Custom logic » sur l’adresse de l’usine dans [automation.chain.link](https://automation.chain.link) (payée en LINK de test). Le bouton « Demander le tirage » reste disponible.

### Sécurité
- Limites de requêtes par adresse IP (inscription, connexion, mot de passe oublié, signatures, achats, robinet) : réponse 429 avec `Retry-After`.
- Politique de sécurité du contenu (CSP) : seuls les scripts du site s’exécutent (le petit script du thème est autorisé par son empreinte), aucune connexion vers un autre site, affichage dans un cadre interdit. `CSP=off` la désactive pour un diagnostic.
- Mots de passe hachés avec scrypt et sel unique, blocage après 5 erreurs, cookie de session `HttpOnly` et `SameSite=Strict`, contrôle anti-CSRF de l’origine, signatures Ethereum à usage unique.

### Hasard vérifiable
Le gagnant est désigné par **Chainlink VRF v2.5** : un nombre aléatoire accompagné d’une preuve cryptographique vérifiée par le contrat. Le ticket gagnant = reste de la division de ce nombre par le nombre de tickets, recalculable par tous (fenêtre « Détails » d’un résultat). En local, il n’existe pas de nœud Chainlink : un contrat d’imitation (`VRFCoordinatorMock`) est déployé et le serveur BlockLucky répond à la place de l’oracle.

## Jouer sur la blockchain locale (Ganache)

Dans trois terminaux :

```bash
npm run chain    # Terminal 1 : blockchain locale de test
npm run deploy   # Terminal 2 : oracle simulé + usine à tirages + premier tirage
npm run dev      # Terminal 3 : application
```

Le déploiement refuse tout réseau autre que **31337** et écrit les adresses et ABI dans `public/contract.json`. Il n’y a aucune clé privée dans le code. Importer dans un profil MetaMask de développement l’un des comptes de test affichés par Ganache (le compte n° 0 est l’administrateur). Ne jamais utiliser ces clés pour de vrais fonds. Après un redémarrage de Ganache : redéployer, recharger la page et réinitialiser l’activité MetaMask si les nonces sont obsolètes.

Depuis un téléphone (app MetaMask, même Wi-Fi) : mettre `HOST=0.0.0.0` dans `.env`, lancer Ganache avec `npm run chain:lan` au lieu de `npm run chain`, puis suivre le tuto « App mobile », qui affiche l’adresse à taper dans le navigateur de l’app. Le réseau ajouté à MetaMask pointe alors vers l’adresse Wi-Fi du PC. Sur Sepolia, seul `HOST` est nécessaire.

Déroulé d’un tirage blockchain :
1. Les ventes sont ouvertes jusqu’à l’échéance ou jusqu’au dernier ticket.
2. Au dernier ticket, ou automatiquement à l’échéance (clôture automatique, ou bouton « Demander le tirage »), le contrat demande un nombre aléatoire à l’oracle.
3. L’oracle répond (quelques secondes en local, 1 à 2 minutes sur Sepolia) : le gagnant est désigné automatiquement.
4. Le gagnant clique « Retirer mes gains ». L’admin crée le tirage suivant depuis l’Espace admin.
5. Si l’oracle ne répond pas dans l’heure, le tirage est annulé automatiquement (ou par n’importe qui) ; l’admin peut annuler avant le résultat. Chaque joueur récupère alors sa mise en un clic.

Pour avancer le temps pendant une démo locale :

```bash
curl -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"evm_increaseTime","params":[3601],"id":1}'
curl -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":2}'
```

## Déployer sur le testnet Sepolia

Sepolia est une blockchain publique de test : tout est visible sur [sepolia.etherscan.io](https://sepolia.etherscan.io), mais l’ETH n’a aucune valeur.

1. Créer dans MetaMask un compte **dédié aux tests** et le créditer via un faucet Sepolia (le tuto MetaMask de l’application en propose).
2. Copier `.env.example` en `.env` et renseigner `SEPOLIA_RPC_URL` et `DEPLOYER_PRIVATE_KEY`. Le fichier `.env` est ignoré par git.
3. Facultatif : `VRF_FUND_ETH=0.1` pour alimenter tout de suite la réserve de l’oracle (sinon depuis l’Espace admin).
4. Lancer `npm run deploy:sepolia`. Le script refuse tout autre réseau que 11155111, crée l’abonnement Chainlink de l’usine et affiche les liens Etherscan et vrf.chain.link.
5. Lancer `npm run dev`, choisir Sepolia dans MetaMask, puis le mode Blockchain dans les Réglages.

Coordinateur Chainlink VRF v2.5 sur Sepolia : `0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B`, voie de gaz 500 gwei (source : [docs.chain.link](https://docs.chain.link/vrf/v2-5/supported-networks)). Chaque tirage consomme un peu d’ETH de test de la réserve ; si elle est vide, la demande reste en attente jusqu’à ce qu’on l’alimente.

Ne jamais mettre dans `.env` la clé d’un compte qui détient de vrais fonds.

## Validation

```bash
npm test
```

48 tests automatiques, qui ne touchent pas aux données de l’application :
- **Contrats** (Ganache éphémère + oracle simulé) : paiement exact, limite par joueur, demande et réponse de l’oracle, seul le coordinateur peut répondre, retrait unique, annulation admin, remboursement en une transaction, oracle muet, création de tirages par l’usine (clones configurés une seule fois, moins de 400 000 gas), clôture automatique, réserve de l’oracle.
- **Robot de clôture** : de bout en bout sur une vraie blockchain Ganache, échéance passée → tirage demandé → oracle simulé → gagnant.
- **Sécurité** : mot de passe oublié (lien à usage unique), export et suppression du compte, limites de requêtes, CSP.
- **API** : achats, débit, capacité, tirage à l’échéance, achats rejoués, reçus, notifications, anti-CSRF.
- **Nouveautés** : comptes et blocage après 5 mauvais mots de passe, droits admin, réglages, annulation, annonces, QR codes à imprimer, connexion avec Ethereum (signature et anti-rejeu), robinet, temps réel.

## Structure

```text
public/          Interface : index.html, style.css, app.js (données et rendu), common.js (outils),
                 account.js (compte), onboarding.js (tuto MetaMask), admin.js (espace admin),
                 fx.js (effets), tour.js (visite guidée)
server.js        Serveur Express et API
server/          env.js, passwords.js (scrypt), siwe.js (connexion Ethereum),
                 realtime.js (SSE), chain.js (surveillance, oracle local, clôture automatique, robinet),
                 security.js (limites de requêtes, CSP), reset.js (remise à zéro de la démo)
contracts/       BlockLucky.sol (un tirage, cloné), BlockLuckyFactory.sol (usine, client VRF, Automation),
                 IVRFCoordinatorV2Plus.sol (interface Chainlink), VRFCoordinatorMock.sol (local)
scripts/         Compilation et déploiement
test/            Tests contrats, API et nouveautés
docs/            Notes de soutenance
data/            État démo généré, ignoré par Git
```

Variables d’environnement utiles : `PORT`, `DATA_FILE` (fichier d’état démo), `CONTRACT_FILE` (configuration des contrats), et celles décrites dans `.env.example`.

## API

- `GET /api/state` : tirage démo courant, solde, activité, historique, règles.
- `POST /api/tickets` `{"quantity", "round", "requestId"}` : achat (limite par joueur, anti-doublon).
- `GET /api/session` : compte, adresse vérifiée, rôle admin, annonces, état du robinet.
- `POST /api/account/register` · `/login` · `/logout` : comptes (mots de passe hachés avec scrypt).
- `POST /api/account/forgot` puis `/api/account/reset` : mot de passe oublié. `GET /api/account/export` et `POST /api/account/delete` : export et suppression des données.
- `POST /api/wallet/challenge` puis `/api/wallet/verify` : connexion avec Ethereum (EIP-4361).
- `POST /api/faucet` : ETH de test pour l’adresse vérifiée, une fois.
- `GET /api/stream` : flux temps réel (Server-Sent Events).
- `GET /api/admin/stats`, `POST /api/admin/settings`, `POST /api/admin/cancel`, `POST /api/admin/reset`, `POST|DELETE /api/admin/announcements`, `GET|POST|DELETE /api/admin/posters` (QR codes) : espace admin.
- `GET /api/receipts/:id`, `POST /api/notifications/read`, `GET /contract-source`, `GET /contract.json`.

## Limites connues

- Prototype pédagogique sans audit : ne jamais l’utiliser avec de l’argent réel (une loterie payante est par ailleurs très réglementée en France).
- Le mode démo reste centralisé : son historique n’est pas une preuve blockchain. Un serveur unique et un fichier JSON ne conviennent pas à 10 000 joueurs simultanés.
- Sans vérification d’e-mail, une personne peut créer plusieurs comptes ; aucun e-mail n’est réellement envoyé (le lien « mot de passe oublié » s’affiche dans la console du serveur).
- Sur Sepolia, la clôture automatique suppose que le serveur tourne avec une clé, ou qu’une tâche Chainlink Automation soit enregistrée et alimentée en LINK.
- Les limites de requêtes sont gardées en mémoire, par serveur : avec plusieurs serveurs, il faudrait un stockage partagé.

## Livrable de soutenance

Voir [docs/SOUTENANCE.md](docs/SOUTENANCE.md) pour le scénario de présentation, la réponse aux attentes de la ville, les indicateurs et les limites.

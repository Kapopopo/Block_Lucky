# BlockLucky : présentation du projet

*Loterie de fin d’année de la ville d’EtherBay, prototype pédagogique, novembre 2026.*

## 1. En bref

EtherBay veut une animation de fin d’année qui fasse découvrir la blockchain à ses habitants. BlockLucky est une loterie en ligne : on achète des tickets, un tirage au sort désigne un gagnant, qui remporte toute la cagnotte.

L’intérêt n’est pas la loterie elle-même. Il s’agit de **montrer, en jouant, ce qu’apporte un smart contract** :

- des règles écrites dans un programme public, que personne ne peut modifier en cours de partie ;
- un hasard que chacun peut vérifier ;
- un organisateur qui ne peut ni choisir le gagnant ni toucher à la cagnotte.

Le site se découvre sans rien installer (mode démo). Il se joue ensuite sur une vraie blockchain de test avec MetaMask (mode blockchain). **Aucun argent réel n’est jamais en jeu.**

## 2. Deux façons de jouer

| | Mode démo | Mode blockchain |
| --- | --- | --- |
| Pour qui | Tout le monde, en un clic | Les curieux qui veulent aller plus loin |
| Ce qu’il faut | Un compte gratuit (pseudo, e-mail, mot de passe) | L’extension ou l’app MetaMask |
| Argent | 1 ETH fictif offert à l’inscription | ETH de test (gratuits, sans valeur) |
| Où sont les règles | Sur le serveur BlockLucky | Dans le smart contract, sur Ganache (local) ou Sepolia (réseau de test public) |
| Le hasard | Tiré par le serveur | Fourni par Chainlink VRF, avec une preuve vérifiée par le contrat |
| Ce qui reste | Un historique sur le serveur, effaçable | Des transactions publiques et définitives |

Le mode démo sert de porte d’entrée. Le mode blockchain montre la même expérience, mais cette fois sans tiers de confiance.

## 3. Liste des fonctionnalités

### Jouer
- **Tableau de bord** : cagnotte, compte à rebours, tickets vendus, portefeuille et derniers achats en direct.
- **Achat de tickets** : de 1 à 20 tickets par achat, à 0,01 ETH le ticket, avec un récapitulatif avant de confirmer. Les tirages ont une limite de tickets par joueur.
- **Tirage automatique à l’échéance** : personne n’a besoin de cliquer. Le gagnant est révélé avec une animation.
- **Mes tickets** : les numéros du tirage en cours et le résultat de chacun (gagné ou perdu). Le compteur de la barre latérale ne compte que les tickets d’un tirage encore en cours.
- **Mes tirages et Mes opérations** : l’historique personnel, les gains et les remboursements.
- **Reçus** : un reçu par achat (fichier JSON), un export CSV des opérations et un rappel du tirage à ajouter à son agenda (fichier `.ics`).
- **Notifications** : ticket acheté, tirage gagné ou perdu, tirage annulé, annonces de la mairie.
- **Résultats** : les tirages passés, avec le bouton « Détails » pour refaire soi-même le calcul du ticket gagnant.
- **Temps réel** : achats, tirages et annonces apparaissent instantanément chez tous les joueurs.
- **Confort** : thème clair ou sombre, site adapté au téléphone, page des règles, animations réduites si le système le demande.

### Compte
- **Invité** : on peut tout visiter, mais le portefeuille est vide. Pour acheter, il faut créer un compte.
- **Inscription** : 1 ETH fictif offert, une seule fois.
- **Connexion** depuis n’importe quel appareil, avec un blocage temporaire après 5 mauvais mots de passe.
- **Mot de passe oublié** : un lien à usage unique, valable 30 minutes.
- **Mes données** : télécharger toutes ses données (fichier JSON) et supprimer son compte. Le pseudo disparaît alors aussi des résultats publiés.
- **Page « Données personnelles »** : ce qui est conservé, pourquoi, combien de temps, et ce qui ne s’efface pas.

### MetaMask
- **Passage au mode blockchain** depuis les Réglages. En mode démo, MetaMask n’est jamais sollicité : le bouton redirige vers le mode blockchain.
- **Bouton de compte** : une fois MetaMask connecté, il affiche l’adresse courte avec un renard, et propose un bouton de déconnexion.
- **Connexion avec Ethereum** : on prouve qu’on possède une adresse en signant un message, sans mot de passe et sans frais.
- **Tuto MetaMask en trois parcours**, qui se valide tout seul étape par étape et disparaît une fois terminé :
  - **extension** de navigateur (ordinateur) ;
  - **app mobile** : navigateur intégré à l’app, lien direct et QR code pour ouvrir le site depuis le téléphone ;
  - **application web** (MetaMask Portfolio) : retrouver le même compte dans l’extension.
- **Robinet** : 0,02 ETH de test offerts pour commencer à jouer, avec une limite par jour.

### Sur la blockchain
- **Usine à tirages** : un contrat qui crée chaque nouveau tirage comme une copie légère d’un modèle. Créer un tirage coûte 26 fois moins cher qu’avant.
- **Hasard vérifiable** avec Chainlink VRF. En local, un oracle simulé joue ce rôle.
- **Clôture automatique** à l’échéance, compatible avec Chainlink Automation : le hasard est demandé, ou le tirage est annulé si l’oracle ne répond pas dans l’heure.
- **Retrait des gains** : le gagnant récupère la cagnotte sur son portefeuille.
- **Remboursement en un clic** si le tirage est annulé.
- **Liens Etherscan** pour vérifier chaque transaction sur Sepolia.
- **Deux réseaux** : Ganache sur l’ordinateur, ou Sepolia, le réseau de test public d’Ethereum.

### Espace admin
- **Règles des tirages** : nombre de tickets, durée, limite par joueur.
- **Créer un tirage blockchain**, réservé au propriétaire de l’usine.
- **Annuler un tirage** avant son résultat, avec une double confirmation : tous les joueurs sont remboursés.
- **Annonces** publiées en direct à tous les joueurs.
- **Statistiques** : visiteurs, comptes, joueurs, tickets vendus, tirages joués ou annulés, ETH redistribués.
- **Réserve de l’oracle** : son solde et un bouton pour l’alimenter.
- **Remise à zéro de la démo** : retour au tirage n° 1, les comptes sont conservés.
- **QR codes à imprimer** : une affiche A4 par lieu de la ville (lieu, lien, message). Les QR codes sont enregistrés et peuvent être réimprimés ou téléchargés en image PNG.

L’admin **ne peut pas** choisir le gagnant, clôturer les ventes avant l’heure ni prendre l’argent de la cagnotte.

### Sécurité
- Mots de passe hachés avec scrypt : le mot de passe n’est jamais stocké en clair.
- Cookie de session protégé (`HttpOnly`, `SameSite=Strict`) et contrôle anti-CSRF.
- Limites de requêtes contre les abus : inscription, connexion, achats, robinet…
- Politique de sécurité du contenu (CSP) : seuls les scripts du site peuvent s’exécuter, et le site ne peut pas être affiché dans le cadre d’un autre site.
- Signatures Ethereum à usage unique, pour empêcher qu’on les réutilise.
- 48 tests automatiques : contrats, serveur, robot de clôture, sécurité, QR codes.

## 4. Déroulé d’un tirage

1. **Ventes ouvertes** : les joueurs achètent leurs tickets. Chaque ticket reçoit un numéro.
2. **Fin des ventes** : au dernier ticket disponible, ou à l’échéance. La clôture est automatique.
3. **Demande de hasard** : le contrat demande un nombre aléatoire à l’oracle Chainlink.
4. **Réponse de l’oracle** : le nombre arrive avec une preuve mathématique. Le contrat vérifie la preuve, puis en déduit le ticket gagnant.
5. **Gain** : le propriétaire du ticket gagnant retire la cagnotte. Il n’y a aucune commission, mais chaque transaction coûte des frais de réseau.
6. **Si quelque chose bloque** : l’admin peut annuler avant le résultat. Le tirage est aussi annulé automatiquement si l’oracle ne répond pas dans l’heure. Chaque joueur récupère alors sa mise en un clic.

En mode démo, le déroulé est identique, mais c’est le serveur qui tire au sort.

## 5. Architecture

- **Site** : HTML, CSS et JavaScript, sans framework, découpé en modules (jeu, compte, tuto, admin, QR codes).
- **Serveur** : Node.js avec Express. Il gère :
  - le mode démo, dont l’état est enregistré dans un fichier JSON ;
  - les comptes et la connexion avec Ethereum ;
  - le temps réel ;
  - la surveillance de la blockchain, l’oracle local, le robot de clôture et le robinet.
- **Contrats** en Solidity :
  - `BlockLucky` : un tirage ;
  - `BlockLuckyFactory` : l’usine. Elle crée les tirages, parle à Chainlink VRF et suit le format Chainlink Automation.
- **Lien avec la blockchain** : la bibliothèque ethers.js, côté navigateur avec MetaMask et côté serveur.

Les clés privées des joueurs ne passent jamais par le serveur : c’est MetaMask qui signe.

## 6. Réponse aux parties prenantes

| Partie prenante | Attente | Réponse de BlockLucky |
| --- | --- | --- |
| Madame la Maire | Un événement fédérateur et accessible | Identité EtherBay, jeu sans argent réel, tuto guidé, affiches à QR code pour les lieux de la ville |
| Événementiel | Une expérience simple et vivante | Achat en quelques clics, résultats en direct, tirage automatique à l’heure prévue, annonces |
| DSI | Fiabilité, sécurité, coûts maîtrisés | Règles vérifiables, hasard prouvé, contrats testés, coûts réduits par les clones, protections web, RGPD |

**Coûts sur Sepolia**, en gas (les frais du réseau), avec le passage aux clones :

| Action | Avant | Maintenant |
| --- | --- | --- |
| Créer un tirage | 7,05 millions de gas (≈ 0,0106 ETH de test) | 271 000 de gas (≈ 0,0004 ETH de test) |
| Se faire rembourser | 2 transactions | 1 transaction (≈ 35 000 de gas) |

## 7. Limites assumées

- **Prototype sans audit** : les contrats ne doivent jamais servir avec de l’argent réel. En France, une loterie payante est d’ailleurs très réglementée.
- **Mode démo centralisé** : son historique est une simple base de données, pas une preuve blockchain.
- **Aucun e-mail réellement envoyé** : le lien « mot de passe oublié » s’affiche dans la console du serveur. Sans vérification d’e-mail, une personne peut créer plusieurs comptes.
- **Hasard en local** : il est simulé, car il n’y a pas de nœud Chainlink sur Ganache.
- **Clôture automatique sur Sepolia** : elle suppose que le serveur tourne avec une clé de test, ou qu’une tâche Chainlink Automation soit payée en LINK.
- **Montée en charge** : un serveur unique et un fichier JSON ne suffisent pas pour un grand événement public. Il faudrait une vraie base de données et plusieurs serveurs.
- **Accessibilité** : les bases sont en place (libellés, clavier, messages de statut), mais aucun audit complet n’a été réalisé.

## 8. Lexique

| Terme | Définition |
| --- | --- |
| **Abonnement VRF** | Compte chez Chainlink qui paie les demandes de hasard du contrat, en ETH ou en LINK. |
| **Adresse** | Identifiant public d’un compte Ethereum (par exemple `0xc13C…7A0c`). On peut la partager sans risque, comme un RIB. |
| **Admin (administrateur)** | Organisateur des tirages. En mode blockchain, c’est le propriétaire de l’usine à tirages. Il ne peut ni choisir le gagnant ni prendre la cagnotte. |
| **Anti-CSRF** | Protection qui empêche un autre site de faire agir le navigateur du joueur à sa place sur BlockLucky. |
| **Blockchain** | Registre partagé entre de nombreux ordinateurs. Ce qui y est écrit est public et ne peut plus être modifié. |
| **Bloc** | Paquet de transactions ajouté à la blockchain. Les blocs s’enchaînent, d’où le nom. |
| **Cagnotte** | Somme des mises d’un tirage. Elle revient entièrement au gagnant. |
| **Chainlink** | Réseau d’oracles qui apporte aux smart contracts des informations venues de l’extérieur, ici du hasard. |
| **Chainlink Automation** | Service Chainlink qui déclenche une action sur un contrat au bon moment, ici la clôture d’un tirage à l’échéance. |
| **Clé privée** | Secret qui permet de signer au nom d’une adresse. Quiconque la connaît contrôle le compte : on ne la donne jamais. |
| **Clone (EIP-1167)** | Copie ultra-légère d’un contrat modèle. Elle réutilise le code du modèle au lieu de le redéployer, ce qui réduit fortement les frais. |
| **Cookie de session** | Petit fichier que le navigateur garde pour que le site reconnaisse le joueur. BlockLucky n’en utilise qu’un, purement technique. |
| **CSP (Content Security Policy)** | Règle envoyée au navigateur, qui n’autorise que les scripts du site. Elle bloque les injections de code. |
| **Échéance** | Heure de fin des ventes d’un tirage. |
| **ETH (ether)** | Monnaie de la blockchain Ethereum. Elle sert aussi à payer les frais. |
| **ETH de test** | ETH d’un réseau de test comme Sepolia, gratuits et sans aucune valeur. |
| **ETH fictif** | Solde imaginaire du mode démo. Il n’existe que sur le serveur BlockLucky. |
| **Etherscan** | Site public qui affiche toutes les transactions et tous les contrats d’Ethereum, et de Sepolia. |
| **ethers.js** | Bibliothèque JavaScript qui permet au site et au serveur de parler à la blockchain. |
| **Express** | Outil Node.js qui sert à construire le serveur web et son API. |
| **Frais de réseau** | Prix payé pour chaque transaction, versé au réseau et pas à BlockLucky. Il ne se récupère pas. |
| **Gas** | Unité qui mesure le travail d’une transaction. Les frais valent le gas consommé multiplié par le prix du gas. |
| **Ganache** | Blockchain Ethereum qui tourne sur l’ordinateur, pour développer et tester sans Internet. |
| **Gwei** | Un milliardième d’ETH. C’est l’unité habituelle du prix du gas. |
| **Hachage (empreinte)** | Transformation à sens unique d’une donnée. On peut vérifier un mot de passe à partir de son empreinte, mais pas le retrouver. |
| **JSON** | Format de texte simple pour enregistrer des données. Il sert pour les reçus, l’export du compte et l’état de la démo. |
| **LINK** | Jeton de Chainlink, qui peut payer ses services. |
| **Limite de requêtes** | Nombre maximal d’essais autorisés dans un temps donné. Elle freine les robots et les attaques par force brute. |
| **MetaMask** | Portefeuille Ethereum, en extension de navigateur ou en app mobile. Il garde les clés et signe les transactions. |
| **MetaMask Portfolio** | Application web de MetaMask qui affiche un compte. Elle ne signe pas pour les autres sites. |
| **Mode blockchain** | Façon de jouer où les règles sont exécutées par le smart contract, avec MetaMask. |
| **Mode démo** | Façon de jouer sans portefeuille, avec de l’ETH fictif géré par le serveur. |
| **Node.js** | Environnement qui exécute du JavaScript sur un serveur. |
| **Oracle** | Service qui fournit à un smart contract une information qu’il ne peut pas obtenir seul : le contrat ne voit que la blockchain. |
| **Oracle simulé** | En local, le serveur BlockLucky remplace Chainlink pour répondre aux demandes de hasard. |
| **Phrase secrète** | Les 12 mots qui permettent de restaurer un portefeuille MetaMask. Ils donnent accès à tous ses comptes. |
| **QR code** | Code-barres carré que l’appareil photo d’un téléphone lit pour ouvrir un lien. Ici, il ouvre la loterie depuis une affiche. |
| **Reçu** | Fichier qui prouve un achat de tickets : tirage, numéros, montant, date. |
| **Remboursement** | Restitution de la mise quand un tirage est annulé. |
| **Retrait** | Transaction par laquelle le gagnant transfère ses gains du contrat vers son portefeuille. |
| **RGPD** | Règlement européen sur les données personnelles. Il impose la transparence et les droits d’accès et d’effacement. |
| **Robinet (faucet)** | Service qui donne gratuitement quelques ETH de test pour commencer à jouer. |
| **Robot de clôture (keeper)** | Programme qui surveille les tirages et déclenche la clôture à l’échéance. Le contrat revérifie toujours que c’est bien l’heure. |
| **RPC** | Point d’accès qui permet d’interroger un nœud de la blockchain et de lui envoyer des transactions. |
| **scrypt** | Algorithme de hachage volontairement lent, conçu pour protéger les mots de passe. |
| **Sepolia** | Réseau de test public d’Ethereum. Il fonctionne comme le vrai, avec des ETH sans valeur. |
| **Server-Sent Events (SSE)** | Technique qui permet au serveur de pousser des nouvelles au navigateur en temps réel. |
| **Signature** | Preuve, faite avec la clé privée, qu’un message vient bien du propriétaire d’une adresse. |
| **SIWE (Sign-In with Ethereum)** | Connexion à un site en signant un message avec son portefeuille, sans mot de passe et sans frais. |
| **Smart contract (contrat intelligent)** | Programme déployé sur la blockchain qui applique ses règles tout seul. Personne ne peut le modifier ensuite. |
| **Solidity** | Langage de programmation des smart contracts Ethereum. |
| **Testnet** | Réseau de test d’une blockchain, comme Sepolia. |
| **Ticket** | Participation à un tirage, à 0,01 ETH. Chaque ticket porte un numéro. |
| **Tirage** | Une partie de la loterie : ventes, puis désignation d’un gagnant, ou annulation. |
| **Transaction** | Opération envoyée à la blockchain (achat, retrait, création de tirage…). Elle est signée et payée en frais. |
| **Usine à tirages (factory)** | Contrat qui crée les tirages les uns après les autres et garde la liste de tous les tirages. |
| **VRF (Verifiable Random Function)** | Hasard accompagné d’une preuve mathématique : on peut vérifier que personne ne l’a truqué. |
| **Wallet (portefeuille)** | Application qui garde les clés d’un ou plusieurs comptes et permet de signer. MetaMask en est un. |

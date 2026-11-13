# Présenter BlockLucky

## Proposition

EtherBay rassemble ses habitants autour d’une loterie de fin d’année qui leur fait découvrir les smart contracts. La démonstration ne demande aucun portefeuille : un compte gratuit suffit, et il reçoit 1 ETH fictif. Le mode blockchain permet ensuite de jouer avec MetaMask sur une vraie blockchain de test, où les règles sont appliquées par le contrat et le hasard fourni par un oracle vérifiable.

## Démonstration en sept minutes

1. **Tableau de bord** : la cagnotte, le compte à rebours et le portefeuille. En invité, le portefeuille est vide.
2. **Compte** : en créer un (le premier devient admin) ; 1 ETH fictif est offert. Montrer « Données personnelles » et « Télécharger mes données ».
3. **Achat** : cinq tickets, soit 0,05 ETH ; le solde passe à 0,95 ETH, et « Derniers achats » et « Mes tickets » se mettent à jour en direct.
4. **Second joueur** : une fenêtre privée montre la cagnotte partagée et la limite de tickets par joueur.
5. **Espace admin** : règles des tirages, annonce publiée en direct, statistiques, remise à zéro de la démo, puis « Créer un QR code » pour la mairie et impression de l’affiche A4. Rappeler ce que l’admin ne peut pas faire.
6. **Tuto MetaMask** : les trois parcours (extension, app mobile, application web). En mode démo, MetaMask n’est jamais sollicité : le bouton mène au mode blockchain.
7. **Blockchain (Ganache déjà lancé)** :
   - acheter des tickets, puis attendre l’échéance sans rien toucher : le tirage est demandé automatiquement, l’oracle répond, le gagnant est révélé et retire ses gains ;
   - ouvrir « Détails » pour refaire le calcul du ticket gagnant ;
   - annuler un tirage depuis l’Espace admin : chaque joueur récupère sa mise en un clic.
8. **Tests** : lancer `npm test` (48 tests : contrats, serveur, robot de clôture, sécurité).

## Réponse aux parties prenantes

| Partie prenante | Réponse proposée | Preuve dans le prototype |
| --- | --- | --- |
| Madame la Maire | Expérience communautaire identifiable et accessible | Identité EtherBay, sans portefeuille ni fonds réels, tuto guidé, mobile |
| Événementiel | Achat court, montants explicites, résultats en direct | Sélecteur de tickets, récapitulatif, temps réel, tirage qui se fait tout seul à l’heure |
| DSI | Règles inspectables, hasard vérifiable, coûts maîtrisés, sécurité | Source Solidity, Chainlink VRF, clones EIP-1167, Chainlink Automation, 48 tests, CSP, limites de requêtes, RGPD |

## Coûts sur la blockchain

Chaque action se paie en gas (frais du réseau), même sur une blockchain de test. La version « clones » divise les principaux coûts :

| Action | Avant | Maintenant |
| --- | --- | --- |
| Déployer l’usine | 15,3 millions de gas | 2,5 millions (modèle compris) |
| Créer un tirage | 7,05 millions | 271 000 (26 fois moins) |
| Se faire rembourser | deux transactions (créditer, puis retirer) | une transaction, environ 35 000 |
| Demander le tirage à l’échéance | un joueur devait cliquer | automatique (serveur ou Chainlink Automation) |

À 1,5 gwei, créer un tirage passe d’environ 0,0106 ETH à 0,0004 ETH de test.

## Engagement et communication

- **Avant l’événement** : ateliers blockchain et affiches à QR code dans les lieux municipaux, créées et imprimées depuis l’Espace admin.
- **Pendant** : démonstration accompagnée et affichage public du fonctionnement.
- **Après** : publication des résultats et questionnaire sur la compréhension des smart contracts.

Objectif proposé : 10 000 participants. Les indicateurs à suivre :
- visiteurs uniques consentants ;
- conversion en participation et abandons ;
- erreurs de transaction ;
- résultats du questionnaire.

Le prototype n’intègre aucun suivi marketing. Les statistiques de l’Espace admin portent sur la démo ; ce n’est pas la mesure de l’objectif global.

## Données personnelles (RGPD)

- **Stocké** : pseudo, e-mail, une empreinte scrypt du mot de passe (jamais le mot de passe lui-même), et les données de jeu démo. En mode blockchain, s’y ajoute l’adresse publique vérifiée par une signature.
- **Cookies** : un seul, la session technique indispensable au fonctionnement. Ni publicité ni mesure d’audience.
- **Droits** : depuis « Mon compte », télécharger ses données (JSON) et supprimer son compte. La suppression retire aussi le pseudo des résultats publiés.
- **Ce qui ne s’efface pas** : les transactions blockchain, publiques et définitives par nature. La page « Données personnelles » l’explique.
- **Mot de passe oublié** : lien à usage unique, valable 30 minutes. La réponse est identique que l’adresse existe ou non.

## Points à expliquer honnêtement

- **Démo centralisée** : son historique JSON n’est pas une preuve blockchain.
- **Réseaux** : le mode blockchain fonctionne en local (Ganache) et sur le testnet public Sepolia.
- **Hasard** : il vient de Chainlink VRF et se vérifie sur Sepolia. En local, l’oracle est simulé par le serveur, car il n’y a pas de nœud Chainlink sur Ganache.
- **Clôture automatique** : en local et sur Sepolia, c’est le serveur qui joue le rôle de Chainlink Automation, avec une clé de test. L’usine est compatible avec un vrai abonnement Automation, mais cela demande des LINK de test, que le prototype n’inclut pas. Le contrat revérifie toujours la condition : personne ne peut forcer un tirage avant l’heure.
- **Rôle de l’admin** : il organise les tirages, mais ne peut ni choisir le gagnant ni toucher à la cagnotte. Il peut annuler, et chacun est alors remboursé.
- **E-mails** : aucun n’est réellement envoyé, le lien de réinitialisation s’affiche dans la console du serveur. Sans vérification d’e-mail, une personne peut aussi créer plusieurs comptes.
- **Frais** : le contrat ne prélève aucune commission, mais chaque transaction coûte des frais de réseau, que l’on ne récupère pas.
- **Montée en charge** : un serveur unique, un fichier JSON et des limites de requêtes en mémoire ne suffisent pas pour un événement public de grande ampleur. Il faudrait une base transactionnelle, un stockage partagé et un plan de charge.
- **Accessibilité** : libellés, focus clavier, messages de statut et réduction des animations sont présents, mais aucun audit complet n’a été réalisé.
- **Contrats** : prototype sans audit, à ne jamais utiliser avec de l’argent réel (en France, une loterie payante est par ailleurs très réglementée).

## Architecture

- **Démo** : navigateur → API Express → fichier d’état de démonstration.
- **Blockchain** : navigateur → ethers → MetaMask → Ganache ou Sepolia → usine à tirages. Chaque tirage est un clone léger du modèle.
- **Hasard** : usine → Chainlink VRF → réponse avec preuve → gagnant désigné par le contrat.
- **Clôture** : serveur BlockLucky, ou Chainlink Automation → `performUpkeep` → demande du hasard, ou annulation si l’oracle reste muet.

Les clés du portefeuille ne transitent jamais par le serveur Express. Les adresses de démonstration sont des identifiants fictifs, sans clé privée.

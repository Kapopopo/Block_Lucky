# Présenter BlockLucky

## Proposition

EtherBay rassemble ses habitants autour d’une loterie de fin d’année qui leur fait découvrir les smart contracts. La démonstration est accessible sans installation de portefeuille et utilise exclusivement une monnaie fictive. Le mode blockchain permet ensuite d’observer la validation de transactions et les règles exécutées par le contrat.

## Démonstration en cinq minutes

1. Présenter le tableau de bord sombre, la cagnotte vide et les règles accessibles.
2. Ouvrir le portefeuille démo : 1 ETH fictif, aucun dépôt nécessaire.
3. Acheter cinq tickets : 0,05 ETH, solde restant 0,95 ETH, activité et Mes tickets actualisés.
4. Ouvrir une fenêtre privée pour montrer un second participant et le partage de la cagnotte.
5. Montrer Réseau et contrat, le code Solidity et les limites de l’aléatoire.
6. Exécuter `npm test` pour montrer les contrôles et le cycle du contrat.
7. Avec Ganache déjà lancé, connecter MetaMask, acheter des tickets, observer la transaction et expliquer le retrait des gains. Le tirage temporel peut être accéléré localement avec `evm_increaseTime` (3601 secondes) puis `evm_mine` ; programmer ensuite le tirage et miner trois blocs avant de le déclencher.

## Réponse aux parties prenantes

| Partie prenante | Réponse proposée | Preuve dans le prototype |
| --- | --- | --- |
| Madame la Maire | Expérience communautaire identifiable et accessible | Identité EtherBay, parcours sans compte ni fonds réels |
| Événementiel | Achat court, montants explicites, résultats lisibles | Sélecteur de tickets, portefeuille, historique, mobile |
| DSI | Règles inspectables, validation serveur, tests contractuels | Source Solidity, tests Ganache, paiements exacts et retraits protégés |

## Engagement et communication

Avant l’événement : ateliers blockchain et QR codes dans les lieux municipaux. Pendant : démonstration accompagnée et affichage public du fonctionnement. Après : publication des résultats et questionnaire sur la compréhension des smart contracts.

Objectif proposé : 10 000 participants. Mesurer les visiteurs uniques consentants, la conversion en participation, les abandons, les erreurs de transaction et le résultat du questionnaire. Le prototype n’intègre pas de suivi marketing ni de données personnelles nominatives. Les statistiques affichées concernent le tirage courant et ne constituent pas la mesure de cet objectif global.

## Points à expliquer honnêtement

- La démo est centralisée : son historique JSON n’est pas une preuve blockchain.
- Le mode blockchain est un contrat local réellement exécuté, sans déploiement public effectué.
- Le hash de bloc futur est un aléatoire pédagogique biaisable ; il faudrait une VRF pour une version à enjeux.
- La fin d’un délai ne déclenche pas une transaction blockchain toute seule : une personne ou un service doit l’appeler.
- Le contrat ne prélève pas de commission ; le réseau facture des frais de transaction.
- Le serveur mono-instance et le stockage JSON doivent évoluer vers une base transactionnelle, une protection anti-abus et une stratégie de charge avant un événement public de grande ampleur.
- Le thème sombre est responsive ; les libellés, focus clavier et messages de statut sont présents. Aucun audit complet d’accessibilité n’a été réalisé.

## Architecture

Navigateur → API Express → fichier d’état de démonstration.

Navigateur → ethers → MetaMask → Ganache → smart contract Solidity.

Les clés du portefeuille blockchain ne transitent pas par le serveur Express. Les adresses de démonstration sont des identifiants fictifs, sans clé privée et sans existence garantie sur une blockchain.

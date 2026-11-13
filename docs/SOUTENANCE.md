# Présenter BlockLucky

## Proposition

EtherBay rassemble ses habitants autour d’une loterie de fin d’année qui leur fait découvrir les smart contracts. La démonstration est accessible sans installation de portefeuille (un compte gratuit suffit) et utilise exclusivement une monnaie fictive. Le mode blockchain permet ensuite d’observer la validation de transactions et les règles exécutées par le contrat.

## Démonstration en cinq minutes

1. Présenter le tableau de bord sombre, la cagnotte vide et les règles accessibles.
2. Montrer le portefeuille invité vide, puis créer un compte (il devient admin) : 1 ETH fictif est offert, aucun dépôt nécessaire.
3. Acheter cinq tickets : 0,05 ETH, solde restant 0,95 ETH, activité et Mes tickets actualisés.
4. Ouvrir une fenêtre privée pour montrer un second participant et le partage de la cagnotte.
5. Montrer l’Espace admin : règles, annonce publiée en direct, ce que l’admin ne peut pas faire.
6. Exécuter `npm test` pour montrer les contrôles et le cycle du contrat.
7. Avec Ganache déjà lancé, suivre le tuto MetaMask, acheter le dernier ticket : le contrat demande le hasard à l’oracle, la réponse arrive, le gagnant est révélé, puis il retire ses gains. Ouvrir « Détails » pour refaire le calcul du ticket gagnant.

## Réponse aux parties prenantes

| Partie prenante | Réponse proposée | Preuve dans le prototype |
| --- | --- | --- |
| Madame la Maire | Expérience communautaire identifiable et accessible | Identité EtherBay, parcours sans portefeuille ni fonds réels |
| Événementiel | Achat court, montants explicites, résultats lisibles | Sélecteur de tickets, portefeuille, historique, mobile |
| DSI | Règles inspectables, validation serveur, tests contractuels | Source Solidity, tests Ganache, paiements exacts et retraits protégés |

## Engagement et communication

Avant l’événement : ateliers blockchain et QR codes dans les lieux municipaux. Pendant : démonstration accompagnée et affichage public du fonctionnement. Après : publication des résultats et questionnaire sur la compréhension des smart contracts.

Objectif proposé : 10 000 participants. Mesurer les visiteurs uniques consentants, la conversion en participation, les abandons, les erreurs de transaction et le résultat du questionnaire. Le prototype n’intègre pas de suivi marketing ni de données personnelles nominatives. Les statistiques affichées concernent le tirage courant et ne constituent pas la mesure de cet objectif global.

## Points à expliquer honnêtement

- La démo est centralisée : son historique JSON n’est pas une preuve blockchain.
- Le mode blockchain fonctionne en local (Ganache) et sur le testnet public Sepolia.
- Le hasard vient de Chainlink VRF : vérifiable sur Sepolia ; en local, l’oracle est simulé par le serveur (il n’y a pas de nœud Chainlink sur Ganache).
- L’admin organise les tirages mais ne peut ni choisir le gagnant ni toucher à la cagnotte ; il peut annuler, et tout le monde est alors remboursé.
- Les comptes démo n’ont pas de vérification d’e-mail : une personne peut créer plusieurs comptes.
- La fin d’un délai ne déclenche pas une transaction blockchain toute seule : une personne ou un service doit l’appeler.
- Le contrat ne prélève pas de commission ; le réseau facture des frais de transaction.
- Le serveur mono-instance et le stockage JSON doivent évoluer vers une base transactionnelle, une protection anti-abus et une stratégie de charge avant un événement public de grande ampleur.
- Le thème sombre est responsive ; les libellés, focus clavier et messages de statut sont présents. Aucun audit complet d’accessibilité n’a été réalisé.

## Architecture

Navigateur → API Express → fichier d’état de démonstration.

Navigateur → ethers → MetaMask → Ganache → smart contract Solidity.

Les clés du portefeuille blockchain ne transitent pas par le serveur Express. Les adresses de démonstration sont des identifiants fictifs, sans clé privée et sans existence garantie sur une blockchain.

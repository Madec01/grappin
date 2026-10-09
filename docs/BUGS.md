# Registre des bugs

Dernière mise à jour : 9 octobre 2026, version 0.2.1.

| Id | Statut | Sévérité | Description | Reproduction | Résolution |
|---|---|---|---|---|---|
| B-001 | résolu | majeur | Écran noir sur le téléphone du propriétaire : GitHub Pages publiait le code source brut de la branche au lieu du jeu assemblé. | 9 octobre 2026, après l'activation de Pages sur la source « Deploy from a branch ». | Relance du déploiement par la chaîne automatique, qui finit après la publication brute et la remplace. Cause de fond : la source Pages doit être réglée sur « GitHub Actions » par le propriétaire ; tant que ce n'est pas fait, chaque publication est une course entre les deux mécanismes. |
| B-002 | résolu | mineur | Le test de fumée du pilote automatique échouait sur les machines lentes de l'intégration continue, le pilote mourant dans la brume avant dix mètres. | CI du commit 5ea7da0. | Brume ralentie dans ce test (`fogBaseSpeed=0.15`) : il vérifie que le jeu tourne sans erreur, pas l'adresse du pilote. |

## Conventions

- **Statut :** ouvert, reproduit, en cours, résolu, non reproductible, refusé.
- **Sévérité :** bloquant, majeur, mineur, cosmétique.
- Chaque bug résolu renvoie vers le commit ou la version du journal des modifications qui le corrige.

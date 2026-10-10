# Registre des bugs

Dernière mise à jour : 9 octobre 2026, version 0.2.1.

| Id | Statut | Sévérité | Description | Reproduction | Résolution |
|---|---|---|---|---|---|
| B-001 | résolu | majeur | Écran noir sur le téléphone du propriétaire : GitHub Pages publiait le code source brut de la branche au lieu du jeu assemblé. | 9 octobre 2026, après l'activation de Pages sur la source « Deploy from a branch ». | Relance du déploiement par la chaîne automatique, qui finit après la publication brute et la remplace. Cause de fond : la source Pages doit être réglée sur « GitHub Actions » par le propriétaire ; tant que ce n'est pas fait, chaque publication est une course entre les deux mécanismes. |
| B-002 | résolu | mineur | Le test de fumée du pilote automatique échouait sur les machines lentes de l'intégration continue, le pilote mourant dans la brume avant dix mètres. | CI du commit 5ea7da0. | Brume ralentie dans ce test (`fogBaseSpeed=0.15`) : il vérifie que le jeu tourne sans erreur, pas l'adresse du pilote. |
| B-003 | ouvert | mineur | Les étiquettes d'altitude (« 40 m », « 60 m ») passent sous les chiffres de l'interface en haut à gauche quand une ligne d'altitude traverse cette zone, et se lisent mal. Pendant une bascule, elles tournent avec le monde et apparaissent couchées. | Captures de la 0.4.1. | À traiter dans l'habillage de la phase 5, quand l'interface sera redessinée : masquer l'étiquette sous l'interface, ou la placer en bord d'écran quel que soit l'angle. |
| B-004 | résolu | majeur | Prise électrique : le cercle de visée se posait sur une prise chargée et, l'appui étant gardé en mémoire, le grappin s'y accrochait tout seul et tuait sans geste du joueur ; mourir d'un coup était de toute façon trop dur. | Signalé par le propriétaire le 10 octobre 2026 sur la 0.5.2. | 0.5.3 : la visée ignore une électrique qui avertit ou qui est chargée, et la décharge remplace la mort (corde lâchée, repoussé, étourdi 0,7 s). |
| B-005 | résolu | majeur | La brume d'un niveau gagnait de la vitesse avec la hauteur absolue de la ville, jusqu'au plafond de 3 m/s dès le niveau 10, quel que soit le réglage du niveau. Le propriétaire la trouvait trop rapide, et les robots mouraient dans la brume en quelques secondes sur les niveaux hauts. | 0.4.0 à 0.6.0, signalé le 10 octobre 2026. | 0.6.1 : un niveau joue sa brume à vitesse constante ; le gain par palier se compte depuis le toit de départ. |

## Conventions

- **Statut :** ouvert, reproduit, en cours, résolu, non reproductible, refusé.
- **Sévérité :** bloquant, majeur, mineur, cosmétique.
- Chaque bug résolu renvoie vers le commit ou la version du journal des modifications qui le corrige.

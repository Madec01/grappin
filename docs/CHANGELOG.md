# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versionnage sémantique.

## [0.2.0] — 2026-10-09 — Génération vérifiée et difficulté

### Ajouté

- Générateur de parcours par segments : chaîne de points, fourche entre une route basse sûre et une route haute étoilée qui se rejoignent, corniches et dalles flottantes, accroches fragiles et propulseuses, selon un profil par palier de 50 m qui ajoute une contrainte à la fois.
- Robot vérificateur : chaque point d'un segment est joué avec la vraie physique au pire élan d'arrivée ; sans instant de lâcher qui mène plus haut, le segment est régénéré, puis remplacé par un segment de repli vérifié. Aucun segment n'est accepté sans preuve.
- Obstacles fixes : les toucher termine la partie, les frôler rapporte « Frôlé » ; ligne de vue du grappin, qui ne traverse pas un obstacle. Étoiles de la route haute. Paliers nommés. Accroches fragiles qui cassent après une seconde, propulseurs qui boostent le lâcher.
- Pompage : accroché et sans élan, le personnage se relance jusqu'à une vitesse plancher, pour qu'un balancement ne soit jamais mou. Proposé au propriétaire, à valider.
- Robots joueurs en module : profils raisonnable et débutant, test qui exige qu'un débutant survive plus de dix secondes.
- Ombre prédictive courte au lâcher, textes flottants, bannière de palier, cause de la défaite.

## [0.1.0] — 2026-10-09 — Socle technique et prototype gris

### Ajouté

- Projet Vite + TypeScript strict, Vitest, ESLint avec règles de déterminisme, Playwright, intégration continue et déploiement GitHub Pages.
- Simulation déterministe à pas fixe de 1/120 s : vol libre, pendule à corde tendue ou molle, accroche immédiate, lâcher avec conservation exacte de la vitesse, plafond de vitesse, journal des gestes, clone et rejeu.
- Treuil : tant que le doigt reste posé, la corde raccourcit jusqu'à 1,5 m et le balancement s'accélère. Source d'énergie du jeu, débrayable par `reelSpeed=0`. Proposé au propriétaire, à valider.
- Impulsion « jamais immobile » à l'accroche et après une demi-seconde pendu sous le point.
- Visée : point le plus proche de la trajectoire en cours, hystérésis, coyote time, mémoire d'appui de 150 ms.
- Lâcher parfait entre 30° et 60°, combo et multiplicateur, score par mètre gagné.
- Brume qui monte par paliers, toit de départ, mort et relance immédiate.
- Parcours d'essai à espacement croissant, tiré d'une graine, engendré à mesure que l'on monte.
- Caméra avec avance vers le haut, dézoom selon la vitesse et taille minimale du personnage.
- Rendu PixiJS en formes grises, interface, écrans titre et fin, trait du grappin animé.
- Réglages depuis l'adresse (`?graine=`, et toute clé de `tuning.ts`), point d'accès `window.__grappin`.
- Robot de mesure en Node et script de captures d'écran et de vidéo.
- Documents de référence : conception, architecture, feuille de route, journal, registre des bugs, boîte à idées.

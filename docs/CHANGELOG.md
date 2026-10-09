# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versionnage sémantique.

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

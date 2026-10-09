# Feuille de route — GRAPPIN

Dernière mise à jour : 9 octobre 2026. Versionnage sémantique, versions 0.x pendant le développement. Chaque phase se termine par un critère de sortie vérifiable ; on ne passe pas à la suivante tant qu'il n'est pas atteint. Chaque livraison s'accompagne de captures d'écran au format téléphone et, quand la sensation compte, d'une courte vidéo.

## Décisions qui structurent cette feuille de route

- Physique déterministe à pas fixe : mêmes gestes, même résultat, sur tout appareil. Condition du vérificateur de parcours, des tests honnêtes et des traversées identiques pour tous.
- Physique maison : un pendule est une seule règle, écrite et maîtrisée par nous, sans moteur du commerce.
- La physique d'abord, le contenu ensuite. Rien n'est habillé avant que le balancement soit agréable sur un vrai téléphone.
- Course infinie d'abord, traversées à arrivée ensuite, sur le même générateur.
- Stack : TypeScript strict, Vite, PixiJS 8 en rendu pur, simulation maison en données simples et clonables, Web Audio, Vitest, Playwright, PWA, déploiement GitHub Pages. Un moteur à entités et composants serait disproportionné pour un seul personnage et des points fixes.
- Assets uniquement libres de droits, licences vérifiées et créditées. La direction silhouettes et lueurs est dessinée en code autant que possible.

## Phase 0 — Cadrage — terminée le 9 octobre 2026

- Dépôt créé et relié. Concept analysé par le Lead et le sous-agent Game Designer, huit décisions tranchées par le propriétaire, GDD rédigé.

## Phase 1 — Socle technique et prototype gris — v0.1

Objectif : régler le pendule avec le propriétaire, sur son téléphone, avant tout contenu.

**Livrables**

- Projet Vite + TypeScript strict, Vitest, ESLint avec règles de déterminisme, Playwright, intégration continue et déploiement GitHub Pages.
- Simulation déterministe à pas fixe : vol libre, pendule à corde rigide, accroche immédiate, lâcher avec conservation de la vitesse, impulsion « jamais immobile », plafond de vitesse.
- Ciblage de l'accroche : point le plus proche de la trajectoire en cours, sélection stable, coyote time.
- Brume qui monte, mort sous la brume, relance immédiate.
- Détection du lâcher parfait, combo, multiplicateur, score et hauteur.
- Caméra : suivi avec avance vers le haut, dézoom selon la vitesse, taille minimale du personnage.
- Rendu PixiJS en formes grises : accroches, accroche visée surlignée, corde, personnage, brume, interface minimale. Écran « Toucher pour jouer », écran de fin avec relance.
- Parcours d'essai : colonne d'accroches à espacement croissant, tirée d'une graine, non vérifiée.
- Tous les réglages chiffrés dans un seul fichier.

**Tests**

- Déterminisme : deux exécutions des mêmes gestes donnent le même état, à l'octet près.
- Conservation de la vitesse au lâcher, corde qui garde sa longueur, aucun corps au-delà du plafond de vitesse.
- Impulsion « jamais immobile » : un personnage accroché sans élan repart toujours.
- Test de fumée Playwright sur écran 390 × 844 : chargement, tap, accroche, lâcher, captures d'écran et vidéo.

**Critère de sortie**

Le balancement est agréable sur le téléphone du propriétaire, le lâcher conserve visiblement l'élan, le jeu tient 60 images par seconde, et le propriétaire valide le réglage du pendule.

## Phase 2 — Génération vérifiée et difficulté — v0.2

- Génération par segments, routes haute et basse qui se rejoignent, paliers de hauteur nommés.
- Robot vérificateur : chaque segment est joué avant d'être affiché, rejeté et régénéré si aucun lâcher n'atteint l'accroche suivante avec de la marge.
- Difficulté croissante, une contrainte à la fois : espacement, puis accroches fragiles, puis propulseurs.
- Bonus « Frôlé » sur les obstacles fixes, sol et plafonds.
- Ombre prédictive très courte au lâcher.
- Robot joueur qui mesure la courbe de difficulté.

Tests : dix mille graines générées sans un seul passage impossible ; un robot débutant survit plus de dix secondes.

Critère de sortie : une partie de trois minutes ne contient aucun passage impossible ni aucune mort injuste, constaté par le propriétaire.

## Phase 3 — Habillage ville de nuit — v0.3

- Silhouettes et lueurs : toits, lampadaires, enseignes, cloches, fenêtres, brume lumineuse.
- Accroches réactives au passage. Traînée, étirement, sifflement du vent, éclat et son du lâcher parfait.
- Audio Web Audio : bruitages et musique libres, déverrouillage au premier tap, volumes.
- Application installable, plein écran portrait, hors ligne. Écrans d'accueil, options, crédits.

Critère de sortie : la première minute est amusante sur un vrai téléphone, constatée par au moins une personne qui n'a pas travaillé sur le jeu. La validation technique ne vaut pas preuve de plaisir.

## Phase 4 — Mouvement et contraintes finales — v0.4

- Accroches mobiles et rotatives, obstacles mobiles, vérificateur étendu à leur cycle.
- Vent et dérive, toujours signalés, en dernière contrainte.

Critère de sortie : chaque contrainte passe le vérificateur et ne dégrade pas la lisibilité.

## Phase 5 — Traversées et confort — v0.5

- Traversées : niveaux à arrivée, construits par le générateur avec graine fixe et longueur donnée, sélection de niveau.
- Mode facile avec ombre prédictive longue, ligne de record, statistiques de fin de partie.

Critère de sortie : une traversée se termine, se rejoue à l'identique et se classe.

## Phase 6 — Polish et publication — v1.0

- Équilibrage piloté par le robot joueur, accessibilité, performance sur téléphones modestes, crédits complets.
- Publication sur GitHub Pages, page d'évaluation pour recueillir les retours.

## Hors périmètre de la version 1.0

- Fantôme de la meilleure run et parcours du jour, accroche élastique « liane », filets de secours, partage de rejeux : en boîte à idées.

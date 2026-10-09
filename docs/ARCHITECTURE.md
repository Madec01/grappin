# Architecture technique — GRAPPIN

Dernière mise à jour : 9 octobre 2026, version 0.1.0. Ce document décrit ce qui existe, pas ce qui est prévu. La feuille de route tient le reste.

## Principes

1. **La simulation est déterministe.** Mêmes gestes, même graine, même résultat, à l'octet près, sur n'importe quel moteur JavaScript. C'est la condition des rejeux, des tests honnêtes, du futur vérificateur de parcours et des traversées identiques pour tous.
2. **La simulation ignore le monde extérieur.** Pas d'horloge, pas de navigateur, pas de rendu, pas d'audio. Elle tourne en Node pour les tests et le robot de mesure.
3. **L'état est en données simples.** Objets sans méthode ni classe : l'état se clone par copie profonde et se sérialise de façon stable. Un moteur à entités et composants serait disproportionné pour un seul personnage et des points fixes.
4. **Tous les réglages vivent dans un seul fichier.** `src/sim/tuning.ts` porte chaque constante de jeu, surchargeable depuis l'adresse du jeu pendant une séance de réglage sur téléphone.
5. **Le rendu lit, il ne décide pas.** La caméra et le dessin consomment l'état ; aucune règle de jeu n'y vit.

## Arborescence

```
src/
  core/math/vec2.ts     Vecteurs 2D purs, sans trigonométrie
  core/math/rng.ts      Générateur seedé (mulberry32), seule source d'aléatoire autorisée
  sim/tuning.ts         Tous les réglages chiffrés, et leur surcharge
  sim/state.ts          État complet : personnage, corde, points, visée, brume, score, journal des gestes
  sim/physics.ts        Vol libre, corde tendue ou molle, treuil, plafond de vitesse, prédiction de vol
  sim/aim.ts            Choix du point visé : trajectoire, hystérésis, coyote time
  sim/rules.ts          Accroche, lâcher, impulsion « jamais immobile », lâcher parfait, combo, score, sol, brume
  sim/course.ts         Parcours d'essai tiré d'une graine, engendré à mesure que l'on monte
  sim/simulation.ts     Pas fixe, ordre des règles, journal, clone, rejeu
  input/pointer.ts      Un seul pointeur : appui et relâché
  render/camera.ts      Mètres vers pixels, suivi, avance, dézoom selon la vitesse
  render/renderer.ts    Dessin PixiJS en formes grises et interface
  app/game.ts           Écrans, accumulateur de temps, réglages depuis l'adresse, état de débogage
  main.ts               Démarrage et point d'accès window.__grappin
scripts/robot.ts        Robot joueur en Node : mesure d'un réglage
scripts/capture.ts      Captures d'écran et vidéo d'une partie jouée par un robot
tests/                  Vitest en Node : physique, règles, visée, parcours, déterminisme
e2e/                    Playwright : fumée sur écran 390 × 844
```

## Déterminisme, règles concrètes

- Pas de temps fixe de 1/120 s. Le temps réel est converti en pas entiers par un accumulateur dans `app/game.ts`, plafonné à 100 ms par image pour ne pas rattraper une suspension d'onglet.
- Seules les quatre opérations et la racine carrée sont utilisées dans `core` et `sim`. Une règle ESLint y interdit `Math.random`, `Math.sin`, `Math.cos`, `Math.atan2`, `Math.pow`, `Date.now` et `performance.now`. Le lâcher parfait compare des pentes à des tangentes d'angles, jamais des angles.
- Les gestes sont journalisés avec leur numéro de pas. `replay` rejoue le journal sur la graine et retrouve le même état.
- L'état du générateur de parcours fait partie de l'état : un clone engendre la même suite de points.
- Preuves : `tests/determinism.test.ts` compare deux exécutions à l'octet près, vérifie qu'un clone en plein vol poursuit à l'identique et que le rejeu du journal reproduit la partie.

## Physique

L'axe Y pointe vers le haut, les unités sont le mètre et la seconde. Un pas fait, dans l'ordre :

1. **Treuil.** Si une corde est tenue, sa longueur baisse de `reelSpeed × dt` jusqu'à `ropeMin`. Si elle est tendue, la vitesse radiale devient au moins la vitesse d'enroulement vers le point, et la vitesse le long du cercle est multipliée par une part `reelSpin` de l'ancien rapport des longueurs, comme un patineur qui ramène les bras. C'est la source d'énergie du jeu : un pendule pur ne monte jamais plus haut que son élan de départ.
2. **Gravité**, puis **corde** : si elle est tendue et que le personnage s'en éloigne, la composante radiale sortante de la vitesse est retirée. Une corde molle laisse voler librement.
3. **Déplacement**, puis correction : si la corde est dépassée, le personnage est ramené sur le cercle et sa vitesse contrainte une seconde fois. La corde garde donc exactement sa longueur à chaque pas, ce que `tests/physics.test.ts` vérifie, avec une perte d'énergie sous 2 % par balancement complet.
4. **Plafond de vitesse** de 24 m/s.

Le lâcher ne touche pas à la vitesse : le personnage part avec celle du moment, ce qu'un test vérifie à l'identique.

## Règles de jeu

`rules.ts` modifie l'état en place et journalise des événements (`attach`, `release`, `kick`, `death`) que le rendu et, plus tard, le son consomment.

- **Accroche.** Recevable si le personnage est vivant, sans corde, avec un point visé encore valide au sens du coyote time, à portée élargie de 20 %. La corde prend la distance du moment, bornée. La vitesse est contrainte immédiatement.
- **Jamais immobile.** À l'accroche, si la vitesse le long du cercle est sous `minSwingSpeed`, elle est portée à `kickSpeed` du côté du prochain point au-dessus. Pendant la tenue, seuls comptent les pas lents passés presque à la verticale sous le point, là où un balancement est au contraire le plus rapide : au bout de `hangSeconds`, nouvelle impulsion.
- **Lâcher parfait.** Vitesse vers le haut, d'au moins `perfectMinSpeed`, de pente entre les tangentes de 30° et 60°. Le combo monte d'un, sinon il retombe à zéro. Multiplicateur `1 + comboStep × combo`, plafonné.
- **Score.** Chaque mètre gagné au-dessus de la hauteur maximale rapporte le multiplicateur courant. Redescendre ne retire rien.
- **Sol.** Le toit de départ est en y = 0 : sans corde, le personnage s'y pose.
- **Brume.** Monte à `fogBaseSpeed`, plus `fogSpeedGain` tous les `fogStepHeight` mètres, plafonnée. Le personnage passe dessous : partie terminée, la corde lâche.

## Visée

`aim.ts` choisit le point surligné avant le tap. Candidats : les points à portée, sauf celui que l'on vient de lâcher pendant quatre dixièmes de seconde. Score : distance entre le point et la position prédite du personnage dans `aimLookaheadSeconds` de vol libre, moins une préférence pour les points plus hauts. Hystérésis : un nouveau point ne remplace le courant que si son score est sous `aimHysteresis` fois le score courant. Coyote time : si plus rien n'est à portée, le point courant reste visé `coyoteSeconds`, et l'accroche reste recevable. Le joueur choisit donc sa route par le moment où il lâche, jamais en visant au doigt.

## Parcours d'essai

`course.ts` engendre une colonne de points dont l'espacement nominal vaut `3 + min(1,5, hauteur / 40)` mètres, alternant les côtés dans une largeur de ±4 m, chaque point à moins de la portée du précédent. Les points sont engendrés 24 m au-dessus du personnage et retirés 10 m sous la brume. Ce parcours n'est pas vérifié par un robot : c'est l'objet de la phase 2.

## Robot de mesure

`scripts/robot.ts` joue cinq graines pendant soixante secondes avec une stratégie raisonnable et rapporte hauteur, rythme, vitesses et tenue moyenne. Mesure du 9 octobre 2026 avec les réglages par défaut : environ deux mètres par seconde de montée, accroches tenues six dixièmes de seconde, cinq parties sur cinq encore vivantes à la minute. Sans treuil : sept mètres, puis la brume.

## Rendu, caméra et entrée

PixiJS 8 sert de renderer pur, en formes et textes, sans aucun asset. `render/renderer.ts` redessine chaque image une cinquantaine de formes à partir de coordonnées d'écran déjà calculées par la caméra : lignes d'altitude tous les 10 m, toit de départ, points d'accroche, anneau du point visé, corde, brume, personnage, puis l'interface (hauteur, multiplicateur, score) et les écrans titre et fin sur un voile. Le trait du grappin se dessine du personnage vers le point en 60 ms de temps réel, pour l'œil seulement : la physique accroche à l'instant du tap.

`render/camera.ts` ne connaît ni PixiJS ni le DOM : dix mètres de large tiennent dans l'écran à zoom 1 ; le zoom cible vaut `1 / (1 + vitesse / 18)`, borné à 0,6 et de sorte que le personnage garde 14 px de diamètre ; centre et zoom sont lissés avec une constante de 0,25 s ; l'avance vers le haut vaut 2,5 m plus 0,08 m par m/s de vitesse verticale, bornée entre 1 et 5 m ; une bande dure garde le personnage entre 45 % et 70 % de la hauteur d'écran. La caméra reste centrée sur x = 0 pour ne pas balancer tout le décor avec le pendule, et ne suit en x que si le personnage s'approche à moins d'un mètre du bord.

`input/pointer.ts` suit un seul pointeur : appui au `pointerdown` avec capture, relâché au `pointerup`, `pointercancel` ou perte de capture, menu contextuel bloqué. La souris produit les mêmes événements, ce qui rend le jeu jouable sur ordinateur et testable par Playwright.

## Écrans et boucle de jeu

`app/game.ts` tient trois écrans, titre, partie et fin. Sur le titre et sur la fin, l'appui lance la partie et compte comme l'appui d'accroche. Le temps réel est converti en pas fixes par un accumulateur plafonné à 100 ms par image ; la simulation ne voit jamais le temps réel. Les réglages viennent de l'adresse : `?graine=` fixe la graine, et tout paramètre nommé comme une clé de `Tuning` surcharge la valeur. `debugState()` expose un instantané lisible aux tests de bout en bout et aux séances de réglage, via `window.__grappin`.

## Tests et intégration continue

| Niveau | Outil | Ce qui est vérifié |
|---|---|---|
| Unitaire | Vitest en Node | Parabole, plafond de vitesse, corde à longueur constante, énergie, treuil, accroche, impulsion, lâcher parfait, combo, score, sol, brume, mémoire d'appui, visée, coyote time, parcours, déterminisme, caméra, écrans et réglages d'URL |
| Bout en bout | Playwright, Chromium, 390 × 844 | Chargement sans erreur, doigt posé qui accroche au toucher et à la souris, relâché qui libère, tap qui lance, graine d'URL respectée |
| Qualité | ESLint, tsc strict | Règles de déterminisme, typage strict avec index non vérifiés et propriétés optionnelles exactes |

Le workflow `.github/workflows/ci.yml` enchaîne lint, typage, tests, fumée mobile et build à chaque push, puis déploie `dist/` sur GitHub Pages depuis `main`. Le dépôt doit avoir GitHub Pages configuré sur la source « GitHub Actions ». Le build Pages utilise la base `/grappin/` via la variable `GRAPPIN_BASE`.

## Limites connues de la version 0.1

- Le parcours d'essai n'est pas vérifié par un robot ; la phase 2 apporte la génération vérifiée.
- Pas d'interpolation entre deux pas de simulation : une micro-saccade est possible sur un écran à 144 Hz.
- Aucun son, aucun habillage, aucune application installable : ils viennent après la validation de la sensation.

# Architecture technique — GRAPPIN

Dernière mise à jour : 10 octobre 2026, version 0.4.0. Ce document décrit ce qui existe, pas ce qui est prévu. La feuille de route tient le reste.

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
  sim/state.ts          État complet : personnage, corde, points, obstacles, étoiles, visée, brume, score, palier, journal des gestes
  sim/geometry.ts       Écart cercle-boîte, traversée d'une boîte par un segment
  sim/physics.ts        Vol libre, corde tendue ou molle, pompage, treuil, plafond de vitesse, prédiction de vol
  sim/aim.ts            Choix du point visé : trajectoire, ligne de vue, hystérésis, coyote time
  sim/rules.ts          Accroche, lâcher, impulsions, fragiles, propulseurs, obstacles et frôlé, étoiles, paliers, score, sol, brume
  sim/generator.ts      Construction d'un segment selon un motif et un profil : chaîne, escalier, couloir, dalles, rafale, fragiles, saut
  sim/verifier.ts       Robot vérificateur : joue chaque point et prouve qu'une sortie vers le haut existe
  sim/course.ts         Plan de parcours (course libre ou niveau), génération, vérification, repli, élagage sous la brume
  sim/robot.ts          Robots joueurs raisonnable et débutant, pour mesurer un réglage
  sim/simulation.ts     Pas fixe, ordre des règles, journal, clone, rejeu
  data/tiers.ts         Noms des paliers de hauteur
  data/levels.ts        Les dix niveaux : graine, hauteurs, brume, profil, nouveauté
  meta/traversee.ts     Étoiles d'un niveau, niveaux débloqués, départ avancé, plan et réglages d'un niveau
  meta/levels.ts        Expérience et niveaux de grimpeur
  meta/talismans.ts     Catalogue des talismans et leur effet sur les réglages
  meta/missions.ts      Catalogue des missions, avancement et remplacement
  meta/runTracker.ts    Relevé d'une partie pour les missions, depuis les événements
  meta/profile.ts       Profil sauvegardé, relecture tolérante, fin de partie, équipement
  input/pointer.ts      Un seul pointeur : appui et relâché, avec la position en pixels
  render/camera.ts      Mètres vers pixels, suivi, avance, dézoom selon la vitesse
  render/cues.ts        Repères purs lus de l'état : ombre prédictive, usure de l'accroche fragile tenue
  render/effects.ts     Temps réel à l'écran : trait du grappin, textes flottants, bannière de palier
  render/format.ts      Nombres à la française
  render/style.ts       Palette, police, fabrique de textes, marges d'encoche
  render/labels.ts      Textes purs des écrans : avancement d'une mission, talismans équipés, emplacements
  render/screens.ts     Écrans titre, fin et talismans, voile, boutons et leurs rectangles
  render/renderer.ts    Dessin PixiJS en formes grises, interface, délégation des écrans
  app/game.ts           Écrans, accumulateur de temps, réglages depuis l'adresse, état de débogage
  main.ts               Démarrage et point d'accès window.__grappin
scripts/robot.ts        Mesure d'un réglage par les robots joueurs, en ligne de commande
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

1. **Pompage.** Si une corde est tenue et que l'élan est faible, mesuré par la vitesse qu'aurait le personnage au point bas du cercle, une accélération de `swingAssistAccel` le long du cercle, dans le sens du mouvement, le relance jusqu'à `swingAssistSpeed`. Sans elle, une corde arrivée au plus court finit en balancement mou, car le treuil n'y apporte plus rien.
2. **Treuil.** Si une corde est tenue, sa longueur baisse de `reelSpeed × dt` jusqu'à `ropeMin`. Si elle est tendue, la vitesse radiale devient au moins la vitesse d'enroulement vers le point, et la vitesse le long du cercle est multipliée par une part `reelSpin` de l'ancien rapport des longueurs, comme un patineur qui ramène les bras. C'est la source d'énergie du jeu : un pendule pur ne monte jamais plus haut que son élan de départ.
3. **Gravité**, puis **corde** : si elle est tendue et que le personnage s'en éloigne, la composante radiale sortante de la vitesse est retirée. Une corde molle laisse voler librement.
4. **Déplacement**, puis correction : si la corde est dépassée, le personnage est ramené sur le cercle et sa vitesse contrainte une seconde fois. La corde garde donc exactement sa longueur à chaque pas, ce que `tests/physics.test.ts` vérifie, avec une perte d'énergie sous 2 % par balancement complet.
5. **Plafond de vitesse** de 24 m/s.

`swingStep` enchaîne pompage, treuil et déplacement : la simulation et le vérificateur l'appellent tous deux, donc jouent exactement la même physique.

Le lâcher ne touche pas à la vitesse : le personnage part avec celle du moment, ce qu'un test vérifie à l'identique.

## Règles de jeu

`rules.ts` modifie l'état en place et journalise des événements (`attach`, `release`, `kick`, `death`) que le rendu et, plus tard, le son consomment.

- **Accroche.** Recevable si le personnage est vivant, sans corde, avec un point visé encore valide au sens du coyote time, à portée élargie de 20 %. La corde prend la distance du moment, bornée. La vitesse est contrainte immédiatement.
- **Jamais immobile.** À l'accroche, si la vitesse le long du cercle est sous `minSwingSpeed`, elle est portée à `kickSpeed` du côté du prochain point au-dessus. Pendant la tenue, seuls comptent les pas lents passés presque à la verticale sous le point, là où un balancement est au contraire le plus rapide : au bout de `hangSeconds`, nouvelle impulsion.
- **Lâcher parfait.** Vitesse vers le haut, d'au moins `perfectMinSpeed`, de pente entre les tangentes de 30° et 60°. Le combo monte d'un, sinon il retombe à zéro. Multiplicateur `1 + comboStep × combo`, plafonné.
- **Score.** Chaque mètre gagné au-dessus de la hauteur maximale rapporte le multiplicateur courant. Redescendre ne retire rien.
- **Fragiles et propulseurs.** Une accroche fragile tenue `fragileSeconds` casse : `broken` passe à vrai, elle n'est plus visée ni dessinée, et le personnage est lâché avec sa vitesse par la règle ordinaire du lâcher. Un propulseur multiplie la vitesse au lâcher par `boostFactor`, sous le plafond, sans changer la direction.
- **Obstacles.** Boîtes alignées sur les axes. Un écart cercle-boîte nul ou négatif termine la partie, cause `obstacle`. Un écart sous `grazeDistance` rapporte `grazeScore × multiplicateur` une fois par obstacle et par corde : la liste des obstacles frôlés est vidée à chaque accroche.
- **Étoiles.** Ramassées quand les cercles se touchent, `pickupScore × multiplicateur`.
- **Paliers.** Quand la hauteur maximale franchit un multiple de `tierHeight`, un événement porte le nom du palier.
- **Sol.** Le toit de départ est en y = 0 : sans corde, le personnage s'y pose.
- **Brume.** Monte à `fogBaseSpeed`, plus `fogSpeedGain` tous les `fogStepHeight` mètres, plafonnée. Le personnage passe dessous : partie terminée, la corde lâche.

## Niveaux

`data/levels.ts` décrit les dix niveaux ; `meta/traversee.ts` en tire le plan et les réglages d'une partie (la brume du niveau, appliquée après les talismans), compte les étoiles (terminer, toutes les étoiles du niveau, cinq parfaits d'affilée), dit quels niveaux sont débloqués (le suivant du plus haut franchi) et d'où part la course libre. Dans la simulation, le toit de départ est en `groundY`, la brume part sous lui, la hauteur se compte depuis lui, et franchir `finishY` passe le statut à `won` avec un événement `finish` : la partie est alors figée. Le même niveau est identique à chaque essai, et son rejeu aussi, ce qu'un test vérifie.

## Progression

`src/meta` est un modèle pur, sans rendu ni navigateur. `levels.ts` : le niveau L demande `120 × L × (L − 1) / 2` points au total. `talismans.ts` : chaque talisman est une fonction des réglages vers des réglages, appliquée par `applyTalismans` dans l'ordre du catalogue ; ils ne font que faciliter, et la partie entière, vérificateur compris, joue avec les réglages qui en résultent. Deux talismans passent par la simulation : `startKickSpeed` donne son élan à la toute première accroche de la partie, `secondChances` fait renvoyer le personnage vers le haut par la brume au lieu de le prendre, avec un événement `rescue`. `missions.ts` : dix-huit missions ordonnées, trois actives, `settleMissions` applique le relevé d'une partie, remplit les missions de comptage par accumulation et celles de record par maximum, et remplace les accomplies. `runTracker.ts` relève depuis les événements de règles ce dont les missions ont besoin ; l'événement de lâcher porte pour cela la durée de tenue, le genre du point et le caractère forcé d'une casse. `profile.ts` tient le profil en données versionnées, l'écrit sur un stockage injecté, `localStorage` dans le navigateur et une mémoire dans les tests, et relit avec tolérance : toute donnée douteuse ramène au profil neuf. `endRun` fait le bilan d'une partie : expérience, missions, records, niveau et déblocages ; `endLevel` y ajoute les étoiles du niveau, leurs primes et l'enregistrement du résultat.

## Visée

`aim.ts` choisit le point surligné avant le tap. Candidats : les points intacts à portée, en ligne de vue, c'est-à-dire sans obstacle sur le trait du grappin, sauf celui que l'on vient de lâcher pendant quatre dixièmes de seconde. Score : distance entre le point et la position prédite du personnage dans `aimLookaheadSeconds` de vol libre, moins une préférence pour les points plus hauts. Hystérésis : un nouveau point ne remplace le courant que si son score est sous `aimHysteresis` fois le score courant. Coyote time : si plus rien n'est à portée, le point courant reste visé `coyoteSeconds`, et l'accroche reste recevable. Le joueur choisit donc sa route par le moment où il lâche, jamais en visant au doigt.

## Parcours engendré et vérifié

`course.ts` suit un plan : course libre depuis une hauteur de départ, avec le profil du palier, ou niveau fixe de `startY` à `endY` avec son propre profil, engendré en entier dès le départ et arrêté six mètres au-dessus de sa ligne d'arrivée. Il ajoute des segments tant que le sommet connu est sous `hero.y + courseAhead`. Pour chaque segment, `generator.ts` tire un motif parmi ceux que le profil permet et propose : une chaîne de points dont la montée et le déport viennent du motif et l'espacement du profil, alternant les côtés dans une largeur de ±4 m ; pour la chaîne, une fourche si le profil le permet (route basse proche, route haute lointaine avec une étoile, point de jonction) ; pour le couloir, une étoile entre deux points sur deux ; pour la rafale, trois propulseurs de suite ; pour la série de fragiles, trois ou quatre fragiles de suite ; pour le grand saut, un propulseur puis un trou d'un espacement et demi ; des obstacles, corniches appuyées aux bords ou dalles flottantes, plus nombreux et flottants seulement pour le champ de dalles, jamais à moins de 1,4 m d'un point ni dans la zone de pendaison sous un point, ni dans les huit premiers mètres au-dessus du toit de départ ; hors zone d'apprentissage, au moins une étoile par segment. Les profils de la course libre vivent dans `tierProfile`, ceux des niveaux dans `data/levels.ts`.

`verifier.ts` dispose. Pour chaque point du segment sauf le dernier, et pour le point d'entrée, il construit deux états d'arrivée au pire élan, pendu 3 m sous le point, décalé d'un demi-mètre à gauche puis à droite, avec la seule impulsion de départ. Il tient la corde avec la vraie physique jusqu'à `verifyHoldSeconds`, moins pour une accroche fragile, et tous les quatre pas examine un lâcher : le vol libre est échantillonné tous les cinq centièmes de seconde ; à chaque instant, le point que la visée choisirait est relevé, et il compte s'il est plus haut, à `verifyCatchRatio` de la portée, en ligne de vue, et si le balancement qui suit l'accroche ne heurte rien pendant six dixièmes de seconde. Toucher un obstacle en vol ou en balancement arrête la tentative. Pour une fourche, les deux branches doivent en plus être atteintes depuis une arrivée à élan ordinaire, 6 m/s : la route haute est optionnelle, il suffit qu'un joueur lancé puisse la prendre. Un segment refusé est régénéré jusqu'à six fois, puis un segment de repli, chaîne serrée sans rien d'autre, est proposé et vérifié à son tour ; s'il échouait aussi, il serait accepté et compté dans `unverified`, ce que les tests interdisent. Mesure du 9 octobre 2026 sur quarante graines : zéro repli à tous les paliers, environ six millisecondes par segment, un segment tous les vingt mètres environ.

Les points, obstacles et étoiles passés dix mètres sous la brume sont retirés. Le dernier point d'un segment est vérifié comme entrée du segment suivant, avec les quatre derniers points et les obstacles proches en contexte.

## Robots joueurs

`sim/robot.ts` joue une partie en Node avec deux profils. Le robot raisonnable accroche dès qu'un point est visé, tient jusqu'à 8 m/s ou une corde au plus court, lâche dans la fenêtre du lâcher parfait, jamais plus de 2,5 s pendu. Le robot débutant réagit avec un quart de seconde de retard, accepte une fenêtre de lâcher large et maladroite, et tient jusqu'à 3 s. Aucun des deux n'évite les obstacles. `tests/features.test.ts` exige qu'un débutant survive plus de dix secondes sur chacune de vingt graines ; `scripts/robot.ts` rapporte hauteur, rythme, vitesses, tenue et cause de la fin pour dix graines.

## Rendu, caméra et entrée

PixiJS 8 sert de renderer pur, en formes et textes, sans aucun asset. `render/renderer.ts` redessine chaque image les formes visibles à partir de coordonnées d'écran déjà calculées par la caméra, du fond vers l'avant : lignes d'altitude tous les 10 m, toit de départ, obstacles (rectangles à liseré clair), points d'accroche (normal en disque ; fragile en disque clair à anneau tireté et fissure, avec un anneau qui se vide pendant la tenue ; propulseur en disque dans un anneau plein surmonté de chevrons ; un point cassé n'est pas dessiné), étoiles, anneau du point visé, corde, ombre prédictive en six points, brume, personnage, textes flottants, puis l'interface (hauteur, multiplicateur, score), la bannière de palier et les écrans titre et fin sur un voile, avec la cause de la défaite.

`render/cues.ts` calcule sans PixiJS ni temps réel ce que le rendu montre de l'état : l'ombre prédictive, six positions de vol libre jusqu'à `shadowSeconds` avec la vitesse que donnerait le lâcher, propulseur compris, par la règle `releaseVelocity` de la simulation ; et l'usure de l'accroche fragile tenue, en pas de simulation pour tomber à zéro au pas exact de la casse. `render/effects.ts` porte tout le temps réel à l'écran, sans PixiJS : le trait du grappin qui se dessine en 60 ms, les textes flottants (« Frôlé ! », « +10 », « Parfait ×1,25 », « Boost », « Crac ») qui montent et s'effacent en 0,7 s en s'empilant s'ils se recouvriraient, et la bannière de palier qui vit 2 s. Le jeu y verse les événements de règles et le temps écoulé ; le rendu les relit.

`render/camera.ts` ne connaît ni PixiJS ni le DOM : dix mètres de large tiennent dans l'écran à zoom 1 ; le zoom cible vaut `1 / (1 + vitesse / 18)`, borné à 0,6 et de sorte que le personnage garde 14 px de diamètre ; centre et zoom sont lissés avec une constante de 0,25 s ; l'avance vers le haut vaut 2,5 m plus 0,08 m par m/s de vitesse verticale, bornée entre 1 et 5 m ; une bande dure garde le personnage entre 45 % et 70 % de la hauteur d'écran. La caméra reste centrée sur x = 0 pour ne pas balancer tout le décor avec le pendule, et ne suit en x que si le personnage s'approche à moins d'un mètre du bord.

`input/pointer.ts` suit un seul pointeur : appui au `pointerdown` avec capture, relâché au `pointerup`, `pointercancel` ou perte de capture, menu contextuel bloqué, position en pixels CSS relative au canvas. La souris produit les mêmes événements, ce qui rend le jeu jouable sur ordinateur et testable par Playwright.

`render/screens.ts` dessine les écrans sur un voile : le titre avec le niveau, la barre d'expérience, le record, les trois missions et leur avancement, les talismans équipés, le bouton « Talismans », « Toucher pour jouer » et l'indice de départ ; la fin avec la hauteur, la cause, le score, l'expérience gagnée, le record, les missions accomplies, le niveau atteint et les déblocages ; l'écran des talismans avec six lignes équipables ou verrouillées et un bouton « Retour ». Il retient les rectangles des boutons dessinés, et `hitTest(x, y)` dit lequel un appui touche. Tout est en PixiJS, sans DOM.

## Écrans et boucle de jeu

`app/game.ts` tient six écrans : titre, liste des niveaux, partie, fin, victoire et talismans. Une partie est un niveau, avec sa graine, son plan et sa brume, ou une course libre à départ avancé. Il charge le profil depuis un stockage injecté et calcule les réglages de chaque partie avec les talismans équipés ; tout ce qui naît avec une partie, simulation, réglages, caméra, effets, suiveur, vit dans un objet de partie. Sur le titre et sur la fin, un appui sur un bouton agit, sinon l'appui lance la partie et compte comme l'appui d'accroche ; six dixièmes de seconde après la mort, les appuis sont ignorés pour que l'écran de fin se lise. À la mort, le bilan est tiré, le profil mis à jour et sauvegardé aussitôt. Le temps réel est converti en pas fixes par un accumulateur plafonné à 100 ms par image ; la simulation ne voit jamais le temps réel. Chaque image : simulation, caméra, puis les événements de règles sont passés aux effets avec la position du personnage à l'écran, la mort retient sa cause, et le rendu dessine. Les réglages viennent de l'adresse : `?graine=` fixe la graine, et tout paramètre nommé comme une clé de `Tuning` surcharge la valeur, `?tierHeight=4` par exemple fait apparaître obstacles, fragiles et propulseurs dès les premiers mètres. `debugState()` expose un instantané lisible aux tests de bout en bout et aux séances de réglage, via `window.__grappin` : écran, pas, corde, point visé, hauteur, score, combo, position, vitesse, brume, graine, cause de la mort, palier, obstacles chargés, étoiles prises, niveau, expérience, talismans équipés, missions et expérience de la dernière partie. `window.__grappin` offre aussi `profile()`, `equip(id)`, `resetProfile()`, `playLevel(id)`, `playFree()` et `buttons()`, la liste des boutons dessinés.

## Tests et intégration continue

| Niveau | Outil | Ce qui est vérifié |
|---|---|---|
| Unitaire | Vitest en Node | Parabole, plafond de vitesse, corde à longueur constante, énergie, treuil, pompage, accroche, impulsion, lâcher parfait, combo, score, sol, brume, mémoire d'appui, visée et ligne de vue, coyote time, géométrie, fragiles, propulseurs, obstacles et frôlé, étoiles, paliers, générateur et profils, vérificateur sur deux cents graines, robots, déterminisme, niveaux, talismans, missions, profil et sa relecture, suiveur de partie, caméra, repères, effets, textes des écrans, pointeur, jeu et boutons, réglages d'URL |
| Bout en bout | Playwright, Chromium, 390 × 844 | Chargement sans erreur, doigt posé qui accroche au toucher et à la souris, relâché qui libère, tap qui lance, graine d'URL respectée, pilote automatique qui grimpe sans erreur de console, progression sauvegardée entre deux chargements, boutons des écrans par de vrais taps |
| Qualité | ESLint, tsc strict | Règles de déterminisme, typage strict avec index non vérifiés et propriétés optionnelles exactes |

Le workflow `.github/workflows/ci.yml` enchaîne lint, typage, tests, fumée mobile et build à chaque push, puis déploie `dist/` sur GitHub Pages depuis `main`. Le dépôt doit avoir GitHub Pages configuré sur la source « GitHub Actions ». Le build Pages utilise la base `/grappin/` via la variable `GRAPPIN_BASE`.

## Limites connues de la version 0.2

- La corde peut traverser un obstacle pendant le balancement ; seule l'accroche exige la ligne de vue.
- Le vérificateur suppose un joueur qui lâche à temps : une accroche fragile cassée pour avoir trop tenu n'est pas couverte par la garantie.
- La génération d'un segment prend quelques millisecondes sur le fil principal, une image perdue tous les vingt mètres environ ; un Worker viendra si cela se voit sur téléphone.
- Pas d'interpolation entre deux pas de simulation : une micro-saccade est possible sur un écran à 144 Hz.
- Aucun son, aucun habillage, aucune application installable : ils viennent après la validation de la sensation.

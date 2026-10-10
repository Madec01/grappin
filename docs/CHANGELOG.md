# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versionnage sémantique.

## [0.5.0] — 2026-10-10 — Prises écartées et traversières

Décision du propriétaire : ses quatre idées de prises sont retenues, dans l'ordre proposé par le Lead. Ce lot livre les deux premières.

### Ajouté

- Écartement progressif des prises : le déport d'un point au suivant grandit avec la hauteur en course libre (jusqu'à une fois et demie) et selon le niveau dans les traversées (du 4 au 10) ; la largeur jouable s'ouvre de ± 4 m à ± 6 m, les corniches suivent. Un pas ne dépasse jamais 6,8 m, ce que la corde sait suivre. La caméra dézoome d'elle-même quand des prises sortent des dix mètres de l'écran.
- Les traversières, septième événement : trois points du segment balaient toute la largeur de la ville, aller-retour en cinq secondes (plus lentement quand elle est large), sur un rail tireté. Le robot vérificateur accepte le segment dès qu'une des trois positions, un bout, le milieu, l'autre bout, le fait passer, puisqu'on peut attendre la prise en pendant au point d'avant. Tirées au sort en course libre avec les six autres.

### Corrigé

- Un segment trop court, coupé par un événement qui commence juste au-dessus du toit, pouvait poser un obstacle au-dessus de son propre sommet, pile sous le premier point du segment suivant : les obstacles restent désormais entre deux mètres au-dessus du départ et deux mètres sous le sommet.

## [0.4.3] — 2026-10-10 — Les six événements en course libre

Retour du propriétaire après test des niveaux : « la bascule rajoute de la difficulté, on meurt souvent au début surtout si on prend beaucoup de vitesse, mais avec l'habitude ça passe ». Demande : que la course libre tire toutes ces nouveautés au hasard.

### Modifié

- Course libre : passé le palier 0 d'apprentissage, un segment sur deux porte l'un des six événements, tiré au sort sans répéter le précédent ; auparavant, trois événements seulement avant le palier 4 et un segment sur trois.

## [0.4.2] — 2026-10-10 — Mode test

Demande du propriétaire : pouvoir tester les niveaux sans les gagner un par un.

### Ajouté

- Mode test par `?test=1` : tous les niveaux ouverts dans la liste et par `playLevel()`, la liste dit les événements de chaque niveau et la hauteur où ils commencent, un rappel « MODE TEST » pendant la partie, et un profil à part (`grappin.profil.test`) pour ne rien mêler à la vraie progression.

## [0.4.1] — 2026-10-10 — Six événements

Décision du propriétaire : les six événements proposés, dont la bascule du niveau.

### Ajouté

- Conditions physiques du moment : la gravité est un vecteur qui peut tourner, le vent une poussée ; vol, balancement, pompage, lâcher parfait, visée, ombre et vérificateur les suivent.
- Événements planifiés par hauteur dans chaque niveau, et tirés au sort en course libre dès le palier 2 : bascule, coup de vent, panne, pluie d'étoiles, alerte, câble ; bannières d'annonce ; chute hors de la ville pendant une bascule.
- Le vérificateur prouve chaque segment dans les conditions de son événement, les points sur câble aux deux bouts et au milieu, et le point d'entrée dans ses propres conditions ; la zone sans obstacle sous un point couvre tout le balancement. Les segments s'arrêtent aux frontières des événements, pour qu'aucun ne soit joué dans d'autres conditions que celles où il a été prouvé.
- Rendu : le niveau tourne à l'écran pendant la bascule, traînées de vent, lampadaires éteints, étoiles qui tombent, brume qui clignote, câbles dessinés.

## [0.4.0] — 2026-10-10 — Niveaux et variété

Décision du propriétaire : les niveaux fixes deviennent le mode principal, pour ne plus repartir de zéro et casser la répétition.

### Ajouté

- Dix niveaux fixes et enchaînés, de 60 à 100 m, chacun avec sa graine, sa brume, son profil et sa nouveauté ; ligne d'arrivée et victoire ; aucun obstacle dans les huit premiers mètres ; niveau engendré en entier à son départ.
- Trois étoiles par niveau, primes d'expérience, déblocage du niveau suivant, départ avancé de la course libre à la zone la plus haute franchie.
- Sept motifs de segments : chaîne, escalier, couloir d'étoiles, champ de dalles, rafale de propulseurs, série de fragiles, grand saut ; au moins une étoile par segment hors apprentissage.
- Écrans des niveaux, de victoire et de fin de niveau, intro du niveau, ligne d'arrivée dessinée, hauteur relative à l'objectif.
- Le toit de départ et la brume suivent la hauteur de départ ; la simulation accepte un plan de parcours, course libre ou niveau.

## [0.3.0] — 2026-10-09 — Progression

Décision du propriétaire : missions et niveaux à talismans, avant l'habillage.

### Ajouté

- Profil du joueur sauvegardé sur l'appareil : expérience, records, talismans équipés, missions ; relecture tolérante d'une sauvegarde absente, corrompue ou d'une autre version.
- Niveaux de grimpeur : l'expérience additionne les scores et les récompenses de missions ; le niveau 2 à 120 points, puis de plus en plus.
- Dix-huit missions, trois actives à la fois, du facile au difficile ; les missions de comptage s'accumulent, celles de record gardent le meilleur d'une partie.
- Six talismans débloqués par niveau, un puis deux emplacements : Treuil renforcé, Corde longue, Élan de départ, Seconde chance, Aimant à étoiles, Frôleur. Dans la simulation : élan de la première accroche et rebond de secours depuis la brume.
- Écrans titre, fin et talismans avec boutons tactiles ; indice de départ jusqu'à 30 m ; suiveur de partie ; l'événement de lâcher porte la durée de tenue, le genre du point et la casse.

## [0.2.1] — 2026-10-09 — Vitesse plus facile à prendre

Retour du propriétaire sur la 0.2.0 : difficile de prendre de la vitesse.

### Modifié

- Treuil plus franc : 3,5 m/s de raccourcissement et 60 % de conservation du moment cinétique, au lieu de 2,5 m/s et 50 %. Mesure des robots : un bon joueur atteint 8 m/s en 2,4 s au lieu de 6,4 s, un débutant monte 62 m en vingt secondes au lieu de 32, dix parties sur dix encore vivantes, aucun repli du générateur. L'ancien réglage se retrouve avec `?reelSpeed=2.5&reelSpin=0.5`.

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

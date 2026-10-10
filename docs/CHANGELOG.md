# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versionnage sémantique.

## [0.6.2] — 2026-10-10 — Les obstacles ne tuent plus

Retour du propriétaire : « les obstacles qui tuent d'un coup, c'est aussi trop fort ».

### Modifié

- Toucher un obstacle ne tue plus : c'est un choc. Le personnage est repoussé hors de l'obstacle, rebondit en ne gardant qu'un tiers de son élan dans la direction du choc et six dixièmes le long de la surface, lâche sa corde, perd sa série de parfaits et reste étourdi 0,45 s sans viser ni attraper ; « Boum » flotte. Sur le dessus d'une corniche, il peut se poser. La brume et la chute hors de la ville restent les seules fins de partie.
- Le frôlement rapporte toujours ; le robot vérificateur reste prudent : il ne compte jamais un vol qui traverse un obstacle.

## [0.6.1] — 2026-10-10 — La brume ralentit

Retour du propriétaire : « la brume monte trop vite ».

### Corrigé

- B-005 : dans un niveau, la brume gagnait de la vitesse avec la hauteur absolue de la ville, comme en course libre : au niveau 7 elle montait déjà à 2,6 m/s au lieu des 1,2 prévus, et dès le niveau 10 elle plafonnait à 3 m/s quel que soit le réglage du niveau. Un niveau joue désormais sa brume à vitesse constante, et le gain par palier se compte depuis le toit de départ, aussi en course libre partie haut.

### Modifié

- Brume de chaque niveau ralentie de 15 % (de 0,5 m/s au niveau 1 à 1,55 m/s au niveau 20), et la brume part cinq mètres sous le toit au lieu de trois.

## [0.6.0] — 2026-10-10 — Le lanceur et dix niveaux de plus

Demandes du propriétaire : « il faut plus de niveaux » et une nouvelle mécanique, le lanceur : « on s'accroche dessus et il faut tirer avec le doigt dans une direction opposée à celle où on veut aller, et plus on tire fort plus ça va loin ».

### Ajouté

- Le lanceur, nouvelle espèce de prise : on y est tiré et tenu, sans balancement ; on tire le doigt à l'opposé de là où l'on veut aller (jusqu'à 2,5 m de monde), on relâche, et le personnage part à l'opposé, de 6 m/s sans traction à 15 m/s à pleine traction. Un simple tap lance tout droit vers le haut, doucement. Un lancer ne compte ni comme parfait ni comme raté.
- Le motif « lanceur » du générateur : un lanceur, un mur à trou de 2,4 m entre 4,5 et 6 m au-dessus, et la chaîne qui reprend au-dessus du mur. Le vérificateur prouve chaque lanceur avec un éventail de 51 lancers (17 directions du haut, 3 forces) : l'un d'eux au moins doit passer. Dès le palier 2 en course libre.
- Dix niveaux de plus, du 11 au 20, de 820 à 2 000 m : Les passerelles, Les cheminées, Les tours, La centrale, Les enseignes de nuit, Le pont, L'orage, Le phare, Le vertige, Le ciel. Lanceurs partout, puis traversières, prises à cycles, vents, bascules, pannes et alertes combinés.
- Le journal des entrées garde la traction du relâché : un rejeu redonne la même partie.
- Le robot joueur sait lancer : vers le point le plus proche au-dessus, aux deux tiers de la force.
- Le lanceur à l'écran : une coupe en « Y » vert d'eau, un élastique de chaque pointe au personnage tiré, qui s'épaissit et blanchit avec la force, une jauge autour du personnage, un cercle tireté à la portée de la traction, et l'ombre prédictive allongée qui sert de visée. Le doigt qui glisse pendant la prise donne la traction, rotation de bascule comprise ; un relâché l'envoie à la simulation.
- La liste des niveaux se lit par pages de dix, avec « Niveaux 11 à 20 » et « Niveaux 1 à 10 », ouverte sur la page du niveau à jouer.
- Les musiques du propriétaire (dépôt Way, `assets/music/`, treize pistes) : une par niveau, en boucle, chargée au besoin, et celle du menu sur le titre ; la course libre prend la piste du niveau qui couvre sa hauteur. Rien ne joue avant le premier appui, comme l'exigent les navigateurs. Un réglage « Musique » sur le titre, gardé dans le profil.
- Niveaux plus longs, demande du propriétaire : de 90 à 260 m au lieu de 60 à 150, soit 3 600 m de ville en tout, avec des événements doublés pour remplir la longueur.

## [0.5.3] — 2026-10-10 — La prise électrique ne tue plus

Retour du propriétaire : « ça bug avec les prises électriques, sans que je m'accroche dessus, juste si le cercle de visée est dessus, ça me tue ; c'est un peu trop fort de tuer d'un coup ».

### Modifié

- La visée ne se pose plus jamais sur une prise électrique qui avertit ou qui est chargée : l'anneau va ailleurs, ou disparaît. Un appui, même gardé en mémoire, ne peut donc plus se poser dessus au mauvais moment.
- Pendre à une prise électrique quand elle se charge ne tue plus : c'est une décharge. La corde lâche, le personnage est repoussé à 5 m/s à l'opposé de la prise, la série de parfaits retombe à zéro et, pendant 0,7 s, il ne vise ni n'attrape rien. « Décharge ! » flotte à l'écran.

### Corrigé

- B-004 : avec l'appui gardé en mémoire (un doigt posé un peu en avance), le grappin pouvait se poser tout seul sur une prise électrique chargée dès qu'elle devenait la cible, et tuer sans que le joueur ait rien fait.

## [0.5.2] — 2026-10-10 — Style néon

Décision du propriétaire : « on va garder ce style minimaliste et en faire un style néon ». Les formes restent, la lumière change.

### Modifié

- Palette néon sur fond nuit : tube blanc froid à halo cyan pour les points, la corde, le personnage et l'anneau de visée ; étoiles jaunes ; fragiles magenta qui grésillent ; propulseurs cyan à chevrons qui scintillent ; prises électriques orange, qui grésillent quand elles avertissent et passent au rouge quand elles sont chargées ; prises à éclipse violettes, réduites à une trace sombre quand elles sont éteintes ; obstacles sombres cernés de rouge-magenta ; brume bleu-violet à crête lumineuse ; câbles et traversières en rail cyan.
- Halos sans filtre : chaque forme est tracée trois fois (deux halos puis le cœur), par lots de même couleur ; seuls les éléments à l'écran sont dessinés. Mesuré en rendu logiciel à parité avec l'ancien rendu sur les scènes de jeu ; à mesurer sur un vrai téléphone.
- Nouveaux : bords de la ville à ± 14 m en tube rouge sombre, visibles au dézoom et pendant la bascule ; silhouettes de toits et d'antennes en contour fin sur les côtés, déterministes par bande de vingt mètres ; anneau de visée qui s'allume en se resserrant, anneau qui pulse sur le point tenu ; titres, bannières et boutons à halo.
- Page HTML et couleur de thème au même fond nuit.

## [0.5.1] — 2026-10-10 — Prise électrique et prise à éclipse

Les deux dernières idées de prises du propriétaire, validées le 10 octobre 2026.

### Ajouté

- La prise électrique, un piège : elle se charge 1,5 s toutes les 4 s, avec un avertissement de 0,6 s avant ; l'attraper chargée, ou y pendre quand elle se charge, électrocute (« Électrocuté par une prise piégée »). Posée à côté d'un point de la chaîne, là où la visée peut la préférer.
- La prise à éclipse, un raccourci : allumée deux secondes, éteinte deux secondes ; éteinte, la visée l'ignore et le grappin ne l'attrape pas ; si l'on y pend quand elle s'éteint, la corde lâche sans casse. Posée au-dessus du point qu'elle permet de sauter.
- Les deux ne comptent jamais pour le vérificateur : chaque segment reste prouvé sans elles, et chacune a toujours un point normal à portée de corde. En course libre, éclipses dès le palier 3 (deux dès le 6), électriques dès le palier 4 ; dans les traversées, une éclipse au niveau 8, une électrique au 9, les deux au 10.
- Rendu provisoire avant le néon : la prise électrique est plus pâle, cerclée quand elle avertit, cerclée en gras quand elle est chargée ; la prise à éclipse éteinte s'assombrit comme un lampadaire en panne.

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

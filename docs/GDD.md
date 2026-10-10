# GRAPPIN, document de conception

Version 0.4.1, 10 octobre 2026. Le propriétaire du projet est le seul valideur du game design, du lore et de la direction artistique. Les points marqués [VALIDÉ] ont été tranchés par lui le 9 octobre 2026. Le Lead Game Architect a les pleins pouvoirs sur le code et l'architecture.

## 1. Vision [VALIDÉ]

**Pitch.** Un jeu d'arcade de mouvement, en portrait, sur téléphone. Le personnage monte en se balançant de point d'accroche en point d'accroche avec un grappin. Toute la maîtrise tient dans un seul geste : sentir le bon instant de lâcher pour conserver son élan.

**Expérience visée.** Le vol parfait, une longue chaîne fluide qui ressemble à de la danse.

**Format.** Écran portrait, parcours ascendant pour avoir de la place devant le personnage. Sessions courtes, relance immédiate. Jouable à la souris avec le même geste, pour les tests.

**Public.** Joueurs mobiles de tous niveaux. Une seule main suffit.

## 2. Univers [VALIDÉ, style néon minimaliste décidé le 10 octobre 2026]

**Ascension nocturne d'une ville.** Le personnage grimpe une ville la nuit, de toit en toit, de lampadaire en enseigne. Direction artistique proposée par le Lead et retenue par le propriétaire : silhouettes et lueurs, formes simples sur dégradés nocturnes, lisibles à grande vitesse et presque entièrement dessinables en code.

**Style néon minimaliste.** Décision du propriétaire après avoir joué la 0.4.2 : « on va garder ce style minimaliste et en faire un style néon ». Les formes restent celles d'aujourd'hui, des ronds, des traits, des étoiles ; ce qui change, c'est la lumière : chaque élément de jeu est un tube de néon sur fond nuit, avec son halo, sa couleur de tube et ses états (allumé, visé, tenu, grésillant, éteint). Le décor de ville reste en contours fins, jamais au point de concurrencer les points et les dangers. Livré en 0.5.2 : fond nuit `#070b16` ; tube blanc froid à halo cyan pour tout ce qui se joue (points, corde, personnage, visée) ; jaune pour les étoiles ; magenta pour le fragile ; cyan vif pour le propulseur ; orange puis rouge pour la prise électrique ; violet pour la prise à éclipse ; rouge-magenta pour les dangers (obstacles, bords de la ville) ; bleu-violet pour la brume.

**Accroches réactives, transposées dans la ville.** Les lampadaires s'allument au passage, les cloches d'église sonnent, les fenêtres s'éclairent, les enseignes grésillent. Elles matérialisent la chaîne.

**La brume.** Une brume lumineuse monte lentement depuis les rues. Elle est la ligne de mort et donne le rythme. Elle empêche aussi de rester pendu indéfiniment.

Le héros, son nom, et le détail du décor restent à proposer au propriétaire.

## 3. Contrôles [VALIDÉ]

- Un seul geste : maintenir le doigt n'importe où sur l'écran accroche le grappin, relâcher libère le personnage.
- L'accroche est immédiate au tap. Le trait du grappin se dessine en quelques centièmes de seconde pour l'œil seulement ; la physique n'attend pas.
- Tant que le doigt reste posé, le personnage se balance en pendule autour du point accroché.
- Au lâcher, le personnage garde la vitesse du moment : lâcher au point bas donne de la vitesse, en haut de la hauteur.
- Le point d'accroche visé est toujours surligné avant le tap. La sélection est stable : un autre point doit être nettement meilleur pour remplacer le point courant.
- Coyote time : un tap qui arrive juste après le passage d'un point l'accroche quand même.
- **Choix de route par le moment du lâcher.** Le point visé est celui qui se trouve sur la trajectoire que le personnage est en train de suivre. Le joueur choisit sa route haute ou basse par le moment où il lâche, jamais en visant au doigt. Hypothèse à prouver sur le prototype gris.

## 4. Physique [VALIDÉ]

- Douce mais crédible, gravité légèrement réduite pour le plaisir.
- C'est le cœur du jeu, réglé et testé avant tout contenu.
- Les balancements doivent être courts et nerveux : le vol ne doit jamais devenir une attente.
- **Jamais immobile.** Si l'élan est trop faible à l'accroche, ou si le personnage pend immobile sous le point plus d'une demi-seconde, une petite impulsion automatique et invisible le pousse vers l'accroche suivante. Le joueur ne peut pas rester pendu, et la brume qui monte s'occupe du reste.
- **Le treuil [VALIDÉ le 9 octobre 2026 sur le prototype 0.1].** Constat du Lead au premier prototype : un pendule pur conserve son énergie, le personnage ne monte jamais plus haut que son élan de départ, et un robot joueur plafonne à sept mètres avant de mourir dans la brume. Il faut une source d'énergie. Proposition : tant que le doigt reste posé, le grappin tire comme un treuil, la corde raccourcit à vitesse constante jusqu'à une longueur minimale, et le balancement s'accélère comme un patineur qui ramène les bras. Tenir plus longtemps rapproche du point et donne de la vitesse ; lâcher au bon moment transforme cette vitesse en vol. Le réglage est débrayable (`reelSpeed=0` redonne le pendule pur). Mesure du robot raisonnable sur cinq graines : deux mètres par seconde de montée, accroches tenues six dixièmes de seconde.
- **Le pompage [VALIDÉ le 9 octobre 2026].** Une fois la corde au plus court, le treuil n'apporte plus rien et un joueur qui tient trop longtemps finit avec un balancement mou. Dans l'esprit de « jamais immobile » : accroché et sans élan, le personnage se relance le long du cercle dans le sens où il va, jusqu'à une vitesse plancher de 4,5 m/s au point bas, bien sous ce qu'un lâcher donne. Un robot débutant, maladroit et lent à réagir, survit désormais plus de dix secondes sur vingt graines sur vingt. Débrayable (`swingAssistAccel=0`).

## 5. Cœur du jeu : l'élan [VALIDÉ]

- **Combo de lâchers parfaits.** Le multiplicateur monte quand on lâche dans la bonne fenêtre d'élan, signalée par un son et un éclat. Un lâcher raté remet le multiplicateur à zéro. Le score récompense exactement le geste que le jeu promet.
- **Frôlé.** Passer très près d'un obstacle donne un bonus.
- Les accroches réagissent au passage pour matérialiser la chaîne.

## 6. Points d'accroche [VALIDÉ]

- Normaux : accroche classique.
- Fragiles : cassent après une seconde de tenue et lâchent le personnage avec sa vitesse ; une accroche cassée n'est plus visable.
- Propulseurs : la vitesse au lâcher gagne un tiers, sans changer de direction.
- Mobiles ou rotatifs : bougent ou tournent, introduits en dernier.
- **Ligne de vue.** Le grappin ne traverse pas un obstacle : un point caché derrière une corniche n'est pas visable. Règle technique du Lead, qui rend les obstacles lisibles et le vérificateur honnête.

**Prises à cycles, idées du propriétaire livrées en 0.5.1.** La **prise électrique** est un piège : elle se charge 1,5 s toutes les 4 s, un avertissement de 0,6 s la précède. On ne peut l'attraper que calme, la visée ne se pose jamais dessus quand elle avertit ou qu'elle est chargée ; y pendre quand elle se charge donne une décharge : la corde lâche, le personnage est repoussé, la série de parfaits retombe à zéro et il reste étourdi 0,7 s, sans viser ni attraper. Pas de mort (retour du propriétaire sur la 0.5.2 : « trop fort de tuer d'un coup »). Elle est posée à côté d'un point de la chaîne : on lâche avant la charge. La **prise à éclipse** est un raccourci : allumée deux secondes, éteinte deux secondes ; éteinte, la visée l'ignore et le grappin ne l'attrape pas, et si l'on y pend quand elle s'éteint, la corde lâche sans casse. Elle est posée au-dessus du point qu'elle permet de sauter. Ni l'une ni l'autre ne compte pour le robot vérificateur : le parcours reste toujours faisable sans elles, et chacune garde un point normal à portée de corde. Les cycles sont décalés d'une prise à l'autre pour qu'elles ne battent pas ensemble.

**Le lanceur, idée du propriétaire livrée en 0.6.0.** « On s'accroche dessus et il faut tirer avec le doigt dans une direction opposée à celle où on veut aller, et plus on tire fort plus ça va loin. » On y est tiré et tenu, sans balancement ; la traction du doigt (jusqu'à 2,5 m de monde) recule le personnage comme la poche d'une fronde ; au relâché, il part à l'opposé, de 6 m/s sans traction à 15 m/s à pleine traction, et l'ombre prédictive montre le vol. Un simple tap lance doucement vers le haut. Un lancer ne compte ni comme parfait ni comme raté : la série reste. Le lanceur va avec le **mur à trou** : deux pans qui barrent la ville entre 4,5 et 6 m au-dessus, un trou de 2,4 m à viser, et la chaîne qui reprend plus haut. Le robot vérificateur essaie un éventail de 51 lancers (dix-sept directions du haut, trois forces) : l'un d'eux au moins doit passer.

## 7. Dangers [VALIDÉ]

- La brume qui monte.
- Obstacles fixes : corniches accrochées aux bords et dalles flottantes. Les toucher termine la partie ; passer à moins d'un demi-mètre sans toucher rapporte le bonus « Frôlé », une fois par obstacle et par corde.
- Obstacles mobiles, introduits en phase 4.

## 8. Parcours [VALIDÉ]

- Généré procéduralement par segments.
- Génération vérifiée : avant d'afficher un segment, un robot le joue et vérifie qu'un instant de lâcher atteint l'accroche suivante avec de la marge. Aucun passage impossible.
- Routes haute, risquée avec bonus, et basse, sûre, qui se rejoignent.
- Difficulté croissante, une nouvelle contrainte à la fois, par paliers de 50 m : palier 0, points normaux espacés de 3 m ; palier 1, un obstacle par segment et la fourche haute-basse ; palier 2, accroches fragiles ; palier 3, un propulseur par segment ; ensuite l'espacement grandit jusqu'à 5 m et jusqu'à trois obstacles par segment.
- Les premiers obstacles enseignent par la pratique comment le lâcher influence la trajectoire.
- **Fourche.** À une fourche, la route basse est proche et sûre, la route haute plus lointaine, avec une étoile qui rapporte, puis les deux se rejoignent. Le joueur choisit par le moment du lâcher et par le moment du tap : le point visé change au fil du vol.
- Paliers de hauteur nommés pour donner un sentiment d'étape. Noms pour la ville de nuit, validés le 9 octobre 2026 : Les toits, Les gouttières, Les enseignes, Les clochers, Les antennes, Les grues, Les nuages.
- **Garantie du vérificateur.** Avant d'afficher un segment, un robot joue chaque point avec la vraie physique, en supposant le pire élan d'arrivée, et exige qu'il existe toujours un instant de lâcher qui mène plus haut sans toucher d'obstacle ; pour une fourche, chaque branche doit être atteignable avec un élan ordinaire. Un segment refusé est régénéré ; un segment de repli serré, vérifié lui aussi, prend la place après six refus. Mesure : zéro repli sur quarante graines à tous les paliers, six millisecondes par segment.

## 9. Modes [VALIDÉ le 10 octobre 2026]

Retour du propriétaire sur la 0.3.0 : « quand on perd, redémarrer de zéro devient vite énervant, le jeu reste hyper répétitif ». Décision : les traversées deviennent le mode principal, la course libre passe en second.

- **Traversée en niveaux fixes.** Vingt niveaux nommés et enchaînés, de 90 à 260 m chacun (3 600 m en tout, allongés à la demande du propriétaire le 10 octobre 2026) : Les toits, Les gouttières, Les enseignes, Les clochers, Les antennes, Les grues, Les nuages, Les toits de nuit, Les gouttières de nuit, Le sommet, puis Les passerelles, Les cheminées, Les tours, La centrale, Les enseignes de nuit, Le pont, L'orage, Le phare, Le vertige, Le ciel. Chaque niveau est le même parcours à chaque essai, grâce à sa graine et à la physique déterministe : on l'apprend et on finit par le maîtriser. Chaque niveau apporte une nouveauté annoncée en une phrase à son départ, a sa brume à sa vitesse, et aucun obstacle dans ses huit premiers mètres. Perdre recommence le niveau, lui seul ; finir un niveau ouvre le suivant.
- **Trois étoiles par niveau** : terminer, ramasser toutes les étoiles du niveau, finir avec cinq lâchers parfaits d'affilée. Chaque étoile gagnée pour la première fois rapporte 50 points d'expérience, le premier passage d'un niveau 100.
- **Course libre**, pour le score, avec départ avancé : elle démarre à la zone la plus haute déjà franchie.
- **Sept motifs de segments**, dans les deux modes, tirés parmi ceux que le niveau ou le palier permet : chaîne en zigzag avec fourche, escalier serré, couloir d'étoiles, champ de dalles à frôler, rafale de trois propulseurs, série de fragiles, grand saut lancé par un propulseur. Hors zone d'apprentissage, chaque segment porte au moins une étoile.

## 9 bis. Progression [VALIDÉ le 9 octobre 2026]

Retour du propriétaire sur la 0.2.0 : « difficile de prendre de la vitesse, on pourrait ajouter une progression par niveaux qui donne accès à des bonus ». Analyse du Lead : bonne idée à condition qu'elle ne serve jamais à réparer la sensation de base, corrigée d'abord par le treuil plus franc de la 0.2.1. Placée avant l'habillage, à la demande du propriétaire.

- **Indice de départ.** Sur l'écran titre, tant que le joueur n'a pas atteint 30 m : « Garde le doigt posé pour prendre de l'élan, relâche en montant ».
- **Missions.** Trois missions actives, affichées sur l'écran titre avec leur avancement, réglées à la fin de chaque partie. Elles enseignent la technique : tenir la corde une seconde, enchaîner des lâchers parfaits, frôler, ramasser, monter, survivre, lâcher une fragile avant qu'elle casse, lâcher depuis un propulseur. Les missions de comptage s'accumulent d'une partie à l'autre, celles de record gardent le meilleur d'une partie. Une mission remplie rapporte de l'expérience et laisse place à la suivante du catalogue, du facile au difficile.
- **Niveaux de grimpeur.** L'expérience est la somme des scores de toutes les parties et des récompenses de missions. Le niveau 2 demande 120 points, le 3 en demande 360, le 4 en demande 720 : les premiers tombent vite, les suivants se méritent. L'écran de fin annonce l'expérience gagnée, les missions accomplies, le niveau atteint et ce qu'il débloque.
- **Talismans.** Des bonus débloqués par niveau et équipés avant la partie, un emplacement d'abord, deux à partir du niveau 4. Ils ne font que faciliter, jamais autre chose, et le robot vérificateur joue avec les réglages de la partie, talismans compris, donc sa garantie tient.

| Talisman | Niveau | Effet |
|---|---|---|
| Treuil renforcé | 1 | Le grappin tire 15 % plus vite |
| Corde longue | 2 | Un mètre de portée en plus |
| Élan de départ | 3 | La première accroche part à 6 m/s |
| Seconde chance | 4 | Une fois par partie, la brume renvoie vers le haut au lieu de prendre |
| Aimant à étoiles | 5 | Rayon de ramassage multiplié par 2,5 |
| Frôleur | 6 | Frôlés doublés, comptés 20 cm plus loin |

- **Ce que cela implique pour le score.** Un score obtenu avec un talisman ne se compare pas tout à fait à un score sans. Accepté pour un jeu solo.
- **Plus tard.** Les niveaux débloqueront les traversées une à une.

## 9 ter. Événements pendant les niveaux [VALIDÉ le 10 octobre 2026]

Demande du propriétaire : des événements qui influencent le jeu pendant un niveau, dont « faire tourner le niveau pour qu'il devienne horizontal ». Les six événements proposés par le Lead ont été retenus. Chacun est planifié à une hauteur fixe d'un niveau, annoncé par une bannière, et le robot vérificateur prouve chaque segment dans les conditions de l'événement qui le couvre. En course libre, passé le palier 0 d'apprentissage, un segment sur deux environ porte l'un des six événements, tiré au sort sans jamais répéter le précédent ; décision du propriétaire du 10 octobre 2026, pour que la grimpe sans fin ait toutes les nouveautés.

- **La bascule.** La gravité tourne d'un quart de tour en deux secondes, vers la gauche ou la droite, tient le temps d'une section, puis revient. Le niveau tourne à l'écran pour que le bas reste en bas : la progression devient horizontale, le personnage pend de côté des points, et tomber hors de la ville est une chute. La physique ne change pas d'une ligne : seule la direction de la gravité.
- **Le coup de vent.** Une poussée latérale de 3 m/s² qui dévie les vols, montée en une seconde, visible par des traînées.
- **La panne.** Les lampadaires s'éteignent par vagues, deux secondes toutes les quatre, décalés selon leur numéro ; un point éteint reste accrochable, on vise de mémoire.
- **La pluie d'étoiles.** Une étoile tous les six dixièmes de seconde tombe au-dessus du personnage, à cueillir au vol.
- **L'alerte.** La brume double de vitesse le temps d'une section.
- **Le câble.** Deux points du segment glissent de côté sur un câble de 3,2 m, aller-retour en trois secondes ; le vérificateur les prouve aux deux bouts et au milieu.
- **Les traversières.** Idée du propriétaire, livrée en 0.5.0 : trois points du segment balaient toute la largeur de la ville, aller-retour en cinq secondes à l'écartement 1, plus lentement quand la ville est plus large. On peut attendre la prise en pendant au point d'avant : le vérificateur accepte le segment dès qu'une des trois positions le fait passer. En course libre seulement pour l'instant.

Répartition dans les niveaux : pluie au 3, panne au 4, bascule au 5, vent au 6, alerte puis câbles au 7, bascule et panne au 8, vent, pluie et câbles au 9, bascule, alerte et panne au 10.

## 10. Caméra [VALIDÉ]

- Dézoom lissé à grande vitesse pour garder la lisibilité.
- Le personnage ne descend jamais sous une taille minimale à l'écran.
- Le joueur voit toujours les prochaines accroches.

## 11. Score [VALIDÉ]

- Score = hauteur gagnée × multiplicateur du combo, accumulé au fil de la montée.
- Ligne de record de hauteur affichée pendant la partie.
- Ombre prédictive de la trajectoire au lâcher : très courte pour tout le monde, longue en mode facile.

## 12. Feedback [VALIDÉ]

- La vitesse se matérialise : traînée, étirement, sifflement du vent. Le vrai flou de mouvement est remplacé par une traînée, moins coûteuse et plus lisible.
- Les effets ne masquent jamais les accroches ni les dangers.
- Pas de vibration. Le son et l'image portent le feedback.
- Le son ne démarre qu'après un premier tap : écran « Toucher pour jouer ».


**Musique.** Décision du propriétaire du 10 octobre 2026 : ses propres pistes (dépôt Way), une par niveau, en boucle ; la piste du menu sur le titre ; la course libre prend celle du niveau qui couvre sa hauteur. Un réglage « Musique » la coupe. Les bruitages viennent plus tard.
## 13. Options tranchées le 9 octobre 2026 [VALIDÉ]

| Option | Décision |
|---|---|
| Filets ou rattrapage de secours | NON. La relance immédiate est le filet. |
| Accroche élastique à tension variable | NON. Possible plus tard comme accroche spéciale « liane », en boîte à idées. |
| Vent et dérive signalés visuellement | OUI, en toute dernière contrainte de difficulté, toujours signalés. |
| Ombre prédictive | Très courte pour tous, longue en mode facile. |
| Fantôme de la meilleure run | Jugé non prioritaire. En boîte à idées avec le parcours du jour. |

## 14. Règles chiffrées de départ

Valeurs de départ pour le prototype, à régler à la main sur téléphone. Elles vivent dans un seul fichier du code pour être changées sans rien casser.

| Règle | Valeur de départ |
|---|---|
| Gravité | 7,5 m/s², soit environ trois quarts de la gravité réelle |
| Pas de simulation | 1/120 s |
| Longueur de corde | distance au moment du tap, bornée par la portée, puis raccourcie par le treuil jusqu'à 1,5 m |
| Treuil | 3,5 m/s de raccourcissement, 60 % de la conservation du moment cinétique (2,5 et 50 % avant le retour du propriétaire du 9 octobre 2026 : « difficile de prendre de la vitesse ») |
| Vitesse maximale | 24 m/s |
| Portée du grappin | 7 m |
| Élan minimal à l'accroche, sinon impulsion | 2 m/s tangentiels, impulsion à 3 m/s |
| Coyote time | 120 ms |
| Fenêtre du lâcher parfait | vitesse orientée entre 30° et 60° au-dessus de l'horizontale, dans le sens du mouvement |
| Multiplicateur | 1 + 0,25 × combo, plafonné à 5 |
| Vitesse de la brume | 0,8 m/s au départ, +0,1 m/s tous les 50 m, plafonnée à 3 m/s |
| Pompage | vitesse plancher 4,5 m/s au point bas, 4 m/s² |
| Accroche fragile | casse après 1 s de tenue |
| Propulseur | vitesse × 1,35 au lâcher |
| Frôlé | sous 0,5 m du bord, 5 points × multiplicateur |
| Étoile | rayon 0,35 m, 10 points × multiplicateur |
| Ombre prédictive | 0,25 s de vol |
| Palier | tous les 50 m |

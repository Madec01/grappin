# GRAPPIN, document de conception

Version 0.4.1, 10 octobre 2026. Le propriétaire du projet est le seul valideur du game design, du lore et de la direction artistique. Les points marqués [VALIDÉ] ont été tranchés par lui le 9 octobre 2026. Le Lead Game Architect a les pleins pouvoirs sur le code et l'architecture.

## 1. Vision [VALIDÉ]

**Pitch.** Un jeu d'arcade de mouvement, en portrait, sur téléphone. Le personnage monte en se balançant de point d'accroche en point d'accroche avec un grappin. Toute la maîtrise tient dans un seul geste : sentir le bon instant de lâcher pour conserver son élan.

**Expérience visée.** Le vol parfait, une longue chaîne fluide qui ressemble à de la danse.

**Format.** Écran portrait, parcours ascendant pour avoir de la place devant le personnage. Sessions courtes, relance immédiate. Jouable à la souris avec le même geste, pour les tests.

**Public.** Joueurs mobiles de tous niveaux. Une seule main suffit.

## 2. Univers [VALIDÉ, style néon minimaliste décidé le 10 octobre 2026]

**Ascension abstraite, dans la lumière.** Décision du propriétaire du 11 octobre 2026, prioritaire sur tout ce qui précède : le thème de la ville est abandonné. L'univers est abstrait, minimaliste et lumineux : une bille, des prises, des lignes, des anneaux, des rails, des cadres, des surfaces et des volumes simples sur fond sombre, en néon maîtrisé. Aucun bâtiment, fenêtre, lampadaire, enseigne ni récit urbain ; les mécaniques restent, leur habillage urbain et la progression « rallumer la ville » sont retirés ; les noms et illustrations urbains deviennent abstraits à mesure que le contenu est remanié (0.9.0 : noms des niveaux et des paliers, structures à la place des silhouettes). La richesse vient du mouvement, des trajectoires, des transformations et des réactions du jeu ; l'abandon de la ville ne rend pas le jeu austère. (Historique : la direction « ascension nocturne d'une ville », retenue le 9 octobre, a guidé les versions 0.1 à 0.8.)

**Style néon minimaliste.** Décision du propriétaire après avoir joué la 0.4.2 : « on va garder ce style minimaliste et en faire un style néon ». Les formes restent celles d'aujourd'hui, des ronds, des traits, des étoiles ; ce qui change, c'est la lumière : chaque élément de jeu est un tube de néon sur fond nuit, avec son halo, sa couleur de tube et ses états (allumé, visé, tenu, grésillant, éteint). Le décor (des structures géométriques abstraites depuis la 0.9.0) reste en contours fins, jamais au point de concurrencer les points et les dangers. Depuis la 0.6.5, à la demande du propriétaire, l'ambiance suit la famille de musique : Cyan nuit, Indigo, Glace, Lime, Braise, pour le fond, les silhouettes, le tube des points normaux, la brume et l'accent de l'interface, avec un fondu d'une seconde ; les couleurs qui portent un sens (étoiles, fragile, propulseur, électrique, éclipse, lanceur, dangers) ne changent jamais. Livré en 0.5.2 : fond nuit `#070b16` ; tube blanc froid à halo cyan pour tout ce qui se joue (points, corde, personnage, visée) ; jaune pour les étoiles ; magenta pour le fragile ; cyan vif pour le propulseur ; orange puis rouge pour la prise électrique ; violet pour la prise à éclipse ; rouge-magenta pour les dangers (obstacles, bords de la ville) ; bleu-violet pour la brume.

**L'ambiance pulse avec la musique.** Demande du propriétaire du 11 octobre 2026 : « que l'ambiance lumineuse pulse au rythme de la musique, que ça change de couleur d'effet, même les éléments du jeu ». Livré en 0.8.0 : le rythme de chaque piste est analysé une fois pour toutes (temps, force de chaque temps, mesure, graves, médiums, aigus) et le jeu lit le pouls à chaque image. Sur chaque temps, le fond monte d'un cran vers la brume, les halos des points, de la corde, du personnage et de l'anneau tenu s'élargissent et s'allument, la crête de brume s'éclaire, les immeubles de la ville dansent (les pairs sur les temps 1 et 3, les impairs sur 2 et 4), le cerne des obstacles et les halos des prises spéciales s'intensifient, le multiplicateur grossit ; les étoiles scintillent avec les aigus. À chaque temps, la couleur d'effet (halo des points, de la corde, des titres, teinte du fond, de la dalle, de la crête de brume et de la ville) change : trois couleurs franches par ambiance, A sur le temps fort puis B, C, B, choisies loin des couleurs des prises (0.8.1, sur demande d'un jeu « hyper dynamique visuellement ») ; le temps fort frappe plus fort que les autres. Règles de lisibilité : jamais une forme, une taille de cible ou une position ne bouge (seuls les traits de la ville, décor lointain, battent en épaisseur depuis la 0.12.1) ; les couleurs qui portent un sens ne changent pas ; l'état d'une prise électrique ou à éclipse passe avant la musique ; musique coupée, le rendu est exactement celui d'avant. Tous les réglages sont au même endroit (`PULSE`, render/pulse.ts). Retour du propriétaire sur la 0.12.0 : « les éléments de décor ne pulsent pas assez avec la musique, c'est trop faible ; je veux quelque chose de dynamique, de nerveux ». Depuis la 0.12.1 : amplitudes presque doublées, temps fort à +50 %, retombée plus sèche, couleur d'effet qui claque en 15 % du temps, force des temps relevée (plancher 0,3 plus racine de la force : sur les pistes du jeu, un temps sur deux a une force sous 0,5, et le coup restait à moitié), graves comptés seulement au-dessus d'un seuil (sans quoi ce qu'ils mènent reste allumé en continu), et traits de la ville qui s'épaississent et s'opacifient sur chaque temps. Second retour (0.12.2) : « le but de la lumière colorée, c'est que ça change de couleur aussi ». Les trois couleurs d'effet de chaque ambiance sont désormais trois teintes franchement différentes (cyan, rose, lime pour Cyan nuit ; pervenche, magenta-rose, lime-jaune pour Indigo ; bleu glace, rose-rouge, violet pour Glace ; lime, bleu, rose pour Lime ; saumon, bleu, jaune pour Braise), toujours distinctes des couleurs des prises, et tant que la musique bat, le fond, la nappe de brume, la dalle et le décor en gardent une part pendant tout le temps : la lumière est colorée et change de couleur à chaque temps. Troisième retour (0.12.3) : « tous les éléments ne doivent pas forcément avoir la même couleur, un peu comme en discothèque ». Trois lampes, donc : à tout instant les trois couleurs de l'ambiance sont là ensemble, la principale sur le personnage, la corde, la visée, la crête de brume et l'interface, la deuxième sur la nappe de brume, la dalle et le décor pair, la troisième sur le fond et le décor impair, et chaque point normal sous la sienne d'après son numéro ; chaque lampe change de couleur à chaque temps.

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

- **Combo : parfait, correct, erreur [prototype 0.9.0, sur le brief du 11 octobre 2026].** Le multiplicateur monte quand on lâche dans la bonne fenêtre d'élan, signalée par un son et un éclat. Un lâcher correct (ni parfait, ni une erreur) ne le casse plus : il le fait redescendre d'un cran (réglage `comboMissPenalty`, 0 pour le garder tel quel). Seules les erreurs réelles, choc contre un obstacle et décharge, le remettent à zéro. La série de parfaits (objectifs, étoile de série) est distincte du multiplicateur, et un lancer ne la coupe jamais. Le score récompense exactement le geste que le jeu promet.
- **Frôlé.** Passer très près d'un obstacle donne un bonus.
- Les accroches réagissent au passage pour matérialiser la chaîne.

## 6. Points d'accroche [VALIDÉ]

- Normaux : accroche classique.
- Fragiles : cassent après une seconde de tenue et lâchent le personnage avec sa vitesse ; une accroche cassée n'est plus visable.
- Propulseurs : la vitesse au lâcher gagne un tiers, sans changer de direction.
- Mobiles ou rotatifs : bougent ou tournent, introduits en dernier.
- **Ligne de vue.** Le grappin ne traverse pas un obstacle : un point caché derrière une corniche n'est pas visable. Règle technique du Lead, qui rend les obstacles lisibles et le vérificateur honnête.

**Prises à cycles, idées du propriétaire livrées en 0.5.1.** La **prise électrique** est un piège : elle se charge 1,5 s toutes les 4 s, un avertissement de 0,6 s la précède. On ne peut l'attraper que calme, la visée ne se pose jamais dessus quand elle avertit ou qu'elle est chargée ; y pendre quand elle se charge donne une décharge : la corde lâche, le personnage est repoussé, la série de parfaits retombe à zéro et il reste étourdi 0,7 s, sans viser ni attraper. Pas de mort (retour du propriétaire sur la 0.5.2 : « trop fort de tuer d'un coup »). Elle est posée à côté d'un point de la chaîne : on lâche avant la charge. La **prise à éclipse** est un raccourci : allumée deux secondes, éteinte deux secondes ; éteinte, la visée l'ignore et le grappin ne l'attrape pas, et si l'on y pend quand elle s'éteint, la corde lâche sans casse. Elle est posée au-dessus du point qu'elle permet de sauter. Ni l'une ni l'autre ne compte pour le robot vérificateur : le parcours reste toujours faisable sans elles, et chacune garde un point normal à portée de corde. Les cycles sont décalés d'une prise à l'autre pour qu'elles ne battent pas ensemble.

**Le lanceur, idée du propriétaire livrée en 0.6.0.** « On s'accroche dessus et il faut tirer avec le doigt dans une direction opposée à celle où on veut aller, et plus on tire fort plus ça va loin. » On y est tiré et tenu, sans balancement ; la traction du doigt (jusqu'à 2,5 m de monde) recule le personnage comme la poche d'une fronde ; au relâché, il part à l'opposé, de 6 m/s sans traction à 15 m/s à pleine traction, et l'ombre prédictive montre le vol. Un simple tap lance doucement vers le haut. Un lancer ne compte ni comme parfait ni comme raté : la série reste. Le lanceur va avec le **mur à trou** : deux pans qui barrent la zone entre 4,5 et 6 m au-dessus, un trou de 2,4 m à viser, et la chaîne qui reprend plus haut. **Reconception 0.9.0** (le propriétaire le trouvait trop facile, viser n'apportait pas assez) : le trou est toujours décalé du lanceur, de 1,9 à 2,7 m, si bien qu'un tir vertical bute sur le mur et qu'il faut choisir un angle ; une fois sur deux, quand les fourches sont permises, le mur a deux trous, un large et sûr d'un côté et un étroit surmonté d'une étoile de l'autre, les deux routes se rejoignant plus haut ; rien d'autre que le mur ne se pose dans le couloir du tir. Le robot vérificateur essaie un éventail de 132 lancers (trente-trois directions par pas de cinq degrés, quatre forces) : l'un d'eux au moins doit passer, et chaque route d'une fourche doit être attrapée. Restent à faire, dans l'ordre du brief : le passage sous un plafond (la pleine puissance est de trop), l'ouverture mobile, le tir avec rebond.

## 7. Dangers [VALIDÉ]

- La brume qui monte.
- Obstacles fixes : corniches accrochées aux bords et dalles flottantes. Les toucher est un choc, pas une mort (décision du propriétaire du 10 octobre 2026) : repoussé, rebond amorti, corde lâchée, série à zéro, étourdi 0,45 s ; on peut se poser sur le dessus d'une corniche. Passer à moins d'un demi-mètre sans toucher rapporte le bonus « Frôlé », une fois par obstacle et par corde.
- **Roue motorisée (P1), livrée en 0.13.0.** Une prise qui tourne : accroché, le personnage est entraîné le long de sa corde par un moteur jusqu'à 11 m/s, sans treuil, jusqu'à faire le tour ; il lâche où il veut. Le générateur la pose devant une prise dix mètres plus haut, que seule la roue atteint. Dès le palier 3.
- **Obstacle tournant (O2), livré en 0.13.0.** Une barre de 2,6 m qui fait un tour en six secondes ; la toucher est un choc. Elle ne barre pas la visée : on la passe au bon moment. Dès le palier 3.
- **Lanceur à ouverture mobile (L3, la glissière), livré en 0.13.0.** Le trou du mur va et vient de 2,4 m de part et d'autre, un aller-retour en cinq secondes : on tire quand il passe. Dès le palier 5.

**Obstacles à comportement, lot 2 du brief, livrés en 0.11.0** (chacun avec sa scène de démonstration, `?scene=`) :
- **Surface de rebond (O3).** Une dalle ou une corniche d'un autre habillage qui renvoie le personnage selon son angle d'arrivée, à 90 % de sa vitesse, presque sans frottement. La corde est lâchée s'il en tenait une, mais ni série perdue ni étourdissement : on rattrape un point dans la foulée. Une chute devient une remontée, un tir manqué se récupère ; utile autour des lanceurs et des passages indirects. Le vérificateur la tient pour solide : une route qui n'en dépend pas existe toujours. Dès le palier 1, et au niveau 12.
- **Paroi cassable (O4).** Une paroi fissurée que l'on traverse si l'on arrive à 10 m/s au moins (`smashSpeed`, un bon balancement, un propulseur ou un lanceur y mènent) : elle vole en éclats, le personnage garde 80 % de sa vitesse et marque 25 points ; en dessous, un choc ordinaire. Le rendu allume les fissures quand la vitesse suffit : la condition se perçoit sans chiffre. Le vérificateur la tient pour solide : il y a toujours une autre route, la paroi est un raccourci qui donne une fonction à la vitesse. Dès le palier 3, et au niveau 17.
- **Porte intermittente (O1).** Ouverte 3,6 s sur 6, elle prévient 0,8 s avant de se fermer, et chaque porte bat sur sa propre phase. Ouverte, son contour reste visible, on la traverse et on vise au travers ; fermée, elle repousse comme un solide. Elle ne se referme jamais sur le personnage : s'il est dedans au moment de la fermeture, elle reste franchissable pour lui jusqu'à ce qu'il en sorte. Le vérificateur prouve le parcours sans compter les portes : une porte peut se trouver sur le vol prouvé, et il faut choisir son moment, ou l'attendre en se balançant. Dès le palier 4, et au niveau 18. La scène « porte » est un lanceur dont le trou du mur est une porte : tirer quand elle est ouverte.
- **Anneau de précision (O5).** Un cercle d'1,1 m de rayon au milieu d'un vol, un peu au-dessus de la ligne entre deux points. Rien de solide : le traverser rapporte 15 points à la sortie, et 40 avec un cran de série si le passage s'approche à 40 % du rayon du centre ; le passage se juge au plus près du centre, pas au premier contact. Un anneau raté ne coûte rien. Dès le palier 2, et au niveau 15.

**Les nouveautés comptent (0.12.1).** Retour du propriétaire : « les cassables ne servent à rien dans le gameplay en l'état, pareil pour le reste ; il faut que ça rajoute des éléments de difficulté ». Depuis, le vérificateur joue rebonds, fracas et anneaux dans ses vols, et le générateur les exige par des motifs où le passage n'est prouvé qu'avec eux : le **mur à percer** (lanceur sous un mur cassable sans trou : pleine puissance ou rien), le **sas** (lanceur sous un mur dont le trou est une porte : tirer quand elle est ouverte), le **cerceau** (lanceur sous un mur dont le seul passage est un anneau étroit et décalé : un tir de précision), le **ricochet** (brief, L5 : une chicane barre le tir direct, un mur de rebond renvoie dans le trou), la **percée** (le couloir d'accélération sous un plafond cassable que seule sa vitesse perce). Les obstacles à comportement tirés au sort restent en plus, facultatifs. Limite constatée : hors lanceur et couloir, un rebond ne s'exige pas (il ne redonne jamais plus de hauteur qu'un vol direct, et la visée attrape à 5,6 m) ; le trampoline essayé est abandonné.

**Zones qui modifient le mouvement, lot 2 du brief (section 8), livrées en 0.12.0** (chacune avec sa scène, `?scene=`). Rien de solide : le vol y change. La visée, l'ombre prédictive et le vérificateur jouent les zones avec la vraie physique, si bien que l'ombre dit vrai sous un courant et qu'un parcours sous un courant est prouvé avec lui. Rien d'autre (obstacle, prise à cycles, anneau) ne se pose dans une zone.
- **Courant ascendant (Z1).** Une colonne de 3,2 m de large qui pousse vers le haut à 10 m/s², un peu plus que la gravité : on y monte doucement, porté, le temps de viser. Elle part un mètre au-dessus du point d'entrée et mène à un point dix mètres plus haut, hors de portée de corde : seul le courant y conduit (un balancement très énergique peut parfois y arriver seul). La poussée monte en douceur sur 0,6 m près des bords. Motif « courant », dès le palier 2, et au niveau 13.
- **Courant latéral (Z2).** Une bande de toute la largeur, haute de 3,5 m, qui pousse de côté à 5 m/s² : on prépare son entrée et on anticipe la dérive. Localisée, à la différence du coup de vent qui couvre tout l'écran ; la chaîne continue au travers. Motif « derive », dès le palier 3, et au niveau 19.
- **Couloir d'accélération (Z3) et zone de freinage (Z4).** Un couloir vertical de 5 m qui accélère le long de son axe seulement, à 22 m/s² jusqu'à un plafond de 14 m/s, sans toucher à la vitesse de côté ; un mètre plus haut, une zone de 3 m qui retire 2,5 fois la vitesse par seconde, jamais sous 2 m/s ; et le point de sortie douze mètres au-dessus de l'entrée : « accélération, envolée, freinage, rattrapage ». Motif « fusee », dès le palier 4, et au niveau 16.

## 8. Parcours [VALIDÉ]

- Généré procéduralement par segments.
- Génération vérifiée : avant d'afficher un segment, un robot le joue et vérifie qu'un instant de lâcher atteint l'accroche suivante avec de la marge. Aucun passage impossible.
- Routes haute, risquée avec bonus, et basse, sûre, qui se rejoignent.
- Difficulté croissante, une nouvelle contrainte à la fois, par paliers de 50 m : palier 0, points normaux espacés de 3 m ; palier 1, un obstacle par segment, une surface de rebond et la fourche haute-basse ; palier 2, accroches fragiles, un anneau de précision, le courant ascendant, le lanceur, le cerceau et le mur à percer ; palier 3, un propulseur et une paroi cassable par segment, et la dérive ; palier 4, une porte intermittente, la fusée, le sas, le ricochet et la percée ; ensuite l'espacement grandit jusqu'à 5 m et jusqu'à trois obstacles par segment.
- **Scènes de démonstration** (brief, section 18) : `?scene=rebond`, `cassable`, `porte`, `anneau`, `courant`, `derive`, `fusee`. La course libre commence par un segment construit à la main, le même à chaque fois, où la nouveauté se rencontre seule, avec son nom et une phrase en bannière ; puis la course libre continue. Les tests prouvent chaque scène par le vérificateur et y font grimper le robot.
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
- **Bruitages du geste [livrés en 0.9.0].** Accroche courte et nette, souffle au lâcher, son propre au parfait dont la note monte avec la série, lancer, propulsion, étoile, frôlement, choc, décharge, casse, brume, chute, arrivée, palier. Synthétisés, sans fichier ; coupés par le réglage « Sons ». Le son confirme les actions sans imposer de jouer sur le tempo de la musique.
- **Fenêtre de lâcher visible [livrée en 0.10.0].** Quand lâcher maintenant serait parfait, la corde et le halo du personnage prennent une teinte chaude et l'ombre prédictive s'allume un cran ; un état, pas une animation, rien ne change de taille.
- **Tutoriel par l'action [livré en 0.10.0].** Pas d'écran d'explications : un conseil court au moment du geste (première accroche, première fenêtre de lâcher, premier vol, premier lanceur, premier parfait), une seule fois par profil, qui s'efface donc de lui-même. Tant que 30 m n'ont jamais été atteints, la brume monte à 60 % et l'ombre prédictive porte deux fois plus loin ; ensuite tout revient au réglage normal.
- **Pause et reprise [livrées en 0.9.0].** Un bouton de pause pendant la partie, et la pause automatique quand l'application passe en arrière-plan ou que le système annule le geste. « Reprendre » ne lâche jamais une corde tenue ni ne déclenche un tir : le joueur reprend la corde en main en appuyant de nouveau.


**Musique.** Décision du propriétaire du 10 octobre 2026 : ses propres pistes (dépôt Way), une par niveau, en boucle ; la piste du menu sur le titre ; la course libre prend celle du niveau qui couvre sa hauteur. Un réglage « Musique » la coupe. Les bruitages (0.9.x) sont, depuis la 0.12.5, des échantillons libres (Kenney, CC0) plutôt que des sons de synthèse, que le propriétaire a refusés : « je n'aime pas les sons générés par oscillateur ». Depuis la 0.8.0, la musique se voit : l'ambiance et les éléments du jeu pulsent sur ses temps (voir la section 2).
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
| Vitesse maximale | 20 m/s ; le treuil n'accélère pas au-delà de 13 m/s ; un lâcher ne part pas à plus de 16 m/s (retour du propriétaire du 10 octobre 2026 : « la vitesse devient impossible à gérer ») |
| Portée du grappin | 7 m |
| Élan minimal à l'accroche, sinon impulsion | 2 m/s tangentiels, impulsion à 3 m/s |
| Coyote time | 120 ms |
| Fenêtre du lâcher parfait | vitesse orientée entre 30° et 60° au-dessus de l'horizontale, dans le sens du mouvement, et d'au moins 7 m/s (`perfectMinSpeed` ; 3 m/s avant 0.11.0, retour du propriétaire : le parfait s'allumait avec le minimum d'élan, pas pour le meilleur lâcher) |
| Multiplicateur | 1 + 0,25 × combo, plafonné à 5 |
| Vitesse de la brume | Course libre : 0,8 m/s au départ, +0,1 m/s tous les 50 m depuis le toit de départ, plafonnée à 3 m/s. Niveau : la vitesse du niveau, constante, de 0,5 m/s au premier à 1,55 m/s au vingtième. Départ cinq mètres sous le toit. |
| Pompage | vitesse plancher 4,5 m/s au point bas, 4 m/s² |
| Accroche fragile | casse après 1 s de tenue |
| Propulseur | vitesse × 1,35 au lâcher |
| Frôlé | sous 0,5 m du bord, 5 points × multiplicateur |
| Étoile | rayon 0,35 m, 10 points × multiplicateur |
| Ombre prédictive | 0,25 s de vol |
| Palier | tous les 50 m |

**L'atelier, où l'on choisit ce que l'on affronte (0.13.0, dans le jeu principal depuis la 0.13.1).** Demande du propriétaire : « un vrai mode test dans le jeu où je peux choisir à quelles prises ou autres éléments je veux être confronté », puis « mets-le dans le jeu principal, arrête de faire des versions en plus ». Le titre porte un bouton « Atelier : choisis ce que tu affrontes » : un catalogue de vingt-huit éléments en cinq groupes (prises, obstacles, lanceurs à usage exigé, zones, événements), que l'on coche ; la course n'engendre alors que des segments qui portent ces éléments, et les événements choisis se succèdent à chaque segment. Pour tester une mécanique seule, l'enchaîner, ou en combiner plusieurs. Le choix se garde dans le profil ; une partie d'atelier ne compte ni pour les records, ni pour les missions, ni pour l'expérience.

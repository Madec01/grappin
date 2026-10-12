# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versionnage sémantique.

## [0.14.0] — 2026-10-12 — Lot 3 : le serpentin, l'accordéon, la poche de faible gravité

Demande du propriétaire : « go pour le lot 3 ». Les trois transformations du terrain du brief (section 12, priorité suggérée : serpentin, accordéon, faible gravité), chacune avec sa scène, son entrée dans l'atelier, sa place dans les niveaux et la course libre, prouvée par le vérificateur et jouée par les robots.

### Ajouté

- **Le serpentin (T1)**, événement `serpentin`, « première extension de la bascule » : sur 45 m, la gravité s'incline par stades d'égale hauteur, un huitième de tour (oblique), un quart (horizontal), un huitième, puis revient ; d'un stade à l'autre elle tourne en douceur, deux fois plus lentement que la bascule (un quart de tour en quatre secondes). Le monde tourne à l'écran avec elle : le parcours apparaît vertical, oblique, horizontal, oblique, vertical. Le générateur coupe ses segments à chaque stade et prouve chacun dans la gravité de son stade (`eventBoundaries`, `environmentOf` à une hauteur), la zone de pendaison des obstacles étant penchée avec elle. Dès le palier 2 en course libre, au niveau 19 (à la place d'une bascule) et au 20 ; scène `?scene=serpentin`, qui commence au sommet de sa chaîne.
- **L'accordéon (T3)**, motif `accordeon` : deux bandes de trois prises, gauche et droite, qui se rapprochent et s'écartent en miroir (sur câble, un aller-retour en six secondes, écartées de ± 2,2 m au repos et de ± 1,2 m de course à l'écartement 1). Resserrées, on traverse d'une bande à l'autre ; écartées, elles sont hors de portée l'une de l'autre, on grimpe la sienne. Le vérificateur prouve le segment dans les trois états (écarté, à mi-course, resserré) : 58 segments sur 60 construits. Une fois sur deux, quand les lanceurs sont permis, on y entre par un lanceur, « la distance de la cible évolue ». Les prises de bande (`Anchor.band`) ne deviennent ni fragiles ni câbles d'événement. Dès le palier 4, aux niveaux 17 et 20 ; scène `?scene=accordeon` (avec lanceur).
- **La poche de faible gravité (T6)**, zone `poche` et motif `poche` : une poche de toute la largeur, haute de 12 m, où la gravité tombe à 30 % de sa valeur, en douceur sur 1,5 m à l'entrée et à la sortie (`gravityScale`, `POCKET_RAMP`) ; les vols s'allongent, le grappin sert à courber et à freiner, les prises y sont plus espacées (4,2 m de montée, ± 1,9 m de côté), et rien d'autre ne s'y pose : une respiration. Le balancement aussi se joue avec la gravité du lieu. 57 segments sur 60 construits, tous prouvés. Dès le palier 2, aux niveaux 14 et 20 ; scène `?scene=poche`.
- **Atelier** : un groupe « Transformations du terrain » (serpentin, accordeon, poche), trente et un éléments en six groupes ; un seul événement choisi revient segment après segment (avant, l'atelier plantait sur un seul événement choisi : `rng.pick` sur une liste vide).
- Robots : avant de lâcher, le robot vérifie, un pas sur quatre, que le vol qui suivrait attrape une prise plus haute (`flightCatches`, ce que le vérificateur prouve) ; après un lâcher il ne rattrape rien plus bas tant qu'il monte, « plus haut » s'entendant à l'opposé de la gravité du moment, sauf s'il file vers le bord du monde ; et il garde la corde si le vol sort du monde en une seconde et demie. Sans cela, il faisait du surplace entre les deux bandes d'un accordéon ou entre un lanceur et la prise d'au-dessus. Mesuré : le robot raisonnable survit 60 s sur les trois scènes et sur huit parties d'atelier de chaque transformation.
- Rendu : voir les choix d'habillage ci-dessous.

### Modifié

- Niveau 14 « La décharge » porte une poche de faible gravité pour souffler ; niveau 17 « L'orage » un accordéon ; niveau 19 « Le vertige » un serpentin à la place de sa première bascule ; niveau 20 « Le ciel » tout, dont un serpentin.
- `environmentOf(events, startY, y)` prend la hauteur pour dire la gravité d'un stade de serpentin ; sans hauteur, un quart de tour, comme une bascule. Les événements de course libre ont une longueur par espèce (`eventLength`) ; une scène peut porter des événements (`SceneDef.events`).

## [0.13.1] — 2026-10-12 — L'atelier dans le jeu principal

Retour du propriétaire : « mets-le dans le jeu principal ! Arrête de faire des versions en plus ». L'atelier ne demande plus le mode test.

### Modifié

- **Le bouton « Atelier : choisis ce que tu affrontes » est sur le titre du jeu principal**, sous les trois accès, pour tout le monde et dans l'application installée. Le choix se garde dans le profil ordinaire.
- **Une partie d'atelier ne compte pas** : ni record de hauteur ou de score, ni mission, ni expérience ; l'écran de l'atelier le dit. L'écran de fin montre le bilan de la partie, sans rien y ajouter.
- `?test=1` reste ce qu'il était : tous les niveaux ouverts, un profil à part. Il ne sert plus à ouvrir l'atelier.

## [0.13.0] — 2026-10-12 — Fin du lot 2 : la roue, le tournant, la glissière ; et l'atelier

Demande du propriétaire : « finis le lot 2 », et « un vrai mode test dans le jeu où je peux choisir à quelles prises ou autres éléments je veux être confronté ».

### Ajouté

- **Roue motorisée (P1 du brief)**, prise `roue` : accroché, le personnage est entraîné le long de sa corde par un moteur (`wheelSpeed` 11 m/s, `wheelAccel` 18 m/s²), sans treuil ni pompage, jusqu'à faire le tour ; il lâche où il veut, et la roue porte loin. Le vérificateur joue le moteur dans ses balancements, et le motif « roue » reprend la chaîne dix mètres plus haut, du côté où la roue envoie, hors de portée d'un balancement ordinaire : mesuré, 50 segments sur 60 construits, tous prouvés, aucun sans le moteur. Dès le palier 3, aux niveaux 13 et 20, scène `?scene=roue`. Tube bleu sarcelle.
- **Obstacle tournant (O2)**, obstacle `tournant` : une barre de 2,6 m qui fait un tour en six secondes autour d'un pivot, dans un sens ou l'autre ; la toucher est un choc. Elle ne barre jamais la visée : on la passe au bon moment, le vérificateur ne compte pas sur elle (comme une porte), et les robots regardent où elle sera. Posée comme une dalle, une par segment du motif « tournant » (dès le palier 3, aux niveaux 16 et 20) et selon le profil (`rotors`). Scène `?scene=tournant`.
- **Lanceur à ouverture mobile (L3, « glissière »)** : au-dessus d'un lanceur, un mur dont le trou va et vient de 2,4 m de part et d'autre, un aller-retour en cinq secondes : on tire quand il passe. Les panneaux glissent (`slide`), couvrent le monde quel que soit leur décalage, et le vérificateur, qui ne compte pas sur eux, prouve le tir droit ; les robots attendent le trou (jusqu'à six secondes). Dès le palier 5, aux niveaux 18 et 20, scène `?scene=glissiere`.
- **Géométrie qui bouge** (`sim/moving.ts`) : où est un obstacle à un pas donné (`obstacleAt`, `rotorEnds`, `obstacleGap`, `pushOutAt`), déterministe, avec une trigonométrie à quatre opérations (`core/math/trig.ts`, juste à un millième) puisque celle du moteur JavaScript est interdite dans la simulation.
- **L'atelier**, le mode test où l'on choisit ce que l'on affronte (`data/atelier.ts`) : en mode test (`?test=1`), un bouton « Atelier » sur le titre ouvre un catalogue de vingt-huit éléments en cinq groupes (prises, obstacles, lanceurs à usage exigé, zones, événements), à cocher ; Tout, Rien, « Jouer l'atelier ». La course n'engendre alors que des segments qui portent les éléments choisis (choisir une seule chose, c'est la voir à chaque segment), et les événements choisis se succèdent à chaque segment. Le choix se garde dans le profil du mode test ; `?atelier=roue,tournant` ouvre une partie d'atelier directement, `window.__grappin.playAtelier([...])` aussi.
- Robots : sur une roue, le robot lâche au premier instant où le vol attrape un point au-dessus d'elle (ce que le vérificateur a prouvé) ; sous une glissière, il attend le trou ; avant tout lâcher, il garde la corde si le vol file vers le bord du monde. Le pilote des scènes (tests de bout en bout, captures) fait de même.
- Rendu : la roue est un moyeu sarcelle dans une jante à cinq rayons qui tournent dans le sens du moteur, avec des chevrons pour lire le sens sur une image fixe, jamais moins de 24 px de rayon quand la caméra recule ; la barre tournante est une capsule rouge-magenta de bout à bout, au cerne pulsé, avec son pivot ; les panneaux qui glissent se dessinent là où ils sont. Trois tests de bout en bout à horloge figée (roue tenue à plus de 10 m/s puis lâcher au-dessus de 18 m ; tournant passé ; tir de la glissière seulement quand le trou passe), un pour l'atelier, et des captures.

## [0.12.5] — 2026-10-12 — La musique part au premier geste, des vrais bruitages

Deux retours du propriétaire : « la musique ne se lance pas systématiquement tant qu'on ne fait pas pause une première fois », et « les sons sont horribles, je n'aime pas les sons générés par oscillateur ».

### Corrigé

- **La musique restait muette jusqu'à la première pause (B-014).** Safari, sur iPhone, n'accepte de jouer un son que dans un geste du joueur, sauf sur un élément audio qui a déjà joué dans un geste. Le jeu changeait de piste hors de tout geste (le titre lance un niveau, la course libre monte d'un biome) sur un élément neuf : refusé, en silence. La pause, elle, relançait la piste dans un geste. Désormais une petite réserve de lecteurs est « jouée » sur un silence dans le premier geste, puis réutilisée piste après piste ; et chaque appui relance une piste voulue qui ne jouerait pas (`Music.nudge`) : au pire, la musique part au premier appui qui suit, jamais plus tard.

### Modifié

- **Les bruitages sont des échantillons**, plus des recettes de synthèse : dix-sept sons courts (`public/sons/`, MP3 mono, 132 Ko en tout), tirés des packs de Kenney (www.kenney.nl, domaine public, CC0), coupés et normalisés : clic métallique à l'accroche, souffle d'étoffe au lâcher, pincement au parfait (toujours un demi-ton plus haut par parfait d'affilée), poussée au lancer et à la propulsion, tintement de verre à l'étoile, tic au frôlé, coup au choc, champ de force au rebond, verre brisé au fracas, cloche à l'anneau (une quinte plus haut au centre), grésillement à la décharge, craquement à la casse, grondement dans la brume, descente à la chute, confirmation à l'arrivée, montée au palier. Joués par Web Audio avec leur hauteur et leur volume, chargés au démarrage sans bloquer, gardés hors-ligne avec la coquille. Chaque son se remplace en changeant un fichier (`SAMPLES`, audio/sfx.ts).

## [0.12.4] — 2026-10-12 — Le titre propose d'installer le jeu

Retour du propriétaire : « le jeu ne me propose toujours pas de l'installer ». Le jeu est installable depuis la 0.7.0, mais aucun navigateur ne le propose de lui-même de façon sûre : Chrome, sur Android, n'offre l'installation qu'après un temps d'usage, par une petite barre qu'on ferme sans la voir ; Safari, sur iPhone et iPad, ne la propose jamais, il faut passer par le menu Partager.

### Ajouté

- **Bouton « Installer le jeu » sur le titre** (`app/install.ts`), sous les accès, dès que le navigateur annonce qu'il sait installer en un geste (`beforeinstallprompt`, que le jeu garde pour lui au lieu de laisser Chrome l'afficher à sa guise) : l'appui ouvre l'invite d'installation du navigateur. Acceptée ou refusée, l'invite ne sert qu'une fois : le bouton s'efface jusqu'à ce que le navigateur en redonne une.
- **Sur iPhone et iPad**, hors application, le titre rappelle le chemin en une ligne : « Pour installer : Partager → Sur l'écran d'accueil ».
- Ouvert depuis l'écran d'accueil, ou une fois installé, le titre ne dit plus rien. `debugState().install` dit ce que le titre montre ; un test de bout en bout imite l'annonce de Chrome, appuie sur le bouton et vérifie l'invite.

## [0.12.3] — 2026-10-12 — Comme en discothèque : trois lampes

Retour du propriétaire sur la 0.12.2 : « tous les éléments ne doivent pas forcément avoir la même couleur, un peu comme en discothèque ». Cause : toute la scène prenait la couleur du temps, une seule à la fois.

### Modifié

- **Trois lampes** (`LAMP`, `lampColor`, render/pulse.ts) : à tout instant, les trois couleurs d'effet de l'ambiance sont là ensemble, chacune sur sa lampe, et chaque lampe change de couleur à chaque temps (la principale suit A, B, C, B ; les deux autres la suivent d'un et de deux crans). La lampe principale éclaire le personnage, la corde, la visée, la crête de brume et l'interface ; la nappe de brume, la dalle du toit et le décor pair ont la deuxième ; le fond et le décor impair la troisième.
- **Chaque point normal sous sa lampe**, d'après son numéro : trois couleurs de halo à la fois sur la paroi, voisines jamais pareilles, qui tournent à chaque temps. Le cœur des points reste celui du tube, et les prises spéciales gardent leurs couleurs.
- Les deux lots du décor qui dansent ne sont plus « allumé ou éteint » dans une même couleur : chacun sous sa lampe, jamais de la même couleur, et celui dont c'est le temps s'allume à plein.

## [0.12.2] — 2026-10-12 — La lumière colorée change de couleur

Retour du propriétaire sur la 0.12.1 : « le but de la lumière colorée, c'est que ça change de couleur aussi ». Cause : les trois couleurs d'effet de chaque ambiance étaient trois bleus voisins (ou trois verts, trois crèmes), et la teinte du fond ne durait que le coup du temps : l'œil voyait battre la lumière, pas changer sa couleur.

### Modifié

- **Trois teintes franches par ambiance** (`render/palette.ts`), à peu près un tiers de cercle entre elles, la première restant celle de la famille : Cyan nuit en cyan, rose et lime ; Indigo en pervenche, magenta-rose et lime-jaune ; Glace en bleu glace, rose-rouge et violet ; Lime en lime, bleu et rose ; Braise en saumon, bleu et jaune. Toujours à plus de 40 de toute couleur d'espèce et des teintes chaudes du lâcher parfait (les tests le gardent) : les prises se lisent à leur cœur et à leur forme, jamais à la seule teinte du halo.
- **La lumière reste colorée pendant tout le temps**, pas seulement sur le coup : tant que la musique bat, le fond (20 %), la nappe de brume (50 %), la dalle du toit (20 %) et les structures du décor (30 %) gardent une part de la couleur d'effet, qui change à chaque temps (A sur le temps fort, puis B, C, B, en 15 % du temps) ; sur le coup, le fond, la brume et la dalle se teintent davantage. Au silence et avant le premier temps, rien ne change, comme avant.

## [0.12.1] — 2026-10-11 — Les nouveautés comptent : des mécaniques exigées, pas décoratives

Retour du propriétaire sur 0.11.0 : « tout fonctionne, mais les cassables ne servent à rien dans le gameplay en l'état, pareil pour le reste. Il faut que ça rajoute des éléments de difficulté. » Cause : le parcours était prouvé *sans* les nouveautés, qui restaient facultatives. Désormais le vérificateur joue les mécaniques dans ses vols, et le générateur peut les exiger : un passage n'est prouvé qu'avec elles.

### Ajouté

- **Le vérificateur joue les rencontres** (`sim/flight.ts`, partagé avec les règles du jeu) : dans ses vols, une surface de rebond renvoie, une paroi cassable cède si l'on va assez vite et arrête sinon, un anneau traversé accélère, les zones poussent. Les mêmes formules que la partie, au pas près.
- **Mur à percer (« brise »).** Un lanceur sous un mur cassable sans trou, de toute la largeur : seul un tir à pleine puissance le traverse, un tir mou rebondit. Mesuré : 60 segments sur 60 prouvés avec le mur, 0 sans lui. Dès le palier 2, au niveau 17, scène `?scene=cassable`.
- **Ricochet (« ricochet », brief L5).** Un lanceur dont une chicane barre le tir direct vers le trou du mur ; un mur de rebond vertical, de l'autre côté, renvoie un tir tiré sous la chicane par-dessus elle et dans le trou. Géométrie trouvée par balayage (288 combinaisons, 4 réussissent partout), figée (mur à 5,2 m). 60 sur 60 prouvés avec le rebond, 0 sans. Dès le palier 4, au niveau 12, scène `?scene=rebond`.
- **Percée (« percee »).** Le couloir d'accélération de la fusée sous un plafond cassable de toute la largeur : seule la vitesse du couloir le perce. 60 sur 60 prouvés avec, 0 sans. Dès le palier 4, au niveau 16.
- **Sas (« sas »).** Un lanceur sous un mur dont le trou, décalé, est une porte : on tire quand elle est ouverte. Dès le palier 4, au niveau 18, scène `?scene=porte`.
- **Cerceau (« cerceau »).** Un lanceur sous un mur dont le seul passage est un anneau, plus étroit que le trou d'un mur ordinaire et décalé : un tir de précision ; la sortie est de côté, au-dessus d'un pan, pour qu'on ne l'attrape pas à travers l'anneau avant de l'avoir passé. Dès le palier 2, au niveau 15, scène `?scene=anneau`.
- **Tout anneau traversé accélère** (`ringBoost` 1,3) ; le centre rapporte et monte la série comme avant. Un anneau traversé laisse derrière le personnage trois traits de vitesse de sa couleur pendant 0,3 s, plus clairs s'il est pris au centre (`boostStreaks`, render/effects.ts).
- **Robots** : avant d'attraper, un robot regarde le balancement qui suivrait (comme le vérificateur) et attend un meilleur moment si ce balancement heurte un mur, sauf s'il tombe ou si ce point est le dernier à portée (un choc vaut mieux qu'une sortie du monde) ; avant de lâcher, il regarde une demi-seconde de vol et garde la corde si elle finit dans un mur. La règle de 0.12.0 « porté vers le haut, ne pas rattraper un point sous soi » ne vaut plus que si une zone est devant lui (où son vol arrive en 0,4 s) : partout ailleurs, elle l'envoyait hors du monde (0.12.0 : trois robots raisonnables sur dix survivaient à soixante secondes ; 0.12.1 : dix sur dix, comme en 0.11.0).

### Corrigé

- **Les murs au-dessus des lanceurs se contournaient par les côtés (B-013).** Ils s'arrêtaient un mètre après la largeur des points (± 5 m), mais le monde va jusqu'à ± 14 m : dans la scène du cerceau, le robot attrapait la sortie à travers le trou, passait à 7,7 m de côté sous le mur et ne traversait jamais l'anneau ; le trou, la porte, l'anneau ou la paroi à percer n'obligeaient à rien. Trouvé par le Codeur principal en écrivant le test de bout en bout du cerceau. Tous les murs au-dessus d'un lanceur (mur à trou de 0.10.0 compris, porte, anneau, paroi à percer, plafond de la percée) vont maintenant d'un bord du monde à l'autre (± 15 m). Les tests comptent désormais les rencontres dans la scène elle-même, pas dans la course libre qui la suit ; les robots de la course libre restent à dix sur dix vivants.
- La scène `rebond` s'appelait encore « Le trampoline », avec l'intro du trampoline abandonné : « Le ricochet », et une intro qui dit la chicane et le mur violet.
- **Posé sur une corniche, le personnage restait étourdi sans fin (B-012).** À chaque pas il la touchait à vitesse nulle, ce qui comptait pour un choc : étourdi, sans cible, sans pouvoir rien attraper, jusqu'à la brume. Se poser n'est plus un choc : il reste posé, garde sa série, vise et attrape.
- **Un pilote qui tire depuis un lanceur partait du lanceur lui-même**, pas de la position reculée par la traction que suppose le vérificateur (et où un doigt l'aurait mis) : 1,7 m d'écart qui envoyaient le robot dans la chicane du ricochet. `Simulation.release(pull)` recule le personnage d'abord.

### Modifié

- **Le pouls est bien plus nerveux.** Retour du propriétaire sur la 0.12.0 : « les éléments de décor ne pulsent pas assez avec la musique, c'est trop faible ; je veux quelque chose de dynamique, de nerveux ». Mesuré sur les treize pistes : la force médiane d'un temps est entre 0,35 et 0,65, un temps sur deux sous 0,5, si bien que tout ce qui battait « × force » restait à moitié. Le coup vaut désormais un plancher de 0,3 plus la racine de la force : un temps moyen frappe à plus de 80 %, un temps deviné dans un passage calme frappe encore à moitié. Les amplitudes ont monté (fond jusqu'à 40 % vers la brume au lieu de 24, crête de brume presque blanche sur le temps, prises spéciales ×1,9 au lieu de ×1,5, cerne des obstacles ×2 au lieu de ×1,6, multiplicateur +30 % au lieu de +18 ; le halo ambiant garde son gain, car au-delà il sature en disque plat, mais il le reçoit maintenant presque à plein sur chaque temps), le temps fort frappe moitié plus que les autres (+50 % au lieu de +30), la retombée après un temps est plus sèche (10 % au milieu du temps au lieu de 22), la couleur d'effet claque en 15 % du temps au lieu de 30, les graves ne comptent qu'au-dessus de 0,3 (ils ne descendent presque jamais sous 0,2 : ce qu'ils menaient restait allumé en continu, sans à-coups), et les traits de la ville s'épaississent et s'opacifient sur chaque temps (jusqu'à ×2,2 sur le temps fort), seul endroit où le pouls touche une épaisseur : la ville est un décor, jamais une cible. Au silence, rien ne change, comme avant.
- Le trampoline, essayé comme usage exigé du rebond, est abandonné : un rebond ne redonne jamais plus de hauteur qu'un vol direct, et la visée automatique attrape à 5,6 m, si bien qu'aucune géométrie sans lanceur n'oblige à rebondir. Les surfaces de rebond restent, en filet et en ricochet.
- Les scènes `rebond`, `cassable` et `anneau` montrent l'usage exigé ; leurs noms : « Le ricochet », « Le mur à percer », « Le cerceau ».
- Le test « un obstacle ne tue pas » lâche le personnage sur une dalle, au lieu d'attendre qu'un pilote heurte quelque chose.

### Technique

- `scripts/pilote.ts` : un pilote image par image des scènes, aux règles du robot (pas de point sous soi en montant, pas d'accroche si le balancement heurte un mur, 0,35 s au lanceur puis la traction prouvée), partagé par les tests de bout en bout et le banc de captures. Quatre tests de bout en bout à horloge figée : mur à percer à pleine puissance (fracas) et à moitié (choc), ricochet (la vitesse change de signe en vol), cerceau (anneau traversé, vitesse × 1,15 au moins) ; l'ancien test de l'anneau en temps réel, à quatre essais, est retiré. Tests unitaires : 591.
- `sim/flight.ts` (`flightStep`, `startFlight`, `needsSteps`, `reflected`, `pushOut`, `ringBoosted`), `verifier.flightCatches` pas à pas dès qu'une rencontre est possible, `verifySegment`/`canExit`/`flightCatches` prennent les anneaux, `swingIsClear` exporté ; motifs `brise`, `sas`, `cerceau`, `ricochet`, `percee` et constructeurs `smashWall`, `doorWall`, `hoop`, `ricochet` partagés avec les scènes ; `RICOCHET_WALL_RISE` ; `tuning.ringBoost`.

## [0.12.0] — 2026-10-11 — Lot 2, deuxième livraison : les zones qui modifient le mouvement

Suite du lot 2 du brief, section 8 : des zones où le vol change, chacune avec sa scène. Reste pour le lot 2 : la roue motorisée, l'obstacle tournant, le lanceur à ouverture mobile et le tir avec rebond (0.13.0).

### Ajouté

- **Courant ascendant (Z1).** Une colonne de 3,2 m de large qui pousse vers le haut à 10 m/s², plus que la gravité : on y monte doucement, porté. Elle part un mètre au-dessus du point d'entrée et mène à un point dix mètres plus haut, hors de portée de corde : seul le courant y conduit. La poussée monte en douceur près des bords (« force progressive »). Motif « courant », dès le palier 2 de la course libre, et au niveau 13.
- **Courant latéral (Z2).** Une bande de toute la largeur, haute de 3,5 m, qui pousse de côté à 5 m/s² : on prépare son entrée et on anticipe la dérive. Localisé, à la différence du coup de vent qui couvre tout l'écran. Motif « derive », dès le palier 3, et au niveau 19.
- **Couloir d'accélération et zone de freinage (Z3, Z4).** Un couloir vertical de 5 m qui accélère le long de son axe seulement, à 22 m/s² jusqu'à un plafond de 14 m/s ; puis, un mètre plus haut, une zone de 3 m qui retire 2,5 fois la vitesse par seconde, jamais sous 2 m/s ; et le point de sortie douze mètres au-dessus de l'entrée : « accélération, envolée, freinage, rattrapage ». Motif « fusee », dès le palier 4, et au niveau 16.
- **La visée, l'ombre prédictive et le vérificateur jouent les zones.** Sous un courant, le vol prédit est joué pas à pas avec la vraie physique, pas par la formule du vol libre : l'ombre montre le vol porté ou dévié, la visée prend le point qu'on atteindra vraiment, et chaque segment à zones est prouvé avec ses zones. Mesuré : 60 segments sur 60 prouvés pour le courant et la fusée, 59 sur 60 pour la dérive ; la vérification coûte 6 à 10 ms par segment au lieu de 4.
- **Scènes** `?scene=courant`, `?scene=derive`, `?scene=fusee`, prouvées par le vérificateur et grimpées par les deux robots.
- **Robots** : porté vers le haut, un robot ne rattrape plus un point sous lui, il monte d'abord, comme un joueur.
- **Habillages des zones** (`render/zones.ts`, pur) : le courant ascendant en menthe glacée, traînées qui montent et flèches sur les bords ; la dérive en vert pomme, traînées horizontales dans la bande seule, liserés haut et bas ; le couloir d'accélération en or vif, chevrons serrés qui défilent, sortie marquée d'un trait et d'un entonnoir ; le freinage en lilas pâle, bandes fines qui se resserrent vers le haut. Les traits sont un cran plus vifs autour du personnage quand il est dans une zone. Quatre couleurs nouvelles, loin des espèces, des obstacles et des ambiances (test). Trois prises de plus au banc de captures (`npm run captures -- <dossier> 5 scenes courant derive fusee` pour des scènes choisies).

### Modifié

- Les obstacles tirés au sort, les prises à cycles et les anneaux ne se posent jamais dans une zone.
- Le test du parcours admet qu'un point suive le précédent à douze mètres quand une zone s'étend entre les deux.

### Technique

- `Zone`, `SimState.zones`, `zoneAcceleration`, `zoneAt`, `flightSamples`, `flightAt` (`sim/physics.ts`, la formule fermée reste pour le vol sans zone, à l'identique) ; `integrate` et `swingStep` prennent les zones ; `bestAnchor`, `flightCatches`, `canExit`, `verifySegment` aussi ; motifs `courant`, `derive`, `fusee` et constructeurs `updraft`, `drift`, `rocket` partagés avec les scènes ; `debugState().zones` et `.zone`.

## [0.11.0] — 2026-10-11 — Lot 2, première livraison : des obstacles qui font quelque chose

Demande du propriétaire : « Go lot 2 ». Première livraison du lot 2 du brief : quatre obstacles à comportement, chacun avec sa scène de démonstration. Suivront les courants (0.12.0), puis la roue motorisée, l'obstacle tournant et les lanceurs à ouverture mobile et à rebond (0.13.0).

### Ajouté

- **Surfaces de rebond (O3).** Une dalle ou une corniche qui renvoie le personnage selon son angle d'arrivée, presque sans perte (90 % de la vitesse rendue), corde lâchée s'il en tenait une, mais ni série perdue ni étourdissement : on rattrape un point dans la foulée. Une chute devient une remontée, un tir manqué se récupère. Dès le palier 1 de la course libre, et au niveau 12.
- **Parois cassables (O4).** Une paroi fissurée que l'on traverse en volant en éclats si l'on arrive à 10 m/s au moins (`smashSpeed`), en gardant 80 % de sa vitesse et en marquant 25 points ; en dessous, un choc ordinaire. Le vérificateur la tient pour solide : il y a toujours une autre route, la paroi est un raccourci qui donne une fonction à la vitesse. Dès le palier 3, et au niveau 17.
- **Portes intermittentes (O1).** Un obstacle ouvert 3,6 s sur 6, qui prévient 0,8 s avant de se fermer, chaque porte sur sa phase. Ouverte, on la traverse et on vise au travers ; fermée, elle repousse comme un solide. Elle ne se referme jamais sur le personnage : s'il est dedans au moment de la fermeture, elle reste franchissable pour lui jusqu'à ce qu'il en sorte. Le vérificateur prouve le parcours sans compter les portes (on les attend ouvertes) : une porte peut donc se trouver sur le vol prouvé, et il faut choisir son moment. Dès le palier 4, et au niveau 18.
- **Anneaux de précision (O5).** Un cercle d'1,1 m de rayon au milieu d'un vol, un peu au-dessus de la ligne entre deux points. Rien de solide : le traverser rapporte 15 points à la sortie, et 40 avec un cran de série si le passage s'approche à 40 % du rayon du centre. Un anneau raté ne coûte rien. Dès le palier 2, et au niveau 15.
- **Scènes de démonstration.** `?scene=rebond`, `?scene=cassable`, `?scene=porte`, `?scene=anneau` : la course libre commence par un segment construit à la main, le même à chaque fois, où la nouveauté se rencontre seule, avec son nom et une phrase en bannière ; puis la course libre continue. Les tests prouvent chaque scène par le vérificateur et y font grimper le robot. `window.__grappin.playScene(id)` pour les tests et le banc de captures.
- **Bruitages** du rebond, du fracas et de l'anneau (une quinte plus haut au centre).
- **Habillages.** La surface de rebond se reconnaît à son double contour orchidée et à son ressort en zigzag ; la paroi cassable à ses fissures, qui s'allument quand on va assez vite pour la traverser ; la porte à son contour tireté pâle et à sa jauge qui se remplit quand elle est ouverte, à son contour qui clignote quand elle prévient, à sa masse indigo quand elle est fermée ; l'anneau à son cercle fin vert avec son cercle de centre, plus épais pendant la traversée, éteint une fois pris. Textes flottants « Rebond », « Fracas », « Anneau », « Au centre ! », et un éclat bref au personnage. Quatre couleurs nouvelles, loin des espèces de prises et des ambiances (test).
- **Banc de captures** : une prise par scène (`npm run captures -- <dossier> 5 scenes` pour les scènes seules), dont la paroi éteinte et allumée et la porte dans ses trois états.

### Modifié

- **Un parfait demande un vrai élan.** Retour du propriétaire : « le parfait n'est pas du tout pour le meilleur lâcher, il nous est indiqué quand on a le minimum d'élan quasiment ». Le seuil de vitesse du lâcher parfait passe de 3 m/s (la vitesse de l'impulsion de départ, atteinte dès la première accroche) à 7 m/s (`perfectMinSpeed`) : la fenêtre de lâcher orange et le conseil « Lâche en montant ! » n'arrivent plus qu'avec un balancement qui a pris de l'élan, à la graine 7 depuis le sol après 1,8 s de tenue à 8 m/s, au lieu de 0,8 s à 6 m/s. L'angle ne change pas (entre 30° et 60°). Les robots, qui lâchent à 8 m/s, gardent leurs parfaits. Réglable à l'essai : `?perfectMinSpeed=6`.
- Le générateur pose les espèces du lot 2 avant les obstacles ordinaires et avec plus d'essais ; les anneaux se posent entre deux points consécutifs, jamais autour d'un lanceur ni d'un point qui glisse ; les obstacles gardent leurs distances aux anneaux. Les niveaux 12, 15, 17 et 18 reçoivent chacun une nouveauté, annoncée dans leur phrase d'intro ; les autres niveaux ne changent pas.
- La visée et la ligne de vue ne tiennent compte que des obstacles solides en ce moment : une porte ouverte laisse viser au travers.
- Le test du parcours tolère la sortie d'un lanceur à dix mètres de lui (elle se tire par-dessus son mur).

### Technique

- `src/sim/obstacles.ts` (ce qu'un obstacle est en ce moment, pour le personnage et pour le vérificateur), `src/data/scenes.ts`, `CoursePlan` de genre `scene`, `Obstacle.kind` et `.broken`, `Ring`, `SimState.rings` et `.doorsInside`, événements `bounce`, `smash`, `ring`, réglages `smashSpeed`, `smashScore`, `ringScore`, `ringCentreScore`, profils `bouncers`, `breakables`, `doors`, `rings`, `debugState().rings`, `.smashed`, `.scene`.

## [0.10.0] — 2026-10-11 — Fin du lot 1 : apprendre en jouant

Demande du propriétaire : « finis le lot 1 ». Restaient les aides visuelles et le tutoriel par l'action ; le lanceur sous plafond (L4) est reporté, voir plus bas.

### Ajouté

- **La fenêtre de lâcher se voit.** Quand lâcher maintenant serait un lâcher parfait, la corde et le halo du personnage prennent une teinte chaude et l'ombre prédictive s'allume un cran. Un état, pas une animation ; rien ne change de taille.
- **Le tutoriel par l'action.** Plus d'écran d'explications : un conseil court au moment même du geste, chacun une seule fois par profil, puis plus jamais. « Garde le doigt posé · Tu prends de l'élan » à la première accroche ; « Lâche en montant ! » la première fois que la fenêtre s'ouvre ; « Appuie pour rattraper » au premier vol ; « Tire le doigt vers le bas · Lâche pour partir » au premier lanceur ; « Parfait ! · Enchaîne pour monter le multiplicateur » au premier parfait. Un conseil attend si une bannière de niveau ou d'événement est en cours. Les conseils vus se gardent dans le profil.
- **Menace tolérante et aide plus explicite pour qui apprend.** Tant qu'un joueur n'a jamais atteint 30 m, la brume monte à 60 % de sa vitesse et l'ombre prédictive porte 0,5 s au lieu de 0,25 s. Dès 30 m atteints une fois, tout revient au réglage normal : l'aide s'efface quand le geste est compris.

### Reporté

- **Lanceur L4, passage sous un plafond.** Essayé en quatre géométries, mesuré en simulation : dans ce moteur, une prise s'attrape à n'importe quelle vitesse dès qu'elle est à portée (visée automatique, six mètres), si bien qu'aucun mur ni plafond ne rend la pleine puissance « excessive » avant l'accroche ; et une sortie posée sous une dalle piège tout le monde, pas seulement les tirs forts. Pour que la puissance compte, il faudrait une règle d'accroche qui dépende de la vitesse (une fenêtre d'accroche plus courte à grande vitesse), ce qui change le ressenti de toutes les accroches : décision du propriétaire, à prendre avant de rouvrir L4.

### Corrigé

- **Plus d'à-coup au premier toucher (B-011).** Le contexte audio des bruitages naissait dans le premier geste, et sa création bloquait la page quelques dizaines de millisecondes sur un ordinateur, bien plus sur un petit téléphone ou sur la machine chargée de l'intégration continue, qui a refusé 0.10.0 une première fois sur ce point. Il naît maintenant au chargement, suspendu, et le premier geste ne fait que le reprendre.

### Technique

- `src/app/coach.ts` (pur, testé), `src/meta/learning.ts` (pur, testé), `inReleaseWindow` dans `render/cues.ts`, `effects.tip` (ton 'tip' des bannières), `Profile.tips`, `debugState().releaseWindow` et `.tip`.
- Test de bout en bout du toucher : le passage en partie se vérifie en 2 s au lieu de 0,5 s, le temps de la première image sous rendu logiciel sur un navigateur froid.

## [0.9.0] — 2026-10-11 — Lot 1 du brief : un lanceur qui se vise, des bruitages, la pause, un univers abstrait

Le propriétaire a remis un brief complet (synthèse des échanges du 11 octobre 2026, voir `docs/BACKLOG.md`, « Programme du brief »). Décision prioritaire : abandonner le thème de la ville, garder un univers abstrait, minimaliste et lumineux. Ce lot couvre le lot 0 (inventaire, incohérences, direction artistique) et le cœur du lot 1.

### Modifié

- **Le lanceur se vise pour de bon.** Le trou du mur est toujours décalé du lanceur (de 1,9 à 2,7 m) : un tir vertical bute sur le mur, il faut choisir un angle. Une fois sur deux, quand les fourches sont permises, le mur a deux trous : un large et sûr (2,8 m) d'un côté, un étroit (1,8 m) de l'autre, surmonté d'une étoile ; les deux routes se rejoignent plus haut, et le vérificateur exige qu'un lancer attrape chacune. Entre un lanceur et la reprise de la chaîne, plus aucun obstacle tiré au sort ni prise spéciale : le couloir du tir reste libre. Le vérificateur essaie désormais trente-trois directions par pas de cinq degrés et quatre forces (la précision raisonnable d'un pouce), et les pilotes automatiques tirent la traction prouvée (`sim/pilot.ts`, `window.__grappin.launchAim()`).
- **Combo : parfait, correct, erreur.** Un lâcher correct ne casse plus le multiplicateur : il le fait redescendre d'un cran (`comboMissPenalty`, 1 par défaut, 0 pour le garder tel quel) ; seules les erreurs réelles (choc, décharge) le remettent à zéro. La série de parfaits reste à part, et un lancer ne la coupe plus.
- **Univers abstrait.** Les noms des niveaux et des paliers ne parlent plus de ville : Les premiers anneaux, La chaîne, Les lueurs, Les arcs, Les flèches, Les bras, Les nuages, Les anneaux de nuit, La chaîne de nuit, Le sommet, Les rails, Les colonnes, Les verticales, La décharge, Les lueurs de nuit, L'arche, L'orage, La balise, Le vertige, Le ciel. Les silhouettes d'immeubles laissent place à des structures géométriques abstraites, qui dansent toujours avec la musique.

### Ajouté

- **Bruitages du geste**, sans aucun fichier : accroche, lâcher, parfait (dont la note monte d'un demi-ton par parfait d'affilée), lancer, propulsion, étoile (plus haute pour une étoile de pluie), frôlement, choc, décharge, casse, brume, chute, arrivée, palier ; synthétisés par Web Audio au premier geste. Réglage « Sons : oui/non » sur le titre, gardé dans le profil.
- **Pause et reprise maîtrisée.** Un bouton de pause pendant la partie ; la partie se met aussi en pause toute seule quand l'application passe en arrière-plan ou quand le système annule le geste. Le jeu reste visible, figé, corde comprise. « Reprendre » reprend sans lâcher la corde ni lancer (le lever du doigt qui finit cet appui est avalé) ; le joueur reprend la corde en main en appuyant de nouveau. « Quitter » revient au titre.
- **Départ de la course libre au choix** sur le titre : avancé (là où la progression l'ouvre) ou du sol, pour réapprendre en douceur. Gardé dans le profil.
- **Titre** : l'action principale se lit « Continuer · Niveau N · nom », et le rang du grimpeur s'appelle « Rang ».

### Corrigé

- B-007 : un lancer remettait à zéro la série de parfaits des objectifs, alors que les règles la gardaient.
- B-008 : les étoiles de pluie comptaient parmi les étoiles requises d'un niveau et pouvaient compenser des étoiles fixes manquées pour « toutes les étoiles ». Elles comptent pour le score et les missions, plus pour l'étoile du niveau.
- B-009 : un profil qui avait fini tout le catalogue de missions se voyait réinjecter les trois premières au chargement.

### Technique

- `src/audio/sfx.ts` (recettes, `cueFor`, lecteur Web Audio ou muet), `src/sim/pilot.ts` (`bestLaunch`), `Profile.sfx` et `Profile.freeStart`, `GameScreen` 'paused', boutons 'pause', 'resume', 'quit', 'sfx', 'start' ; `pointer.ts` distingue l'annulation du geste (`onCancel`) du lâcher ; `visibilitychange` met en pause. Tests : incohérences A, B, C ; lanceur décalé et deux routes ; combo ; bruitages ; pause ; annulation ; pilote qui tire la traction prouvée.
- B-010 relevé (ouvert) : la vérification d'un segment ne connaît pas les points du segment suivant, qui peuvent attirer la visée au vol et faire perdre à un point sa sortie « propre » ; un point sur plusieurs milliers, toléré et compté par le test des deux cents graines.

## [0.8.1] — 2026-10-11 — Des couleurs qui changent à chaque temps

Demande du propriétaire : « dynamique pour les couleurs, pas lent ; un jeu hyper dynamique visuellement ».

### Modifié

- La couleur d'effet change à chaque temps, plus toutes les deux mesures : chaque ambiance a maintenant trois couleurs d'effet franchement distinctes (A sur le temps fort, puis B, C, B), choisies loin des couleurs des prises. Cyan nuit : cyan, bleu électrique, blanc glacé. Indigo : lavande, bleu profond, lavande pâle. Glace : blanc-bleu, bleu ciel, blanc. Lime : lime, menthe, blanc chaud. Braise : crème, rose, corail. Le fondu d'une couleur à l'autre tient dans le premier tiers du temps.
- Le temps fort de chaque mesure frappe 30 % plus fort que les trois autres : on sent la mesure, pas seulement le tempo.
- Le fond et la dalle du toit se teintent de la couleur du moment, la crête de brume la prend à moitié avant de s'éclairer ; la ville se teinte des graves vers la couleur du moment et ses immeubles s'allument en plein.
- Amplitudes relevées partout : fond, halos ambiants (portée +70 %, intensité +100 % sur un temps franc), prises spéciales, cerne des obstacles, étoiles, multiplicateur.

### Technique

- `Palette.effectA/B/C`, mélangés comme les autres champs au fondu d'ambiance ; `PULSE.beat.downbeat`, `PULSE.effect.blend`, `PULSE.roof` ; `PUNCH_MAX`. Test des trios (distance entre eux et aux espèces).

## [0.8.0] — 2026-10-11 — L'ambiance pulse au rythme de la musique

Demande du propriétaire : « que l'ambiance lumineuse pulse avec la musique, que ça change de couleur d'effet, que ça pulse au rythme, même les éléments du jeu ».

### Ajouté

- Sur chaque temps de la musique : le fond monte d'un cran vers la brume, les halos des points, de la corde, du personnage et de l'anneau tenu s'élargissent et s'allument, la crête de brume s'éclaire, les immeubles dansent (pairs sur les temps 1 et 3, impairs sur 2 et 4), le cerne des obstacles et les halos des prises spéciales s'intensifient, le multiplicateur grossit. Les étoiles scintillent avec les aigus. La force de chaque temps module tout cela : un passage calme respire, un passage fort frappe.
- Toutes les deux mesures, la couleur d'effet (halo des points, de la corde, des titres et bannières) tourne entre trois teintes de la palette : halo, accent, crête de brume, avec un fondu d'un temps. Plus visible en Braise qu'en Cyan nuit, dont les teintes sont proches.
- Rien ne bouge qui porte un sens : ni une forme, ni une taille de cible, ni une position, ni une couleur d'espèce ; l'état d'une prise électrique ou à éclipse passe avant la musique ; les lignes d'altitude, l'ombre prédictive et la fronde ne pulsent pas. Musique coupée, le rendu est exactement celui d'avant, pixel pour pixel.
- Les réglages sont au même endroit (`PULSE`, `src/render/pulse.ts`), pour ajuster sur retour.

### Technique

- `src/render/pulse.ts` (fonctions pures, 25 tests), rendu et écrans branchés sur `GameFrame.pulse` ; le pouls vient de la position de lecture et du fichier de rythme de la piste (0.7.0). Captures `24-pouls-temps` et `24-pouls-creux` à horloge figée ; test de bout en bout du métronome `?pouls=120`.
- Le banc de captures arrête tout le groupe de processus de son serveur de prévisualisation.

## [0.7.0] — 2026-10-11 — Installable sur le téléphone

Demande du propriétaire : « pouvoir installer sur mon téléphone directement ».

### Ajouté

- Le jeu est une application installable (PWA) : depuis Chrome sur Android (« Installer l'application ») ou Safari sur iPhone (Partager → « Sur l'écran d'accueil »), une icône néon sur l'écran d'accueil, le plein écran sans barre d'adresse, en portrait. Le README explique la marche à suivre.
- Il se lance sans réseau : la page, le code et les icônes sont gardés sur le téléphone par un service worker ; une musique déjà entendue joue hors-ligne, une jamais entendue reste muette. Une nouvelle version se prend toute seule à l'ouverture suivante.
- Les icônes (`public/icones/`, dessinées par `npm run icones`) : l'anneau de visée, la corde et le personnage en néon sur le fond nuit ; une variante « maskable » pour les formes qu'Android découpe, une pour iOS.
- Le rythme de chaque musique, analysé une fois pour toutes (`npm run rythme`, ffmpeg) et rangé à côté d'elle ; le jeu en lit le pouls à chaque image depuis la position de lecture. Rien de visible encore : le rendu qui pulse arrive en 0.8.0.

### Technique

- `src/sw/sw.ts` construit par l'extension Vite `scripts/pwa.ts`, qui lui injecte la liste des fichiers de la coquille et une version de cache (version de l'application + empreinte de la liste) ; `src/sw/ranges.ts` sert les demandes partielles des lecteurs audio depuis le cache. Test de bout en bout : manifeste, icônes, service worker, relance hors-ligne.
- `src/audio/rhythm.ts`, `src/audio/rhythms.ts`, `src/audio/analysis.ts`, `scripts/rythme.ts` ; `?pouls=120` fait battre un métronome visuel pour les tests ; `debugState()` expose `pulse` et `bpm`.

## [0.6.5] — 2026-10-10 — Une ambiance de couleurs par famille de musique

Demande du propriétaire : « des jeux de couleurs en fonction des musiques ».

### Ajouté

- Cinq ambiances, une par famille de pistes : Cyan nuit (biome 1 : niveaux 1, 2, 11, 12, et le titre), Indigo (biome 2 : 3, 4, 13, 14), Glace (biome 3 : 5, 6, 15, 16), Lime (biome 4 : 7, 8, 17, 19), Braise (boss : 9, 10, 18, 20). L'ambiance change le fond, les lignes d'altitude, les silhouettes, le tube des points normaux, la corde, le personnage, la brume et l'accent de l'interface, avec un fondu d'une seconde ; en course libre elle suit la zone traversée, musique coupée ou non.
- Ce qui porte un sens ne change jamais : étoiles jaunes, fragile magenta, propulseur cyan vif, électrique orange puis rouge, éclipse violette, lanceur vert d'eau, dangers rouge-magenta.

## [0.6.4] — 2026-10-10 — La vitesse se lit et se plafonne

Retour du propriétaire : « des fois la vitesse devient impossible à gérer et on part dans le décor », et oui pour la rendre lisible.

### Modifié

- Le treuil n'accélère jamais le balancement au-delà de 13 m/s (il ne freine pas non plus ce qui va déjà plus vite), et aucun lâcher ne part à plus de 16 m/s, propulseur et lanceur compris ; la vitesse maximale absolue passe de 24 à 20 m/s.
- La corde montre la vitesse : au-dessus de 4 m/s elle épaissit (jusqu'à +3 px), son halo se renforce et s'élargit, au maximum au plafond du treuil. L'ombre prédictive suit le lâcher plafonné.

## [0.6.3] — 2026-10-10 — Plus d'étoile au-dessus de l'arrivée

### Corrigé

- B-006, signalé par le propriétaire : les quelques mètres engendrés au-dessus de la ligne d'arrivée, nécessaires au dernier balancement, portaient des étoiles qui comptaient dans le total du niveau ; franchir la ligne gagnant aussitôt, l'étoile « toutes les étoiles » devenait impossible. Plus aucune étoile n'est posée au-dessus de l'arrivée.

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

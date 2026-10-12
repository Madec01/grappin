# Boîte à idées

Dernière mise à jour : 9 octobre 2026. Tout ce qui figure ici attend la validation du propriétaire du projet. Rien n'est engagé.

## Idées écartées de la version 1.0, à reconsidérer plus tard

- **Fantôme de la meilleure run et parcours du jour.** Un parcours identique pour tout le monde chaque jour, avec le fantôme de son meilleur score. Jugé non prioritaire le 9 octobre 2026. Rendu possible par la physique déterministe.
- **Accroche élastique « liane ».** Une accroche spéciale à tension variable avec effet fronde, limitée à certains segments. L'option générale a été refusée le 9 octobre 2026.
- **Filets de secours.** Refusés pour la première version le 9 octobre 2026.
- Partage de rejeux, statistiques détaillées, défis.

## Événements pendant les niveaux — validés et livrés en 0.4.1

Demande du propriétaire : des événements qui influencent le jeu pendant un niveau, dont « faire tourner le niveau pour qu'il devienne horizontal ». Les six événements proposés (bascule, coup de vent, panne, pluie d'étoiles, alerte, câble) ont été validés tels quels et livrés en 0.4.1 ; leur conception vit en section 9 ter du GDD. Reste à faire :

- Matérialiser à l'écran les bords de la ville (± 14 m), hors desquels on tombe pendant une bascule : à traiter dans l'habillage de la phase 5.
- Un robot joueur qui tienne compte du vent et de la gravité tournée : l'actuel ne finit pas les niveaux 7 à 10, ce qui ne dit rien de leur difficulté pour un humain. Retour du propriétaire attendu sur ces niveaux.

## Idées du propriétaire du 10 octobre 2026 — validées telles que proposées

Quatre idées de prises, données après le test des niveaux, validées par le propriétaire avec les propositions du Lead et dans l'ordre 4, 1, 3 (électrique), 2. Les idées 4 et 1 sont livrées en 0.5.0, les idées 3 (électrique) et 2 en 0.5.1 ; le leurre, deuxième option de l'idée 3, reste en réserve.

1. **Prises qui bougent sur toute la largeur de l'écran** — « les traversières ». Proposition : un septième événement, cousin du câble, où deux ou trois points du segment glissent d'un bord à l'autre de la ville (± 4 m) en cinq secondes aller-retour, plus lentement que le câble (1,6 m en 1,5 s). Avis : bonne idée, elle oblige à lâcher au bon moment plutôt qu'au bon endroit ; le vérificateur sait déjà prouver un point glissant à ses deux bouts et au milieu. Coût : faible, un ou deux jours.
2. **Prises accrochables 2 secondes sur 4** — « les prises à éclipse ». Proposition : une nouvelle espèce de point, visible en permanence, dont le néon s'allume 2 s et s'éteint 2 s ; éteint, le grappin ne l'attrape pas et l'anneau de visée montre le compte à rebours. Avis : très lisible en néon, et le joueur peut toujours attendre en pendant au point d'avant, ce qui rend l'attente sûre. Réserve : le vérificateur prouve qu'un passage existe, pas qu'il existe au bon moment ; je propose que les prises à éclipse ne soient jamais le seul chemin, ou que l'attente soit toujours possible (pas sous alerte). Coût : moyen, deux ou trois jours.
3. **Prises piégées**. Deux propositions, à choisir ou cumuler. La **prise électrique** : un point qui se charge par cycles, visible au grésillement du néon ; l'attraper chargé électrocute (mort nouvelle, « Électrocuté »), l'attraper éteint est normal. Le **leurre** : un point qui ressemble presque à un vrai, à un détail près (néon qui tremble), et qui lâche le personnage quatre dixièmes de seconde après la prise. Avis : l'électrique est le plus clair et se marie avec l'idée 2 ; le leurre punit l'inattention, ce qui peut agacer, à doser rarement. Dans les deux cas, le vérificateur ignore ces points pour prouver le passage : le niveau reste toujours faisable sans eux. Coût : moyen.
4. **Prises de plus en plus écartées sur la largeur**. Proposition : un réglage d'écartement par palier en course libre (le déport de côté grandit avec la hauteur, jusqu'à toute la largeur de ± 4 m) et par niveau dans les traversées. Avis : c'est le levier de difficulté le plus naturel, le vérificateur garantit que cela reste franchissable. Attention à la caméra : écartées, les prises sortent de l'écran au zoom 1 ; le dézoom par la vitesse existe déjà, à compléter par un dézoom par l'écartement. Coût : faible.

## Programme du brief du 11 octobre 2026 — suivi idée par idée

Le brief complet du propriétaire (synthèse des échanges du 11 octobre 2026) est la référence de la suite. Statuts : **existant** (déjà dans le jeu avant le brief), **fait** (livré, version), **à faire** (retenu, pas commencé), **prototype** (à essayer dans une scène dédiée avant de l'intégrer), **à revoir** (dépend d'un retour du propriétaire ou d'un prototype). Rien n'est supprimé en silence : une idée moins prioritaire reste ici.

| Idée | Section du brief | Statut |
|---|---|---|
| Univers abstrait, sans ville ; noms et illustrations urbains rendus abstraits | 2 | fait (0.9.0 : noms des niveaux et paliers, structures à la place des silhouettes) ; à poursuivre à chaque remaniement |
| Incohérence A : lancer et série de parfaits | 4 | fait (0.9.0, B-007) |
| Incohérence B : étoiles de pluie et « toutes les étoiles » | 4 | fait (0.9.0, B-008) |
| Incohérence C : missions réinjectées en fin de catalogue | 4 | fait (0.9.0, B-009) |
| Documents en retard sur le code | 4 | fait (0.9.0, README, GDD, ARCHITECTURE, ROADMAP à jour) |
| Bruitages du geste | 5 | fait (0.9.0, synthèse Web Audio) ; montée sonore pendant une série : fait (la note du parfait monte) |
| Aides visuelles : trajectoire plus explicite au début, fenêtre de lâcher montrée | 5 | fait (0.10.0 : ombre 0,5 s pour qui apprend, fenêtre de lâcher teintée) |
| Combo parfait / correct / erreur | 5 | fait en prototype (0.9.0, `comboMissPenalty`) ; à revoir sur ressenti |
| Lanceur L1 ouverture décalée | 6 | fait (0.9.0) |
| Lanceur L2 deux ouvertures (sûre / étroite étoilée) | 6 | fait (0.9.0) |
| Lanceur L4 passage sous un plafond | 6 | à revoir : impossible tel quel, une prise s'attrape à toute vitesse ; demande une accroche qui dépende de la vitesse (décision du propriétaire), voir CHANGELOG 0.10.0 |
| Lanceur L3 ouverture mobile, L5 tir avec rebond | 6 | L5 fait (0.12.1, motif « ricochet ») ; L3 fait (0.13.0, motif « glissiere » : le trou va et vient, on tire quand il passe) |
| P1 Roue motorisée | 7 | fait (0.13.0 : moteur le long de la corde jusqu'à 11 m/s, sortie dix mètres plus haut que seule la roue atteint) |
| P2 Rail de lancement | 7 | à faire (lot 5) |
| P3 Aimant de trajectoire | 7 | à faire (lot 5) |
| P4 Lien élastique | 7 | prototype (lot 5) |
| P5 Prise interrupteur | 7 | à faire (lot 5) |
| Z1 Courant ascendant, Z2 courant latéral, Z3 couloir d'accélération, Z4 zone de freinage | 8 | fait (0.12.0, avec une scène chacun ; les forces, plafonds et dimensions sont des constantes de `sim/generator.ts`, à revoir sur ressenti) |
| O1 Portes intermittentes, O3 surfaces de rebond, O4 parois cassables, O5 anneaux de précision | 9 | fait (0.11.0) ; rendus exigés en 0.12.1 (sas, ricochet, mur à percer et percée, cerceau), suite au retour du propriétaire « ça ne rajoute pas de difficulté » ; à revoir sur ressenti : restitution, seuil de vitesse, cycle des portes, et la part des lanceurs dans ces usages |
| O2 Obstacles tournants | 9 | fait (0.13.0 : barre de 2,6 m, un tour en six secondes, choc au contact, passée au bon moment) |
| O6 Passage qui se referme | 9 | à faire (lot 5) |
| H1 Puits de chute, H2 tunnel descendant, règles de la brume en descente | 10 | à faire (lot 5) |
| D1 Duo alterné, D2 bille écho | 11 | prototype (lot 6) |
| T1 Serpentin, T3 accordéon, T6 faible gravité | 12 | à faire (lot 3) |
| T2 Plafond, T4 faille, T5 carrousel | 12 | à faire (lot 5) |
| T8 Structure dépliante, T9 convoyeur, T7 descente contrôlée | 12 | à faire (lot 5) |
| Combinaisons du catalogue (section 13) | 13 | à faire après apprentissage de chaque élément |
| Enchaînement difficulté / risque / récompense / respiration, secteurs abstraits, fourches enrichies | 14 | à faire (lot 4) |
| Départ avancé facultatif | 14 | fait (0.9.0, « Départ : avancé / du sol ») |
| Mécaniques introduites selon l'apprentissage, pas l'altitude | 14 | à faire (lot 4) |
| Talismans M1 à M4, choix d'amélioration en partie | 15 | à faire (lot 4) |
| Contrats renouvelables après le catalogue | 15 | à faire (lot 4) |
| Déblocages visuels abstraits (traînées, cordes, formes de bille) | 15 | à revoir (constellation : adaptation possible, non validée) |
| Parcours du jour, fantôme personnel | 16 | à faire (lot 4) |
| Accueil « Continuer », « Rang » distinct de « Niveau » | 17 | fait (0.9.0) |
| Tutoriel par l'action, aides qui s'effacent | 17 | fait (0.10.0 : conseils au geste, une fois par profil ; brume tolérante et ombre longue jusqu'à 30 m) |
| Pause, reprise maîtrisée | 17 | fait (0.9.0) |
| Intensité des pulsations réglable, indépendante de la musique | 17 | à faire (lot 4) |
| Options pour téléphones modestes, validation mobile réelle | 17 | à faire (lot 4) ; les performances réelles restent à mesurer sur appareil |
| Vérification à cheval sur deux segments (B-010) | 18 | à faire (avec le générateur du lot 3) |
| Scènes déterministes de démonstration par mécanique | 18 | fait (0.11.0 : `?scene=`, une par nouveauté, prouvées par le vérificateur et jouées par le robot dans les tests) ; à poursuivre avec chaque nouveauté |
| Robots à jour des nouvelles règles | 18 | fait pour le lanceur (0.9.0 : traction prouvée, temps de visée, `playRobot` traçable) ; à faire : éviter les prises électriques ou les lâcher avant la charge (le robot s'y fait décharger et retombe sur le mur du lanceur, niveau 14) ; attendre l'ouverture d'une porte avant de tirer (dans la scène « porte », il tire porte fermée et bute trois à cinq fois avant de passer) |

Choses à ne pas présenter comme des nouveautés : génération infinie, mode niveaux, événements, trajectoire prédictive, talismans (existants) ; vibrations (écartées) ; morts instantanées sur obstacle (ne pas rétablir) ; filet permanent (non retenu).

## Suites de l'installation sur téléphone (0.7.0)

- **Bouton « Installer » sur le titre.** Fait en 0.12.4 (`app/install.ts`) : bouton « Installer le jeu » dès que Chrome annonce `beforeinstallprompt`, rappel « Partager → Sur l'écran d'accueil » sur iPhone et iPad, rien une fois installé. Sur demande du propriétaire : « le jeu ne me propose toujours pas de l'installer ».
- **Musiques hors-ligne d'avance.** Aujourd'hui une piste se garde à sa première écoute ; un bouton « Garder les musiques » téléchargerait les treize (55 Mo) d'un coup, en Wi-Fi.

## Pistes techniques relevées par le Lead le 9 octobre 2026

- La corde peut traverser un obstacle pendant le balancement ; seule l'accroche exige la ligne de vue. À durcir si cela se voit en jeu.
- Un robot joueur qui évite les obstacles donnerait une meilleure mesure de la difficulté : les robots actuels meurent sur le premier obstacle venu passé le palier 1.
- Si la génération d'un segment, quelques millisecondes, se voit sur téléphone, la déplacer dans un Worker.
- Pour la ville de nuit, les corniches et dalles pourront devenir balcons, enseignes, câbles et passerelles.

## Hypothèses à vérifier en test joueur

- Le choix de route par le moment du lâcher, sans viser au doigt, se comprend sans explication.
- À une fourche, le joueur comprend qu'il choisit aussi sa branche par le moment du tap, le point visé changeant au fil du vol.
- Le pompage ne se remarque pas et ne donne pas l'impression que le jeu joue tout seul.
- Un lâcher raté qui remet le combo à zéro n'est pas perçu comme trop sévère.
- La brume qui monte donne du rythme sans écraser la sensation de danse.

## Enseignements hérités

- La validation technique ne démontre ni le plaisir ni la qualité artistique. Ne jamais présenter un jeu comme publiable sur la seule base de tests automatisés.
- Un jeu à un seul tap peut être trop brutal : vérifier tôt qu'un débutant survit plus de dix secondes.

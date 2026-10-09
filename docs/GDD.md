# GRAPPIN, document de conception

Version 0.1, 9 octobre 2026. Le propriétaire du projet est le seul valideur du game design, du lore et de la direction artistique. Les points marqués [VALIDÉ] ont été tranchés par lui le 9 octobre 2026. Le Lead Game Architect a les pleins pouvoirs sur le code et l'architecture.

## 1. Vision [VALIDÉ]

**Pitch.** Un jeu d'arcade de mouvement, en portrait, sur téléphone. Le personnage monte en se balançant de point d'accroche en point d'accroche avec un grappin. Toute la maîtrise tient dans un seul geste : sentir le bon instant de lâcher pour conserver son élan.

**Expérience visée.** Le vol parfait, une longue chaîne fluide qui ressemble à de la danse.

**Format.** Écran portrait, parcours ascendant pour avoir de la place devant le personnage. Sessions courtes, relance immédiate. Jouable à la souris avec le même geste, pour les tests.

**Public.** Joueurs mobiles de tous niveaux. Une seule main suffit.

## 2. Univers [VALIDÉ dans le principe, à préciser]

**Ascension nocturne d'une ville.** Le personnage grimpe une ville la nuit, de toit en toit, de lampadaire en enseigne. Direction artistique proposée par le Lead et retenue par le propriétaire : silhouettes et lueurs, formes simples sur dégradés nocturnes, lisibles à grande vitesse et presque entièrement dessinables en code.

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
- **Le treuil [PROPOSÉ LE 9 OCTOBRE 2026, À VALIDER].** Constat du Lead au premier prototype : un pendule pur conserve son énergie, le personnage ne monte jamais plus haut que son élan de départ, et un robot joueur plafonne à sept mètres avant de mourir dans la brume. Il faut une source d'énergie. Proposition : tant que le doigt reste posé, le grappin tire comme un treuil, la corde raccourcit à vitesse constante jusqu'à une longueur minimale, et le balancement s'accélère comme un patineur qui ramène les bras. Tenir plus longtemps rapproche du point et donne de la vitesse ; lâcher au bon moment transforme cette vitesse en vol. Le réglage est débrayable (`reelSpeed=0` redonne le pendule pur). Mesure du robot raisonnable sur cinq graines : deux mètres par seconde de montée, accroches tenues six dixièmes de seconde.

## 5. Cœur du jeu : l'élan [VALIDÉ]

- **Combo de lâchers parfaits.** Le multiplicateur monte quand on lâche dans la bonne fenêtre d'élan, signalée par un son et un éclat. Un lâcher raté remet le multiplicateur à zéro. Le score récompense exactement le geste que le jeu promet.
- **Frôlé.** Passer très près d'un obstacle donne un bonus.
- Les accroches réagissent au passage pour matérialiser la chaîne.

## 6. Points d'accroche [VALIDÉ]

- Normaux : accroche classique.
- Fragiles : cassent après une seconde.
- Propulseurs : boostent le lâcher.
- Mobiles ou rotatifs : bougent ou tournent, introduits en dernier.

## 7. Dangers [VALIDÉ]

- La brume qui monte.
- Sol, plafonds, obstacles mobiles.

## 8. Parcours [VALIDÉ]

- Généré procéduralement par segments.
- Génération vérifiée : avant d'afficher un segment, un robot le joue et vérifie qu'un instant de lâcher atteint l'accroche suivante avec de la marge. Aucun passage impossible.
- Routes haute, risquée avec bonus, et basse, sûre, qui se rejoignent.
- Difficulté croissante : espacement qui s'agrandit, puis accroches spéciales et obstacles mobiles. Une nouvelle contrainte à la fois.
- Les premiers obstacles enseignent par la pratique comment le lâcher influence la trajectoire.
- Paliers de hauteur nommés pour donner un sentiment d'étape.

## 9. Modes [VALIDÉ]

- **Course infinie**, mode principal.
- **Traversées**, des niveaux avec une arrivée, construits par le même générateur avec une graine fixe et une longueur donnée. Livrées après la course infinie.

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
| Treuil | 2,5 m/s de raccourcissement, moitié de la conservation du moment cinétique |
| Vitesse maximale | 24 m/s |
| Portée du grappin | 7 m |
| Élan minimal à l'accroche, sinon impulsion | 2 m/s tangentiels, impulsion à 3 m/s |
| Coyote time | 120 ms |
| Fenêtre du lâcher parfait | vitesse orientée entre 30° et 60° au-dessus de l'horizontale, dans le sens du mouvement |
| Multiplicateur | 1 + 0,25 × combo, plafonné à 5 |
| Vitesse de la brume | 0,8 m/s au départ, +0,1 m/s tous les 50 m, plafonnée à 3 m/s |

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

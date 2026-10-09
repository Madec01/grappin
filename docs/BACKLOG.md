# Boîte à idées

Dernière mise à jour : 9 octobre 2026. Tout ce qui figure ici attend la validation du propriétaire du projet. Rien n'est engagé.

## Idées écartées de la version 1.0, à reconsidérer plus tard

- **Fantôme de la meilleure run et parcours du jour.** Un parcours identique pour tout le monde chaque jour, avec le fantôme de son meilleur score. Jugé non prioritaire le 9 octobre 2026. Rendu possible par la physique déterministe.
- **Accroche élastique « liane ».** Une accroche spéciale à tension variable avec effet fronde, limitée à certains segments. L'option générale a été refusée le 9 octobre 2026.
- **Filets de secours.** Refusés pour la première version le 9 octobre 2026.
- Partage de rejeux, statistiques détaillées, défis.

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

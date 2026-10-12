# GRAPPIN

Jeu d'arcade de mouvement en portrait, sur téléphone. Le personnage monte en se balançant de point d'accroche en point d'accroche avec un grappin. Toute la maîtrise tient dans un seul geste : sentir le bon instant de lâcher pour conserver son élan.

Version 0.6.0 : style néon minimaliste. Vingt niveaux fixes à trois étoiles, sept événements, dont la bascule qui fait tourner le niveau, course libre à départ avancé, missions, niveaux de grimpeur et talismans. Un seul geste, une brume qui monte, un parcours engendré par segments et vérifié par un robot avant d'être affiché, des fourches entre une route basse sûre et une route haute étoilée, des obstacles à frôler, des accroches fragiles et propulseuses, des paliers nommés, le score et le combo de lâchers parfaits. Prises électriques, à éclipse, traversières et lanceurs à murs à trou. Pas encore de son.

**Jouer : [madec01.github.io/grappin](https://madec01.github.io/grappin/)**, une fois GitHub Pages réglé sur la source « GitHub Actions » dans les réglages du dépôt (Settings, Pages, Build and deployment, Source : GitHub Actions).

## Comment jouer

1. Touchez l'écran pour commencer. Le point d'accroche visé est entouré d'un anneau clair avant même que vous touchiez.
2. Gardez le doigt posé : le grappin est accroché, le personnage se balance.
3. Relâchez au bon moment : le personnage part avec sa vitesse du moment. Lâcher au point bas donne de la vitesse, en haut de la hauteur.
4. Un lâcher qui part vers le haut entre 30° et 60° est « parfait » et monte le multiplicateur. Un lâcher raté le remet à zéro.
5. La brume monte. Passer dessous termine la partie, toucher un obstacle aussi ; touchez pour rejouer. Frôler un obstacle sans le toucher rapporte un bonus.
6. À partir de 50 m, les chemins se séparent parfois : la route basse est sûre, la route haute porte une étoile. Le grappin ne traverse pas les obstacles : un point caché n'est pas visable.
7. Une accroche en pointillés casse après une seconde ; une accroche à chevron propulse le lâcher.
8. Chaque partie rapporte de l'expérience, les missions aussi. Les niveaux de grimpeur débloquent des talismans, à équiper depuis le bouton « Talismans » avant de partir.
9. Le mode principal est la traversée : vingt niveaux fixes, le même parcours à chaque essai, trois étoiles chacun. Perdre recommence le niveau seulement. La course libre démarre à la zone la plus haute franchie.
10. Dès le niveau 3, des événements : pluie d'étoiles, panne de lampadaires, bascule qui fait tourner le niveau, coup de vent, alerte de brume, accroches sur câble.

Le jeu se joue aussi à la souris, avec le même geste : clic maintenu, puis relâché.

## Installer sur un téléphone

Le jeu s'installe depuis le navigateur, sans magasin d'applications : une icône sur l'écran d'accueil, le plein écran sans barre d'adresse, et il se lance même sans réseau (la page, le code et les icônes sont gardés sur le téléphone ; une musique déjà entendue joue hors-ligne, une musique jamais entendue reste muette).

- **Android (Chrome)** : ouvrir https://madec01.github.io/grappin/ ; dès que Chrome sait installer, le titre montre un bouton « Installer le jeu », qui ouvre l'invite d'installation. Sinon, le menu ⋮ en haut à droite → « Installer l'application » (ou « Ajouter à l'écran d'accueil »).
- **iPhone (Safari)** : ouvrir la même adresse (le titre le rappelle), toucher le bouton Partager (le carré avec une flèche vers le haut) → « Sur l'écran d'accueil » → « Ajouter ».

Une nouvelle version se prend toute seule à l'ouverture suivante, quand il y a du réseau. Pour désinstaller, retirer l'icône comme pour n'importe quelle application.

## Réglages pendant une séance de test

Des paramètres d'adresse permettent de régler le jeu sans toucher au code :

- `?graine=12` rejoue toujours le même parcours.
- La musique est celle du propriétaire (dépôt Way), une piste par niveau, dans `public/musique/`. À côté de chaque piste, son fichier de rythme (`<piste>.rythme.json`, produit par `npm run rythme`) fait pulser l'ambiance et les éléments du jeu au tempo ; musique coupée, rien ne pulse.
- `?pouls=120` fait battre un métronome visuel à ce tempo, sans son : pour regarder le pouls, et pour les tests.
- `?scene=rebond` (le ricochet), `?scene=cassable` (le mur à percer), `?scene=porte` (le sas), `?scene=anneau` (le cerceau), `?scene=courant`, `?scene=derive` ou `?scene=fusee` fait commencer la course libre par une scène de démonstration de cette mécanique, la même à chaque fois.
- Les bruitages du geste sont synthétisés (aucun fichier) ; « Sons : oui/non » sur le titre les coupe. « Départ : avancé / du sol » choisit d'où part la course libre.
- Pause : le bouton en haut à droite pendant la partie, ou automatiquement quand l'application passe en arrière-plan ; « Reprendre » ne lâche jamais la corde, on la reprend en main en appuyant de nouveau.
- Pour qui apprend (jamais 30 m atteints), la brume monte à 60 % et l'ombre prédictive porte plus loin ; des conseils courts apparaissent au moment du geste, une seule fois chacun. La fenêtre de lâcher parfait se voit : corde et halo chauds.
- `?comboMissPenalty=0` garde le multiplicateur tel quel sur un lâcher correct (1 par défaut : il redescend d'un cran ; les chocs et décharges le remettent à zéro).
- `?test=1` ouvre le mode test : tous les niveaux se jouent sans les avoir débloqués, la liste des niveaux dit les événements de chacun, et la progression se fait sur un profil à part, sans toucher à la vraie. En ligne : https://madec01.github.io/grappin/?test=1
- Dans la console du navigateur, `__grappin.resetProfile()` efface la progression, `__grappin.profile()` l'affiche.
- Tout réglage de `src/sim/tuning.ts` se surcharge par son nom, par exemple `?gravity=9&ropeMax=6&kickSpeed=4`.

## Lancer en local

```sh
npm install
npm run dev
```

Vite affiche une adresse locale et une adresse réseau. Ouvrez l'adresse réseau sur un téléphone connecté au même réseau.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement avec rechargement |
| `npm run build` | Build de production dans `dist/` |
| `npm run preview` | Sert le build de production |
| `npm test` | Tests unitaires Vitest en Node |
| `npm run test:e2e` | Test de fumée Playwright sur écran de téléphone |
| `npm run lint` | ESLint, règles de déterminisme comprises |
| `npm run typecheck` | TypeScript strict |
| `npm run check` | Lint, typage et tests |
| `npm run captures -- <dossier> [graine]` | Captures d'écran et vidéo d'une partie jouée par un robot, après `npm run build` |
| `npm run icones` | Redessine les icônes de l'application installée (`public/icones/`), en PNG par Chromium |
| `npm run rythme -- [piste ...]` | Analyse le rythme des musiques (ffmpeg requis) et écrit `public/musique/<piste>.rythme.json` ; toutes les pistes sans argument |
| `npm run robot -- [clé=valeur ...] [profil=débutant]` | Robots joueurs en Node qui mesurent hauteur, rythme, vitesses et cause de la fin pour un réglage, par exemple `reelSpeed=4` |

Pour Playwright avec un Chromium déjà installé : `PW_CHROMIUM_PATH=/chemin/vers/chrome npm run test:e2e`. Pour le GIF des captures : `FFMPEG_PATH=/chemin/vers/ffmpeg`.

## Déploiement

Le workflow CI vérifie lint, typage, tests, fumée mobile et build à chaque push, puis déploie `dist/` sur GitHub Pages depuis `main`.

## Gouvernance

- **Game design et direction artistique :** le propriétaire du projet est le seul valideur.
- **Architecture et code :** le Lead Game Architect dispose des pleins pouvoirs techniques.
- **Assets :** uniquement des ressources libres de droits aux licences vérifiées, avec crédits complets.
- **Propreté :** tout code mort, fichier obsolète ou asset inutilisé est supprimé immédiatement.

## Documents

| Document | Rôle |
|---|---|
| [docs/GDD.md](docs/GDD.md) | Document de conception validé |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture technique de ce qui existe |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Jalons, phases, critères de sortie |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Historique versionné |
| [docs/BUGS.md](docs/BUGS.md) | Registre des anomalies |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Boîte à idées |

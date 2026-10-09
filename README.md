# GRAPPIN

Jeu d'arcade de mouvement en portrait, sur téléphone. Le personnage monte en se balançant de point d'accroche en point d'accroche avec un grappin. Toute la maîtrise tient dans un seul geste : sentir le bon instant de lâcher pour conserver son élan.

Version 0.3 : prototype en formes grises avec progression : missions, niveaux de grimpeur et talismans. Un seul geste, une brume qui monte, un parcours engendré par segments et vérifié par un robot avant d'être affiché, des fourches entre une route basse sûre et une route haute étoilée, des obstacles à frôler, des accroches fragiles et propulseuses, des paliers nommés, le score et le combo de lâchers parfaits. Aucun habillage, aucun son : ils viennent après que la sensation est validée.

**Jouer : [madec01.github.io/grappin](https://madec01.github.io/grappin/)**, une fois GitHub Pages réglé sur la source « GitHub Actions » dans les réglages du dépôt (Settings, Pages, Build and deployment, Source : GitHub Actions).

## Comment jouer

1. Touchez l'écran pour commencer. Le point d'accroche visé est entouré d'un anneau clair avant même que vous touchiez.
2. Gardez le doigt posé : le grappin est accroché, le personnage se balance.
3. Relâchez au bon moment : le personnage part avec sa vitesse du moment. Lâcher au point bas donne de la vitesse, en haut de la hauteur.
4. Un lâcher qui part vers le haut entre 30° et 60° est « parfait » et monte le multiplicateur. Un lâcher raté le remet à zéro.
5. La brume monte. Passer dessous termine la partie, toucher un obstacle aussi ; touchez pour rejouer. Frôler un obstacle sans le toucher rapporte un bonus.
6. À partir de 50 m, les chemins se séparent parfois : la route basse est sûre, la route haute porte une étoile. Le grappin ne traverse pas les obstacles : un point caché n'est pas visable.
7. Une accroche en pointillés casse après une seconde ; une accroche à chevron propulse le lâcher.
8. Chaque partie rapporte de l'expérience, les missions aussi. Les niveaux débloquent des talismans, à équiper depuis le bouton « Talismans » avant de partir.

Le jeu se joue aussi à la souris, avec le même geste : clic maintenu, puis relâché.

## Réglages pendant une séance de test

Des paramètres d'adresse permettent de régler le jeu sans toucher au code :

- `?graine=12` rejoue toujours le même parcours.
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

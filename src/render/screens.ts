import { Container, Graphics } from 'pixi.js';
import { LEVELS, levelById, type LevelDef } from '../data/levels';
import { levelFor, levelProgress } from '../meta/levels';
import { missionById, type MissionDef } from '../meta/missions';
import { showsHint, type LevelOutcome, type Profile, type RunOutcome } from '../meta/profile';
import { TALISMANS, slotsFor, type Talisman } from '../meta/talismans';
import { starsOf, unlockedLevel, type LevelResult } from '../meta/traversee';
import { levelButton, levelPageCount, levelsOfPage, type ButtonId, type ButtonRect } from './buttons';
import { type StarLine, equippedLine, levelEvents, levelPageLabel, levelRange, levelRowTitle, levelTitle, missionDoneLine, missionProgress, slotsLine, starLines } from './labels';
import { neonBar, neonPoly, neonPolyline, neonRoundRect } from './neon';
import { COLOR, GlowText, makeText, readSafeInset, starPoints, type Palette } from './style';

/**
 * Les écrans posés sur le jeu : titre, liste des niveaux, fin de partie,
 * victoire et talismans. Un voile nuit, des textes blancs, des formes à contour
 * néon fin : boutons, lignes équipées, étoiles, barre d'expérience. Un écran
 * n'est dessiné qu'une fois par vue et par taille d'écran : ses halos ne
 * coûtent rien à l'image.
 *
 * L'accent de la palette (contour des boutons, lignes allumées, barre d'expérience,
 * halo des titres) et le voile, qui prend la couleur du fond, ne sont pas figés
 * au tracé : ces formes sont dessinées en blanc et teintées, si bien qu'une
 * palette qui change, même en plein fondu, ne retrace rien. Voir `Column.skins`.
 *
 * Chaque écran est fait de deux blocs empilés : celui du haut (l'information)
 * et celui du bas (le bouton et l'invite), collé au bas de l'écran pour rester
 * sous le pouce. Si l'ensemble ne tient pas dans la hauteur, il est réduit
 * d'un coup plutôt que rogné. Les boutons se retrouvent après coup par
 * `hitTest`, à partir des rectangles réellement dessinés.
 */

/** Ce que les écrans ont à montrer. `none` : la partie est en cours, rien n'est posé sur le jeu. */
/** Ce que le mode test dit de lui-même, sur le titre et la liste des niveaux. */
const TEST_MODE_LINE = 'Mode test · tous les niveaux ouverts';

export type OverlayView =
  | { readonly kind: 'none' }
  | { readonly kind: 'title'; readonly profile: Profile; readonly testMode: boolean }
  /** `page` : la page montrée de la liste des niveaux (dix par page), à partir de 0. */
  | { readonly kind: 'levels'; readonly profile: Profile; readonly testMode: boolean; readonly page: number }
  | {
      readonly kind: 'dead';
      /** Hauteur atteinte, et hauteur à atteindre si la partie était un niveau (« Objectif »), sinon null. */
      readonly height: number;
      readonly goal: number | null;
      readonly score: number;
      readonly cause: string;
      readonly outcome: RunOutcome;
    }
  | { readonly kind: 'won'; readonly score: number; readonly outcome: LevelOutcome; readonly result: LevelResult }
  | { readonly kind: 'talismans'; readonly profile: Profile };

/** Marges et mise en page, en pixels CSS. */
const SIDE_MARGIN = 20;
const EDGE_MARGIN = 32;
const SAFE_GAP = 16;
const MAX_WIDTH = 440;
/** Espace minimal entre le bloc du haut et celui du bas. */
const BLOCK_GAP = 24;
/** Voile sur le jeu : assez dense pour que le décor (anneau de visée, lignes d'altitude) ne gêne pas la lecture, assez clair pour le deviner. */
const SHADE_ALPHA = 0.74;
/** Les écrans des talismans, des niveaux et de la victoire portent beaucoup de texte : voile plus dense. */
const SHADE_ALPHA_DENSE = 0.9;
const DENSE_VIEWS: ReadonlySet<OverlayView['kind']> = new Set(['talismans', 'levels', 'won']);

/** Boutons : 56 px de haut, soit plus que les 44 px d'un doigt même réduits d'un cinquième. */
const BUTTON_WIDTH = 220;
const BUTTON_HEIGHT = 56;
const BUTTON_RADIUS = 12;
const BUTTON_EDGE_WIDTH = 1.5;
const BUTTON_FONT_SIZE = 22;

const BAR_WIDTH = 220;
const BAR_HEIGHT = 10;

const MISSION_GAP = 12;
/** Distance entre une mission et son avancement. */
const MISSION_PROGRESS_GAP = 12;

/** Écart entre deux boutons empilés, et entre deux étoiles de la victoire. */
const BUTTON_GAP = 12;
const WIN_ROW_GAP = 8;

const ROW_GAP = 10;
const ROW_PADDING = 12;
const ROW_MIN_HEIGHT = 72;
const ROW_RADIUS = 10;
const ROW_EDGE_WIDTH = 1.5;

/** Liste des niveaux : une ligne de 52 px et 6 px d'écart, soit 58 px par niveau, dix niveaux dans 580 px. */
const LEVEL_ROW_HEIGHT = 52;
const LEVEL_ROW_GAP = 6;
/** Étoiles d'un niveau : trois, de ce rayon en pixels et à ce pas l'une de l'autre. */
const STARS_PER_LEVEL = 3;
const ROW_STAR_RADIUS = 9;
const ROW_STAR_STEP = 26;
/** Place que prennent les étoiles d'une ligne de niveau, marge comprise, et écart à leur garder devant le texte. */
const LEVEL_STARS_WIDTH = STARS_PER_LEVEL * ROW_STAR_STEP + ROW_PADDING;
const LEVEL_DETAIL_GAP = 8;
/** Étoiles de l'écran de victoire : rayon, hauteur de ligne, et marge entre l'étoile et son texte. */
const WIN_STAR_RADIUS = 12;
const WIN_ROW_HEIGHT = 34;
const WIN_STAR_GAP = 12;
/** Étoile creuse : fond et contour. */
const STAR_EMPTY_EDGE_WIDTH = 1.5;
/** Cadenas des niveaux verrouillés, en pixels : largeur du corps, hauteur du corps, hauteur de l'anse et son retrait de chaque côté. */
const LOCK_WIDTH = 16;
const LOCK_BODY = 12;
const LOCK_SHACKLE = 7;
const LOCK_SHACKLE_INSET = 3.5;

const HINT = "Garde le doigt posé pour prendre de l'élan, relâche en montant";

/** Portée du halo des éléments d'interface : plus courte que celle du jeu, pour ne pas déborder sur le texte voisin. */
const UI_SPREAD = 0.6;
/** Force du halo des boutons et des lignes allumées : un cran sous celle du jeu, pour que le texte reste le plus lumineux. */
const UI_STRENGTH = 0.8;

/** Le halo d'un titre : l'accent de la palette, ou une couleur fixe (la mort est rouge, quelle que soit la musique). */
type Glow = number | 'accent';

/** Une étoile du jeu : un tube jaune à halo chaud si elle est gagnée, un contour éteint sinon. */
function drawStar(g: Graphics, x: number, y: number, radius: number, filled: boolean): void {
  if (filled) neonPoly(g, (grow) => starPoints(x, y, radius + grow), { color: COLOR.star, halo: COLOR.starHalo, spread: UI_SPREAD });
  else g.poly(starPoints(x, y, radius)).fill(COLOR.barTrack).stroke({ width: STAR_EMPTY_EDGE_WIDTH, color: COLOR.textLocked });
}

/**
 * Une coche de la largeur `size`, dont le coin haut gauche est en (`x`, `y`) :
 * un trait de tube au cœur blanc froid. Son halo est tracé à part, dans `halo`
 * (en blanc, que l'accent teinte), sous `core`.
 */
function drawCheck(halo: Graphics, core: Graphics, x: number, y: number, size: number): void {
  const points = [
    { x, y: y + size * 0.55 },
    { x: x + size * 0.38, y: y + size * 0.9 },
    { x: x + size, y },
  ];
  const tube = { color: COLOR.hot, halo: COLOR.white, width: 3, cap: 'round' as const, join: 'round' as const, spread: UI_SPREAD };
  neonPolyline(halo, points, { ...tube, pass: 'halo' });
  neonPolyline(core, points, { ...tube, pass: 'core' });
}

/** Un cadenas, dont le coin haut gauche est en (`x`, `y`). */
function drawPadlock(g: Graphics, x: number, y: number): void {
  const radius = LOCK_WIDTH / 2 - LOCK_SHACKLE_INSET;
  g.moveTo(x + LOCK_SHACKLE_INSET, y + LOCK_SHACKLE)
    .lineTo(x + LOCK_SHACKLE_INSET, y + radius)
    .arc(x + LOCK_WIDTH / 2, y + radius, radius, Math.PI, 0)
    .lineTo(x + LOCK_WIDTH - LOCK_SHACKLE_INSET, y + LOCK_SHACKLE)
    .stroke({ width: 2, color: COLOR.textLocked });
  g.roundRect(x, y + LOCK_SHACKLE, LOCK_WIDTH, LOCK_BODY, 3).fill(COLOR.textLocked);
}

/** Un bloc d'écran : une pile verticale de textes et de formes, avec les boutons qu'elle porte. */
class Column {
  readonly root = new Container();
  /** Boutons du bloc, dans son propre repère. */
  readonly buttons: ButtonRect[] = [];
  /**
   * Ce que l'accent de la palette colore dans ce bloc : une fonction par forme
   * ou par halo, qui en change la teinte. L'écran les appelle avec l'accent du moment.
   */
  readonly skins: ((accent: number) => void)[] = [];
  private readonly width: number;
  private cursor = 0;

  constructor(width: number) {
    this.width = width;
  }

  get height(): number {
    return this.cursor;
  }

  gap(pixels: number): void {
    this.cursor += pixels;
  }

  /** Une forme que l'accent de la palette teinte : à tracer en blanc, la teinte lui donne sa couleur. */
  private accented(g: Graphics): Graphics {
    this.skins.push((accent) => {
      g.tint = accent;
    });
    return g;
  }

  /**
   * Texte centré, qui passe à la ligne s'il dépasse la largeur du bloc. `glow` :
   * le halo de néon autour des lettres, pour les titres. 'accent' le fait suivre
   * la palette ; un nombre est une couleur fixe.
   */
  line(text: string, size: number, color: number, bold = false, glow?: Glow): void {
    if (glow === undefined) {
      const label = makeText(text, size, color, { bold, wrap: this.width });
      label.anchor.set(0.5, 0);
      label.position.set(this.width / 2, this.cursor);
      this.root.addChild(label);
      this.cursor += label.height;
      return;
    }
    const label = new GlowText(text, size, color, glow === 'accent' ? COLOR.white : glow, { bold, wrap: this.width });
    if (glow === 'accent') {
      this.skins.push((accent) => {
        label.glow = accent;
      });
    }
    label.anchorAt(0.5, 0);
    label.position.set(this.width / 2, this.cursor);
    this.root.addChild(label);
    this.cursor += label.textHeight;
  }

  /** Barre d'expérience : un rail sombre, et un tube de l'accent sur la part `ratio`. */
  bar(ratio: number): void {
    const x = (this.width - BAR_WIDTH) / 2;
    this.root.addChild(new Graphics().roundRect(x, this.cursor, BAR_WIDTH, BAR_HEIGHT, BAR_HEIGHT / 2).fill(COLOR.barTrack));
    const filled = BAR_WIDTH * Math.min(1, Math.max(0, ratio));
    if (filled > 0) {
      const fill = this.accented(new Graphics());
      neonBar(fill, x, this.cursor, filled, BAR_HEIGHT, { color: COLOR.white, halo: COLOR.white, spread: UI_SPREAD });
      this.root.addChild(fill);
    }
    this.cursor += BAR_HEIGHT;
  }

  /** Une mission : son texte à gauche, son avancement à droite. */
  mission(def: MissionDef, progress: number): void {
    const done = makeText(missionProgress(def, progress), 16, COLOR.textDim, { bold: true });
    done.anchor.set(1, 0);
    done.position.set(this.width, this.cursor);
    const label = makeText(def.text, 16, COLOR.text, { wrap: this.width - done.width - MISSION_PROGRESS_GAP, align: 'left' });
    label.position.set(0, this.cursor);
    this.root.addChild(label, done);
    this.cursor += Math.max(label.height, done.height);
  }

  /** Le fond sombre d'un bouton de `width` pixels, de gauche `x`, au curseur, et son contour de néon fin, qui prend l'accent. */
  private buttonFrame(x: number, width: number): void {
    const panel = new Graphics().roundRect(x, this.cursor, width, BUTTON_HEIGHT, BUTTON_RADIUS).fill({ color: COLOR.panel, alpha: 0.9 });
    const edge = this.accented(new Graphics());
    neonRoundRect(edge, x, this.cursor, width, BUTTON_HEIGHT, BUTTON_RADIUS, { color: COLOR.white, halo: COLOR.white, width: BUTTON_EDGE_WIDTH, spread: UI_SPREAD, strength: UI_STRENGTH });
    this.root.addChild(panel, edge);
  }

  /** Bouton centré, sur fond nuit, au contour de néon fin. */
  button(id: ButtonId, label: string): void {
    const x = (this.width - BUTTON_WIDTH) / 2;
    this.buttonFrame(x, BUTTON_WIDTH);
    const text = makeText(label, BUTTON_FONT_SIZE, COLOR.text, { bold: true });
    text.anchor.set(0.5);
    text.position.set(this.width / 2, this.cursor + BUTTON_HEIGHT / 2);
    this.root.addChild(text);
    this.buttons.push({ id, x, y: this.cursor, width: BUTTON_WIDTH, height: BUTTON_HEIGHT });
    this.cursor += BUTTON_HEIGHT;
  }

  /**
   * Plusieurs boutons côte à côte sur la largeur du bloc, séparés de `BUTTON_GAP`,
   * chacun large selon son poids : de quoi garder « Retour » et le bouton d'une
   * page sur une seule ligne.
   */
  buttonRow(items: readonly { readonly id: ButtonId; readonly label: string; readonly weight: number }[]): void {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    const room = this.width - BUTTON_GAP * (items.length - 1);
    let x = 0;
    for (const item of items) {
      const width = (room * item.weight) / total;
      this.buttonFrame(x, width);
      const text = makeText(item.label, BUTTON_FONT_SIZE, COLOR.text, { bold: true });
      text.anchor.set(0.5);
      text.position.set(x + width / 2, this.cursor + BUTTON_HEIGHT / 2);
      this.root.addChild(text);
      this.buttons.push({ id: item.id, x, y: this.cursor, width, height: BUTTON_HEIGHT });
      x += width + BUTTON_GAP;
    }
    this.cursor += BUTTON_HEIGHT;
  }

  /**
   * Fond d'une ligne, ajouté au bloc : verrouillée, un voile à peine visible ;
   * au repos, un contour bleu sombre ; allumée (talisman équipé, niveau à jouer),
   * un contour de néon de l'accent. `g` porte déjà le rectangle arrondi de la
   * ligne, posée au curseur.
   */
  private paintRow(g: Graphics, height: number, look: 'locked' | 'idle' | 'lit'): void {
    const top = this.cursor;
    if (look === 'locked') g.fill({ color: COLOR.panel, alpha: 0.3 });
    else if (look === 'idle') g.fill({ color: COLOR.panel, alpha: 0.6 }).stroke({ width: ROW_EDGE_WIDTH, color: COLOR.panelEdge });
    else g.fill({ color: COLOR.panelEquipped, alpha: 0.95 });
    this.root.addChild(g);
    if (look !== 'lit') return;
    const edge = this.accented(new Graphics());
    neonRoundRect(edge, 0, top, this.width, height, ROW_RADIUS, { color: COLOR.white, halo: COLOR.white, width: ROW_EDGE_WIDTH, spread: UI_SPREAD, strength: UI_STRENGTH });
    this.root.addChild(edge);
  }

  /**
   * Une ligne de talisman : nom, description plus petite et plus grise, et à
   * droite « Équipé » ou le niveau qui le débloque. Équipée, elle a un fond plus
   * clair ; verrouillée, elle est grisée et n'est pas un bouton.
   */
  talisman(talisman: Talisman, equipped: boolean, locked: boolean): void {
    const nameColor = locked ? COLOR.textLocked : COLOR.text;
    const name = makeText(talisman.name, 19, nameColor, { bold: true, align: 'left' });
    name.position.set(ROW_PADDING, this.cursor + ROW_PADDING);
    const description = makeText(talisman.description, 13, locked ? COLOR.textLocked : COLOR.textFaint, { wrap: this.width - 2 * ROW_PADDING, align: 'left' });
    description.position.set(ROW_PADDING, name.y + name.height + 2);
    const tag = locked ? makeText(`Niveau ${talisman.level}`, 15, COLOR.textLocked) : equipped ? makeText('Équipé', 16, COLOR.text, { bold: true }) : null;
    tag?.anchor.set(1, 0);
    tag?.position.set(this.width - ROW_PADDING, name.y + 2);

    const height = Math.max(ROW_MIN_HEIGHT, description.y + description.height + ROW_PADDING - this.cursor);
    const background = new Graphics().roundRect(0, this.cursor, this.width, height, ROW_RADIUS);
    this.paintRow(background, height, locked ? 'locked' : equipped ? 'lit' : 'idle');

    this.root.addChild(name, description);
    if (tag) this.root.addChild(tag);
    if (!locked) this.buttons.push({ id: talisman.id, x: 0, y: this.cursor, width: this.width, height });
    this.cursor += height;
  }

  /** « 7 ★ sur 30 » : le nombre, une étoile dessinée, puis le reste de la phrase, le tout centré. */
  starCount(count: number, max: number): void {
    const before = makeText(String(count), 18, COLOR.textDim, { bold: true });
    const after = makeText(`sur ${max}`, 18, COLOR.textDim, { bold: true });
    const radius = 8;
    const gap = 8;
    const total = before.width + gap + 2 * radius + gap + after.width;
    const left = (this.width - total) / 2;
    before.position.set(left, this.cursor);
    after.position.set(left + before.width + 2 * gap + 2 * radius, this.cursor);
    const star = new Graphics();
    drawStar(star, left + before.width + gap + radius, this.cursor + before.height / 2, radius, true);
    this.root.addChild(before, star, after);
    this.cursor += before.height;
  }

  /**
   * Une ligne de la liste des niveaux : numéro et nom, intervalle de hauteur, et
   * à droite trois étoiles, pleines ou creuses, ou un cadenas si le niveau est
   * verrouillé. Le niveau à jouer a un fond plus clair ; une ligne verrouillée
   * est grisée et n'est pas un bouton.
   */
  level(level: LevelDef, stars: number, locked: boolean, current: boolean, detail: string = levelRange(level)): void {
    const name = makeText(levelRowTitle(level), 17, locked ? COLOR.textLocked : COLOR.text, { bold: true, align: 'left' });
    name.position.set(ROW_PADDING, this.cursor + 6);
    const range = makeText(detail, 13, locked ? COLOR.textLocked : COLOR.textFaint, { align: 'left' });
    range.position.set(ROW_PADDING, name.y + name.height);
    // La ligne du dessous s'arrête avant les étoiles : on lui retire des événements, du dernier au premier, jusqu'à ce qu'elle tienne.
    const room = this.width - ROW_PADDING - LEVEL_STARS_WIDTH - LEVEL_DETAIL_GAP;
    for (let text = detail; range.width > room && text.includes(' · '); ) {
      const parts = text.replace(/ · …$/, '').split(' · ');
      parts.pop();
      text = [...parts, '…'].join(' · ');
      range.text = text;
    }

    const background = new Graphics().roundRect(0, this.cursor, this.width, LEVEL_ROW_HEIGHT, ROW_RADIUS);
    this.paintRow(background, LEVEL_ROW_HEIGHT, locked ? 'locked' : current ? 'lit' : 'idle');

    const shapes = new Graphics();
    const middle = this.cursor + LEVEL_ROW_HEIGHT / 2;
    if (locked) {
      drawPadlock(shapes, this.width - ROW_PADDING - LOCK_WIDTH, middle - (LOCK_SHACKLE + LOCK_BODY) / 2);
    } else {
      for (let star = 0; star < STARS_PER_LEVEL; star += 1) {
        const x = this.width - ROW_PADDING - ROW_STAR_STEP * (STARS_PER_LEVEL - star) + ROW_STAR_STEP / 2;
        drawStar(shapes, x, middle, ROW_STAR_RADIUS, star < stars);
      }
      this.buttons.push({ id: levelButton(level.id), x: 0, y: this.cursor, width: this.width, height: LEVEL_ROW_HEIGHT });
    }
    this.root.addChild(name, range, shapes);
    this.cursor += LEVEL_ROW_HEIGHT;
  }

  /** Une étoile de la victoire : l'étoile pleine ou creuse, ce qu'elle demande, et à droite une coche ou l'avancement. */
  starLine(line: StarLine): void {
    const middle = this.cursor + WIN_ROW_HEIGHT / 2;
    const shapes = new Graphics();
    drawStar(shapes, WIN_STAR_RADIUS, middle, WIN_STAR_RADIUS, line.done);
    const label = makeText(line.label, 19, line.done ? COLOR.text : COLOR.textDim, { bold: line.done, align: 'left' });
    label.position.set(2 * WIN_STAR_RADIUS + WIN_STAR_GAP, middle - label.height / 2);
    if (line.done) {
      // Le halo de la coche (teinté par l'accent) sous son cœur, qui est avec les étoiles.
      const checkHalo = this.accented(new Graphics());
      drawCheck(checkHalo, shapes, this.width - 18, middle - 7, 14);
      this.root.addChild(checkHalo);
    }
    this.root.addChild(shapes, label);
    if (!line.done && line.progress !== null) {
      const progress = makeText(line.progress, 17, COLOR.textDim, { bold: true });
      progress.anchor.set(1, 0.5);
      progress.position.set(this.width, middle);
      this.root.addChild(progress);
    }
    this.cursor += WIN_ROW_HEIGHT;
  }
}

/** Les deux blocs d'un écran, et où placer celui du haut quand il reste de la place. */
interface Layout {
  readonly upper: Column;
  readonly lower: Column;
  readonly align: 'center' | 'top';
}

function buildTitle(profile: Profile, width: number, testMode: boolean): Layout {
  const upper = new Column(width);
  const progress = levelProgress(profile.xp);
  upper.line('GRAPPIN', 56, COLOR.text, true, 'accent');
  if (testMode) {
    upper.gap(6);
    upper.line(TEST_MODE_LINE, 15, COLOR.textDim);
  }
  upper.gap(16);
  upper.line(`Niveau ${progress.level}`, 24, COLOR.text, true);
  upper.gap(8);
  upper.bar(progress.ratio);
  if (profile.bestHeight > 0) {
    upper.gap(14);
    upper.line(`Meilleure montée : ${Math.floor(profile.bestHeight)} m`, 18, COLOR.textDim);
  }
  // Le niveau qu'un appui va jouer, puis les étoiles gagnées sur l'ensemble de la traversée.
  const next = levelById(unlockedLevel(profile));
  if (next) {
    upper.gap(14);
    upper.line(levelTitle(next), 20, COLOR.text, true);
  }
  upper.gap(4);
  upper.starCount(
    LEVELS.reduce((sum, level) => sum + starsOf(profile, level.id), 0),
    LEVELS.length * STARS_PER_LEVEL,
  );
  upper.gap(24);
  profile.missions
    .flatMap((state) => {
      const def = missionById(state.id);
      return def ? [{ def, progress: state.progress }] : [];
    })
    .forEach((mission, index) => {
      if (index > 0) upper.gap(MISSION_GAP);
      upper.mission(mission.def, mission.progress);
    });

  const lower = new Column(width);
  lower.line(equippedLine(profile.equipped), 16, COLOR.textDim);
  lower.gap(14);
  lower.button('levels', 'Niveaux');
  lower.gap(BUTTON_GAP);
  lower.button('free', 'Course libre');
  lower.gap(BUTTON_GAP);
  lower.button('talismans', 'Talismans');
  lower.gap(BUTTON_GAP);
  lower.button('music', profile.music ? 'Musique : oui' : 'Musique : non');
  lower.gap(22);
  lower.line('Toucher pour jouer', 24, COLOR.textDim);
  if (showsHint(profile)) {
    lower.gap(10);
    lower.line(HINT, 16, COLOR.textDim);
  }
  return { upper, lower, align: 'center' };
}

/**
 * La liste des niveaux, dix par page. En bas, sur une ligne : « Retour » et le
 * bouton de l'autre page (« Niveaux 11 à 20 » depuis la première, « Niveaux 1 à
 * 10 » depuis la dernière).
 */
function buildLevels(profile: Profile, width: number, testMode: boolean, page: number): Layout {
  const current = unlockedLevel(profile);
  const pages = levelPageCount();
  const shown = Math.min(Math.max(0, page), pages - 1);
  const upper = new Column(width);
  upper.line('Niveaux', 34, COLOR.text, true, 'accent');
  if (testMode) {
    upper.gap(4);
    upper.line(TEST_MODE_LINE, 15, COLOR.textDim);
  }
  upper.gap(testMode ? 12 : 16);
  levelsOfPage(shown).forEach((level, index) => {
    if (index > 0) upper.gap(LEVEL_ROW_GAP);
    // En mode test, rien n'est verrouillé et la ligne du dessous dit les événements du niveau, ce que l'on vient tester.
    const detail = testMode && level.events.length > 0 ? levelEvents(level) : levelRange(level);
    upper.level(level, starsOf(profile, level.id), !testMode && level.id > current, level.id === current, detail);
  });

  const lower = new Column(width);
  const row: { id: ButtonId; label: string; weight: number }[] = [{ id: 'back', label: 'Retour', weight: 1 }];
  if (shown > 0) row.push({ id: 'precedents', label: levelPageLabel(levelsOfPage(shown - 1)), weight: 2 });
  if (shown < pages - 1) row.push({ id: 'suite', label: levelPageLabel(levelsOfPage(shown + 1)), weight: 2 });
  lower.buttonRow(row);
  return { upper, lower, align: 'top' };
}

/**
 * Ce que toute fin de partie dit du bilan : score, expérience, record,
 * missions accomplies, niveau de grimpeur et déblocages. `news` : une ligne de
 * plus, juste après l'expérience.
 */
function describeOutcome(upper: Column, score: number, outcome: RunOutcome, news: string | null = null): void {
  upper.line(`Score ${Math.floor(score).toLocaleString('fr-FR')}`, 26, COLOR.text);
  upper.gap(4);
  upper.line(`+${outcome.xpGained} XP`, 26, COLOR.text, true);
  if (news !== null) {
    upper.gap(12);
    upper.line(news, 20, COLOR.text, true);
  }
  if (outcome.newBestHeight) {
    upper.gap(12);
    upper.line('Nouveau record !', 22, COLOR.text, true);
  }
  for (const mission of outcome.missionsCompleted) {
    upper.gap(12);
    upper.line(missionDoneLine(mission), 18, COLOR.text);
  }
  if (outcome.levelAfter > outcome.levelBefore) {
    upper.gap(18);
    upper.line(`Niveau ${outcome.levelAfter} !`, 30, COLOR.text, true, 'accent');
    for (const talisman of outcome.unlocked) {
      upper.gap(6);
      upper.line(`Débloqué : ${talisman.name}`, 20, COLOR.text);
    }
  }
}

function buildDead(height: number, goal: number | null, score: number, cause: string, outcome: RunOutcome, width: number): Layout {
  const upper = new Column(width);
  upper.line(`Perdu à ${Math.floor(height)} m`, 38, COLOR.text, true, COLOR.obstacleEdge);
  upper.gap(6);
  upper.line(cause, 22, COLOR.textDim);
  if (goal !== null) {
    upper.gap(4);
    upper.line(`Objectif : ${goal} m`, 20, COLOR.textDim);
  }
  upper.gap(18);
  describeOutcome(upper, score, outcome);

  const lower = new Column(width);
  lower.button('levels', 'Niveaux');
  lower.gap(BUTTON_GAP);
  lower.button('talismans', 'Talismans');
  lower.gap(22);
  lower.line(goal === null ? 'Toucher pour rejouer' : 'Toucher pour réessayer', 24, COLOR.textDim);
  return { upper, lower, align: 'center' };
}

function buildWon(score: number, outcome: LevelOutcome, result: LevelResult, width: number): Layout {
  const next = levelById(outcome.level.id + 1);
  const upper = new Column(width);
  upper.line('Niveau terminé !', 38, COLOR.text, true, 'accent');
  upper.gap(6);
  upper.line(levelTitle(outcome.level), 22, COLOR.textDim);
  upper.gap(18);
  starLines(result).forEach((line, index) => {
    if (index > 0) upper.gap(WIN_ROW_GAP);
    upper.starLine(line);
  });
  upper.gap(18);
  describeOutcome(upper, score, outcome, outcome.firstClear && next ? `Nouveau niveau débloqué : ${next.name}` : null);

  const lower = new Column(width);
  if (next) {
    lower.button('next', 'Niveau suivant');
    lower.gap(BUTTON_GAP);
  }
  lower.button('replay', 'Rejouer');
  lower.gap(BUTTON_GAP);
  lower.button('levels', 'Niveaux');
  return { upper, lower, align: 'center' };
}

function buildTalismans(profile: Profile, width: number): Layout {
  const level = levelFor(profile.xp);
  const upper = new Column(width);
  upper.line('Talismans', 34, COLOR.text, true, 'accent');
  upper.gap(6);
  upper.line(slotsLine(slotsFor(level), profile.equipped.length), 16, COLOR.textDim);
  upper.gap(20);
  TALISMANS.forEach((talisman, index) => {
    if (index > 0) upper.gap(ROW_GAP);
    upper.talisman(talisman, profile.equipped.includes(talisman.id), talisman.level > level);
  });

  const lower = new Column(width);
  lower.button('back', 'Retour');
  return { upper, lower, align: 'top' };
}

function buildLayout(view: Exclude<OverlayView, { kind: 'none' }>, width: number): Layout {
  switch (view.kind) {
    case 'title':
      return buildTitle(view.profile, width, view.testMode);
    case 'levels':
      return buildLevels(view.profile, width, view.testMode, view.page);
    case 'dead':
      return buildDead(view.height, view.goal, view.score, view.cause, view.outcome, width);
    case 'won':
      return buildWon(view.score, view.outcome, view.result, width);
    case 'talismans':
      return buildTalismans(view.profile, width);
  }
}

/** Deux vues disent-elles la même chose ? Comparaison champ à champ : les profils et issues sont remplacés, jamais modifiés. */
function sameView(a: OverlayView | null, b: OverlayView): boolean {
  if (!a) return false;
  const left = Object.entries(a);
  const right = Object.entries(b);
  return left.length === right.length && left.every(([key, value], index) => right[index]?.[0] === key && Object.is(right[index]?.[1], value));
}

export class Screens {
  /** À ajouter à la scène, au-dessus de tout le reste. */
  readonly root = new Container();
  private readonly shade = new Graphics();
  private readonly content = new Container();
  /** Rectangles des boutons de l'écran affiché, en pixels CSS de l'écran. */
  private rects: ButtonRect[] = [];
  private shown: OverlayView | null = null;
  private shownWidth = 0;
  private shownHeight = 0;
  /** Ce que l'accent colore dans l'écran affiché, et l'accent qui lui a été donné : null tant qu'aucun ne l'a été. */
  private skins: ((accent: number) => void)[] = [];
  private accent: number | null = null;

  constructor() {
    this.root.addChild(this.shade, this.content);
  }

  /**
   * Montre la vue donnée, et ne remet en page que si elle ou la taille de l'écran
   * a changé. L'ambiance, elle, se rafraîchit à chaque image sans rien retracer :
   * le voile prend la couleur du fond, et l'accent colore ses formes et ses halos.
   */
  draw(view: OverlayView, width: number, height: number, palette: Palette): void {
    this.root.visible = view.kind !== 'none';
    if (view.kind === 'none') {
      if (this.shown) this.clear();
      return;
    }
    if (!sameView(this.shown, view) || width !== this.shownWidth || height !== this.shownHeight) this.layout(view, width, height);
    this.shade.tint = palette.background;
    if (palette.accent !== this.accent) {
      this.accent = palette.accent;
      for (const skin of this.skins) skin(palette.accent);
    }
  }

  /** Dessine la vue donnée, pour cette taille d'écran. */
  private layout(view: Exclude<OverlayView, { kind: 'none' }>, width: number, height: number): void {
    this.clear();
    this.shown = view;
    this.shownWidth = width;
    this.shownHeight = height;

    // Le voile est blanc : sa teinte, celle du fond, se pose à chaque image.
    this.shade.rect(0, 0, width, height).fill({ color: COLOR.white, alpha: DENSE_VIEWS.has(view.kind) ? SHADE_ALPHA_DENSE : SHADE_ALPHA });

    const contentWidth = Math.min(width - 2 * SIDE_MARGIN, MAX_WIDTH);
    const { upper, lower, align } = buildLayout(view, contentWidth);
    const top = Math.max(EDGE_MARGIN, readSafeInset('top') + SAFE_GAP);
    const bottom = Math.max(EDGE_MARGIN, readSafeInset('bottom') + SAFE_GAP);
    const available = height - top - bottom;
    const natural = upper.height + BLOCK_GAP + lower.height;
    // Trop haut : tout rétrécit ensemble. Sinon la place qui reste va entre les deux blocs.
    const scale = Math.min(1, available / natural);
    const free = available / scale - natural;
    upper.root.y = align === 'center' ? free / 2 : 0;
    lower.root.y = upper.height + BLOCK_GAP + free;
    this.content.addChild(upper.root, lower.root);
    this.skins = [...upper.skins, ...lower.skins];
    this.content.scale.set(scale);
    this.content.position.set((width - contentWidth * scale) / 2, top);

    this.rects = [upper, lower].flatMap((column) =>
      column.buttons.map((button) => ({
        id: button.id,
        x: this.content.x + button.x * scale,
        y: this.content.y + (column.root.y + button.y) * scale,
        width: button.width * scale,
        height: button.height * scale,
      })),
    );
  }

  /** Boutons de l'écran affiché ; vide quand la partie est en cours. */
  buttons(): readonly ButtonRect[] {
    return this.rects;
  }

  /** Le bouton ou la ligne de talisman sous un point de l'écran, ou null. */
  hitTest(x: number, y: number): ButtonId | null {
    const hit = this.rects.find((rect) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height);
    return hit?.id ?? null;
  }

  /** Vide l'écran : formes, textes et boutons. */
  private clear(): void {
    this.shade.clear();
    for (const child of this.content.removeChildren()) child.destroy({ children: true });
    this.rects = [];
    this.skins = [];
    this.accent = null;
    this.shown = null;
  }
}

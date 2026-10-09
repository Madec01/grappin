import { Container, Graphics } from 'pixi.js';
import { levelFor, levelProgress } from '../meta/levels';
import { missionById, type MissionDef } from '../meta/missions';
import { showsHint, type Profile, type RunOutcome } from '../meta/profile';
import { TALISMANS, slotsFor, type Talisman, type TalismanId } from '../meta/talismans';
import { equippedLine, missionDoneLine, missionProgress, slotsLine } from './labels';
import { COLOR, makeText, readSafeInset } from './style';

/**
 * Les écrans posés sur le jeu : titre, fin de partie et talismans. Un voile
 * sombre et des textes en formes grises, rien d'autre.
 *
 * Chaque écran est fait de deux blocs empilés : celui du haut (l'information)
 * et celui du bas (le bouton et l'invite), collé au bas de l'écran pour rester
 * sous le pouce. Si l'ensemble ne tient pas dans la hauteur, il est réduit
 * d'un coup plutôt que rogné. Les boutons se retrouvent après coup par
 * `hitTest`, à partir des rectangles réellement dessinés.
 */

/** Un bouton ou une ligne sur laquelle on peut taper : « Talismans », « Retour », ou un talisman débloqué. */
export type ButtonId = 'talismans' | 'back' | TalismanId;

/** Rectangle d'un bouton, en pixels CSS de l'écran. */
export interface ButtonRect {
  readonly id: ButtonId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Ce que les écrans ont à montrer. `none` : la partie est en cours, rien n'est posé sur le jeu. */
export type OverlayView =
  | { readonly kind: 'none' }
  | { readonly kind: 'title'; readonly profile: Profile }
  | { readonly kind: 'dead'; readonly height: number; readonly score: number; readonly cause: string; readonly outcome: RunOutcome }
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
/** L'écran des talismans porte beaucoup de texte : voile plus dense. */
const SHADE_ALPHA_DENSE = 0.9;

/** Boutons : 56 px de haut, soit plus que les 44 px d'un doigt même réduits d'un cinquième. */
const BUTTON_WIDTH = 220;
const BUTTON_HEIGHT = 56;
const BUTTON_RADIUS = 12;
const BUTTON_EDGE_WIDTH = 2;
const BUTTON_FONT_SIZE = 22;

const BAR_WIDTH = 220;
const BAR_HEIGHT = 10;

const MISSION_GAP = 12;
/** Distance entre une mission et son avancement. */
const MISSION_PROGRESS_GAP = 12;

const ROW_GAP = 10;
const ROW_PADDING = 12;
const ROW_MIN_HEIGHT = 72;
const ROW_RADIUS = 10;
const ROW_EDGE_WIDTH = 1.5;

const HINT = "Garde le doigt posé pour prendre de l'élan, relâche en montant";

/** Un bloc d'écran : une pile verticale de textes et de formes, avec les boutons qu'elle porte. */
class Column {
  readonly root = new Container();
  /** Boutons du bloc, dans son propre repère. */
  readonly buttons: ButtonRect[] = [];
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

  /** Texte centré, qui passe à la ligne s'il dépasse la largeur du bloc. */
  line(text: string, size: number, color: number, bold = false): void {
    const label = makeText(text, size, color, { bold, wrap: this.width });
    label.anchor.set(0.5, 0);
    label.position.set(this.width / 2, this.cursor);
    this.root.addChild(label);
    this.cursor += label.height;
  }

  /** Barre d'expérience : fond gris, remplissage clair sur la part `ratio`. */
  bar(ratio: number): void {
    const x = (this.width - BAR_WIDTH) / 2;
    const g = new Graphics().roundRect(x, this.cursor, BAR_WIDTH, BAR_HEIGHT, BAR_HEIGHT / 2).fill(COLOR.barTrack);
    const filled = BAR_WIDTH * Math.min(1, Math.max(0, ratio));
    if (filled > 0) g.roundRect(x, this.cursor, filled, BAR_HEIGHT, BAR_HEIGHT / 2).fill(COLOR.barFill);
    this.root.addChild(g);
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

  /** Bouton centré, à bord clair. */
  button(id: ButtonId, label: string): void {
    const x = (this.width - BUTTON_WIDTH) / 2;
    const g = new Graphics()
      .roundRect(x, this.cursor, BUTTON_WIDTH, BUTTON_HEIGHT, BUTTON_RADIUS)
      .fill({ color: COLOR.panel, alpha: 0.9 })
      .stroke({ width: BUTTON_EDGE_WIDTH, color: COLOR.buttonEdge });
    const text = makeText(label, BUTTON_FONT_SIZE, COLOR.text, { bold: true });
    text.anchor.set(0.5);
    text.position.set(this.width / 2, this.cursor + BUTTON_HEIGHT / 2);
    this.root.addChild(g, text);
    this.buttons.push({ id, x, y: this.cursor, width: BUTTON_WIDTH, height: BUTTON_HEIGHT });
    this.cursor += BUTTON_HEIGHT;
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
    if (locked) background.fill({ color: COLOR.panel, alpha: 0.3 });
    else if (equipped) background.fill({ color: COLOR.panelEquipped, alpha: 0.95 }).stroke({ width: ROW_EDGE_WIDTH, color: COLOR.panelEdgeEquipped });
    else background.fill({ color: COLOR.panel, alpha: 0.6 }).stroke({ width: ROW_EDGE_WIDTH, color: COLOR.panelEdge });

    this.root.addChild(background, name, description);
    if (tag) this.root.addChild(tag);
    if (!locked) this.buttons.push({ id: talisman.id, x: 0, y: this.cursor, width: this.width, height });
    this.cursor += height;
  }
}

/** Les deux blocs d'un écran, et où placer celui du haut quand il reste de la place. */
interface Layout {
  readonly upper: Column;
  readonly lower: Column;
  readonly align: 'center' | 'top';
}

function buildTitle(profile: Profile, width: number): Layout {
  const upper = new Column(width);
  const progress = levelProgress(profile.xp);
  upper.line('GRAPPIN', 56, COLOR.text, true);
  upper.gap(16);
  upper.line(`Niveau ${progress.level}`, 24, COLOR.text, true);
  upper.gap(8);
  upper.bar(progress.ratio);
  if (profile.bestHeight > 0) {
    upper.gap(14);
    upper.line(`Record : ${Math.floor(profile.bestHeight)} m`, 18, COLOR.textDim);
  }
  upper.gap(28);
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
  lower.gap(16);
  lower.button('talismans', 'Talismans');
  lower.gap(28);
  lower.line('Toucher pour jouer', 24, COLOR.textDim);
  if (showsHint(profile)) {
    lower.gap(10);
    lower.line(HINT, 16, COLOR.textDim);
  }
  return { upper, lower, align: 'center' };
}

function buildDead(height: number, score: number, cause: string, outcome: RunOutcome, width: number): Layout {
  const upper = new Column(width);
  upper.line(`Perdu à ${Math.floor(height)} m`, 38, COLOR.text, true);
  upper.gap(6);
  upper.line(cause, 22, COLOR.textDim);
  upper.gap(18);
  upper.line(`Score ${Math.floor(score).toLocaleString('fr-FR')}`, 26, COLOR.text);
  upper.gap(4);
  upper.line(`+${outcome.xpGained} XP`, 26, COLOR.text, true);
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
    upper.line(`Niveau ${outcome.levelAfter} !`, 30, COLOR.text, true);
    for (const talisman of outcome.unlocked) {
      upper.gap(6);
      upper.line(`Débloqué : ${talisman.name}`, 20, COLOR.text);
    }
  }

  const lower = new Column(width);
  lower.button('talismans', 'Talismans');
  lower.gap(22);
  lower.line('Toucher pour rejouer', 24, COLOR.textDim);
  return { upper, lower, align: 'center' };
}

function buildTalismans(profile: Profile, width: number): Layout {
  const level = levelFor(profile.xp);
  const upper = new Column(width);
  upper.line('Talismans', 34, COLOR.text, true);
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
      return buildTitle(view.profile, width);
    case 'dead':
      return buildDead(view.height, view.score, view.cause, view.outcome, width);
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

  constructor() {
    this.root.addChild(this.shade, this.content);
  }

  /** Montre la vue donnée, et ne remet en page que si elle ou la taille de l'écran a changé. */
  draw(view: OverlayView, width: number, height: number): void {
    this.root.visible = view.kind !== 'none';
    if (view.kind === 'none') {
      if (this.shown) this.clear();
      return;
    }
    if (sameView(this.shown, view) && width === this.shownWidth && height === this.shownHeight) return;
    this.clear();
    this.shown = view;
    this.shownWidth = width;
    this.shownHeight = height;

    this.shade.rect(0, 0, width, height).fill({ color: COLOR.shade, alpha: view.kind === 'talismans' ? SHADE_ALPHA_DENSE : SHADE_ALPHA });

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
    this.shown = null;
  }
}

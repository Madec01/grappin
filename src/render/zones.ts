import type { Zone, ZoneKind } from '../sim/state';
import { noise } from './effects';
import { mixColor } from './sling';
import { COLOR } from './style';

/**
 * Habillage des zones qui modifient le mouvement (courant ascendant, dérive,
 * couloir d'accélération, freinage) : ce qui, dans leur dessin, se calcule sans
 * PixiJS. Le rendu (`renderer.ts`) pose les formes, ce fichier dit où et avec
 * quelle intensité.
 *
 * Une zone se dessine dans son propre repère, celui de son courant : `along`
 * est la distance depuis l'entrée, dans le sens où elle pousse, et `across` la
 * position en travers. Un courant qui monte, un couloir qui accélère vers le
 * haut, une dérive qui file à droite ou à gauche se dessinent donc par les mêmes
 * fonctions, et seul le repère (`ZoneFrame`) les pose sur l'écran. Les motifs
 * (traînées, chevrons, bandes) ne sont que de la lumière : ils défilent sur
 * l'horloge des effets (temps réel), jamais sur la simulation, et ne disent
 * rien de plus que la zone elle-même. Leur disposition ne dépend que du numéro
 * de la zone (bruit déterministe) : deux zones voisines ne battent pas ensemble,
 * et une zone se redessine toujours pareille à un instant donné.
 */

/** Teinte de cœur de chaque espèce de zone (celle de ses traits et de son halo). */
export const ZONE_TONE: Readonly<Record<ZoneKind, number>> = {
  ascendant: COLOR.updraft,
  lateral: COLOR.drift,
  acceleration: COLOR.rocket,
  freinage: COLOR.brake,
};

/** La même teinte éclaircie vers le blanc : le cœur des traits les plus vifs, comme le cœur presque blanc d'un tube de néon. */
export const ZONE_CORE: Readonly<Record<ZoneKind, number>> = {
  ascendant: mixColor(COLOR.updraft, COLOR.white, 0.55),
  lateral: mixColor(COLOR.drift, COLOR.white, 0.5),
  acceleration: mixColor(COLOR.rocket, COLOR.white, 0.55),
  freinage: mixColor(COLOR.brake, COLOR.white, 0.45),
};

/** Quand le personnage est dans la zone, ses traits sont d'un cran plus vifs : ce facteur multiplie leur opacité (jamais au-delà de 1). */
export const ZONE_INSIDE_BOOST = 1.35;

/** Dans quel sens une zone pousse, vu de l'écran : sur l'axe vertical ou horizontal, vers le haut/la droite (+1) ou le bas/la gauche (-1). */
export interface Flow {
  readonly vertical: boolean;
  readonly sign: 1 | -1;
}

const UP: Flow = { vertical: true, sign: 1 };
const DOWN: Flow = { vertical: true, sign: -1 };
const RIGHT: Flow = { vertical: false, sign: 1 };
const LEFT: Flow = { vertical: false, sign: -1 };

/**
 * Le sens où la zone pousse : l'axe dominant de sa direction. Le freinage n'a pas de direction (il ne pousse pas) : il se dessine
 * à plat, empilé de bas en haut, sans que rien n'y file.
 */
export function flowOf(zone: Pick<Zone, 'kind' | 'dir'>): Flow {
  if (zone.kind === 'freinage') return UP;
  const { x, y } = zone.dir;
  if (Math.abs(y) >= Math.abs(x)) return y < 0 ? DOWN : UP;
  return x < 0 ? LEFT : RIGHT;
}

/** Un point ou un rectangle à l'écran, en pixels : réutilisés d'une image à l'autre, jamais alloués par image. */
export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Le repère d'une zone à l'écran : son rectangle (coin haut gauche, largeur et hauteur en pixels) et le sens où elle pousse. `along`
 * compte depuis l'entrée, dans le sens de la poussée ; `across`, depuis le bord gauche (zone verticale) ou le bord haut (zone horizontale).
 */
export interface ZoneFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  vertical: boolean;
  sign: 1 | -1;
}

export function makeFrame(): ZoneFrame {
  return { left: 0, top: 0, width: 0, height: 0, vertical: true, sign: 1 };
}

/** Pose le repère sur le rectangle écran de la zone. */
export function placeFrame(frame: ZoneFrame, left: number, top: number, width: number, height: number, flow: Flow): ZoneFrame {
  frame.left = left;
  frame.top = top;
  frame.width = width;
  frame.height = height;
  frame.vertical = flow.vertical;
  frame.sign = flow.sign;
  return frame;
}

/** Longueur de la zone dans le sens de la poussée, en pixels. */
export function frameLength(frame: ZoneFrame): number {
  return frame.vertical ? frame.height : frame.width;
}

/** Largeur de la zone en travers de la poussée, en pixels. */
export function frameBreadth(frame: ZoneFrame): number {
  return frame.vertical ? frame.width : frame.height;
}

/** Le point de l'écran à la distance `along` de l'entrée et à la position `across` en travers (pixels). Écrit dans `out`. */
export function framePoint(frame: ZoneFrame, along: number, across: number, out: Point): Point {
  if (frame.vertical) {
    out.x = frame.left + across;
    out.y = frame.sign > 0 ? frame.top + frame.height - along : frame.top + along;
  } else {
    out.y = frame.top + across;
    out.x = frame.sign > 0 ? frame.left + along : frame.left + frame.width - along;
  }
  return out;
}

const SCRATCH_A: Point = { x: 0, y: 0 };
const SCRATCH_B: Point = { x: 0, y: 0 };

/** Le rectangle de l'écran qui couvre la bande `along` de `from` à `to` et `across` de `left` à `right`, quel que soit le sens du repère. Écrit dans `out`. */
export function frameBox(frame: ZoneFrame, from: number, to: number, left: number, right: number, out: Box): Box {
  const a = framePoint(frame, from, left, SCRATCH_A);
  const b = framePoint(frame, to, right, SCRATCH_B);
  out.x = Math.min(a.x, b.x);
  out.y = Math.min(a.y, b.y);
  out.width = Math.abs(b.x - a.x);
  out.height = Math.abs(b.y - a.y);
  return out;
}

/** Le rectangle `box` rogné à la vue ; faux s'il n'en reste rien. Écrit dans `out` (qui peut être `box`). */
export function clipBox(box: Box, view: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }, out: Box): boolean {
  const left = Math.max(box.x, view.left);
  const right = Math.min(box.x + box.width, view.right);
  const top = Math.max(box.y, view.top);
  const bottom = Math.min(box.y + box.height, view.bottom);
  if (right <= left || bottom <= top) return false;
  out.x = left;
  out.y = top;
  out.width = right - left;
  out.height = bottom - top;
  return true;
}

/** Partie fractionnaire, toujours dans [0, 1), même pour un nombre négatif. */
export function frac(value: number): number {
  return value - Math.floor(value);
}

/** Le niveau (de 0 à `levels` - 1) d'une intensité de 0 à 1 : pour ranger des traits d'opacités voisines dans un même tracé. */
export function levelOf(value: number, levels: number): number {
  return Math.min(levels - 1, Math.max(0, Math.floor(value * levels)));
}

/** Fondu aux deux bouts d'un parcours : 0 aux extrémités de `position` (de 0 à 1), 1 passé `fade` de chaque bout, doux entre les deux. */
export function edgeFade(position: number, fade: number): number {
  const t = Math.min(1, Math.max(0, Math.min(position, 1 - position) / fade));
  return t * t * (3 - 2 * t);
}

/**
 * Lumière qui court le long d'une rangée de repères fixes : le repère `index` sur `count` (rangés dans le sens de la poussée) est au
 * plus vif quand la vague le franchit, `hz` fois par seconde, puis s'éteint doucement jusqu'au tour suivant. De 0 à 1.
 */
export function waveLight(index: number, count: number, clock: number, hz: number): number {
  const lit = 1 - frac(clock * hz - index / count);
  return lit * lit;
}

/**
 * Traînées d'un courant (ascendant, dérive) : des trais de lumière qui filent dans le sens de la poussée, à trois vitesses. Vitesse
 * visuelle en mètres par seconde (elle n'est pas celle du personnage), longueur en mètres, épaisseur en pixels, opacité de 0 à 1 ; `share` est
 * la part de traînées de ce rang, et `glow` dit si leur halo est posé (seules les plus vives en ont : un halo par traînée coûterait cher).
 */
export interface StreakTier {
  readonly speed: number;
  readonly length: number;
  readonly width: number;
  readonly alpha: number;
  readonly share: number;
  readonly glow: boolean;
}

export type StreakKind = 'ascendant' | 'lateral';

export const STREAK_TIERS: Readonly<Record<StreakKind, readonly StreakTier[]>> = {
  // Un courant qui monte : des trais courts et fins, lents, d'autres plus longs, quelques-uns vifs et brillants.
  ascendant: [
    { speed: 2.4, length: 0.6, width: 1.25, alpha: 0.4, share: 0.35, glow: false },
    { speed: 4, length: 1, width: 1.6, alpha: 0.6, share: 0.35, glow: false },
    { speed: 6.5, length: 1.7, width: 2, alpha: 0.9, share: 0.3, glow: true },
  ],
  // Une dérive : plus longs que le vent, plus rapides, pour qu'on la distingue des traînées pâles qui couvrent l'écran.
  lateral: [
    { speed: 4.5, length: 0.9, width: 1, alpha: 0.3, share: 0.35, glow: false },
    { speed: 7.5, length: 1.6, width: 1.4, alpha: 0.5, share: 0.4, glow: false },
    { speed: 12, length: 2.6, width: 1.8, alpha: 0.8, share: 0.25, glow: true },
  ],
};

/** Traînées par mètre carré de zone, et leurs bornes : assez pour que le champ se lise, peu pour que le dessin reste léger. */
export const STREAK_DENSITY: Readonly<Record<StreakKind, number>> = { ascendant: 0.9, lateral: 0.6 };
export const STREAK_MIN = 6;
export const STREAK_MAX = 36;

/** Une traînée : sa piste en travers (de 0 à 1, loin des bords), sa phase de départ le long du parcours (de 0 à 1) et son rang. */
export interface Mote {
  readonly lane: number;
  readonly start: number;
  readonly tier: number;
}

/** Les pistes évitent les bords de la zone, pour ne pas se confondre avec son contour. */
const LANE_MARGIN = 0.08;
/** Suite à faible discrépance (R2) : pistes et phases réparties sans paquets ni alignements. */
const R2_LANE = 0.7548776662466927;
const R2_START = 0.5698402909980532;
const MOTE_JITTER = 0.06;

/** Le nombre de traînées d'une zone de cette taille (mètres) : proportionnel à sa surface, borné. */
export function streakCount(kind: StreakKind, widthMeters: number, heightMeters: number): number {
  return Math.min(STREAK_MAX, Math.max(STREAK_MIN, Math.round(widthMeters * heightMeters * STREAK_DENSITY[kind])));
}

/**
 * Les traînées d'une zone : toujours les mêmes pour le même numéro de zone et les mêmes dimensions. Rien pour les espèces qui
 * n'ont pas de traînées (couloir d'accélération, freinage).
 */
export function buildMotes(zone: Pick<Zone, 'id' | 'kind' | 'x0' | 'y0' | 'x1' | 'y1'>): Mote[] {
  if (zone.kind !== 'ascendant' && zone.kind !== 'lateral') return [];
  const tiers = STREAK_TIERS[zone.kind];
  const count = streakCount(zone.kind, zone.x1 - zone.x0, zone.y1 - zone.y0);
  const motes: Mote[] = [];
  for (let i = 0; i < count; i += 1) {
    const seed = zone.id * 1009 + i * 31;
    const lane = frac(0.5 + (i + 1) * R2_LANE + (noise(seed) - 0.5) * MOTE_JITTER);
    const start = frac(0.25 + (i + 1) * R2_START + (noise(seed + 7) - 0.5) * MOTE_JITTER);
    motes.push({ lane: LANE_MARGIN + (1 - 2 * LANE_MARGIN) * lane, start, tier: tierOf(i, count, tiers) });
  }
  return motes;
}

/** Le rang de la traînée numéro `index` sur `count` : les premières sont du rang 0, puis du rang 1, selon la part de chaque rang. */
function tierOf(index: number, count: number, tiers: readonly StreakTier[]): number {
  let upTo = 0;
  for (let tier = 0; tier < tiers.length - 1; tier += 1) {
    upTo += (tiers[tier]?.share ?? 0) * count;
    if (index < Math.round(upTo)) return tier;
  }
  return tiers.length - 1;
}

/** Ce que le rendu retient d'une zone d'une image à l'autre : son sens, ses dimensions en mètres et ses traînées. Calculé une fois par zone. */
export interface ZoneKit {
  readonly flow: Flow;
  /** Longueur dans le sens de la poussée, largeur en travers, en mètres. */
  readonly lengthMeters: number;
  readonly breadthMeters: number;
  readonly motes: readonly Mote[];
}

export function buildKit(zone: Pick<Zone, 'id' | 'kind' | 'dir' | 'x0' | 'y0' | 'x1' | 'y1'>): ZoneKit {
  const flow = flowOf(zone);
  const width = zone.x1 - zone.x0;
  const height = zone.y1 - zone.y0;
  return { flow, lengthMeters: flow.vertical ? height : width, breadthMeters: flow.vertical ? width : height, motes: buildMotes(zone) };
}

/** Un tronçon de parcours, en fractions de la longueur de la zone (de 0 à 1), de l'arrière vers l'avant. */
export interface Span {
  from: number;
  to: number;
}

/**
 * Le tronçon de zone qu'éclaire la traînée à l'instant `clock` (secondes de temps réel) : elle entre par l'entrée en grandissant, file
 * à la vitesse de son rang, sort par l'extrémité en rétrécissant, puis renaît à l'entrée. Rogné aux limites de la zone : une traînée n'en
 * dépasse jamais. Faux quand elle est tout à fait hors de la zone (le tour de sa renaissance). `lengthMeters` est la longueur de la
 * zone dans le sens de la poussée.
 */
export function streakSpan(mote: Mote, tier: StreakTier, clock: number, lengthMeters: number, out: Span): boolean {
  if (!(lengthMeters > 0)) return false;
  // Le parcours complet est la zone plus la longueur de la traînée : sa tête sort, puis sa queue.
  const cycle = lengthMeters + tier.length;
  const head = frac(mote.start + (clock * tier.speed) / cycle) * cycle;
  const from = Math.max(0, head - tier.length);
  const to = Math.min(lengthMeters, head);
  if (to - from < 1e-6) return false;
  out.from = from / lengthMeters;
  out.to = to / lengthMeters;
  return true;
}

/**
 * Couloir d'accélération : des chevrons serrés, tous tournés dans le sens de la poussée, qui défilent vite le long de l'axe. Écart entre
 * deux chevrons (mètres), vitesse visuelle (mètres par seconde), et part de la longueur où ils se fondent aux deux bouts.
 */
export const CHEVRON_SPACING = 0.55;
export const CHEVRON_SPEED = 7;
export const CHEVRON_FADE = 0.16;

/** Le nombre de chevrons à passer en revue pour couvrir une zone de cette longueur (mètres). */
export function chevronCount(lengthMeters: number): number {
  return Math.max(1, Math.ceil(lengthMeters / CHEVRON_SPACING));
}

/** La distance à l'entrée (mètres) du chevron numéro `index` à l'instant `clock` : le motif entier glisse, d'un écart par `CHEVRON_SPACING / CHEVRON_SPEED` secondes. À ignorer au-delà de la longueur. */
export function chevronAlong(index: number, clock: number): number {
  return frac((clock * CHEVRON_SPEED) / CHEVRON_SPACING) * CHEVRON_SPACING + index * CHEVRON_SPACING;
}

/**
 * Freinage : une trame de fines bandes, qui se resserrent vers le haut (la matière s'épaissit) et dérivent très lentement vers le bas,
 * à l'inverse de ce qui monte : rien n'y pousse. Bandes par mètre de hauteur, bornes, cycles de dérive par seconde, et exposant de
 * la densité (au-dessus de 1, plus serré en haut).
 */
export const BRAKE_LINES_PER_METER = 3;
export const BRAKE_LINES_MIN = 5;
export const BRAKE_LINES_MAX = 24;
export const BRAKE_DRIFT_HZ = 0.1;
export const BRAKE_DENSITY = 1.7;
const BRAKE_FADE = 0.18;

/** Le nombre de bandes d'une zone de freinage de cette hauteur (mètres). */
export function brakeLineCount(heightMeters: number): number {
  return Math.min(BRAKE_LINES_MAX, Math.max(BRAKE_LINES_MIN, Math.round(heightMeters * BRAKE_LINES_PER_METER)));
}

/** Une bande : sa hauteur dans la zone (de 0 en bas à 1 en haut) et son intensité (de 0 à 1). */
export interface BrakeLine {
  along: number;
  light: number;
}

/** La bande `index` sur `count` à l'instant `clock` : elle naît en haut, très pâle, descend et s'éteint en bas. Écrit dans `out`. */
export function brakeLine(index: number, count: number, clock: number, out: BrakeLine): BrakeLine {
  const s = (index + frac(-clock * BRAKE_DRIFT_HZ)) / count;
  out.along = 1 - Math.pow(1 - s, BRAKE_DENSITY);
  out.light = edgeFade(s, BRAKE_FADE) * (0.4 + 0.6 * out.along);
  return out;
}

/**
 * Un chevron posé dans le repère de la zone : ses trois points (aile, pointe, aile) à l'écran, pointe en avant, dans le sens de la
 * poussée. `along` et `across` sont son centre (pixels), `depth` de combien la pointe avance (et les ailes reculent), `half` la demi-
 * largeur en travers. `out` reçoit les trois points.
 */
export function chevronShape(frame: ZoneFrame, along: number, across: number, depth: number, half: number, out: readonly [Point, Point, Point]): void {
  framePoint(frame, along - depth, across - half, out[0]);
  framePoint(frame, along + depth, across, out[1]);
  framePoint(frame, along - depth, across + half, out[2]);
}

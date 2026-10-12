import { doorGauge, doorState, switchGauge } from '../sim/cycles';
import { cablePosition } from '../sim/events';
import { ELASTIC_MAX_STRETCH, SWITCH_HOLD_SECONDS, railPoint } from '../sim/holds';
import { ROTOR_THICKNESS, closerState, type CloserState } from '../sim/moving';
import { RING_CENTRE_RATIO } from '../sim/rules';
import type { Anchor, Obstacle, Rail, Ring, SimState } from '../sim/state';
import type { Tuning } from '../sim/tuning';
import { noise } from './effects';
import { mixColor } from './sling';
import { COLOR } from './style';

/**
 * Habillages des obstacles à comportement (surface de rebond, paroi cassable,
 * porte, barre tournante, verrou d'interrupteur, passage qui se referme), des
 * anneaux de précision, de la roue motorisée, des bandes de l'accordéon et des
 * prises du lot 5 (aimant, rail, lien élastique) : ce qui, dans leur dessin, se
 * calcule de l'état sans PixiJS ni temps réel. Le
 * rendu (`renderer.ts`) pose les formes, ce fichier dit quoi poser et dans quel
 * état.
 *
 * Règle : tout se lit de l'état de la simulation, jamais de l'horloge de
 * l'écran. Une porte se lit de `state.step` (cycle, jauge, clignotement), une
 * paroi cassable de la vitesse du personnage, un anneau de sa traversée en
 * cours : une même image se redessine toujours pareille, ce qui rend les
 * captures reproductibles. Les motifs (fissures) viennent du numéro de
 * l'obstacle, par un bruit déterministe. Fait exception la roue motorisée, dont
 * les rayons tournent à l'écran sur l'horloge des effets : un simple
 * mouvement du décor, jamais un état du jeu, mais la formule de leur angle est
 * ici, pure.
 */

/**
 * Teintes dérivées des couleurs d'espèce : la masse d'un obstacle à comportement reste sombre comme celle d'un obstacle solide, mais
 * prend un soupçon de sa teinte, pour que même sans le contour on sente à quelle famille elle appartient.
 */
export const SKIN = {
  /** Masse d'une surface de rebond. */
  bounceBody: mixColor(COLOR.obstacle, COLOR.bounce, 0.12),
  /** Masse d'une paroi cassable : sombre, et un cran plus chaude quand le personnage va assez vite pour la traverser. */
  smashBody: mixColor(COLOR.obstacle, COLOR.smash, 0.08),
  smashBodyLit: mixColor(COLOR.obstacle, COLOR.smash, 0.22),
  /** Fissures d'une paroi cassable : une braise éteinte, puis la braise rougie à blanc quand la paroi est prête à céder. */
  crackDim: mixColor(COLOR.smash, COLOR.obstacle, 0.25),
  crackHot: mixColor(COLOR.smash, COLOR.white, 0.62),
  /** Masse d'une porte fermée, et le pâle de son contour tireté quand elle est ouverte et de sa jauge quand elle est fermée. */
  doorBody: mixColor(COLOR.obstacle, COLOR.door, 0.3),
  doorPale: mixColor(COLOR.door, COLOR.white, 0.45),
  /** Verrou d'un interrupteur : la masse et le pâle de la porte, mais ambrés. */
  lockBody: mixColor(COLOR.obstacle, COLOR.switch, 0.22),
  lockPale: mixColor(COLOR.switch, COLOR.white, 0.45),
  /** L'aimant tenu (le noyau s'allume), l'interrupteur actif, le cœur d'un rail et le lien élastique tenu : leur teinte éclaircie vers le blanc. */
  magnetHot: mixColor(COLOR.magnet, COLOR.white, 0.55),
  switchHot: mixColor(COLOR.switch, COLOR.white, 0.55),
  railCore: mixColor(COLOR.rail, COLOR.white, 0.5),
  elasticHot: mixColor(COLOR.elastic, COLOR.white, 0.55),
  /** Panneau d'un passage qui se referme : la masse d'un solide, un peu plus chaude, et la teinte de son avertissement. */
  closerBody: mixColor(COLOR.obstacle, COLOR.obstacleEdge, 0.2),
  closerPale: mixColor(COLOR.obstacleEdge, COLOR.white, 0.45),
  /** Anneau traversé en cours : le cœur s'éclaircit vers le blanc. */
  ringHot: mixColor(COLOR.ring, COLOR.white, 0.55),
  /** Masse de la barre d'un tournant : sombre, avec un soupçon du rouge-magenta du danger, pour qu'une barre qui bouge ne se confonde pas avec un mur. */
  rotorBody: mixColor(COLOR.obstacle, COLOR.obstacleEdge, 0.16),
  /** Le cœur des traits d'une bande d'accordéon (son bord intérieur, ses chevrons) : sa teinte éclaircie vers le blanc, comme le cœur presque blanc d'un tube de néon. */
  bandCore: mixColor(COLOR.accordion, COLOR.white, 0.5),
} as const;

/** Le cycle d'une onde de pas : de 0 à 1, `hz` fois par seconde de simulation (jamais de temps réel). */
export function stepWave(step: number, stepSeconds: number, hz: number): number {
  return 0.5 + 0.5 * Math.sin(2 * Math.PI * hz * step * stepSeconds);
}

/** Une porte qui avertit clignote à ce rythme (Hz, sur le temps de la simulation) : assez vif pour se voir, assez lent pour ne pas fatiguer. */
export const DOOR_BLINK_HZ = 3;

/**
 * Où en est une porte, du point de vue du dessin : ouverte (contour tireté pâle, la masse se remplit),
 * qui avertit (contour qui s'allume et clignote, la masse presque pleine), fermée (masse pleine), ou
 * fermée mais laissant passer le personnage qu'elle a surpris à l'intérieur (masse fantôme).
 */
export type DoorPhase = 'ouverte' | 'avertit' | 'fermee' | 'passage';

export interface DoorLook {
  readonly phase: DoorPhase;
  /** Jauge de 0 à 1 de la phase courante (voir `doorGauge`) : la part de la phase déjà écoulée. */
  readonly gauge: number;
  /** Clignotement de 0 à 1, calé sur le pas de simulation ; 1 hors avertissement (le contour est alors franc). */
  readonly beat: number;
}

/** Ce qu'il faut dessiner d'une porte à ce pas ; `inside` : le personnage s'y trouve (voir `SimState.doorsInside`). */
export function doorLook(box: Pick<Obstacle, 'id'>, state: Pick<SimState, 'step' | 'doorsInside'>, tuning: Tuning): DoorLook {
  const gauge = doorGauge(box.id, state.step, tuning);
  const cycle = doorState(box.id, state.step, tuning);
  if (cycle === 'ouverte') return { phase: 'ouverte', gauge, beat: 1 };
  if (cycle === 'se ferme') return { phase: 'avertit', gauge, beat: stepWave(state.step, tuning.stepSeconds, DOOR_BLINK_HZ) };
  return { phase: state.doorsInside.includes(box.id) ? 'passage' : 'fermee', gauge, beat: 1 };
}

/** Où en est un anneau : libre, en cours de traversée (loin du centre, ou déjà passé près du centre) ou traversé. */
export type RingPhase = 'libre' | 'traverse' | 'centre' | 'prise';

/** L'état d'un anneau du point de vue du dessin : `closest` dit que le personnage est dans le disque, et jusqu'où il s'est approché du centre. */
export function ringPhase(ring: Pick<Ring, 'taken' | 'closest' | 'radius'>): RingPhase {
  if (ring.taken) return 'prise';
  if (ring.closest === null) return 'libre';
  return ring.closest <= ring.radius * RING_CENTRE_RATIO ? 'centre' : 'traverse';
}

/**
 * Fissures d'une paroi cassable : des lignes brisées dans le repère de la
 * paroi, `u` le long de sa plus grande dimension et `v` en travers, de 0 à 1 chacun, à plat
 * (u, v, u, v...). En fractions et non en pixels : le motif ne change pas avec le zoom, il
 * se pose sur le rectangle une fois converti.
 */
export type Crack = readonly number[];

/** Une fissure par tranche de cette longueur (mètres) de la paroi, au moins une : une paroi plus longue a plus de fissures, pas de plus grandes. */
export const CRACK_SPACING = 0.9;
/** Les quatre niveaux, en travers, par où passe la fissure principale (de 0 à 1) : elle traverse la paroi de bord à bord. */
const CRACK_LEVELS: readonly number[] = [0, 0.38, 0.64, 1];
/** Écart latéral maximal d'un sommet de la fissure à l'axe de sa tranche, en part de la tranche. */
const CRACK_WANDER = 0.42;
/** Branche latérale qui part du milieu de la fissure : sa portée le long de la paroi (part de la tranche) et sa montée en travers. */
const BRANCH_REACH = 0.34;
const BRANCH_RISE = 0.3;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Le motif de fissures de la paroi numéro `id` et de longueur `longLength`
 * (mètres) : une fissure en éclair par tranche, avec une branche qui en part. Le
 * même motif à chaque appel, d'après le numéro seul.
 */
export function crackPattern(id: number, longLength: number): Crack[] {
  const count = Math.max(1, Math.round(longLength / CRACK_SPACING));
  const cracks: Crack[] = [];
  for (let slice = 0; slice < count; slice += 1) {
    const seed = id * 977 + slice * 61;
    const centre = (slice + 0.5 + (noise(seed) - 0.5) * 0.3) / count;
    const points: number[] = [];
    let middle = { u: centre, v: 0.5 };
    CRACK_LEVELS.forEach((v, index) => {
      const u = clamp01(centre + (noise(seed + 7 + index) - 0.5) * 2 * (CRACK_WANDER / count));
      points.push(u, v);
      if (index === 1) middle = { u, v };
    });
    cracks.push(points);
    // Une branche, d'un côté ou de l'autre, qui part du coude et monte ou descend un peu.
    const side = noise(seed + 31) < 0.5 ? -1 : 1;
    const up = noise(seed + 43) < 0.5 ? -1 : 1;
    cracks.push([middle.u, middle.v, clamp01(middle.u + (side * BRANCH_REACH) / count), clamp01(middle.v + up * BRANCH_RISE)]);
  }
  return cracks;
}

/** Les dents du ressort d'une surface de rebond : une par tranche de cette longueur en pixels, deux au moins. */
const SPRING_PERIOD = 15;

export function springTeeth(lengthPixels: number): number {
  return Math.max(2, Math.round(lengthPixels / SPRING_PERIOD));
}

/**
 * La roue motorisée : un moyeu (le point d'accroche), une jante de ce rayon (en
 * mètres de monde) et des rayons qui tournent à l'écran dans le sens où le
 * moteur entraîne le personnage. Une marque dit la direction même sur une image
 * fixe : un chevron, sur la jante, entre deux rayons, pointé dans le sens du
 * tour. L'angle est celui du repère de l'écran (x vers la droite, y vers le
 * bas : un angle qui croît tourne vers la droite en haut, dans le sens des
 * aiguilles d'une montre), alors que le moteur dit son sens vu de face, y vers
 * le haut (+1 : à gauche en haut, sens trigonométrique).
 */
export const WHEEL_RIM_RADIUS = 0.9;
export const WHEEL_SPOKES = 5;
/** Tours par seconde de l'horloge des effets : assez lent pour se lire, assez vif pour qu'on voie que ça entraîne. */
export const WHEEL_TURNS_PER_SECOND = 0.4;

/** Le sens de rotation à l'écran, dans le repère de l'écran : +1 vers la droite en haut (sens des aiguilles), -1 vers la gauche. Opposé au `spin` du moteur, qui se dit y vers le haut. */
export function wheelDirection(spin: -1 | 1): 1 | -1 {
  return spin === 1 ? -1 : 1;
}

/** L'angle (radians, repère de l'écran) du premier rayon à cet instant de l'horloge des effets. */
export function wheelAngle(clock: number, spin: -1 | 1): number {
  return wheelDirection(spin) * WHEEL_TURNS_PER_SECOND * clock * 2 * Math.PI;
}

/** Un segment dans le repère de l'écran, relatif à un centre. */
export interface WheelSegment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Les rayons de la roue à cet instant, du rayon `inner` à `outer` (pixels), autour du moyeu : `count` rayons également répartis. */
export function wheelSpokes(clock: number, spin: -1 | 1, inner: number, outer: number, count: number = WHEEL_SPOKES): WheelSegment[] {
  const first = wheelAngle(clock, spin);
  return Array.from({ length: count }, (_, k) => {
    const angle = first + (k / count) * 2 * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x0: cos * inner, y0: sin * inner, x1: cos * outer, y1: sin * outer };
  });
}

/** Un chevron : ses trois sommets à plat (bras, pointe, bras), relatifs à un centre. */
export type WheelChevron = readonly [number, number, number, number, number, number];

/**
 * Les chevrons de la jante, un entre chaque paire de rayons, de taille `size` (pixels), posés sur la jante de rayon `rim`, la pointe vers
 * l'avant du tour : celui qui lit la roue sait de quel côté elle entraîne sans la voir bouger.
 */
export function wheelChevrons(clock: number, spin: -1 | 1, rim: number, size: number, count: number = WHEEL_SPOKES): WheelChevron[] {
  const first = wheelAngle(clock, spin);
  const way = wheelDirection(spin);
  return Array.from({ length: count }, (_, k) => {
    const angle = first + ((k + 0.5) / count) * 2 * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Sur la jante, `along` suit le tour et `across` pointe vers l'extérieur.
    const along = { x: -sin * way, y: cos * way };
    const across = { x: cos, y: sin };
    const at = (a: number, b: number): [number, number] => [cos * rim + along.x * a + across.x * b, sin * rim + along.y * a + across.y * b];
    const [ax, ay] = at(-size * 0.6, size * 0.7);
    const [tx, ty] = at(size * 0.6, 0);
    const [bx, by] = at(-size * 0.6, -size * 0.7);
    return [ax, ay, tx, ty, bx, by] as const;
  });
}

/**
 * La barre d'un obstacle tournant, en pixels. Son épaisseur est celle de la collision (`ROTOR_THICKNESS` mètres de monde), au moins `minThickness`
 * pixels quand on dézoome : une barre qui s'effaçerait serait un piège. Le contour de `edge` pixels est centré sur le bord, comme celui d'un mur :
 * le trait extérieur (`outer`) déborde donc d'un demi-contour de chaque côté, et le corps sombre (`body`) qu'on pose par-dessus en retire autant,
 * pour ne laisser que l'anneau du contour. Le disque du pivot (`pivot`, rayon) est plus gros que la barre, pour qu'on voie autour de quoi elle tourne.
 */
export const ROTOR_PIVOT_RADIUS = 0.3;

export function rotorWidths(scale: number, edge: number, minThickness = 2 * edge): { readonly outer: number; readonly body: number; readonly pivot: number } {
  const thickness = Math.max(ROTOR_THICKNESS * scale, minThickness);
  const outer = thickness + edge;
  return { outer, body: Math.max(0, thickness - edge), pivot: Math.max(ROTOR_PIVOT_RADIUS * scale, outer / 2 + 1) };
}

/**
 * Les bandes de l'accordéon (lot 3, version 0.14.0) : deux colonnes de prises, la gauche (`band` -1) et la droite (1), qui se rapprochent et
 * s'écartent en miroir. Ce ne sont pas des câbles : chaque bande se dessine comme un panneau translucide posé derrière ses prises, du bas de la
 * plus basse au haut de la plus haute, et il bouge avec elles (la simulation met à jour leur position à chaque pas). Deux prises du même côté
 * à moins de `BAND_LINK` mètres l'une de l'autre sont de la même bande : le parcours engendre ses prises de bas en haut, une bande est donc une
 * suite d'enjambées de moins de `BAND_LINK` mètres. Le panneau dépasse les prises de `BAND_PAD_Y` mètres en haut et en bas (le disque et le halo des
 * prises y tiennent), de `BAND_PAD_X` mètres de chaque côté de leur zigzag, et fait au moins `BAND_MIN_WIDTH` mètres de large.
 */
export const BAND_LINK = 6;
export const BAND_MIN_WIDTH = 1.2;
export const BAND_PAD_X = 0.2;
export const BAND_PAD_Y = 0.35;
/** Les chevrons du panneau, qui disent le sens où la bande va, sont répartis à peu près tous les `BAND_CHEVRON_SPACING` mètres. */
export const BAND_CHEVRON_SPACING = 0.9;

/** Un panneau de bande, en mètres de monde (y vers le haut), et le sens où la bande glisse à ce pas : -1 vers la gauche, 1 vers la droite, 0 si aucune prise de la bande ne glisse. */
export interface AccordionBand {
  readonly side: -1 | 1;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly heading: -1 | 0 | 1;
}

/** Ce qu'on sait d'une bande tant qu'on y ajoute des prises : l'étendue des prises elles-mêmes, et son sens. */
interface BandReach {
  side: -1 | 1;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  heading: -1 | 0 | 1;
}

/** Le sens où glisse la prise au pas `step` : -1 vers la gauche, 1 vers la droite, 0 si elle ne glisse pas. */
function slideHeading(anchor: Anchor, step: number, tuning: Tuning): -1 | 0 | 1 {
  if (!anchor.cable) return 0;
  const dx = cablePosition(anchor, step + 1, tuning).x - cablePosition(anchor, step, tuning).x;
  return dx > 0 ? 1 : dx < 0 ? -1 : 0;
}

/** Aucune bande : le cas ordinaire, partagé pour ne rien allouer. */
const NO_BANDS: readonly AccordionBand[] = [];

/** Les panneaux des bandes de l'accordéon pour les prises de ce pas, dans l'ordre où leurs premières prises sont rencontrées. Aucun sans prise de bande. */
export function accordionBands(anchors: readonly Anchor[], step: number, tuning: Tuning): readonly AccordionBand[] {
  const reaches: BandReach[] = [];
  for (const anchor of anchors) {
    if (anchor.band === undefined || anchor.broken) continue;
    const { x, y } = anchor.pos;
    const home = reaches.find((reach) => reach.side === anchor.band && y >= reach.yMin - BAND_LINK && y <= reach.yMax + BAND_LINK);
    if (!home) {
      reaches.push({ side: anchor.band, xMin: x, xMax: x, yMin: y, yMax: y, heading: slideHeading(anchor, step, tuning) });
      continue;
    }
    home.xMin = Math.min(home.xMin, x);
    home.xMax = Math.max(home.xMax, x);
    home.yMin = Math.min(home.yMin, y);
    home.yMax = Math.max(home.yMax, y);
    if (home.heading === 0) home.heading = slideHeading(anchor, step, tuning);
  }
  if (reaches.length === 0) return NO_BANDS;
  return reaches.map((reach) => {
    const middle = (reach.xMin + reach.xMax) / 2;
    const half = Math.max(BAND_MIN_WIDTH / 2, (reach.xMax - reach.xMin) / 2 + BAND_PAD_X);
    return { side: reach.side, left: middle - half, right: middle + half, bottom: reach.yMin - BAND_PAD_Y, top: reach.yMax + BAND_PAD_Y, heading: reach.heading };
  });
}

/** Combien de chevrons le panneau porte : un tous les `BAND_CHEVRON_SPACING` mètres, un au moins. Le chevron `k` est au milieu de la `k`-ième tranche. */
export function bandChevronCount(band: AccordionBand): number {
  return Math.max(1, Math.round((band.top - band.bottom) / BAND_CHEVRON_SPACING));
}

/**
 * Les prises du lot 5 (version 0.15.0). Tout se lit de l'état de la simulation ou, pour ce qui n'est qu'un mouvement du décor (les anneaux
 * d'un champ qui convergent), d'une phase que le rendu tire de l'horloge des effets.
 *
 * L'aimant : des anneaux de champ concentriques autour du noyau, jusqu'au rayon d'action. Au repos, `MAGNET_RING_COUNT` anneaux fixes, également
 * répartis ; tenu, ils convergent vers le noyau : chacun naît au bord, glisse vers le centre et s'efface à l'approche (`magnetRing`).
 */
export const MAGNET_RING_COUNT = 3;
/** Les anneaux d'un champ tenu font ce nombre de pas d'un anneau à l'autre par seconde de l'horloge des effets : l'un traverse tout le champ en deux secondes environ. */
export const MAGNET_RINGS_PER_SECOND = 1.5;

/** Un anneau de champ : sa part du rayon d'action (0 au noyau, 1 au bord) et son opacité relative (de 0 à 1). */
export interface MagnetRing {
  readonly ratio: number;
  readonly alpha: number;
}

/**
 * L'anneau `k` (de 0 à `count - 1`) d'un champ d'aimant. Au repos (`held` faux), les anneaux sont fixes, entre le noyau et le bord, tous
 * également visibles. Tenu, `phase` (de 0 à 1, qui avance sans cesse) les fait converger : l'anneau naît au bord, invisible, s'éclaire à
 * mi-chemin et s'efface au noyau, et le suivant arrive derrière lui.
 */
export function magnetRing(k: number, count: number, phase: number, held: boolean): MagnetRing {
  if (!held) return { ratio: (k + 1) / (count + 1), alpha: 1 };
  const along = (k + phase) / count;
  return { ratio: 1 - along, alpha: Math.sin(Math.PI * along) };
}

/** La phase des anneaux d'un champ tenu à cet instant de l'horloge des effets : de 0 (inclus) à 1 (exclu), elle revient à 0 `MAGNET_RINGS_PER_SECOND` fois par seconde. */
export function magnetPhase(clock: number): number {
  const turns = clock * MAGNET_RINGS_PER_SECOND;
  return turns - Math.floor(turns);
}

/**
 * Le verrou d'une prise interrupteur : une porte que l'on dessine comme les autres, mais ambrée. Ouverte tant que la prise est tenue, puis
 * pendant `SWITCH_HOLD_SECONDS` : la jauge (`switchGauge`) se remplit pendant ce délai et la porte avertit pendant ses `SWITCH_WARNING_SECONDS`
 * dernières secondes, comme une porte à cycle. Fermée ensuite, ou laissant passer le personnage qu'elle a surpris dedans.
 */
export const SWITCH_WARNING_SECONDS = 1;

export interface LockLook extends DoorLook {
  /** Vrai tant que le personnage tient la prise qui commande le verrou : il est franchement ouvert, rien ne s'écoule. */
  readonly held: boolean;
}

/** Ce qu'il faut dessiner d'un verrou à ce pas ; `held` : la prise qui le commande est tenue en ce moment. */
export function lockLook(box: Pick<Obstacle, 'id' | 'switchedBy' | 'openUntilStep'>, state: Pick<SimState, 'step' | 'doorsInside' | 'rope'>, tuning: Tuning): LockLook {
  const held = box.switchedBy !== undefined && state.rope?.anchorId === box.switchedBy;
  const open = box.openUntilStep !== undefined && state.step < box.openUntilStep;
  if (!open) return { phase: state.doorsInside.includes(box.id) ? 'passage' : 'fermee', gauge: 0, beat: 1, held: false };
  const gauge = switchGauge(box, state.step, tuning, SWITCH_HOLD_SECONDS);
  const remaining = ((box.openUntilStep ?? 0) - state.step) * tuning.stepSeconds;
  if (held || remaining > SWITCH_WARNING_SECONDS) return { phase: 'ouverte', gauge, beat: 1, held };
  return { phase: 'avertit', gauge, beat: stepWave(state.step, tuning.stepSeconds, DOOR_BLINK_HZ), held: false };
}

/**
 * Le point où le segment qui part du centre (`cx`, `cy`) d'un rectangle de demi-largeur `halfWidth` et de demi-hauteur `halfHeight`, vers (`tx`, `ty`), sort
 * du rectangle : là où le trait qui relie une prise à son verrou touche le verrou, sans le traverser. Le centre lui-même si la cible y est.
 */
export function rectEdgePoint(cx: number, cy: number, halfWidth: number, halfHeight: number, tx: number, ty: number): { readonly x: number; readonly y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  // La part du segment parcourue avant de sortir par un côté vertical, puis par un côté horizontal : la plus courte des deux.
  const alongX = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
  const alongY = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
  const k = Math.min(1, alongX, alongY);
  return { x: cx + dx * k, y: cy + dy * k };
}

/**
 * Le rail de lancement : un arc en dôme tracé sur `RAIL_SEGMENTS` segments (soit `RAIL_SEGMENTS + 1` positions réparties d'un bout à l'autre), et
 * posé sur la prise. Les positions sont celles de la simulation (`railPoint`), en mètres relatifs à la prise (x vers la droite, y vers le haut),
 * à plat (x, y, x, y...) ; l'arc ne dépend que du rail, il se calcule une fois par rail et se garde.
 */
export const RAIL_SEGMENTS = 14;

const RAIL_ARCS = new WeakMap<Rail, readonly number[]>();
const RAIL_ORIGIN = { x: 0, y: 0 };

export function railArc(rail: Rail): readonly number[] {
  let arc = RAIL_ARCS.get(rail);
  if (!arc) {
    const points: number[] = [];
    for (let i = 0; i <= RAIL_SEGMENTS; i += 1) {
      const p = railPoint(RAIL_ORIGIN, rail, i / RAIL_SEGMENTS);
      points.push(p.x, p.y);
    }
    arc = points;
    RAIL_ARCS.set(rail, arc);
  }
  return arc;
}

/** Les deux ailes d'une pointe de flèche de taille `size`, dans le repère de l'écran, relatives à la pointe, pour une flèche qui va dans la direction (`dx`, `dy`) : (x, y, x, y). Rien si la direction est nulle. */
export function arrowWings(dx: number, dy: number, size: number): readonly [number, number, number, number] {
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return [0, 0, 0, 0];
  const ux = dx / length;
  const uy = dy / length;
  // Chaque aile revient en arrière et s'écarte de côté d'une demi-taille.
  const back = size;
  const side = size / 2;
  return [-ux * back - uy * side, -uy * back + ux * side, -ux * back + uy * side, -uy * back - ux * side];
}

/**
 * Le lien élastique tenu. L'étirement (`elasticStretch`, de 0 à `ELASTIC_MAX_STRETCH`) se lit sur le trait : plus il est étiré, plus il est épais,
 * clair et lumineux, jusqu'au blanc à l'étirement maximal, où la butée le retient. Mou (le personnage plus près de la prise que la longueur de
 * repos), c'est un trait fin et lâche, qui ondule d'autant plus qu'il pend. Épaisseurs en pixels.
 */
export const ELASTIC_WIDTH_MIN = 1.5;
export const ELASTIC_WIDTH_MAX = 5.5;
export const ELASTIC_GLOW_MIN = 0.6;
export const ELASTIC_GLOW_MAX = 1.8;
/** Un lien mou ondule d'au plus ce nombre de pixels, à raison de ce nombre de pixels par mètre de mou ; son ondulation a ce nombre de creux et de bosses, et bat à ce rythme (Hz de la simulation). */
export const ELASTIC_WIGGLE_MAX = 9;
export const ELASTIC_WIGGLE_PER_SLACK = 0.5;
export const ELASTIC_WAVES = 3;
export const ELASTIC_WIGGLE_HZ = 2;

export interface ElasticLook {
  /** La part de l'étirement maximal atteinte, de 0 à 1. */
  readonly ratio: number;
  readonly width: number;
  readonly color: number;
  /** Force du halo. */
  readonly glow: number;
  /** Amplitude de l'ondulation, en pixels : 0 dès que le lien est tendu. */
  readonly wiggle: number;
}

/** Ce qu'il faut dessiner d'un lien élastique étiré de `stretch` mètres, ou mou de `slack` mètres (l'un des deux est nul), à `scale` pixels par mètre. */
export function elasticLook(stretch: number, slack: number, scale: number): ElasticLook {
  const ratio = Math.min(1, Math.max(0, stretch / ELASTIC_MAX_STRETCH));
  return {
    ratio,
    width: ELASTIC_WIDTH_MIN + (ELASTIC_WIDTH_MAX - ELASTIC_WIDTH_MIN) * ratio,
    color: mixColor(COLOR.elastic, COLOR.white, ratio),
    glow: ELASTIC_GLOW_MIN + (ELASTIC_GLOW_MAX - ELASTIC_GLOW_MIN) * ratio,
    wiggle: Math.min(ELASTIC_WIGGLE_MAX, Math.max(0, slack) * scale * ELASTIC_WIGGLE_PER_SLACK),
  };
}

/** Le décalage de côté, en pixels, d'un lien mou au point `u` de sa longueur (0 à la prise, 1 au personnage) : nul aux deux bouts, une onde entre. `phase` en radians, qui avance avec le pas de simulation. */
export function strandOffset(u: number, amplitude: number, phase: number): number {
  return amplitude * Math.sin(Math.PI * u) * Math.sin(2 * Math.PI * ELASTIC_WAVES * u + phase);
}

/** La phase de l'ondulation d'un lien mou au pas `step`. */
export function strandPhase(step: number, stepSeconds: number): number {
  return 2 * Math.PI * ELASTIC_WIGGLE_HZ * step * stepSeconds;
}

/**
 * Le passage qui se referme (O6) : ses deux panneaux de sortie se dessinent là où ils sont (`obstacleAt`), comme des panneaux qui glissent, et
 * un liseré d'avertissement dit où en est la séquence. Armé, un liseré discret ; il se ferme, le liseré pulse et une jauge se remplit ; fermé,
 * la masse est pleine ; il rouvre, la jauge se vide.
 */
export const CLOSER_BLINK_HZ = 4;

export interface CloserLook {
  readonly phase: CloserState;
  /** De 0 à 1 : la part de la fermeture faite (elle croît en se fermant) ou, en rouvrant, ce qu'il reste à rouvrir (elle décroît). 0 armé, 1 fermé. */
  readonly gauge: number;
  /** Clignotement de 0 à 1 pendant la fermeture, 1 ailleurs (le liseré est alors franc). */
  readonly beat: number;
}

/** Ce qu'il faut dessiner d'un panneau de passage qui se referme à ce pas. */
export function closerLook(box: Obstacle, step: number, tuning: Tuning): CloserLook {
  const phase = closerState(box, step, tuning);
  const closer = box.closer;
  if (!closer || box.triggeredStep === undefined || phase === 'arme') return { phase: 'arme', gauge: 0, beat: 1 };
  const elapsed = (step - box.triggeredStep) * tuning.stepSeconds;
  if (phase === 'se ferme') return { phase, gauge: Math.min(1, elapsed / closer.closeSeconds), beat: stepWave(step, tuning.stepSeconds, CLOSER_BLINK_HZ) };
  if (phase === 'ferme') return { phase, gauge: 1, beat: 1 };
  return { phase, gauge: Math.max(0, 1 - (elapsed - closer.closeSeconds - closer.shutSeconds) / closer.closeSeconds), beat: 1 };
}

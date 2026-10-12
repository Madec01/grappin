import type { Rng } from '../core/math/rng';
import type { Vec2 } from '../core/math/vec2';
import { STILL, type Environment } from './environment';
import { CABLE_HALF_LENGTH, CABLE_PERIOD_SECONDS, TRAVERSIERE_PERIOD_SECONDS } from './events';
import { circleBoxGap } from './geometry';
import { LANCEUR_CLEARANCE } from './launcher';
import { zoneAt } from './physics';
import { WORLD_HALF_WIDTH } from './rules';
import type { Anchor, Obstacle, ObstacleKind, Pickup, Ring, Zone } from './state';

/**
 * Construction d'un segment de parcours : une chaîne de points d'accroche qui
 * monte d'une vingtaine de mètres, selon un motif et un profil. Le motif
 * donne la forme (chaîne en zigzag, escalier serré, couloir d'étoiles, champ
 * de dalles, rafale de propulseurs, série de fragiles, grand saut) ; le profil
 * dit ce qui est permis (espacement, obstacles, fourche, fragiles,
 * propulseurs). Le générateur propose ; le vérificateur (`verifier.ts`)
 * dispose. Tout l'aléatoire vient du générateur seedé.
 */

/**
 * Motifs. Les trois derniers sont les zones du lot 2 : « courant », un courant
 * ascendant qui porte jusqu'à un point hors de portée de corde ; « derive »,
 * une bande de courant latéral qui traverse la chaîne ; « fusee », un couloir
 * d'accélération puis une zone de freinage avant le point suivant
 * (« accélération, envolée, freinage, rattrapage »).
 */
export type Archetype = 'chaine' | 'escalier' | 'couloir' | 'dalles' | 'rafale' | 'fragiles' | 'saut' | 'lanceur' | 'courant' | 'derive' | 'fusee' | 'brise' | 'sas' | 'cerceau' | 'ricochet' | 'percee' | 'roue' | 'tournant' | 'glissiere';

/**
 * Les cinq derniers motifs EXIGENT une mécanique du lot 2 (retour du
 * propriétaire, 0.12.1 : « il faut que ça rajoute de la difficulté ») :
 * « brise », un lanceur sous un mur cassable sans trou, à percer à pleine
 * puissance ; « sas », un lanceur sous un mur dont le trou est une porte, à
 * passer quand elle est ouverte ; « cerceau », un lanceur sous un mur dont le
 * seul passage est un anneau, étroit et décalé ; « ricochet », un lanceur
 * dont une chicane barre le tir direct, et qu'un mur de rebond renvoie dans
 * le trou (brief, L5) ; « percee », un couloir d'accélération sous un plafond
 * cassable que seule sa vitesse perce. Le vérificateur joue ces mécaniques
 * dans ses vols (`flight.ts`) : le passage n'est prouvé qu'avec elles. Un
 * rebond ne peut pas s'exiger ailleurs qu'au tir : il ne redonne jamais plus
 * de hauteur qu'un vol direct, et la visée attrape à 5,6 m.
 */
export const ARCHETYPES: readonly Archetype[] = ['chaine', 'escalier', 'couloir', 'dalles', 'rafale', 'fragiles', 'saut', 'lanceur', 'courant', 'derive', 'fusee', 'brise', 'sas', 'cerceau', 'ricochet', 'percee'];

export interface Segment {
  readonly anchors: Anchor[];
  readonly obstacles: Obstacle[];
  readonly pickups: Pickup[];
  readonly rings: Ring[];
  readonly zones: Zone[];
  /** Point de fourche, dont les deux branches doivent toutes deux être atteignables. */
  readonly junctionId: number | null;
  readonly branchIds: readonly number[];
}

/** Compteurs d'identifiants, uniques sur toute la partie. */
export interface IdCounters {
  anchor: number;
  obstacle: number;
  pickup: number;
  ring: number;
  zone: number;
}

/** Ce qu'un profil permet : une nouvelle contrainte à la fois. */
export interface TierProfile {
  /** Espacement nominal entre deux points, en mètres. */
  readonly spacing: number;
  readonly obstacles: number;
  readonly split: boolean;
  readonly fragileChance: number;
  readonly boosters: number;
  /** Motifs de segments permis ; le générateur en tire un au sort. */
  readonly archetypes: readonly Archetype[];
  /**
   * Écartement : multiplie le déport de côté des pas et la largeur jouable
   * (1 : ± 4 m, 1,5 : ± 6 m). Décision du propriétaire : les prises
   * s'écartent de plus en plus avec la hauteur.
   */
  readonly spread: number;
  /** Prises électriques (pièges à cycles) et prises à éclipse (raccourcis accrochables deux secondes sur quatre) par segment. */
  readonly electric: number;
  readonly eclipse: number;
  /**
   * Lot 2 du brief, par segment : surfaces de rebond, parois cassables, portes
   * intermittentes (des dalles d'une autre espèce, aux mêmes règles de
   * placement) et anneaux de précision (entre deux points, sur le vol).
   * Absents, aucun.
   */
  readonly bouncers?: number;
  readonly breakables?: number;
  readonly doors?: number;
  readonly rings?: number;
  /** Fin du lot 2 : barres tournantes par segment (une de plus dans le motif « tournant »). */
  readonly rotors?: number;
}

/** Largeur jouable à l'écartement 1 : les points restent entre -limit et +limit, les obstacles s'y appuient. */
export const HALF_WIDTH = 4;
/** Écartement le plus fort : ± 6 m, ce que la caméra sait encore montrer en dézoomant. */
export const MAX_SPREAD = 1.5;
/** Les corniches s'accrochent un mètre au-delà de la largeur jouable. */
const WALL_MARGIN = 1;
/**
 * Un mur au-dessus d'un lanceur va d'un bord du monde à l'autre : le monde
 * s'arrête à ± `WORLD_HALF_WIDTH`, bien au-delà de la largeur des points, et un
 * mur qui s'arrêtait un mètre après celle-ci se contournait par les côtés (le
 * robot le faisait, en 0.12.1 en cours) : son trou, sa porte, son anneau ou sa
 * paroi à percer n'obligeaient à rien.
 */
const WALL_EDGE = WORLD_HALF_WIDTH + 1;
/** Un pas de chaîne ne dépasse jamais cette longueur, quel que soit l'écartement : la corde doit pouvoir suivre. */
const STEP_MAX = 6.8;

/** Largeur jouable d'un profil : ± cette valeur. */
export function playableHalfWidth(spread: number): number {
  return HALF_WIDTH * spread;
}
/** Premier point, par rapport au toit de départ. */
export const FIRST_ANCHOR_OFFSET: Vec2 = { x: 0.8, y: 4 };

const OBSTACLE_THICKNESS = 0.4;
/** Dégagement minimal entre un obstacle et le centre d'un point ou d'une étoile. */
const OBSTACLE_CLEARANCE = 1.4;
const PICKUP_CLEARANCE = 0.8;
/**
 * Sous un point, là où l'on pend et se balance après l'avoir attrapé, rien
 * jusqu'à cette profondeur et cette demi-largeur : un balancement sur trois
 * mètres de corde balaie près de trois mètres de chaque côté.
 */
const HANG_DEPTH = 3.8;
const HANG_HALF_WIDTH = 2.6;
/** Aucun obstacle dans les premiers mètres au-dessus du toit de départ : on prend son élan tranquille. */
const GRACE_ABOVE_ORIGIN = 8;

/**
 * Vrai si la boîte empiète sur la zone de pendaison d'un point : là où tire la
 * gravité, sur `HANG_DEPTH`, large de deux fois `HANG_HALF_WIDTH`. Sous
 * gravité tournée, la zone est de côté.
 */
function underAnchor(anchor: Vec2, box: Obstacle, env: Environment): boolean {
  const g = env.gravityDir;
  if (g.x === 0) {
    const low = g.y < 0 ? anchor.y - HANG_DEPTH : anchor.y;
    const high = g.y < 0 ? anchor.y : anchor.y + HANG_DEPTH;
    return box.y1 > low && box.y0 < high && box.x1 > anchor.x - HANG_HALF_WIDTH && box.x0 < anchor.x + HANG_HALF_WIDTH;
  }
  const left = g.x > 0 ? anchor.x : anchor.x - HANG_DEPTH;
  const right = g.x > 0 ? anchor.x + HANG_DEPTH : anchor.x;
  return box.x1 > left && box.x0 < right && box.y1 > anchor.y - HANG_HALF_WIDTH && box.y0 < anchor.y + HANG_HALF_WIDTH;
}

/** Profil de la course libre selon le palier : les motifs s'ouvrent avec les contraintes. */
export function tierProfile(tier: number): TierProfile {
  // Palier 0, zone d'apprentissage : seuls les motifs les plus doux.
  const archetypes: Archetype[] = ['chaine', 'couloir'];
  if (tier >= 1) archetypes.push('escalier', 'dalles');
  if (tier >= 2) archetypes.push('fragiles');
  if (tier >= 2) archetypes.push('lanceur');
  if (tier >= 3) archetypes.push('rafale', 'saut');
  // Lot 2, les zones : le courant ascendant d'abord (il porte), la dérive ensuite (elle dévie), la fusée en dernier (elle demande de rattraper vite).
  if (tier >= 2) archetypes.push('courant');
  if (tier >= 3) archetypes.push('derive');
  if (tier >= 4) archetypes.push('fusee');
  // Lot 2, les usages exigés : avec les lanceurs (palier 2), le cerceau et le mur à percer ; puis le sas et le ricochet ; la percée avec la fusée.
  if (tier >= 2) archetypes.push('cerceau', 'brise');
  if (tier >= 4) archetypes.push('sas', 'ricochet', 'percee');
  // Fin du lot 2 : la roue et le tournant au palier 3, la glissière avec les lanceurs du palier 5.
  if (tier >= 3) archetypes.push('roue', 'tournant');
  if (tier >= 5) archetypes.push('glissiere');
  return {
    spacing: Math.min(5, 3 + 0.4 * tier),
    obstacles: tier === 0 ? 0 : Math.min(3, 1 + Math.floor(tier / 2)),
    split: tier >= 1,
    fragileChance: tier >= 2 ? 0.3 : 0,
    boosters: tier >= 3 ? 1 : 0,
    archetypes,
    spread: Math.min(MAX_SPREAD, 1 + 0.08 * tier),
    electric: tier >= 4 ? 1 : 0,
    eclipse: tier >= 3 ? (tier >= 6 ? 2 : 1) : 0,
    // Lot 2 : une nouveauté par palier, dans l'ordre où elle se comprend le mieux.
    bouncers: tier >= 1 ? 1 : 0,
    rings: tier >= 2 ? 1 : 0,
    breakables: tier >= 3 ? 1 : 0,
    doors: tier >= 4 ? 1 : 0,
  };
}

function clampX(x: number, halfWidth: number): number {
  return Math.max(-halfWidth, Math.min(halfWidth, x));
}

/**
 * Pas d'une chaîne : montée en multiples de l'espacement, déport en multiples
 * de l'espacement et de l'écartement, côté alterné, borné à la largeur. Un
 * pas trop long pour la corde est ramené à `STEP_MAX` en rognant le déport.
 */
function chainStep(rng: Rng, from: Vec2, spacing: number, dyRange: readonly [number, number], dxRange: readonly [number, number], spread: number, halfWidth: number): Vec2 {
  const dy = spacing * (dyRange[0] + (dyRange[1] - dyRange[0]) * rng.next());
  const side = from.x > 0 ? -1 : 1;
  let dx = side * spacing * spread * (dxRange[0] + (dxRange[1] - dxRange[0]) * rng.next());
  if (dx * dx + dy * dy > STEP_MAX * STEP_MAX) dx = side * Math.sqrt(Math.max(0, STEP_MAX * STEP_MAX - dy * dy));
  let x = from.x + dx;
  if (x > halfWidth || x < -halfWidth) x = from.x - dx;
  return { x: clampX(x, halfWidth), y: from.y + dy };
}

function makeAnchor(ids: IdCounters, pos: Vec2, kind: Anchor['kind'] = 'normal'): Anchor {
  const anchor: Anchor = { id: ids.anchor, pos, kind, broken: false };
  ids.anchor += 1;
  return anchor;
}

function makePickup(ids: IdCounters, pos: Vec2): Pickup {
  const pickup: Pickup = { id: ids.pickup, pos, taken: false };
  ids.pickup += 1;
  return pickup;
}

/** Forme d'un motif : plages de montée et de déport, en multiples de l'espacement. */
const SHAPES: Record<Archetype, { dy: readonly [number, number]; dx: readonly [number, number] }> = {
  chaine: { dy: [0.55, 0.9], dx: [0.4, 1] },
  escalier: { dy: [0.5, 0.7], dx: [0.5, 0.9] },
  couloir: { dy: [0.7, 0.9], dx: [0.25, 0.5] },
  dalles: { dy: [0.55, 0.9], dx: [0.4, 1] },
  rafale: { dy: [0.55, 0.9], dx: [0.4, 1] },
  fragiles: { dy: [0.5, 0.8], dx: [0.4, 0.9] },
  saut: { dy: [0.55, 0.85], dx: [0.4, 0.9] },
  lanceur: { dy: [0.55, 0.9], dx: [0.4, 1] },
  courant: { dy: [0.55, 0.9], dx: [0.4, 1] },
  derive: { dy: [0.55, 0.9], dx: [0.4, 1] },
  fusee: { dy: [0.55, 0.9], dx: [0.4, 1] },
  brise: { dy: [0.55, 0.9], dx: [0.4, 1] },
  sas: { dy: [0.55, 0.9], dx: [0.4, 1] },
  cerceau: { dy: [0.55, 0.9], dx: [0.4, 1] },
  ricochet: { dy: [0.55, 0.9], dx: [0.4, 1] },
  percee: { dy: [0.55, 0.9], dx: [0.4, 1] },
  roue: { dy: [0.55, 0.9], dx: [0.4, 1] },
  tournant: { dy: [0.55, 0.9], dx: [0.4, 1] },
  glissiere: { dy: [0.55, 0.9], dx: [0.4, 1] },
};

/**
 * Fin du lot 2 (0.13.0), en mètres. Roue motorisée (P1) : la chaîne arrive sur
 * une roue, dont le moteur entraîne le personnage le long de sa corde jusqu'à
 * `wheelSpeed` ; la chaîne reprend `WHEEL_RISE` plus haut, du côté où la roue
 * envoie, hors de portée d'un balancement ordinaire : seule la roue y mène. Rien
 * à moins de `WHEEL_CLEARANCE` d'une roue : on y tourne au bout de sa corde.
 * Tournant (O2) : une barre de `ROTOR_LENGTH` qui fait un tour en
 * `ROTOR_TURN_SECONDS`, posée comme une dalle (son carré tient lieu de boîte),
 * que l'on passe au bon moment. Glissière (L3) : le mur d'un lanceur dont le
 * trou va et vient de `SLIDE_AMPLITUDE` de part et d'autre, en `SLIDE_PERIOD`
 * par aller-retour : on tire quand le trou passe.
 */
export const WHEEL_RISE = 10;
const WHEEL_SIDE = 2.2;
export const WHEEL_CLEARANCE = 5.5;
export const ROTOR_LENGTH = 2.6;
export const ROTOR_TURN_SECONDS = 6;
export const SLIDE_AMPLITUDE = 2.4;
export const SLIDE_PERIOD = 5;

/** La roue au point `from`, et où la chaîne reprend. Partagé avec les scènes. */
export function wheel(ids: IdCounters, from: Vec2, spin: -1 | 1, halfWidth: number): { anchor: Anchor; exit: Vec2 } {
  const anchor: Anchor = { ...makeAnchor(ids, from, 'roue'), motor: { spin } };
  return { anchor, exit: { x: clampX(from.x + spin * WHEEL_SIDE, halfWidth), y: from.y + WHEEL_RISE } };
}

/** Une barre tournante autour de `pivot` : son carré englobant tient lieu de boîte. Partagé avec les scènes. */
export function rotorBar(ids: IdCounters, pivot: Vec2, spin: number, phase: number): Obstacle {
  const half = ROTOR_LENGTH / 2;
  const box: Obstacle = { id: ids.obstacle, x0: pivot.x - half, y0: pivot.y - half, x1: pivot.x + half, y1: pivot.y + half, kind: 'tournant', rotor: { pivot, length: ROTOR_LENGTH, spin, phase } };
  ids.obstacle += 1;
  return box;
}

/** Le mur à ouverture mobile au-dessus d'un lanceur : deux panneaux qui glissent ensemble, et où la chaîne reprend. Partagé avec les scènes. */
export function slidingWall(ids: IdCounters, launcher: Vec2, rise: number, halfWidth: number, phase: number): { walls: Obstacle[]; exit: Vec2 } {
  const wallY = launcher.y + rise;
  const gapX = clampX(launcher.x, halfWidth);
  // Les panneaux dépassent le bord du monde de l'amplitude : décalés, ils le couvrent encore.
  const reach = WALL_EDGE + SLIDE_AMPLITUDE;
  const slide = { amplitude: SLIDE_AMPLITUDE, period: SLIDE_PERIOD, phase };
  const walls: Obstacle[] = [
    { id: ids.obstacle, x0: -reach, y0: wallY, x1: gapX - GAP_HALF_WIDTH, y1: wallY + OBSTACLE_THICKNESS, slide },
    { id: ids.obstacle + 1, x0: gapX + GAP_HALF_WIDTH, y0: wallY, x1: reach, y1: wallY + OBSTACLE_THICKNESS, slide },
  ];
  ids.obstacle += 2;
  return { walls, exit: { x: gapX, y: wallY + ABOVE_WALL } };
}

/**
 * Les usages exigés du lot 2, en mètres. Mur à percer (« brise ») : un mur
 * cassable de toute la largeur, à la hauteur du mur d'un lanceur, et la chaîne
 * qui reprend au-dessus comme après un mur à trou : seul un tir à pleine
 * puissance le traverse. Sas : le mur d'une chaîne ordinaire, `SAS_RISE`
 * au-dessus du point, dont le trou (large de deux `GAP_HALF_WIDTH`) est une
 * porte, et la chaîne reprend `SAS_ABOVE` au-dessus. Trampoline : depuis le
 * point courant, un tapis de rebond `TRAMPOLINE_DROP` plus bas et
 * `TRAMPOLINE_SIDE` de côté, et le point suivant `TRAMPOLINE_REACH` de côté
 * et `TRAMPOLINE_RISE` plus haut, hors de portée d'un vol direct : on tombe sur
 * le tapis, on remonte. Cerceau : un anneau au milieu du vol vers un point
 * `HOOP_RISE` plus haut, trop loin sans l'accélération du centre.
 */
/**
 * Cerceau : au-dessus d'un lanceur, un mur dont le seul passage est un anneau,
 * plus étroit que le trou d'un mur ordinaire (`HOOP_GAP_HALF`), décalé comme
 * lui : un tir de précision ; pris au centre, l'anneau rapporte et accélère.
 */
const HOOP_GAP_HALF = 1.3;
const HOOP_EXIT_SIDE = 2.4;
/**
 * Ricochet (brief, L5 : « tir avec rebond ») : au-dessus d'un lanceur, un mur
 * dont le trou est un peu décalé du côté opposé au mur de rebond ; une chicane
 * solide, `RICOCHET_CHICANE_RISE` au-dessus du lanceur, de
 * `RICOCHET_CHICANE_FROM` (côté trou) à `RICOCHET_CHICANE_TO` (côté rebond),
 * barre le tir direct vers le trou ; on tire sous la chicane vers le mur de
 * rebond vertical, à `RICOCHET_PAD_SIDE`, qui renvoie par-dessus la chicane et
 * dans le trou.
 */
const RICOCHET_GAP_OFFSET = 1.6;
const RICOCHET_CHICANE_RISE = 3.2;
const RICOCHET_CHICANE_FROM = 2.6;
const RICOCHET_CHICANE_TO = 1.4;
const RICOCHET_PAD_SIDE = 3.4;
const RICOCHET_PAD_HALF = 0.2;
const RICOCHET_PAD_BOTTOM = 0.6;
const RICOCHET_PAD_TOP = 5.2;
/** Le mur du ricochet est toujours à cette hauteur au-dessus du lanceur : la géométrie du renvoi est réglée (balayage du 11 octobre 2026), elle ne se tire pas au sort. */
export const RICOCHET_WALL_RISE = 5.2;
/** Percée : un plafond cassable de toute la largeur, `PERCEE_ABOVE_BOOST` au-dessus du couloir d'accélération, que seule sa vitesse perce. */
const PERCEE_ABOVE_BOOST = 0.8;

/** Le mur cassable sans trou au-dessus d'un lanceur, et où la chaîne reprend. `rise` : hauteur du mur au-dessus du lanceur. Partagé avec les scènes. */
export function smashWall(ids: IdCounters, launcher: Vec2, rise: number, exitDx: number, halfWidth: number): { wall: Obstacle; exit: Vec2 } {
  const wallY = launcher.y + rise;
  const wall: Obstacle = { id: ids.obstacle, x0: -WALL_EDGE, y0: wallY, x1: WALL_EDGE, y1: wallY + OBSTACLE_THICKNESS, kind: 'cassable' };
  ids.obstacle += 1;
  return { wall, exit: { x: clampX(launcher.x + exitDx, halfWidth), y: wallY + ABOVE_WALL } };
}

/**
 * Le mur à porte au-dessus d'un lanceur (brief : « première combinaison
 * recommandée : lanceur et ouverture » qui s'ouvre et se ferme) : deux pans
 * solides, une porte dans le trou décalé, et où la chaîne reprend. `rise` :
 * hauteur du mur au-dessus du lanceur. Partagé avec les scènes.
 */
export function doorWall(ids: IdCounters, launcher: Vec2, rise: number, gapX: number, halfWidth: number): { walls: Obstacle[]; exit: Vec2 } {
  const wallX = WALL_EDGE;
  const wallY = launcher.y + rise;
  const x = clampX(gapX, halfWidth - GAP_HALF_WIDTH);
  const walls: Obstacle[] = [
    { id: ids.obstacle, x0: -wallX, y0: wallY, x1: x - GAP_HALF_WIDTH, y1: wallY + OBSTACLE_THICKNESS },
    { id: ids.obstacle + 1, x0: x - GAP_HALF_WIDTH, y0: wallY, x1: x + GAP_HALF_WIDTH, y1: wallY + OBSTACLE_THICKNESS, kind: 'porte' },
    { id: ids.obstacle + 2, x0: x + GAP_HALF_WIDTH, y0: wallY, x1: wallX, y1: wallY + OBSTACLE_THICKNESS },
  ];
  ids.obstacle += 3;
  return { walls, exit: { x, y: wallY + ABOVE_WALL } };
}

/** L'anneau au milieu du vol depuis `from` vers un point trop loin pour un vol ordinaire, et ce point. Partagé avec les scènes. */
export function hoop(ids: IdCounters, launcher: Vec2, rise: number, gapX: number, halfWidth: number): { walls: Obstacle[]; ring: Ring; exit: Vec2 } {
  const wallX = WALL_EDGE;
  const wallY = launcher.y + rise;
  const x = clampX(gapX, halfWidth - HOOP_GAP_HALF);
  const walls: Obstacle[] = [
    { id: ids.obstacle, x0: -wallX, y0: wallY, x1: x - HOOP_GAP_HALF, y1: wallY + OBSTACLE_THICKNESS },
    { id: ids.obstacle + 1, x0: x + HOOP_GAP_HALF, y0: wallY, x1: wallX, y1: wallY + OBSTACLE_THICKNESS },
  ];
  ids.obstacle += 2;
  const ring: Ring = { id: ids.ring, pos: { x, y: wallY + OBSTACLE_THICKNESS / 2 }, radius: RING_RADIUS, closest: null, taken: false };
  ids.ring += 1;
  // La sortie est de côté, au-dessus d'un pan : on ne la voit pas à travers l'anneau depuis le bas, on ne l'attrape qu'une fois passé.
  const side = x > launcher.x ? 1 : -1;
  return { walls, ring, exit: { x: clampX(x + side * HOOP_EXIT_SIDE, halfWidth), y: wallY + ABOVE_WALL } };
}

/** Le ricochet au-dessus d'un lanceur : mur à trou décalé du côté `side`, chicane qui barre le tir direct, mur de rebond de l'autre côté. Partagé avec les scènes. */
export function ricochet(ids: IdCounters, launcher: Vec2, rise: number, side: -1 | 1, halfWidth: number): { boxes: Obstacle[]; exit: Vec2 } {
  const wallX = WALL_EDGE;
  const wallY = launcher.y + rise;
  // `side` est le côté du mur de rebond ; le trou est de l'autre côté, un peu décalé.
  const gapX = clampX(launcher.x - side * RICOCHET_GAP_OFFSET, halfWidth);
  const span = (a: number, b: number): [number, number] => (side > 0 ? [launcher.x + a, launcher.x + b] : [launcher.x - b, launcher.x - a]);
  const [cx0, cx1] = span(-RICOCHET_CHICANE_FROM, RICOCHET_CHICANE_TO);
  const [px0, px1] = span(RICOCHET_PAD_SIDE - RICOCHET_PAD_HALF, RICOCHET_PAD_SIDE + RICOCHET_PAD_HALF);
  const chicaneY = launcher.y + RICOCHET_CHICANE_RISE;
  const boxes: Obstacle[] = [
    { id: ids.obstacle, x0: -wallX, y0: wallY, x1: gapX - GAP_HALF_WIDTH, y1: wallY + OBSTACLE_THICKNESS },
    { id: ids.obstacle + 1, x0: gapX + GAP_HALF_WIDTH, y0: wallY, x1: wallX, y1: wallY + OBSTACLE_THICKNESS },
    { id: ids.obstacle + 2, x0: Math.min(cx0, cx1), y0: chicaneY, x1: Math.max(cx0, cx1), y1: chicaneY + OBSTACLE_THICKNESS },
    { id: ids.obstacle + 3, x0: Math.min(px0, px1), y0: launcher.y + RICOCHET_PAD_BOTTOM, x1: Math.max(px0, px1), y1: launcher.y + RICOCHET_PAD_TOP, kind: 'rebond' },
  ];
  ids.obstacle += 4;
  return { boxes, exit: { x: gapX, y: wallY + ABOVE_WALL } };
}

/**
 * Les zones du lot 2, en mètres. Courant ascendant : une colonne de
 * `UPDRAFT_HALF_WIDTH` de demi-largeur qui pousse à `UPDRAFT_STRENGTH` (plus que
 * la gravité : on y monte, doucement), d'un mètre au-dessus du point d'entrée
 * jusqu'à un mètre sous le point de sortie, lui-même `UPDRAFT_RISE` plus haut, hors de
 * portée de corde : seul le courant y mène. Dérive : une bande de toute la
 * largeur, haute de `DRIFT_HEIGHT`, qui pousse de côté à `DRIFT_STRENGTH`.
 * Fusée : un couloir de `BOOST_HEIGHT` qui accélère vers le haut à
 * `BOOST_STRENGTH` jusqu'à `BOOST_CAP`, puis après un mètre une zone de
 * freinage de `BRAKE_HEIGHT` à `BRAKE_STRENGTH` par seconde, et le point de
 * sortie `BOOST_RISE` au-dessus de l'entrée.
 */
export const UPDRAFT_HALF_WIDTH = 1.6;
export const UPDRAFT_STRENGTH = 10;
export const UPDRAFT_RISE = 10;
export const DRIFT_HEIGHT = 3.5;
export const DRIFT_STRENGTH = 5;
export const BOOST_HALF_WIDTH = 1.6;
export const BOOST_HEIGHT = 5;
export const BOOST_STRENGTH = 22;
export const BOOST_CAP = 14;
export const BRAKE_HEIGHT = 3;
export const BRAKE_STRENGTH = 2.5;
export const BOOST_RISE = 12;
/** Les zones commencent un mètre au-dessus du point qui les précède : on s'y balance sans elles, on y entre en lâchant. Un courant s'arrête un mètre sous sa sortie. */
const ZONE_ABOVE_ENTRY = 1;
const ZONE_BELOW_EXIT = 1;
/** Le point de sortie d'un courant ou d'une fusée est décalé de côté de cette distance : on le rattrape en sortant du courant. */
const ZONE_EXIT_OFFSET = 1.2;
/** Aucun obstacle, aucune prise ajoutée, aucun anneau à moins de cette distance d'une zone. */
const ZONE_CLEARANCE = 0.5;

function makeZone(ids: IdCounters, kind: Zone['kind'], x0: number, y0: number, x1: number, y1: number, strength: number, dir: Vec2, cap?: number): Zone {
  const zone: Zone = cap === undefined ? { id: ids.zone, x0, y0, x1, y1, kind, strength, dir } : { id: ids.zone, x0, y0, x1, y1, kind, strength, dir, cap };
  ids.zone += 1;
  return zone;
}

/** La colonne d'un courant ascendant au-dessus du point `from`, et où la chaîne reprend. Partagé avec les scènes. */
export function updraft(ids: IdCounters, from: Vec2, halfWidth: number): { zone: Zone; exit: Vec2 } {
  const x = clampX(from.x, halfWidth - UPDRAFT_HALF_WIDTH);
  const side = from.x > 0 ? -1 : 1;
  const exit = { x: clampX(x + side * ZONE_EXIT_OFFSET, halfWidth), y: from.y + UPDRAFT_RISE };
  return { zone: makeZone(ids, 'ascendant', x - UPDRAFT_HALF_WIDTH, from.y + ZONE_ABOVE_ENTRY, x + UPDRAFT_HALF_WIDTH, exit.y - ZONE_BELOW_EXIT, UPDRAFT_STRENGTH, { x: 0, y: 1 }), exit };
}

/** Une bande de dérive de toute la largeur, qui commence un mètre au-dessus de `y` et pousse vers `side`. Partagé avec les scènes. */
export function drift(ids: IdCounters, y: number, side: -1 | 1, halfWidth: number): Zone {
  const wallX = halfWidth + WALL_MARGIN;
  return makeZone(ids, 'lateral', -wallX, y + ZONE_ABOVE_ENTRY, wallX, y + ZONE_ABOVE_ENTRY + DRIFT_HEIGHT, DRIFT_STRENGTH, { x: side, y: 0 });
}

/** Le couloir d'accélération et la zone de freinage au-dessus du point `from`, et où la chaîne reprend. Partagé avec les scènes. */
export function rocket(ids: IdCounters, from: Vec2, halfWidth: number): { boost: Zone; brake: Zone; exit: Vec2 } {
  const x = clampX(from.x, halfWidth - BOOST_HALF_WIDTH);
  const side = from.x > 0 ? -1 : 1;
  const boostY0 = from.y + ZONE_ABOVE_ENTRY;
  const brakeY0 = boostY0 + BOOST_HEIGHT + 1;
  const exit = { x: clampX(x + side * ZONE_EXIT_OFFSET, halfWidth), y: from.y + BOOST_RISE };
  return {
    boost: makeZone(ids, 'acceleration', x - BOOST_HALF_WIDTH, boostY0, x + BOOST_HALF_WIDTH, boostY0 + BOOST_HEIGHT, BOOST_STRENGTH, { x: 0, y: 1 }, BOOST_CAP),
    brake: makeZone(ids, 'freinage', x - 2 * BOOST_HALF_WIDTH, brakeY0, x + 2 * BOOST_HALF_WIDTH, brakeY0 + BRAKE_HEIGHT, BRAKE_STRENGTH, { x: 0, y: 0 }),
    exit,
  };
}

/** Vrai si la boîte s'approche d'une zone à moins de `ZONE_CLEARANCE`. */
function nearZone(box: Obstacle, zones: readonly Zone[]): boolean {
  return zones.some((z) => box.x1 > z.x0 - ZONE_CLEARANCE && box.x0 < z.x1 + ZONE_CLEARANCE && box.y1 > z.y0 - ZONE_CLEARANCE && box.y0 < z.y1 + ZONE_CLEARANCE);
}

/**
 * Le mur à trou d'un lanceur : hauteur au-dessus du lanceur, demi-largeur du
 * trou, et hauteur du point suivant au-dessus du mur (hors zone de pendaison).
 *
 * Le trou est toujours DÉCALÉ du lanceur (retour du propriétaire : « le
 * lanceur est trop facile, viser n'apporte pas assez ») : un tir vertical bute
 * sur le mur, il faut choisir un angle. Dès que les fourches sont permises, une
 * fois sur deux le mur a DEUX trous : un large, sûr, d'un côté, et un étroit de
 * l'autre, surmonté d'une étoile ; les deux routes se rejoignent plus haut, et
 * le vérificateur exige qu'un lancer attrape chacune.
 */
const WALL_RISE_MIN = 4.5;
const WALL_RISE_RANGE = 1.5;
const GAP_HALF_WIDTH = 1.2;
const SAFE_GAP_HALF_WIDTH = 1.4;
const TIGHT_GAP_HALF_WIDTH = 0.9;
const ABOVE_WALL = 4.2;
/** Décalage du centre du trou par rapport au lanceur, en mètres : au moins le demi-trou large plus le personnage et une marge. */
const GAP_OFFSET_MIN = 1.9;
const GAP_OFFSET_MAX = 2.7;
/** Hauteur de l'étoile de la route étroite au-dessus du mur, et du point où les deux routes se rejoignent au-dessus des sorties. */
const TIGHT_STAR_ABOVE_WALL = 1.3;
const MERGE_ABOVE_EXITS = 3.2;

/**
 * Construit un segment depuis le dernier point connu (`from`), ou depuis le
 * toit de départ `origin` si `from` est null. Le segment monte jusqu'à environ
 * `16 à 24 m` au-dessus de son départ, selon le motif demandé.
 */
export interface SegmentContext {
  /** Conditions physiques pleines de l'événement en cours à cette hauteur. */
  readonly env: Environment;
  /** Conditions dans lesquelles on arrive au point d'entrée, parfois autres : rien non plus là où l'on y pend. */
  readonly entryEnv: Environment;
  /** Des points qui glissent : sur un câble court (deux points du milieu) ou en traversière sur toute la largeur (trois points). */
  readonly cable: 'none' | 'cable' | 'traversiere';
  /**
   * Aucun point au-dessus de cette hauteur : un événement commence ou finit un
   * mètre plus haut. Le segment s'arrête alors entre un et trois mètres sous
   * elle, pour que le suivant soit engendré et prouvé dans les nouvelles
   * conditions. `Infinity` sans frontière.
   */
  readonly maxY: number;
}

export const PLAIN_CONTEXT: SegmentContext = { env: STILL, entryEnv: STILL, cable: 'none', maxY: Infinity };

/** Longueur visée d'un segment : de 16 à 24 m, ou jusqu'à la frontière proche d'un événement, à 28 m au plus. */
function targetHeight(rng: Rng, startY: number, maxY: number): number {
  const natural = startY + 16 + 8 * rng.next();
  return maxY - 2 <= natural + 4 ? maxY - 2 : natural;
}

export function buildSegment(rng: Rng, ids: IdCounters, from: Vec2 | null, origin: Vec2, profile: TierProfile, archetype: Archetype, context: SegmentContext = PLAIN_CONTEXT): Segment {
  const anchors: Anchor[] = [];
  const pickups: Pickup[] = [];
  let junctionId: number | null = null;
  let branchIds: number[] = [];
  const shape = SHAPES[archetype];
  const spacing = archetype === 'escalier' ? Math.max(2.6, profile.spacing * 0.85) : profile.spacing;
  const halfWidth = playableHalfWidth(profile.spread);
  const startY = from?.y ?? origin.y;
  const targetY = targetHeight(rng, startY, context.maxY);
  let cur: Vec2 = from ?? { x: origin.x + FIRST_ANCHOR_OFFSET.x, y: origin.y + FIRST_ANCHOR_OFFSET.y };
  if (!from) anchors.push(makeAnchor(ids, cur));
  const wantsSplit = archetype === 'chaine' && profile.split && rng.next() < 0.8;
  let splitDone = false;
  let jumpDone = false;
  let launcherDone = false;
  let zoneDone = false;
  let featureDone = false;
  /** Obstacles posés par le motif lui-même, que les obstacles tirés au sort respectent. */
  const fixed: Obstacle[] = [];
  const zones: Zone[] = [];
  /** Anneaux posés par le motif lui-même (cerceau). */
  const fixedRings: Ring[] = [];

  while (cur.y < targetY) {
    if (wantsSplit && !splitDone && cur.y - startY > 3 && targetY - cur.y > 9) {
      // Fourche : la route basse est proche et sûre, la haute plus loin et étoilée, puis les deux se rejoignent.
      const u = Math.min(profile.spacing, 3.6);
      const side = cur.x > 0 ? -1 : 1;
      const junction = anchors.at(-1) ?? makeAnchor(ids, cur);
      if (anchors.length === 0) anchors.push(junction);
      const low = makeAnchor(ids, { x: clampX(cur.x + side * 0.75 * u, halfWidth), y: cur.y + 0.5 * u });
      const high = makeAnchor(ids, { x: clampX(cur.x + side * 0.5 * u, halfWidth), y: cur.y + 1.1 * u });
      const merge = makeAnchor(ids, { x: clampX(cur.x - side * 0.1 * u, halfWidth), y: cur.y + 1.6 * u });
      anchors.push(low, high, merge);
      pickups.push(makePickup(ids, { x: (high.pos.x + merge.pos.x) / 2, y: (high.pos.y + merge.pos.y) / 2 + 0.3 }));
      junctionId = junction.id;
      branchIds = [low.id, high.id];
      splitDone = true;
      cur = merge.pos;
      continue;
    }
    if (archetype === 'lanceur' && !launcherDone && anchors.length > 0 && cur.y - startY > 3 && targetY - cur.y > 11) {
      // Lanceur : le dernier point devient un lanceur, un mur à trou décalé le surplombe, et la chaîne reprend au-dessus du mur.
      const launcher = makeAnchor(ids, cur, 'lanceur');
      anchors[anchors.length - 1] = launcher;
      const wallY = cur.y + WALL_RISE_MIN + WALL_RISE_RANGE * rng.next();
      const wallX = WALL_EDGE;
      const wall = (x0: number, x1: number): void => {
        fixed.push({ id: ids.obstacle, x0, y0: wallY, x1, y1: wallY + OBSTACLE_THICKNESS });
        ids.obstacle += 1;
      };
      // Le trou part du côté où il y a le plus de place, toujours décalé : un tir vertical bute sur le mur.
      const side = cur.x > 0 ? -1 : 1;
      const offset = GAP_OFFSET_MIN + (GAP_OFFSET_MAX - GAP_OFFSET_MIN) * rng.next();
      const gapX = clampX(cur.x + side * offset, halfWidth);
      // Deux routes quand les fourches sont permises et qu'il reste de la place de l'autre côté pour un second trou décalé.
      const roomBehind = halfWidth - Math.abs(cur.x) >= GAP_OFFSET_MIN + TIGHT_GAP_HALF_WIDTH;
      const twoRoutes = profile.split && junctionId === null && roomBehind && rng.next() < 0.5;
      if (twoRoutes) {
        const tightX = clampX(cur.x - side * (GAP_OFFSET_MIN + (GAP_OFFSET_MAX - GAP_OFFSET_MIN) * rng.next()), halfWidth);
        const [left, right] = gapX < tightX ? [{ x: gapX, half: SAFE_GAP_HALF_WIDTH }, { x: tightX, half: TIGHT_GAP_HALF_WIDTH }] : [{ x: tightX, half: TIGHT_GAP_HALF_WIDTH }, { x: gapX, half: SAFE_GAP_HALF_WIDTH }];
        wall(-wallX, left.x - left.half);
        wall(left.x + left.half, right.x - right.half);
        wall(right.x + right.half, wallX);
        const safe = makeAnchor(ids, { x: gapX, y: wallY + ABOVE_WALL });
        const tech = makeAnchor(ids, { x: tightX, y: wallY + ABOVE_WALL });
        pickups.push(makePickup(ids, { x: tightX, y: wallY + OBSTACLE_THICKNESS + TIGHT_STAR_ABOVE_WALL }));
        cur = { x: clampX((gapX + tightX) / 2, halfWidth), y: wallY + ABOVE_WALL + MERGE_ABOVE_EXITS };
        const merge = makeAnchor(ids, cur);
        anchors.push(safe, tech, merge);
        junctionId = launcher.id;
        branchIds = [safe.id, tech.id];
      } else {
        wall(-wallX, gapX - GAP_HALF_WIDTH);
        wall(gapX + GAP_HALF_WIDTH, wallX);
        cur = { x: clampX(gapX + (rng.next() - 0.5) * 1.0, halfWidth), y: wallY + ABOVE_WALL };
        anchors.push(makeAnchor(ids, cur));
      }
      launcherDone = true;
      continue;
    }
    // La roue n'est posée qu'à six mètres au-dessus du départ du segment : au bout de sa corde, le personnage tourne jusqu'à cinq mètres sous elle, au-dessus des obstacles du segment d'avant.
    if (archetype === 'roue' && !featureDone && anchors.length > 0 && cur.y - startY > 6 && targetY - cur.y > WHEEL_RISE + 3) {
      // Roue : le dernier point devient une roue motorisée, et la chaîne reprend bien plus haut, du côté où elle envoie. Elle tourne dans
      // le sens où l'on arrive (venant de la gauche, on passe sous elle vers la droite : sens trigonométrique) : elle entraîne au lieu de freiner.
      const previous = anchors.length >= 2 ? anchors[anchors.length - 2]!.pos : (from ?? cur);
      const spin: -1 | 1 = previous.x <= cur.x ? 1 : -1;
      const { anchor: hub, exit } = wheel(ids, cur, spin, halfWidth);
      anchors[anchors.length - 1] = hub;
      cur = exit;
      anchors.push(makeAnchor(ids, cur));
      featureDone = true;
      continue;
    }
    if (archetype === 'glissiere' && !featureDone && anchors.length > 0 && cur.y - startY > 3 && targetY - cur.y > 11) {
      // Glissière : le dernier point devient un lanceur, sous un mur dont le trou va et vient ; on tire quand il passe.
      anchors[anchors.length - 1] = makeAnchor(ids, cur, 'lanceur');
      const { walls, exit } = slidingWall(ids, cur, WALL_RISE_MIN + WALL_RISE_RANGE * rng.next(), halfWidth, rng.next());
      fixed.push(...walls);
      cur = exit;
      anchors.push(makeAnchor(ids, cur));
      featureDone = true;
      continue;
    }
    if (archetype === 'brise' && !featureDone && anchors.length > 0 && cur.y - startY > 3 && targetY - cur.y > 11) {
      // Mur à percer : le dernier point devient un lanceur, un mur cassable sans trou le surplombe, la chaîne reprend au-dessus.
      anchors[anchors.length - 1] = makeAnchor(ids, cur, 'lanceur');
      const { wall, exit } = smashWall(ids, cur, WALL_RISE_MIN + WALL_RISE_RANGE * rng.next(), (rng.next() - 0.5) * 2, halfWidth);
      fixed.push(wall);
      cur = exit;
      anchors.push(makeAnchor(ids, cur));
      featureDone = true;
      continue;
    }
    if (archetype === 'sas' && !featureDone && anchors.length > 0 && cur.y - startY > 3 && targetY - cur.y > 11) {
      // Sas : le dernier point devient un lanceur, et le trou décalé du mur est une porte ; on tire quand elle est ouverte.
      anchors[anchors.length - 1] = makeAnchor(ids, cur, 'lanceur');
      const side = cur.x > 0 ? -1 : 1;
      const { walls, exit } = doorWall(ids, cur, WALL_RISE_MIN + WALL_RISE_RANGE * rng.next(), cur.x + side * (GAP_OFFSET_MIN + (GAP_OFFSET_MAX - GAP_OFFSET_MIN) * rng.next()), halfWidth);
      fixed.push(...walls);
      cur = exit;
      anchors.push(makeAnchor(ids, cur));
      featureDone = true;
      continue;
    }
    if (archetype === 'cerceau' && !featureDone && anchors.length > 0 && cur.y - startY > 3 && targetY - cur.y > 11) {
      // Cerceau : le dernier point devient un lanceur, et le seul passage du mur est un anneau, étroit et décalé : un tir de précision.
      anchors[anchors.length - 1] = makeAnchor(ids, cur, 'lanceur');
      const side = cur.x > 0 ? -1 : 1;
      const { walls, ring, exit } = hoop(ids, cur, WALL_RISE_MIN + WALL_RISE_RANGE * rng.next(), cur.x + side * (GAP_OFFSET_MIN + (GAP_OFFSET_MAX - GAP_OFFSET_MIN) * rng.next()), halfWidth);
      fixed.push(...walls);
      fixedRings.push(ring);
      cur = exit;
      anchors.push(makeAnchor(ids, cur));
      featureDone = true;
      continue;
    }
    if (archetype === 'ricochet' && !featureDone && anchors.length > 0 && cur.y - startY > 3 && targetY - cur.y > 11 && halfWidth + WALL_MARGIN - Math.abs(cur.x) >= RICOCHET_PAD_SIDE + RICOCHET_PAD_HALF) {
      // Ricochet : le dernier point devient un lanceur ; une chicane barre le tir direct vers le trou, un mur de rebond y renvoie.
      anchors[anchors.length - 1] = makeAnchor(ids, cur, 'lanceur');
      const side: -1 | 1 = cur.x > 0 ? -1 : 1;
      const { boxes, exit } = ricochet(ids, cur, RICOCHET_WALL_RISE, side, halfWidth);
      fixed.push(...boxes);
      cur = exit;
      anchors.push(makeAnchor(ids, cur));
      featureDone = true;
      continue;
    }
    if (archetype === 'courant' && !zoneDone && anchors.length > 0 && cur.y - startY > 3 && targetY - cur.y > UPDRAFT_RISE + 2) {
      // Courant ascendant : depuis le dernier point, une colonne porte jusqu'au point suivant, hors de portée de corde.
      const { zone, exit } = updraft(ids, cur, halfWidth);
      zones.push(zone);
      cur = exit;
      anchors.push(makeAnchor(ids, cur));
      zoneDone = true;
      continue;
    }
    if (archetype === 'derive' && !zoneDone && anchors.length > 0 && cur.y - startY > 3 && targetY - cur.y > DRIFT_HEIGHT + 6) {
      // Dérive : une bande de courant latéral traverse la chaîne, qui continue normalement ; le vérificateur prouve la traversée avec le courant.
      zones.push(drift(ids, cur.y, cur.x > 0 ? -1 : 1, halfWidth));
      zoneDone = true;
    }
    if ((archetype === 'fusee' || archetype === 'percee') && !zoneDone && anchors.length > 0 && cur.y - startY > 3 && targetY - cur.y > BOOST_RISE + 2) {
      // Fusée : un couloir d'accélération, un freinage, et le point de sortie loin au-dessus. Percée : en plus, un plafond cassable
      // de toute la largeur juste au-dessus du couloir, que seule la vitesse du couloir perce.
      const { boost, brake, exit } = rocket(ids, cur, halfWidth);
      zones.push(boost, brake);
      if (archetype === 'percee') {
        const y0 = boost.y1 + PERCEE_ABOVE_BOOST;
        fixed.push({ id: ids.obstacle, x0: -WALL_EDGE, y0, x1: WALL_EDGE, y1: y0 + OBSTACLE_THICKNESS, kind: 'cassable' });
        ids.obstacle += 1;
      }
      cur = exit;
      anchors.push(makeAnchor(ids, cur));
      zoneDone = true;
      continue;
    }
    if (archetype === 'saut' && !jumpDone && profile.boosters > 0 && cur.y - startY > 6 && targetY - cur.y > 8) {
      // Grand saut : un propulseur, puis un trou d'un espacement et demi que seul le lâcher propulsé franchit bien.
      const launcher = makeAnchor(ids, cur, 'booster');
      anchors[anchors.length - 1] = launcher;
      const side = cur.x > 0 ? -1 : 1;
      cur = { x: clampX(cur.x + side * 0.6 * spacing, halfWidth), y: cur.y + 1.45 * spacing };
      anchors.push(makeAnchor(ids, cur));
      jumpDone = true;
      continue;
    }
    const prev = cur;
    cur = chainStep(rng, cur, spacing, shape.dy, shape.dx, profile.spread, halfWidth);
    // Jamais au-dessus de la frontière : le dernier pas se raccourcit pour finir deux mètres sous elle.
    if (cur.y > context.maxY) cur = { x: cur.x, y: context.maxY - 1 };
    anchors.push(makeAnchor(ids, cur));
    // Couloir d'étoiles : une étoile entre deux points sur deux, légèrement décalée.
    if (archetype === 'couloir' && anchors.length % 2 === 0) {
      pickups.push(makePickup(ids, { x: clampX((prev.x + cur.x) / 2 + (rng.next() - 0.5) * 1.2, halfWidth), y: (prev.y + cur.y) / 2 }));
    }
  }

  // Hors zone d'apprentissage, chaque segment porte au moins une étoile, à côté d'un point du milieu :
  // la deuxième étoile d'un niveau doit se mériter.
  const teaching = !profile.split && profile.obstacles === 0;
  if (pickups.length === 0 && !teaching && anchors.length >= 3) {
    const beside = anchors[Math.floor(anchors.length / 2)]!;
    const side = beside.pos.x > 0 ? -1 : 1;
    pickups.push(makePickup(ids, { x: clampX(beside.pos.x + side * 1.3, halfWidth), y: beside.pos.y + 0.8 }));
  }
  assignKinds(rng, anchors, profile, archetype, junctionId, branchIds);
  if (context.cable !== 'none') hangCables(anchors, junctionId, branchIds, halfWidth, context.cable);
  addSpecialAnchors(rng, ids, anchors, profile, halfWidth, zones);
  const rings = [...fixedRings, ...placeRings(rng, ids, anchors, pickups, zones, profile.rings ?? 0, new Set([...branchIds, junctionId ?? -1]), halfWidth, fixedRings)];
  const obstacleCount = archetype === 'dalles' ? Math.min(4, profile.obstacles + 2) : profile.obstacles;
  // Les espèces du lot 2 se posent d'abord : elles sont le propos du segment, les obstacles ordinaires prennent la place qui reste.
  const kinds: ObstacleKind[] = [
    ...Array<ObstacleKind>((profile.rotors ?? 0) + (archetype === 'tournant' ? 1 : 0)).fill('tournant'),
    ...Array<ObstacleKind>(profile.doors ?? 0).fill('porte'),
    ...Array<ObstacleKind>(profile.breakables ?? 0).fill('cassable'),
    ...Array<ObstacleKind>(profile.bouncers ?? 0).fill('rebond'),
    ...Array<ObstacleKind>(obstacleCount).fill('solide'),
  ];
  const obstacles = placeObstacles(rng, ids, anchors, pickups, rings, zones, Math.max(startY, origin.y + GRACE_ABOVE_ORIGIN - 2), cur.y, kinds, from, archetype === 'dalles', context, halfWidth, fixed);
  return { anchors, obstacles, pickups, rings, zones, junctionId, branchIds };
}

/** Anneau de précision : rayon, hauteur au-dessus du milieu du vol, et distances gardées aux points, aux étoiles et aux autres anneaux. */
export const RING_RADIUS = 1.1;
const RING_RISE = 0.5;
const RING_ANCHOR_CLEARANCE = 0.4;
const RING_PICKUP_CLEARANCE = 0.3;
const RING_RING_CLEARANCE = 0.5;

/**
 * Anneaux de précision (brief, O5) : chacun entre deux points consécutifs de
 * la chaîne, au milieu du vol et un peu au-dessus, là où passe une belle
 * trajectoire. Jamais autour d'un lanceur ni d'un point qui glisse, ni sur
 * une fourche, ni sur un autre anneau. Rien de solide : un anneau raté ne
 * coûte rien, le parcours se prouve sans lui.
 */
function placeRings(rng: Rng, ids: IdCounters, anchors: readonly Anchor[], pickups: readonly Pickup[], zones: readonly Zone[], count: number, protectedIds: ReadonlySet<number>, halfWidth: number, fixed: readonly Ring[] = []): Ring[] {
  const rings: Ring[] = [...fixed];
  if (count <= 0 || anchors.length < 4) return rings.slice(fixed.length);
  const bands = launchBands(anchors);
  const pairs: number[] = [];
  for (let i = 1; i < anchors.length - 2; i += 1) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (a.kind === 'lanceur' || b.kind === 'lanceur' || a.cable || b.cable || protectedIds.has(a.id) || protectedIds.has(b.id)) continue;
    if (b.pos.y < a.pos.y + 2) continue;
    pairs.push(i);
  }
  if (pairs.length === 0) return rings;
  const clear = (pos: Vec2): boolean =>
    anchors.every((a) => Math.hypot(a.pos.x - pos.x, a.pos.y - pos.y) >= RING_RADIUS + RING_ANCHOR_CLEARANCE) &&
    pickups.every((p) => Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y) >= RING_RADIUS + RING_PICKUP_CLEARANCE) &&
    rings.every((r) => Math.hypot(r.pos.x - pos.x, r.pos.y - pos.y) >= 2 * RING_RADIUS + RING_RING_CLEARANCE) &&
    !bands.some((band) => pos.y > band.y0 && pos.y < band.y1) &&
    zoneAt(zones, pos) === null;
  for (let n = 0; n < count; n += 1) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const i = pairs[Math.floor(rng.next() * pairs.length)]!;
      const a = anchors[i]!.pos;
      const b = anchors[i + 1]!.pos;
      const limit = halfWidth - RING_RADIUS;
      const pos = { x: Math.max(-limit, Math.min(limit, (a.x + b.x) / 2)), y: (a.y + b.y) / 2 + RING_RISE };
      if (!clear(pos)) continue;
      rings.push({ id: ids.ring, pos, radius: RING_RADIUS, closest: null, taken: false });
      ids.ring += 1;
      break;
    }
  }
  return rings.slice(fixed.length);
}

/** Prise à éclipse : au-dessus du point qu'elle permet de sauter, et déport de la prise électrique à côté de son point. */
const ECLIPSE_RISE = 1.5;
const ELECTRIC_OFFSET = 2.4;
const ELECTRIC_RISE = 0.6;
/** Aucune prise ajoutée à moins de cette distance d'une autre. */
const SPECIAL_CLEARANCE = 1.6;

/**
 * Ajoute au segment ses prises électriques et à éclipse, sans toucher à la
 * chaîne : le parcours reste prouvé sans elles. Une éclipse est un raccourci,
 * posée au-dessus du point qu'elle permet de sauter, entre ses deux voisins.
 * Une électrique est un piège, posée à côté d'un point de la chaîne, là où
 * la visée peut la préférer. Chacune est insérée juste après son point, pour
 * garder la liste à peu près ordonnée par hauteur et le sommet en dernier.
 */
/**
 * La bande de tir de chaque lanceur : de juste sous lui jusqu'au-dessus du point
 * où la chaîne reprend par-dessus son mur. Rien d'autre que le mur ne s'y pose :
 * ni obstacle tiré au sort, ni prise spéciale, qui n'aurait pas de sortie.
 */
function launchBands(anchors: readonly Anchor[]): { readonly y0: number; readonly y1: number }[] {
  return anchors.filter((a) => a.kind === 'lanceur').map((a) => ({ y0: a.pos.y - 1, y1: a.pos.y + WALL_RISE_MIN + WALL_RISE_RANGE + ABOVE_WALL + 1 }));
}

function addSpecialAnchors(rng: Rng, ids: IdCounters, anchors: Anchor[], profile: TierProfile, halfWidth: number, zones: readonly Zone[] = []): void {
  const wanted: Anchor['kind'][] = [...Array<Anchor['kind']>(profile.eclipse).fill('eclipse'), ...Array<Anchor['kind']>(profile.electric).fill('electrique')];
  if (wanted.length === 0 || anchors.length < 5) return;
  const farEnough = (pos: Vec2): boolean => anchors.every((a) => Math.hypot(a.pos.x - pos.x, a.pos.y - pos.y) >= SPECIAL_CLEARANCE);
  const bands = launchBands(anchors);
  const inBand = (pos: Vec2): boolean => bands.some((band) => pos.y > band.y0 && pos.y < band.y1);
  for (const kind of wanted) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      // Jamais sur le premier ni le dernier point, ni sur un point qui glisse.
      const i = 1 + Math.floor(rng.next() * (anchors.length - 3));
      const before = anchors[i - 1]!;
      const here = anchors[i]!;
      const after = anchors[i + 1]!;
      if (here.cable || before.cable || after.cable) continue;
      // Jamais autour d'un lanceur ni dans sa bande de tir : sous le mur, une prise n'aurait pas de sortie.
      if (before.kind === 'lanceur' || here.kind === 'lanceur' || after.kind === 'lanceur') continue;
      if (before.kind === 'roue' || here.kind === 'roue' || after.kind === 'roue') continue;
      const pos =
        kind === 'eclipse'
          ? { x: clampX((before.pos.x + after.pos.x) / 2 + (rng.next() - 0.5) * 1.2, halfWidth), y: here.pos.y + ECLIPSE_RISE }
          : { x: clampX(here.pos.x + (here.pos.x > 0 ? -1 : 1) * ELECTRIC_OFFSET, halfWidth), y: here.pos.y + ELECTRIC_RISE };
      // Jamais dans une zone : un courant y porterait la prise hors de toute logique de sortie.
      if (!farEnough(pos) || inBand(pos) || zoneAt(zones, pos) !== null) continue;
      anchors.splice(i + 1, 0, makeAnchor(ids, pos, kind));
      break;
    }
  }
}

/** Une traversière s'arrête à cette distance du bord jouable. */
const TRAVERSIERE_INSET = 0.3;

/**
 * Des points normaux du milieu du segment deviennent des points qui glissent :
 * sur un câble court, deux points vont et viennent de 1,6 m de chaque côté ;
 * en traversière, trois points balaient toute la largeur jouable, d'autant
 * plus lentement qu'elle est large.
 */
function hangCables(anchors: Anchor[], junctionId: number | null, branchIds: readonly number[], halfWidth: number, kind: 'cable' | 'traversiere'): void {
  const protectedIds = new Set<number>([...branchIds, junctionId ?? -1, anchors.at(-1)?.id ?? -1, anchors[0]?.id ?? -1]);
  const candidates = anchors.map((a, i) => ({ a, i })).filter(({ a }) => !protectedIds.has(a.id) && a.kind === 'normal');
  const slots = kind === 'cable' ? [1 / 3, 2 / 3] : [1 / 4, 1 / 2, 3 / 4];
  const picked = new Set<number>();
  for (const slot of slots) {
    const pick = candidates[Math.floor(candidates.length * slot)];
    if (!pick || picked.has(pick.a.id)) continue;
    picked.add(pick.a.id);
    const { a, i } = pick;
    const from = kind === 'cable' ? { x: clampX(a.pos.x - CABLE_HALF_LENGTH, halfWidth), y: a.pos.y } : { x: -halfWidth + TRAVERSIERE_INSET, y: a.pos.y };
    const to = kind === 'cable' ? { x: clampX(a.pos.x + CABLE_HALF_LENGTH, halfWidth), y: a.pos.y } : { x: halfWidth - TRAVERSIERE_INSET, y: a.pos.y };
    const period = kind === 'cable' ? CABLE_PERIOD_SECONDS : (TRAVERSIERE_PERIOD_SECONDS * halfWidth) / HALF_WIDTH;
    anchors[i] = { ...a, pos: { x: (from.x + to.x) / 2, y: a.pos.y }, cable: { from, to, period } };
  }
}

/** Segment de repli : une chaîne serrée, sans rien d'autre. Toujours franchissable. */
export function buildPlainSegment(rng: Rng, ids: IdCounters, from: Vec2 | null, origin: Vec2, context: SegmentContext = PLAIN_CONTEXT): Segment {
  return buildSegment(rng, ids, from, origin, { spacing: 3, obstacles: 0, split: false, fragileChance: 0, boosters: 0, archetypes: ['chaine'], spread: 1, electric: 0, eclipse: 0 }, 'chaine', { ...context, cable: 'none' });
}

/**
 * Fragiles et propulseurs, jamais sur la fourche, ses branches, leur jonction,
 * le premier ni le dernier point. La rafale aligne trois propulseurs de suite,
 * la série de fragiles trois à quatre fragiles de suite, au milieu du segment.
 */
function assignKinds(rng: Rng, anchors: Anchor[], profile: TierProfile, archetype: Archetype, junctionId: number | null, branchIds: readonly number[]): void {
  const protectedIds = new Set<number>([...branchIds, junctionId ?? -1, anchors.at(-1)?.id ?? -1, anchors[0]?.id ?? -1]);
  const eligible = anchors.filter((a) => !protectedIds.has(a.id) && a.kind === 'normal');
  const fragile = new Set<number>();
  const boosters = new Set<number>();
  const runOf = (count: number, into: Set<number>): void => {
    if (eligible.length === 0) return;
    const start = Math.max(0, Math.min(eligible.length - count, Math.floor(eligible.length / 2) - 1));
    for (let i = start; i < Math.min(eligible.length, start + count); i += 1) into.add(eligible[i]!.id);
  };
  if (archetype === 'rafale' && profile.boosters > 0) runOf(3, boosters);
  else if (archetype === 'fragiles' && profile.fragileChance > 0) runOf(3 + (rng.next() < 0.5 ? 1 : 0), fragile);
  else {
    for (const anchor of eligible) if (rng.next() < profile.fragileChance) fragile.add(anchor.id);
    const boostable = eligible.filter((a) => !fragile.has(a.id));
    for (let i = 0; i < profile.boosters && boostable.length > 0; i += 1) boosters.add(rng.pick(boostable).id);
  }
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i]!;
    const kind = fragile.has(anchor.id) ? 'fragile' : boosters.has(anchor.id) ? 'booster' : anchor.kind;
    if (kind !== anchor.kind) anchors[i] = { ...anchor, kind };
  }
}

/** Un obstacle ne s'approche pas d'un anneau à moins de cette distance de son cercle. */
const RING_OBSTACLE_CLEARANCE = 0.6;

/**
 * Corniches accrochées aux bords et dalles flottantes, à distance des points,
 * des étoiles et des anneaux, une par espèce demandée dans `kinds`. Les
 * espèces du lot 2 (rebond, cassable, porte) se posent comme les autres, en
 * corniche ou en dalle, mais d'abord et avec plus d'essais : elles sont le
 * propos du segment ; une porte est un peu plus large.
 */
function placeObstacles(
  rng: Rng,
  ids: IdCounters,
  anchors: readonly Anchor[],
  pickups: readonly Pickup[],
  rings: readonly Ring[],
  zones: readonly Zone[],
  startY: number,
  endY: number,
  kinds: readonly ObstacleKind[],
  from: Vec2 | null,
  slabsOnly: boolean,
  context: SegmentContext,
  halfWidth: number,
  fixed: readonly Obstacle[] = [],
): Obstacle[] {
  const wallX = halfWidth + WALL_MARGIN;
  const obstacles: Obstacle[] = [...fixed];
  // Entre un lanceur et la chaîne qui reprend au-dessus de son mur, aucun obstacle tiré au sort : le couloir du tir, décalé, doit rester libre.
  const bands = launchBands(anchors);
  const inLaunchBand = (box: Obstacle): boolean => bands.some((band) => box.y1 > band.y0 && box.y0 < band.y1);
  const { env, entryEnv } = context;
  // Un point qui glisse est tenu à l'écart partout où il passe : à ses deux bouts et au milieu. Autour d'un lanceur, rien jusqu'où la traction recule le personnage.
  const clearOf = (pos: Vec2, box: Obstacle): boolean => circleBoxGap(pos, 0, box) >= OBSTACLE_CLEARANCE && !underAnchor(pos, box, env);
  const keepAway = (box: Obstacle): boolean =>
    anchors.every((a) => (a.kind === 'lanceur' ? circleBoxGap(a.pos, LANCEUR_CLEARANCE, box) > 0 : a.kind === 'roue' ? circleBoxGap(a.pos, WHEEL_CLEARANCE, box) > 0 : (a.cable ? [a.cable.from, a.pos, a.cable.to] : [a.pos]).every((pos) => clearOf(pos, box)))) &&
    pickups.every((p) => circleBoxGap(p.pos, 0, box) >= PICKUP_CLEARANCE) &&
    rings.every((r) => circleBoxGap(r.pos, r.radius, box) >= RING_OBSTACLE_CLEARANCE) &&
    !nearZone(box, zones) &&
    (from === null || (circleBoxGap(from, 0, box) >= OBSTACLE_CLEARANCE && !underAnchor(from, box, env) && !underAnchor(from, box, entryEnv))) &&
    !inLaunchBand(box) &&
    obstacles.every((o) => box.y1 < o.y0 - 1 || box.y0 > o.y1 + 1);
  // Les obstacles vivent entre deux mètres au-dessus du départ et deux mètres sous le sommet du segment,
  // jamais au-dessus : un segment trop court pour cela n'en reçoit aucun.
  const bottom = startY + 2;
  const top = endY - 2 - OBSTACLE_THICKNESS;
  if (top - bottom < 1) return obstacles;
  for (const kind of kinds) {
    // Une espèce du lot 2 a droit à plus d'essais : elle est attendue.
    for (let attempt = 0; attempt < (kind === 'solide' ? 6 : kind === 'tournant' ? 24 : 12); attempt += 1) {
      const y0 = bottom + rng.next() * (top - bottom);
      let x0: number;
      let x1: number;
      if (!slabsOnly && rng.next() < 0.5) {
        const width = (kind === 'porte' ? 2 : 1.5) + 1.5 * rng.next();
        if (rng.next() < 0.5) {
          x0 = -wallX;
          x1 = -wallX + width;
        } else {
          x0 = wallX - width;
          x1 = wallX;
        }
      } else {
        const width = (kind === 'porte' ? 2 : 1.5) + rng.next();
        const center = (-3 + 6 * rng.next()) * (halfWidth / HALF_WIDTH);
        x0 = center - width / 2;
        x1 = center + width / 2;
      }
      if (kind === 'tournant') {
        // Une barre tournante : son pivot au milieu de la place tirée, flottant, jamais au bord ; un tour en six secondes, dans un sens ou l'autre.
        const pivot = { x: clampX((x0 + x1) / 2, halfWidth - ROTOR_LENGTH / 2), y: y0 + ROTOR_LENGTH / 2 };
        if (pivot.y + ROTOR_LENGTH / 2 > top + OBSTACLE_THICKNESS) continue;
        const spin = (rng.next() < 0.5 ? -1 : 1) / ROTOR_TURN_SECONDS;
        const probe = rotorBar({ obstacle: ids.obstacle, anchor: 0, pickup: 0, ring: 0, zone: 0 }, pivot, spin, rng.next());
        if (!keepAway(probe)) continue;
        obstacles.push(probe);
        ids.obstacle += 1;
        break;
      }
      const box: Obstacle = kind === 'solide' ? { id: ids.obstacle, x0, y0, x1, y1: y0 + OBSTACLE_THICKNESS } : { id: ids.obstacle, x0, y0, x1, y1: y0 + OBSTACLE_THICKNESS, kind };
      if (!keepAway(box)) continue;
      obstacles.push(box);
      ids.obstacle += 1;
      break;
    }
  }
  return obstacles;
}

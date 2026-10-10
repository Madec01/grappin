import type { Rng } from '../core/math/rng';
import type { Vec2 } from '../core/math/vec2';
import { STILL, type Environment } from './environment';
import { CABLE_HALF_LENGTH, CABLE_PERIOD_SECONDS, TRAVERSIERE_PERIOD_SECONDS } from './events';
import { circleBoxGap } from './geometry';
import { LANCEUR_CLEARANCE } from './launcher';
import type { Anchor, Obstacle, Pickup } from './state';

/**
 * Construction d'un segment de parcours : une chaîne de points d'accroche qui
 * monte d'une vingtaine de mètres, selon un motif et un profil. Le motif
 * donne la forme (chaîne en zigzag, escalier serré, couloir d'étoiles, champ
 * de dalles, rafale de propulseurs, série de fragiles, grand saut) ; le profil
 * dit ce qui est permis (espacement, obstacles, fourche, fragiles,
 * propulseurs). Le générateur propose ; le vérificateur (`verifier.ts`)
 * dispose. Tout l'aléatoire vient du générateur seedé.
 */

export type Archetype = 'chaine' | 'escalier' | 'couloir' | 'dalles' | 'rafale' | 'fragiles' | 'saut' | 'lanceur';

export const ARCHETYPES: readonly Archetype[] = ['chaine', 'escalier', 'couloir', 'dalles', 'rafale', 'fragiles', 'saut', 'lanceur'];

export interface Segment {
  readonly anchors: Anchor[];
  readonly obstacles: Obstacle[];
  readonly pickups: Pickup[];
  /** Point de fourche, dont les deux branches doivent toutes deux être atteignables. */
  readonly junctionId: number | null;
  readonly branchIds: readonly number[];
}

/** Compteurs d'identifiants, uniques sur toute la partie. */
export interface IdCounters {
  anchor: number;
  obstacle: number;
  pickup: number;
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
}

/** Largeur jouable à l'écartement 1 : les points restent entre -limit et +limit, les obstacles s'y appuient. */
export const HALF_WIDTH = 4;
/** Écartement le plus fort : ± 6 m, ce que la caméra sait encore montrer en dézoomant. */
export const MAX_SPREAD = 1.5;
/** Les corniches s'accrochent un mètre au-delà de la largeur jouable. */
const WALL_MARGIN = 1;
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
};

/** Le mur à trou d'un lanceur : hauteur au-dessus du lanceur, demi-largeur du trou, et hauteur du point suivant au-dessus du mur (hors zone de pendaison). */
const WALL_RISE_MIN = 4.5;
const WALL_RISE_RANGE = 1.5;
const GAP_HALF_WIDTH = 1.2;
const ABOVE_WALL = 4.2;

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
  /** Obstacles posés par le motif lui-même, que les obstacles tirés au sort respectent. */
  const fixed: Obstacle[] = [];

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
      // Lanceur : le dernier point devient un lanceur, un mur à trou le surplombe, et la chaîne reprend au-dessus du mur.
      anchors[anchors.length - 1] = makeAnchor(ids, cur, 'lanceur');
      const wallY = cur.y + WALL_RISE_MIN + WALL_RISE_RANGE * rng.next();
      const gapX = clampX(cur.x + (rng.next() - 0.5) * 2 * Math.max(0, halfWidth - 2.2), halfWidth);
      const wallX = halfWidth + WALL_MARGIN;
      fixed.push({ id: ids.obstacle, x0: -wallX, y0: wallY, x1: gapX - GAP_HALF_WIDTH, y1: wallY + OBSTACLE_THICKNESS });
      ids.obstacle += 1;
      fixed.push({ id: ids.obstacle, x0: gapX + GAP_HALF_WIDTH, y0: wallY, x1: wallX, y1: wallY + OBSTACLE_THICKNESS });
      ids.obstacle += 1;
      cur = { x: clampX(gapX + (rng.next() - 0.5) * 1.6, halfWidth), y: wallY + ABOVE_WALL };
      anchors.push(makeAnchor(ids, cur));
      launcherDone = true;
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
  addSpecialAnchors(rng, ids, anchors, profile, halfWidth);
  const obstacleCount = archetype === 'dalles' ? Math.min(4, profile.obstacles + 2) : profile.obstacles;
  const obstacles = placeObstacles(rng, ids, anchors, pickups, Math.max(startY, origin.y + GRACE_ABOVE_ORIGIN - 2), cur.y, obstacleCount, from, archetype === 'dalles', context, halfWidth, fixed);
  return { anchors, obstacles, pickups, junctionId, branchIds };
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
function addSpecialAnchors(rng: Rng, ids: IdCounters, anchors: Anchor[], profile: TierProfile, halfWidth: number): void {
  const wanted: Anchor['kind'][] = [...Array<Anchor['kind']>(profile.eclipse).fill('eclipse'), ...Array<Anchor['kind']>(profile.electric).fill('electrique')];
  if (wanted.length === 0 || anchors.length < 5) return;
  const farEnough = (pos: Vec2): boolean => anchors.every((a) => Math.hypot(a.pos.x - pos.x, a.pos.y - pos.y) >= SPECIAL_CLEARANCE);
  for (const kind of wanted) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      // Jamais sur le premier ni le dernier point, ni sur un point qui glisse.
      const i = 1 + Math.floor(rng.next() * (anchors.length - 3));
      const before = anchors[i - 1]!;
      const here = anchors[i]!;
      const after = anchors[i + 1]!;
      if (here.cable || before.cable || after.cable) continue;
      const pos =
        kind === 'eclipse'
          ? { x: clampX((before.pos.x + after.pos.x) / 2 + (rng.next() - 0.5) * 1.2, halfWidth), y: here.pos.y + ECLIPSE_RISE }
          : { x: clampX(here.pos.x + (here.pos.x > 0 ? -1 : 1) * ELECTRIC_OFFSET, halfWidth), y: here.pos.y + ELECTRIC_RISE };
      if (!farEnough(pos)) continue;
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

/** Corniches accrochées aux bords et dalles flottantes, à distance des points et des étoiles. */
function placeObstacles(
  rng: Rng,
  ids: IdCounters,
  anchors: readonly Anchor[],
  pickups: readonly Pickup[],
  startY: number,
  endY: number,
  count: number,
  from: Vec2 | null,
  slabsOnly: boolean,
  context: SegmentContext,
  halfWidth: number,
  fixed: readonly Obstacle[] = [],
): Obstacle[] {
  const wallX = halfWidth + WALL_MARGIN;
  const obstacles: Obstacle[] = [...fixed];
  const { env, entryEnv } = context;
  // Un point qui glisse est tenu à l'écart partout où il passe : à ses deux bouts et au milieu. Autour d'un lanceur, rien jusqu'où la traction recule le personnage.
  const clearOf = (pos: Vec2, box: Obstacle): boolean => circleBoxGap(pos, 0, box) >= OBSTACLE_CLEARANCE && !underAnchor(pos, box, env);
  const keepAway = (box: Obstacle): boolean =>
    anchors.every((a) => (a.kind === 'lanceur' ? circleBoxGap(a.pos, LANCEUR_CLEARANCE, box) > 0 : (a.cable ? [a.cable.from, a.pos, a.cable.to] : [a.pos]).every((pos) => clearOf(pos, box)))) &&
    pickups.every((p) => circleBoxGap(p.pos, 0, box) >= PICKUP_CLEARANCE) &&
    (from === null || (circleBoxGap(from, 0, box) >= OBSTACLE_CLEARANCE && !underAnchor(from, box, env) && !underAnchor(from, box, entryEnv))) &&
    obstacles.every((o) => box.y1 < o.y0 - 1 || box.y0 > o.y1 + 1);
  // Les obstacles vivent entre deux mètres au-dessus du départ et deux mètres sous le sommet du segment,
  // jamais au-dessus : un segment trop court pour cela n'en reçoit aucun.
  const bottom = startY + 2;
  const top = endY - 2 - OBSTACLE_THICKNESS;
  if (top - bottom < 1) return obstacles;
  for (let i = 0; i < count; i += 1) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const y0 = bottom + rng.next() * (top - bottom);
      let x0: number;
      let x1: number;
      if (!slabsOnly && rng.next() < 0.5) {
        const width = 1.5 + 1.5 * rng.next();
        if (rng.next() < 0.5) {
          x0 = -wallX;
          x1 = -wallX + width;
        } else {
          x0 = wallX - width;
          x1 = wallX;
        }
      } else {
        const width = 1.5 + rng.next();
        const center = (-3 + 6 * rng.next()) * (halfWidth / HALF_WIDTH);
        x0 = center - width / 2;
        x1 = center + width / 2;
      }
      const box: Obstacle = { id: ids.obstacle, x0, y0, x1, y1: y0 + OBSTACLE_THICKNESS };
      if (!keepAway(box)) continue;
      obstacles.push(box);
      ids.obstacle += 1;
      break;
    }
  }
  return obstacles;
}

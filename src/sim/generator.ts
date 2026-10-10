import type { Rng } from '../core/math/rng';
import type { Vec2 } from '../core/math/vec2';
import { STILL, type Environment } from './environment';
import { CABLE_HALF_LENGTH } from './events';
import { circleBoxGap } from './geometry';
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

export type Archetype = 'chaine' | 'escalier' | 'couloir' | 'dalles' | 'rafale' | 'fragiles' | 'saut';

export const ARCHETYPES: readonly Archetype[] = ['chaine', 'escalier', 'couloir', 'dalles', 'rafale', 'fragiles', 'saut'];

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
}

/** Largeur jouable : les points restent entre -limit et +limit, les obstacles s'y appuient. */
export const HALF_WIDTH = 4;
/** Bord du monde où s'accrochent les corniches. */
export const WALL_X = 5;
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
  if (tier >= 3) archetypes.push('rafale', 'saut');
  return {
    spacing: Math.min(5, 3 + 0.4 * tier),
    obstacles: tier === 0 ? 0 : Math.min(3, 1 + Math.floor(tier / 2)),
    split: tier >= 1,
    fragileChance: tier >= 2 ? 0.3 : 0,
    boosters: tier >= 3 ? 1 : 0,
    archetypes,
  };
}

function clampX(x: number): number {
  return Math.max(-HALF_WIDTH, Math.min(HALF_WIDTH, x));
}

/** Pas d'une chaîne : montée et déport en multiples de l'espacement, côté alterné, borné à la largeur. */
function chainStep(rng: Rng, from: Vec2, spacing: number, dyRange: readonly [number, number], dxRange: readonly [number, number]): Vec2 {
  const dy = spacing * (dyRange[0] + (dyRange[1] - dyRange[0]) * rng.next());
  const side = from.x > 0 ? -1 : 1;
  const dx = side * spacing * (dxRange[0] + (dxRange[1] - dxRange[0]) * rng.next());
  let x = from.x + dx;
  if (x > HALF_WIDTH || x < -HALF_WIDTH) x = from.x - dx;
  return { x: clampX(x), y: from.y + dy };
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
};

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
  /** Un câble couvre ce segment : deux points du milieu glissent. */
  readonly cable: boolean;
  /**
   * Aucun point au-dessus de cette hauteur : un événement commence ou finit un
   * mètre plus haut. Le segment s'arrête alors entre un et trois mètres sous
   * elle, pour que le suivant soit engendré et prouvé dans les nouvelles
   * conditions. `Infinity` sans frontière.
   */
  readonly maxY: number;
}

export const PLAIN_CONTEXT: SegmentContext = { env: STILL, entryEnv: STILL, cable: false, maxY: Infinity };

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
  const startY = from?.y ?? origin.y;
  const targetY = targetHeight(rng, startY, context.maxY);
  let cur: Vec2 = from ?? { x: origin.x + FIRST_ANCHOR_OFFSET.x, y: origin.y + FIRST_ANCHOR_OFFSET.y };
  if (!from) anchors.push(makeAnchor(ids, cur));
  const wantsSplit = archetype === 'chaine' && profile.split && rng.next() < 0.8;
  let splitDone = false;
  let jumpDone = false;

  while (cur.y < targetY) {
    if (wantsSplit && !splitDone && cur.y - startY > 3 && targetY - cur.y > 9) {
      // Fourche : la route basse est proche et sûre, la haute plus loin et étoilée, puis les deux se rejoignent.
      const u = Math.min(profile.spacing, 3.6);
      const side = cur.x > 0 ? -1 : 1;
      const junction = anchors.at(-1) ?? makeAnchor(ids, cur);
      if (anchors.length === 0) anchors.push(junction);
      const low = makeAnchor(ids, { x: clampX(cur.x + side * 0.75 * u), y: cur.y + 0.5 * u });
      const high = makeAnchor(ids, { x: clampX(cur.x + side * 0.5 * u), y: cur.y + 1.1 * u });
      const merge = makeAnchor(ids, { x: clampX(cur.x - side * 0.1 * u), y: cur.y + 1.6 * u });
      anchors.push(low, high, merge);
      pickups.push(makePickup(ids, { x: (high.pos.x + merge.pos.x) / 2, y: (high.pos.y + merge.pos.y) / 2 + 0.3 }));
      junctionId = junction.id;
      branchIds = [low.id, high.id];
      splitDone = true;
      cur = merge.pos;
      continue;
    }
    if (archetype === 'saut' && !jumpDone && profile.boosters > 0 && cur.y - startY > 6 && targetY - cur.y > 8) {
      // Grand saut : un propulseur, puis un trou d'un espacement et demi que seul le lâcher propulsé franchit bien.
      const launcher = makeAnchor(ids, cur, 'booster');
      anchors[anchors.length - 1] = launcher;
      const side = cur.x > 0 ? -1 : 1;
      cur = { x: clampX(cur.x + side * 0.6 * spacing), y: cur.y + 1.45 * spacing };
      anchors.push(makeAnchor(ids, cur));
      jumpDone = true;
      continue;
    }
    const prev = cur;
    cur = chainStep(rng, cur, spacing, shape.dy, shape.dx);
    // Jamais au-dessus de la frontière : le dernier pas se raccourcit pour finir deux mètres sous elle.
    if (cur.y > context.maxY) cur = { x: cur.x, y: context.maxY - 1 };
    anchors.push(makeAnchor(ids, cur));
    // Couloir d'étoiles : une étoile entre deux points sur deux, légèrement décalée.
    if (archetype === 'couloir' && anchors.length % 2 === 0) {
      pickups.push(makePickup(ids, { x: clampX((prev.x + cur.x) / 2 + (rng.next() - 0.5) * 1.2), y: (prev.y + cur.y) / 2 }));
    }
  }

  // Hors zone d'apprentissage, chaque segment porte au moins une étoile, à côté d'un point du milieu :
  // la deuxième étoile d'un niveau doit se mériter.
  const teaching = !profile.split && profile.obstacles === 0;
  if (pickups.length === 0 && !teaching && anchors.length >= 3) {
    const beside = anchors[Math.floor(anchors.length / 2)]!;
    const side = beside.pos.x > 0 ? -1 : 1;
    pickups.push(makePickup(ids, { x: clampX(beside.pos.x + side * 1.3), y: beside.pos.y + 0.8 }));
  }
  assignKinds(rng, anchors, profile, archetype, junctionId, branchIds);
  if (context.cable) hangCables(anchors, junctionId, branchIds);
  const obstacleCount = archetype === 'dalles' ? Math.min(4, profile.obstacles + 2) : profile.obstacles;
  const obstacles = placeObstacles(rng, ids, anchors, pickups, Math.max(startY, origin.y + GRACE_ABOVE_ORIGIN - 2), cur.y, obstacleCount, from, archetype === 'dalles', context);
  return { anchors, obstacles, pickups, junctionId, branchIds };
}

/** Deux points normaux du milieu du segment deviennent des points sur câble, qui vont et viennent de côté. */
function hangCables(anchors: Anchor[], junctionId: number | null, branchIds: readonly number[]): void {
  const protectedIds = new Set<number>([...branchIds, junctionId ?? -1, anchors.at(-1)?.id ?? -1, anchors[0]?.id ?? -1]);
  const candidates = anchors.map((a, i) => ({ a, i })).filter(({ a }) => !protectedIds.has(a.id) && a.kind === 'normal');
  const picks = [candidates[Math.floor(candidates.length / 3)], candidates[Math.floor((2 * candidates.length) / 3)]].filter((c): c is { a: Anchor; i: number } => c !== undefined);
  for (const { a, i } of picks) {
    const from = { x: clampX(a.pos.x - CABLE_HALF_LENGTH), y: a.pos.y };
    const to = { x: clampX(a.pos.x + CABLE_HALF_LENGTH), y: a.pos.y };
    anchors[i] = { ...a, pos: { x: (from.x + to.x) / 2, y: a.pos.y }, cable: { from, to } };
  }
}

/** Segment de repli : une chaîne serrée, sans rien d'autre. Toujours franchissable. */
export function buildPlainSegment(rng: Rng, ids: IdCounters, from: Vec2 | null, origin: Vec2, context: SegmentContext = PLAIN_CONTEXT): Segment {
  return buildSegment(rng, ids, from, origin, { spacing: 3, obstacles: 0, split: false, fragileChance: 0, boosters: 0, archetypes: ['chaine'] }, 'chaine', { ...context, cable: false });
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
): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const { env, entryEnv } = context;
  const keepAway = (box: Obstacle): boolean =>
    anchors.every((a) => circleBoxGap(a.pos, 0, box) >= OBSTACLE_CLEARANCE && !underAnchor(a.pos, box, env)) &&
    pickups.every((p) => circleBoxGap(p.pos, 0, box) >= PICKUP_CLEARANCE) &&
    (from === null || (circleBoxGap(from, 0, box) >= OBSTACLE_CLEARANCE && !underAnchor(from, box, env) && !underAnchor(from, box, entryEnv))) &&
    obstacles.every((o) => box.y1 < o.y0 - 1 || box.y0 > o.y1 + 1);
  for (let i = 0; i < count; i += 1) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const y0 = startY + 2 + rng.next() * Math.max(1, endY - startY - 4);
      let x0: number;
      let x1: number;
      if (!slabsOnly && rng.next() < 0.5) {
        const width = 1.5 + 1.5 * rng.next();
        if (rng.next() < 0.5) {
          x0 = -WALL_X;
          x1 = -WALL_X + width;
        } else {
          x0 = WALL_X - width;
          x1 = WALL_X;
        }
      } else {
        const width = 1.5 + rng.next();
        const center = -3 + 6 * rng.next();
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

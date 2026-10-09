import type { Rng } from '../core/math/rng';
import type { Vec2 } from '../core/math/vec2';
import { circleBoxGap } from './geometry';
import type { Anchor, Obstacle, Pickup } from './state';

/**
 * Construction d'un segment de parcours : une chaîne de points d'accroche qui
 * monte d'une vingtaine de mètres, avec selon le palier une fourche entre une
 * route haute étoilée et une route basse sûre, des obstacles fixes, des
 * accroches fragiles et propulseuses. Le générateur propose ; le vérificateur
 * (`verifier.ts`) dispose. Tout l'aléatoire vient du générateur seedé.
 */

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

/** Ce qu'un palier ajoute : une nouvelle contrainte à la fois. */
export interface TierProfile {
  /** Espacement nominal entre deux points, en mètres. */
  readonly spacing: number;
  readonly obstacles: number;
  readonly split: boolean;
  readonly fragileChance: number;
  readonly boosters: number;
}

/** Largeur jouable : les points restent entre -limit et +limit, les obstacles s'y appuient. */
export const HALF_WIDTH = 4;
/** Bord du monde où s'accrochent les corniches. */
export const WALL_X = 5;
/** Premier point, au-dessus du toit de départ. */
export const FIRST_ANCHOR: Vec2 = { x: 0.8, y: 4 };

const OBSTACLE_THICKNESS = 0.4;
/** Dégagement minimal entre un obstacle et le centre d'un point ou d'une étoile. */
const OBSTACLE_CLEARANCE = 1.4;
const PICKUP_CLEARANCE = 0.8;
/** Sous un point, là où l'on pend après l'avoir attrapé, rien jusqu'à cette profondeur et cette demi-largeur. */
const HANG_DEPTH = 3.8;
const HANG_HALF_WIDTH = 1.3;

/** Vrai si la boîte empiète sur la zone de pendaison sous un point. */
function underAnchor(anchor: Vec2, box: Obstacle): boolean {
  return box.y1 < anchor.y && box.y1 > anchor.y - HANG_DEPTH && box.x1 > anchor.x - HANG_HALF_WIDTH && box.x0 < anchor.x + HANG_HALF_WIDTH;
}

export function tierProfile(tier: number): TierProfile {
  return {
    spacing: Math.min(5, 3 + 0.4 * tier),
    obstacles: tier === 0 ? 0 : Math.min(3, 1 + Math.floor(tier / 2)),
    split: tier >= 1,
    fragileChance: tier >= 2 ? 0.3 : 0,
    boosters: tier >= 3 ? 1 : 0,
  };
}

function clampX(x: number): number {
  return Math.max(-HALF_WIDTH, Math.min(HALF_WIDTH, x));
}

/** Point suivant d'une chaîne : on alterne les côtés, on repart de l'autre côté si l'on sort, puis on borne. */
function nextChainPoint(rng: Rng, from: Vec2, spacing: number): Vec2 {
  const dy = spacing * (0.55 + 0.35 * rng.next());
  const side = from.x > 0 ? -1 : 1;
  const dx = side * spacing * (0.4 + 0.6 * rng.next());
  let x = from.x + dx;
  if (x > HALF_WIDTH || x < -HALF_WIDTH) x = from.x - dx;
  return { x: clampX(x), y: from.y + dy };
}

function makeAnchor(ids: IdCounters, pos: Vec2, kind: Anchor['kind'] = 'normal'): Anchor {
  const anchor: Anchor = { id: ids.anchor, pos, kind, broken: false };
  ids.anchor += 1;
  return anchor;
}

/**
 * Construit un segment depuis le dernier point connu (`from`, ou null au tout
 * début). `startY` est la hauteur de ce point ; le segment monte jusqu'à
 * environ `startY + 16 à 24 m`.
 */
export function buildSegment(rng: Rng, ids: IdCounters, from: Vec2 | null, profile: TierProfile): Segment {
  const anchors: Anchor[] = [];
  const pickups: Pickup[] = [];
  let junctionId: number | null = null;
  let branchIds: number[] = [];
  const startY = from?.y ?? 0;
  const targetY = startY + 16 + 8 * rng.next();
  let cur: Vec2 = from ?? FIRST_ANCHOR;
  if (!from) anchors.push(makeAnchor(ids, cur));
  const wantsSplit = profile.split && rng.next() < 0.8;
  let splitDone = false;

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
      pickups.push({ id: ids.pickup, pos: { x: (high.pos.x + merge.pos.x) / 2, y: (high.pos.y + merge.pos.y) / 2 + 0.3 }, taken: false });
      ids.pickup += 1;
      junctionId = junction.id;
      branchIds = [low.id, high.id];
      splitDone = true;
      cur = merge.pos;
      continue;
    }
    cur = nextChainPoint(rng, cur, profile.spacing);
    anchors.push(makeAnchor(ids, cur));
  }

  assignKinds(rng, anchors, profile, junctionId, branchIds);
  const obstacles = placeObstacles(rng, ids, anchors, pickups, startY, cur.y, profile.obstacles, from);
  return { anchors, obstacles, pickups, junctionId, branchIds };
}

/** Segment de repli : une chaîne serrée, sans rien d'autre. Toujours franchissable. */
export function buildPlainSegment(rng: Rng, ids: IdCounters, from: Vec2 | null): Segment {
  return buildSegment(rng, ids, from, { spacing: 3, obstacles: 0, split: false, fragileChance: 0, boosters: 0 });
}

/** Fragiles et propulseurs, jamais sur la fourche, ses branches, leur jonction ni le dernier point. */
function assignKinds(rng: Rng, anchors: Anchor[], profile: TierProfile, junctionId: number | null, branchIds: readonly number[]): void {
  const protectedIds = new Set<number>([...branchIds, junctionId ?? -1, anchors.at(-1)?.id ?? -1, anchors[0]?.id ?? -1]);
  const eligible = anchors.filter((a) => !protectedIds.has(a.id));
  const fragile = new Set<number>();
  for (const anchor of eligible) if (rng.next() < profile.fragileChance) fragile.add(anchor.id);
  const boosters = new Set<number>();
  const boostable = eligible.filter((a) => !fragile.has(a.id));
  for (let i = 0; i < profile.boosters && boostable.length > 0; i += 1) boosters.add(rng.pick(boostable).id);
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i]!;
    const kind = fragile.has(anchor.id) ? 'fragile' : boosters.has(anchor.id) ? 'booster' : 'normal';
    if (kind !== 'normal') anchors[i] = { ...anchor, kind };
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
): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const keepAway = (box: Obstacle): boolean =>
    anchors.every((a) => circleBoxGap(a.pos, 0, box) >= OBSTACLE_CLEARANCE && !underAnchor(a.pos, box)) &&
    pickups.every((p) => circleBoxGap(p.pos, 0, box) >= PICKUP_CLEARANCE) &&
    (from === null || (circleBoxGap(from, 0, box) >= OBSTACLE_CLEARANCE && !underAnchor(from, box))) &&
    obstacles.every((o) => box.y1 < o.y0 - 1 || box.y0 > o.y1 + 1);
  for (let i = 0; i < count; i += 1) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const y0 = startY + 2 + rng.next() * Math.max(1, endY - startY - 4);
      let x0: number;
      let x1: number;
      if (rng.next() < 0.5) {
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

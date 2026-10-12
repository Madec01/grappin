import { cosTurns, sinTurns } from '../core/math/trig';
import type { Vec2 } from '../core/math/vec2';
import { pushOut } from './flight';
import { circleBoxGap } from './geometry';
import type { Anchor, Obstacle, Orbit, Rift, Rotor, Slide } from './state';
import type { Tuning } from './tuning';

/**
 * Les obstacles qui bougent (brief du 11 octobre 2026, lot 2) : la barre qui
 * tourne autour d'un pivot (« tournant », O2) et le panneau qui glisse (le mur
 * à ouverture mobile du lanceur, L3) ; lot 5, le panneau qui se referme (O6) ;
 * lot 5 B, les surfaces d'une faille qui s'écartent (T4), les barres tangentes
 * de la coque d'un carrousel (T5) et le panneau à charnière d'une structure
 * dépliante (T8), avec les prises qui bougent avec eux (`orbitPosition`,
 * `riftPosition`). Leur géométrie dépend du pas de
 * simulation, jamais du temps réel : `obstacleAt` et `obstacleGap` disent où
 * ils sont à un pas donné, pour les règles, le rendu et les robots. Le
 * vérificateur ne compte pas sur eux (voir `provableObstacles`) : on les
 * attend ou on les évite, comme une porte. Déterministe : quatre opérations et
 * la trigonométrie de `core/math/trig.ts`.
 */

/** Épaisseur de la barre d'un tournant, en mètres. */
export const ROTOR_THICKNESS = 0.4;

/** Vrai pour un obstacle dont la géométrie dépend du pas. */
export function isMoving(box: Obstacle): boolean {
  return box.rotor !== undefined || box.slide !== undefined || box.closer !== undefined || box.rift !== undefined || box.hinge !== undefined;
}

/** Vrai pour une prise qui bouge : sur câble, en orbite ou d'une faille. Le générateur les tient à l'écart de ce qu'il pose, le vérificateur les prouve à plusieurs positions. */
export function isMobile(anchor: Pick<Anchor, 'cable' | 'orbit' | 'rift'>): boolean {
  return anchor.cable !== undefined || anchor.orbit !== undefined || anchor.rift !== undefined;
}

/** L'ouverture d'une faille à ce pas, de 0 (fermée) à 1 (ouverte en grand) : nulle tant qu'elle n'est pas déclenchée, puis linéaire. */
export function riftProgress(rift: Rift, riftStep: number | undefined, step: number, tuning: Tuning): number {
  if (riftStep === undefined) return 0;
  const elapsed = (step - riftStep) * tuning.stepSeconds;
  return elapsed >= rift.seconds ? 1 : elapsed / rift.seconds;
}

/** Où est une prise de faille à ce pas : sa position de repos, décalée de son glissement. */
export function riftPosition(anchor: Pick<Anchor, 'rift' | 'riftStep' | 'pos'>, step: number, tuning: Tuning): Vec2 {
  if (!anchor.rift) return anchor.pos;
  const k = riftProgress(anchor.rift, anchor.riftStep, step, tuning);
  return { x: anchor.rift.rest.x + anchor.rift.dx * k, y: anchor.rift.rest.y };
}

/** Le point d'une orbite `turns` tours après sa phase. */
export function orbitPoint(orbit: Orbit, turns: number): Vec2 {
  const t = orbit.phase + turns;
  return { x: orbit.pivot.x + orbit.radius * cosTurns(t), y: orbit.pivot.y + orbit.radius * sinTurns(t) };
}

/** Où est une prise de carrousel à ce pas : sur son cercle, à sa phase plus ce qu'elle a tourné. */
export function orbitPosition(orbit: Orbit, step: number, tuning: Tuning): Vec2 {
  return orbitPoint(orbit, orbit.spin * step * tuning.stepSeconds);
}

/**
 * Prises d'une couronne de carrousel (lot 5 B, T5) : trois, à un tiers de tour
 * l'une de l'autre. Peu, pour que la visée, qui préfère le point le plus
 * proche, lâche la couronne pour la sortie au-dessus dès que l'on s'élève un
 * peu au-dessus de la prise du sommet.
 */
export const CAROUSEL_ANCHORS = 3;
/**
 * Les positions qu'une prise de carrousel occupe quand le vérificateur la
 * prouve : trois phases sur un tiers de tour, car une couronne de trois prises
 * se répète tous les tiers de tour.
 */
export const ORBIT_PLACEMENTS: readonly number[] = [0, 1 / 9, 2 / 9];

/** Les positions où le générateur tient une prise à l'écart de ce qu'il pose : partout où elle passe. */
export function anchorPlacements(anchor: Anchor): Vec2[] {
  if (anchor.cable) return [anchor.cable.from, anchor.pos, anchor.cable.to];
  if (anchor.orbit) return ORBIT_PLACEMENTS.map((turns) => orbitPoint(anchor.orbit!, turns));
  if (anchor.rift) return [anchor.rift.rest, { x: anchor.rift.rest.x + anchor.rift.dx, y: anchor.rift.rest.y }];
  return [anchor.pos];
}

/**
 * Le décalage d'un panneau de passage qui se referme à ce pas : nul tant qu'il
 * n'est pas déclenché ; puis il ferme, reste fermé, rouvre (`Closer`).
 */
export function closerOffset(box: Obstacle, step: number, tuning: Tuning): number {
  if (!box.closer || box.triggeredStep === undefined) return 0;
  const { travel, side, closeSeconds, shutSeconds } = box.closer;
  const elapsed = (step - box.triggeredStep) * tuning.stepSeconds;
  if (elapsed < closeSeconds) return side * travel * (elapsed / closeSeconds);
  if (elapsed < closeSeconds + shutSeconds) return side * travel;
  const opening = (elapsed - closeSeconds - shutSeconds) / closeSeconds;
  return opening >= 1 ? 0 : side * travel * (1 - opening);
}

/** Où en est un passage qui se referme : `armé` (ouvert, prêt), `se ferme`, `fermé`, `rouvre`. Pour le rendu. */
export type CloserState = 'arme' | 'se ferme' | 'ferme' | 'rouvre';

export function closerState(box: Obstacle, step: number, tuning: Tuning): CloserState {
  if (!box.closer || box.triggeredStep === undefined) return 'arme';
  const elapsed = (step - box.triggeredStep) * tuning.stepSeconds;
  if (elapsed < box.closer.closeSeconds) return 'se ferme';
  if (elapsed < box.closer.closeSeconds + box.closer.shutSeconds) return 'ferme';
  return 'rouvre';
}

/** L'angle de la barre à ce pas, en tours. */
export function rotorTurns(rotor: Rotor, step: number, tuning: Tuning): number {
  return rotor.phase + rotor.spin * step * tuning.stepSeconds;
}

/** L'angle d'un panneau à charnière, en tours : de fermé à ouvert selon son ouverture du moment. */
export function hingeTurns(box: Pick<Obstacle, 'hinge' | 'hingeProgress'>): number {
  if (!box.hinge) return 0;
  return box.hinge.closedTurns + (box.hinge.openTurns - box.hinge.closedTurns) * (box.hingeProgress ?? 0);
}

/** L'angle de la barre d'un obstacle à ce pas, en tours : celui de son tournant, ou de sa charnière. */
export function turnsOf(box: Obstacle, step: number, tuning: Tuning): number {
  if (!box.rotor) return 0;
  return box.hinge ? hingeTurns(box) : rotorTurns(box.rotor, step, tuning);
}

/** Le centre de la barre d'un tournant quand elle fait `turns` tours : son pivot, ou son bras tourné avec elle. */
export function rotorCentre(rotor: Rotor, turns: number): Vec2 {
  if (!rotor.arm) return rotor.pivot;
  const c = cosTurns(turns);
  const s = sinTurns(turns);
  return { x: rotor.pivot.x + rotor.arm.x * c - rotor.arm.y * s, y: rotor.pivot.y + rotor.arm.x * s + rotor.arm.y * c };
}

/** Les deux bouts de la barre d'un tournant à ce pas, ou null si l'obstacle n'en est pas un. */
export function rotorEnds(box: Obstacle, step: number, tuning: Tuning): { readonly a: Vec2; readonly b: Vec2 } | null {
  if (!box.rotor) return null;
  const turns = turnsOf(box, step, tuning);
  const half = box.rotor.length / 2;
  const dx = cosTurns(turns) * half;
  const dy = sinTurns(turns) * half;
  const centre = rotorCentre(box.rotor, turns);
  return { a: { x: centre.x - dx, y: centre.y - dy }, b: { x: centre.x + dx, y: centre.y + dy } };
}


/** Le décalage horizontal d'un panneau qui glisse à ce pas : un aller-retour en triangle, à vitesse constante, comme un câble. */
export function slideOffset(slide: Slide, step: number, tuning: Tuning): number {
  const periods = (step * tuning.stepSeconds) / slide.period + slide.phase;
  const k = periods - Math.floor(periods);
  return slide.amplitude * (k < 0.5 ? 4 * k - 1 : 3 - 4 * k);
}

/** L'obstacle là où il est à ce pas : un panneau décalé de son glissement, de sa fermeture ou de l'ouverture de sa faille ; tout autre obstacle, lui-même. */
export function obstacleAt(box: Obstacle, step: number, tuning: Tuning): Obstacle {
  if (box.closer) {
    const dx = closerOffset(box, step, tuning);
    return dx === 0 ? box : { ...box, x0: box.x0 + dx, x1: box.x1 + dx };
  }
  if (box.rift) {
    const dx = box.rift.dx * riftProgress(box.rift, box.riftStep, step, tuning);
    return dx === 0 ? box : { ...box, x0: box.x0 + dx, x1: box.x1 + dx };
  }
  if (!box.slide) return box;
  const dx = slideOffset(box.slide, step, tuning);
  return { ...box, x0: box.x0 + dx, x1: box.x1 + dx };
}

/** Le point du segment [a, b] le plus proche de `p`. */
function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const raw = len2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** L'écart entre un cercle et l'obstacle tel qu'il est à ce pas : négatif s'ils se touchent. Les obstacles fixes passent par `circleBoxGap`. */
export function obstacleGap(pos: Vec2, radius: number, box: Obstacle, step: number, tuning: Tuning): number {
  const ends = rotorEnds(box, step, tuning);
  if (!ends) return circleBoxGap(pos, radius, obstacleAt(box, step, tuning));
  const near = nearestOnSegment(pos, ends.a, ends.b);
  return Math.hypot(pos.x - near.x, pos.y - near.y) - ROTOR_THICKNESS / 2 - radius;
}

/** Sort le cercle de l'obstacle tel qu'il est à ce pas, par le chemin le plus court : position corrigée et normale du contact. */
export function pushOutAt(pos: Vec2, radius: number, box: Obstacle, step: number, tuning: Tuning): { pos: Vec2; n: Vec2 } {
  const ends = rotorEnds(box, step, tuning);
  if (!ends) return pushOut(pos, radius, obstacleAt(box, step, tuning));
  const near = nearestOnSegment(pos, ends.a, ends.b);
  let n = { x: pos.x - near.x, y: pos.y - near.y };
  const len = Math.hypot(n.x, n.y);
  if (len > 1e-9) n = { x: n.x / len, y: n.y / len };
  else {
    // Le centre est sur la barre : on sort perpendiculairement à elle.
    const turns = turnsOf(box, step, tuning);
    n = { x: -sinTurns(turns), y: cosTurns(turns) };
  }
  const depth = radius + ROTOR_THICKNESS / 2 - len;
  return { pos: { x: pos.x + n.x * (depth + 1e-3), y: pos.y + n.y * (depth + 1e-3) }, n };
}

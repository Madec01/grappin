import { cosTurns, sinTurns } from '../core/math/trig';
import type { Vec2 } from '../core/math/vec2';
import { pushOut } from './flight';
import { circleBoxGap } from './geometry';
import type { Obstacle, Rotor, Slide } from './state';
import type { Tuning } from './tuning';

/**
 * Les obstacles qui bougent (brief du 11 octobre 2026, lot 2) : la barre qui
 * tourne autour d'un pivot (« tournant », O2) et le panneau qui glisse (le mur
 * à ouverture mobile du lanceur, L3). Leur géométrie dépend du pas de
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
  return box.rotor !== undefined || box.slide !== undefined || box.closer !== undefined;
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

/** Les deux bouts de la barre d'un tournant à ce pas, ou null si l'obstacle n'en est pas un. */
export function rotorEnds(box: Obstacle, step: number, tuning: Tuning): { readonly a: Vec2; readonly b: Vec2 } | null {
  if (!box.rotor) return null;
  const turns = rotorTurns(box.rotor, step, tuning);
  const half = box.rotor.length / 2;
  const dx = cosTurns(turns) * half;
  const dy = sinTurns(turns) * half;
  const { pivot } = box.rotor;
  return { a: { x: pivot.x - dx, y: pivot.y - dy }, b: { x: pivot.x + dx, y: pivot.y + dy } };
}

/** Le décalage horizontal d'un panneau qui glisse à ce pas : un aller-retour en triangle, à vitesse constante, comme un câble. */
export function slideOffset(slide: Slide, step: number, tuning: Tuning): number {
  const periods = (step * tuning.stepSeconds) / slide.period + slide.phase;
  const k = periods - Math.floor(periods);
  return slide.amplitude * (k < 0.5 ? 4 * k - 1 : 3 - 4 * k);
}

/** L'obstacle là où il est à ce pas : un panneau décalé de son glissement ou de sa fermeture ; tout autre obstacle, lui-même. */
export function obstacleAt(box: Obstacle, step: number, tuning: Tuning): Obstacle {
  if (box.closer) {
    const dx = closerOffset(box, step, tuning);
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
    const turns = rotorTurns(box.rotor!, step, tuning);
    n = { x: -sinTurns(turns), y: cosTurns(turns) };
  }
  const depth = radius + ROTOR_THICKNESS / 2 - len;
  return { pos: { x: pos.x + n.x * (depth + 1e-3), y: pos.y + n.y * (depth + 1e-3) }, n };
}

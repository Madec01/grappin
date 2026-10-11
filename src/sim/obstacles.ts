import { isDoorClosed } from './cycles';
import type { Obstacle, ObstacleKind, SimState } from './state';
import type { Tuning } from './tuning';

/**
 * Ce qu'un obstacle est en ce moment, selon son espèce (`ObstacleKind`). Deux
 * points de vue : celui du personnage, pour qui une porte ouverte ou refermée
 * sur lui n'est pas solide, et celui du vérificateur, qui prouve un parcours
 * sans compter sur les portes (ouvertes une bonne part du temps, on les attend)
 * ni sur les parois déjà cassées, mais en tenant les surfaces de rebond et les
 * parois cassables pour solides : la preuve ne demande ni vitesse ni rebond.
 */

export function obstacleKind(box: Obstacle): ObstacleKind {
  return box.kind ?? 'solide';
}

/** Solide pour le personnage en ce moment : ni cassé, ni porte ouverte, ni porte refermée sur lui. */
export function isSolidNow(box: Obstacle, step: number, tuning: Tuning, doorsInside: readonly number[]): boolean {
  if (box.broken) return false;
  if (obstacleKind(box) !== 'porte') return true;
  return isDoorClosed(box.id, step, tuning) && !doorsInside.includes(box.id);
}

/** Les obstacles solides en ce moment : la visée, la ligne de vue et l'ombre les lisent. */
export function solidObstacles(state: Pick<SimState, 'obstacles' | 'step' | 'doorsInside'>, tuning: Tuning): Obstacle[] {
  return state.obstacles.filter((box) => isSolidNow(box, state.step, tuning, state.doorsInside));
}

/** Ce que le vérificateur tient pour solide : tout sauf les portes et les parois cassées. */
export function provableObstacles(obstacles: readonly Obstacle[]): Obstacle[] {
  return obstacles.filter((box) => !box.broken && obstacleKind(box) !== 'porte');
}

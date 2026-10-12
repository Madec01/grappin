import { isDoorClosed } from './cycles';
import { obstacleAt } from './moving';
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

/** Solide pour le personnage en ce moment : ni cassé, ni porte ouverte (par son cycle, ou par la prise interrupteur qui la commande), ni porte refermée sur lui. */
export function isSolidNow(box: Obstacle, step: number, tuning: Tuning, doorsInside: readonly number[]): boolean {
  if (box.broken) return false;
  if (obstacleKind(box) !== 'porte') return true;
  const closed = box.switchedBy !== undefined ? box.openUntilStep === undefined || step >= box.openUntilStep : isDoorClosed(box.id, step, tuning);
  return closed && !doorsInside.includes(box.id);
}

/**
 * Les obstacles solides en ce moment, là où ils sont à ce pas : la visée, la
 * ligne de vue et l'ombre les lisent. Un tournant n'en fait pas partie : il ne
 * barre jamais la visée, on l'évite au contact, le temps d'un passage.
 */
export function solidObstacles(state: Pick<SimState, 'obstacles' | 'step' | 'doorsInside'>, tuning: Tuning): Obstacle[] {
  return state.obstacles.filter((box) => isSolidNow(box, state.step, tuning, state.doorsInside) && obstacleKind(box) !== 'tournant').map((box) => obstacleAt(box, state.step, tuning));
}

/** Ce que le vérificateur tient pour solide : tout sauf les portes (à cycle ou commandées), les parois cassées, et ce qui bouge (tournants et panneaux à charnière, panneaux qui glissent ou se referment, surfaces d'une faille), que l'on attend, que l'on commande ou que l'on évite. */
export function provableObstacles(obstacles: readonly Obstacle[]): Obstacle[] {
  return obstacles.filter((box) => !box.broken && obstacleKind(box) !== 'porte' && obstacleKind(box) !== 'tournant' && box.slide === undefined && box.closer === undefined && box.rift === undefined && box.hinge === undefined);
}

import { distance, type Vec2 } from '../core/math/vec2';
import { STILL, type Environment } from './environment';
import { segmentCrossesBox } from './geometry';
import { freeFlightAt, type Body } from './physics';
import type { Anchor, Obstacle, SimState } from './state';
import type { Tuning } from './tuning';

/**
 * Choix du point d'accroche visé, surligné avant le tap.
 *
 * Règle : le point visé est celui qui se trouve le plus près de l'endroit où
 * le personnage sera dans un instant, en suivant sa trajectoire actuelle. Le
 * joueur choisit donc sa route par le moment où il lâche, jamais en visant au
 * doigt. Deux garde-fous rendent la sélection stable : une hystérésis, qui
 * exige qu'un nouveau point soit nettement meilleur pour remplacer le point
 * courant, et un coyote time, qui garde le point quelques centièmes de seconde
 * après qu'il est sorti de portée.
 */

export interface AimResult {
  readonly targetId: number | null;
  readonly targetValidStep: number;
}

/** Score d'un candidat : plus petit est meilleur. */
export function aimScore(anchor: Anchor, predicted: Vec2, heroY: number, tuning: Tuning): number {
  return distance(anchor.pos, predicted) - tuning.aimHeightBias * (anchor.pos.y - heroY);
}

/** Un point n'est visable que si le grappin peut l'atteindre en ligne droite, sans traverser d'obstacle. */
export function inSight(from: Vec2, anchor: Anchor, obstacles: readonly Obstacle[]): boolean {
  return !obstacles.some((box) => segmentCrossesBox(from, anchor.pos, box));
}

/** Point que viserait le personnage depuis une position et une vitesse données, hors hystérésis. */
export function bestAnchor(
  anchors: readonly Anchor[],
  obstacles: readonly Obstacle[],
  body: Body,
  grounded: boolean,
  excludeId: number | null,
  tuning: Tuning,
  env: Environment = STILL,
): Anchor | null {
  const predicted = freeFlightAt(body, grounded ? 0 : tuning.aimLookaheadSeconds, tuning, env);
  let best: Anchor | null = null;
  let bestScore = Infinity;
  for (const anchor of anchors) {
    if (anchor.broken || anchor.id === excludeId || distance(anchor.pos, body.pos) > tuning.ropeMax) continue;
    if (!inSight(body.pos, anchor, obstacles)) continue;
    const s = aimScore(anchor, predicted, body.pos.y, tuning);
    if (s < bestScore) {
      best = anchor;
      bestScore = s;
    }
  }
  return best;
}

export function chooseTarget(state: SimState, tuning: Tuning): AimResult {
  const { hero, step } = state;
  const coyoteSteps = Math.round(tuning.coyoteSeconds / tuning.stepSeconds);
  const excludeSteps = Math.round(0.4 / tuning.stepSeconds);
  // Le point que l'on vient de lâcher n'est pas repris tout de suite : on monte.
  const excluded = step - state.releaseStep < excludeSteps ? state.lastAnchorId : null;
  const best = bestAnchor(state.anchors, state.obstacles, hero, hero.grounded, excluded, tuning, state.env);

  if (best && state.targetId !== null && best.id !== state.targetId) {
    const current = state.anchors.find((a) => a.id === state.targetId);
    if (current && !current.broken && current.id !== excluded && distance(current.pos, hero.pos) <= tuning.ropeMax && inSight(hero.pos, current, state.obstacles)) {
      const predicted = freeFlightAt(hero, hero.grounded ? 0 : tuning.aimLookaheadSeconds, tuning, state.env);
      const bestScore = aimScore(best, predicted, hero.pos.y, tuning);
      const currentScore = aimScore(current, predicted, hero.pos.y, tuning);
      if (bestScore >= currentScore * tuning.aimHysteresis) return { targetId: current.id, targetValidStep: step };
    }
  }
  if (best) return { targetId: best.id, targetValidStep: step };
  // Plus aucun point à portée : coyote time sur le point courant, puis rien.
  if (state.targetId !== null && step - state.targetValidStep <= coyoteSteps) {
    return { targetId: state.targetId, targetValidStep: state.targetValidStep };
  }
  return { targetId: null, targetValidStep: step };
}

import { distance, type Vec2 } from '../core/math/vec2';
import { freeFlightAt } from './physics';
import type { Anchor, SimState } from './state';
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
function score(anchor: Anchor, predicted: Vec2, heroY: number, tuning: Tuning): number {
  return distance(anchor.pos, predicted) - tuning.aimHeightBias * (anchor.pos.y - heroY);
}

export function chooseTarget(state: SimState, tuning: Tuning): AimResult {
  const { hero, step } = state;
  const lookahead = hero.grounded ? 0 : tuning.aimLookaheadSeconds;
  const predicted = freeFlightAt(hero, lookahead, tuning);
  const coyoteSteps = Math.round(tuning.coyoteSeconds / tuning.stepSeconds);
  const excludeSteps = Math.round(0.4 / tuning.stepSeconds);

  let best: Anchor | null = null;
  let bestScore = Infinity;
  let current: Anchor | null = null;
  let currentScore = Infinity;
  for (const anchor of state.anchors) {
    if (distance(anchor.pos, hero.pos) > tuning.ropeMax) continue;
    // Le point que l'on vient de lâcher n'est pas repris tout de suite : on monte.
    if (anchor.id === state.lastAnchorId && step - state.releaseStep < excludeSteps) continue;
    const s = score(anchor, predicted, hero.pos.y, tuning);
    if (anchor.id === state.targetId) {
      current = anchor;
      currentScore = s;
    }
    if (s < bestScore) {
      best = anchor;
      bestScore = s;
    }
  }

  if (current && best && best.id !== current.id && bestScore >= currentScore * tuning.aimHysteresis) {
    return { targetId: current.id, targetValidStep: step };
  }
  if (best) return { targetId: best.id, targetValidStep: step };
  // Plus aucun point à portée : coyote time sur le point courant, puis rien.
  if (state.targetId !== null && step - state.targetValidStep <= coyoteSteps) {
    return { targetId: state.targetId, targetValidStep: state.targetValidStep };
  }
  return { targetId: null, targetValidStep: step };
}

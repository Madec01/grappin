import type { Vec2 } from '../core/math/vec2';
import { freeFlightAt } from '../sim/physics';
import { releaseVelocity } from '../sim/rules';
import type { Anchor, SimState } from '../sim/state';
import type { Tuning } from '../sim/tuning';

/**
 * Repères visuels calculés à partir de l'état : l'ombre prédictive et l'usure
 * d'une accroche fragile. Fonctions pures, sans PixiJS ni temps réel : le
 * rendu les lit, il ne les décide pas.
 */

/** Nombre de points de l'ombre prédictive. */
export const SHADOW_POINTS = 6;

/** Point auquel la corde est accrochée en ce moment, ou undefined sans corde. */
function heldAnchor(state: SimState): Anchor | undefined {
  const rope = state.rope;
  return rope ? state.anchors.find((anchor) => anchor.id === rope.anchorId) : undefined;
}

/**
 * Ombre prédictive : positions, en mètres, où irait le personnage s'il lâchait
 * maintenant, de plus en plus loin jusqu'à `shadowSeconds` de vol libre. Vide
 * sans corde. La vitesse vient de la règle du lâcher elle-même, propulseur
 * compris : l'ombre dit vrai.
 */
export function shadowPoints(state: SimState, tuning: Tuning): Vec2[] {
  if (!state.rope) return [];
  const body = { pos: state.hero.pos, vel: releaseVelocity(state, tuning) };
  const points: Vec2[] = [];
  for (let i = 1; i <= SHADOW_POINTS; i += 1) {
    points.push(freeFlightAt(body, (tuning.shadowSeconds * i) / SHADOW_POINTS, tuning));
  }
  return points;
}

/** Usure de l'accroche fragile en main : sa position et la part de tenue écoulée, de 0 (saisie) à 1 (elle casse). */
export interface FragileGauge {
  readonly pos: Vec2;
  readonly wear: number;
}

/**
 * Jauge de l'accroche fragile tenue, ou null si la corde est lâchée ou si le
 * point tenu n'est pas fragile. Calculée en pas de simulation, comme la casse
 * elle-même : la jauge arrive à 1 exactement au moment du « Crac ».
 */
export function fragileGauge(state: SimState, tuning: Tuning): FragileGauge | null {
  const anchor = heldAnchor(state);
  if (anchor?.kind !== 'fragile') return null;
  const held = (state.step - state.attachStep) * tuning.stepSeconds;
  return { pos: anchor.pos, wear: held >= tuning.fragileSeconds ? 1 : held / tuning.fragileSeconds };
}

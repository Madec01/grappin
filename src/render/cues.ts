import type { Vec2 } from '../core/math/vec2';
import { isLit } from '../sim/cycles';
import { freeFlightAt } from '../sim/physics';
import { lightIsOff } from '../sim/events';
import { releaseVelocity } from '../sim/rules';
import type { Anchor, AnchorKind, SimState } from '../sim/state';
import type { Tuning } from '../sim/tuning';

/**
 * Repères visuels calculés à partir de l'état : l'ombre prédictive, l'usure
 * d'une accroche fragile, les lampadaires éteints par la panne, les tubes
 * éteints (panne ou éclipse) et le côté du vent. Fonctions pures, sans PixiJS ni temps réel : le rendu les lit, il ne
 * les décide pas.
 */

/** Nombre de points de l'ombre prédictive. */
export const SHADOW_POINTS = 6;

/** Point auquel la corde est accrochée en ce moment, ou undefined sans corde. */
function heldAnchor(state: SimState): Anchor | undefined {
  const rope = state.rope;
  return rope ? state.anchors.find((anchor) => anchor.id === rope.anchorId) : undefined;
}

/** Espèce du point tenu en ce moment, ou null sans corde : « lanceur » dit au jeu de lire la traction du doigt. */
export function heldKind(state: SimState): AnchorKind | null {
  return heldAnchor(state)?.kind ?? null;
}

/**
 * Ombre prédictive : positions, en mètres, où irait le personnage s'il lâchait
 * maintenant, de plus en plus loin jusqu'à `seconds` de vol libre (par défaut
 * `shadowSeconds`). Vide sans corde. La vitesse vient de la règle du lâcher
 * elle-même, propulseur et lanceur compris : l'ombre dit vrai.
 */
export function shadowPoints(state: SimState, tuning: Tuning, seconds: number = tuning.shadowSeconds): Vec2[] {
  if (!state.rope) return [];
  const body = { pos: state.hero.pos, vel: releaseVelocity(state, tuning) };
  const points: Vec2[] = [];
  for (let i = 1; i <= SHADOW_POINTS; i += 1) {
    points.push(freeFlightAt(body, (seconds * i) / SHADOW_POINTS, tuning, state.env));
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

/** Vrai si le lampadaire de l'accroche `anchorId` est éteint en ce moment : la panne est en cours et sa vague le tient dans le noir. */
export function isDark(state: SimState, anchorId: number, tuning: Tuning): boolean {
  return state.lightsOff && lightIsOff(anchorId, state.step, tuning);
}

/**
 * Le tube de cette accroche est-il éteint en ce moment ? Un lampadaire que la
 * panne tient dans le noir, ou une prise à éclipse hors de son cycle : le rendu
 * n'en laisse que la trace sombre d'un néon coupé. Éteint ne veut pas dire
 * inaccrochable : la panne laisse le point accrochable, seule l'éclipse le refuse.
 */
export function isOff(state: SimState, anchor: Anchor, tuning: Tuning): boolean {
  return isDark(state, anchor.id, tuning) || (anchor.kind === 'eclipse' && !isLit(anchor.id, state.step, tuning));
}

/**
 * Côté vers lequel souffle le dernier coup de vent commencé, -1 vers la gauche
 * et 1 vers la droite. Lu dans le calendrier du niveau et non dans
 * `state.env.wind`, qui part de zéro et ne dit rien au premier pas.
 */
export function windSide(state: SimState): -1 | 1 {
  let side: -1 | 1 = 1;
  let latest = -1;
  state.schedule.forEach((event, index) => {
    const started = state.eventRuntimes[index]?.startStep ?? null;
    if (event.kind !== 'vent' || started === null || started < latest) return;
    latest = started;
    side = event.side ?? 1;
  });
  return side;
}

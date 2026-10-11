import type { Vec2 } from '../core/math/vec2';
import { launchSet, launchVelocity, pulledPosition } from './launcher';
import type { Anchor, SimState } from './state';
import type { Tuning } from './tuning';
import { circleBoxGap } from './geometry';
import { provableObstacles } from './obstacles';
import { flightCatches } from './verifier';

/**
 * Ce qu'un pilote automatique (le robot de `robot.ts`, les pilotes des tests
 * de bout en bout et du banc de captures) doit savoir viser depuis un lanceur.
 *
 * Le mur à trou d'un lanceur est décalé : il faut choisir un angle, et parfois
 * une force. Plutôt que de viser le point le plus proche au jugé, le pilote
 * essaie les mêmes tractions que le vérificateur (trente-trois directions,
 * quatre forces) et garde la première dont le vol attrape un point au-dessus du
 * lanceur, en préférant les points les plus hauts. C'est exactement ce que le
 * vérificateur a prouvé possible : un pilote qui vise ainsi passe partout où
 * le parcours est accepté. Déterministe, sans trigonométrie (l'éventail est
 * tabulé dans `launcher.ts`).
 */

/** La traction (mètres de monde, le doigt tiré à l'opposé du vol) qui lance vers un point au-dessus du lanceur tenu, ou null sans lanceur tenu ni sortie trouvée. */
export function bestLaunch(state: SimState, tuning: Tuning): Vec2 | null {
  if (!state.rope) return null;
  const launcher = state.anchors.find((a) => a.id === state.rope?.anchorId);
  if (!launcher || launcher.kind !== 'lanceur') return null;
  const candidates = state.anchors.filter((a) => a.id !== launcher.id && !a.broken && a.pos.y > launcher.pos.y + 1);
  if (candidates.length === 0) return null;
  const byId = new Map<number, Anchor>(candidates.map((a) => [a.id, a]));
  let best: { pull: Vec2; height: number } | null = null;
  // Les mêmes obstacles que le vérificateur : les portes ne comptent pas, le tir prouvé passe quand elles sont ouvertes.
  const obstacles = provableObstacles(state.obstacles);
  for (const pull of launchSet(state.env)) {
    const pos = pulledPosition(launcher.pos, pull);
    if (obstacles.some((box) => circleBoxGap(pos, tuning.heroRadius, box) <= 0)) continue;
    const caught = flightCatches(launcher, { pos, vel: launchVelocity(pull, state.env) }, candidates, obstacles, tuning, state.env, state.zones, state.rings);
    for (const id of caught) {
      const height = byId.get(id)?.pos.y ?? -Infinity;
      if (!best || height > best.height) best = { pull, height };
    }
  }
  return best?.pull ?? null;
}

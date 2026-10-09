import { createRng } from '../core/math/rng';
import { buildPlainSegment, buildSegment, tierProfile, type IdCounters, type Segment } from './generator';
import type { SimState } from './state';
import type { Tuning } from './tuning';
import { verifySegment } from './verifier';

/**
 * Parcours engendré par segments à mesure que l'on monte. Chaque segment est
 * proposé par le générateur puis joué par le robot vérificateur ; refusé, il
 * est régénéré, et après plusieurs refus un segment de repli serré prend sa
 * place. L'état du générateur vit dans `SimState.course` pour qu'un clone
 * poursuive la même suite.
 */

export interface CourseState {
  readonly seed: number;
  rngState: number;
  /** Position du dernier point engendré, sommet du parcours connu. */
  lastX: number;
  lastY: number;
  ids: IdCounters;
  /** Segments acceptés, dont ceux de repli et, en dernier recours, ceux acceptés sans preuve. */
  segments: number;
  fallbacks: number;
  unverified: number;
}

/** Tentatives de génération avant les segments de repli, puis tentatives de repli. */
const MAX_ATTEMPTS = 6;
const MAX_FALLBACK_ATTEMPTS = 4;
/** Points et obstacles du parcours accepté gardés comme contexte de vérification. */
const CONTEXT_ANCHORS = 4;
/** Les éléments passés sous la brume de plus de cette distance sont retirés. */
const PRUNE_BEHIND = 10;

export function createCourse(seed: number): CourseState {
  return { seed, rngState: createRng(seed).getState(), lastX: 0, lastY: 0, ids: { anchor: 1, obstacle: 1, pickup: 1 }, segments: 0, fallbacks: 0, unverified: 0 };
}

/** Ajoute des segments tant que le sommet est sous `untilY`. Modifie l'état en place. */
export function extendCourse(state: SimState, untilY: number, tuning: Tuning): void {
  const course = state.course;
  const rng = createRng(course.seed);
  rng.setState(course.rngState);
  while (course.lastY < untilY) {
    const from = state.anchors.at(-1)?.pos ?? null;
    const tier = Math.floor(course.lastY / tuning.tierHeight);
    const context = state.anchors.slice(-CONTEXT_ANCHORS);
    const contextObstacles = state.obstacles.filter((o) => o.y1 >= course.lastY - 8);
    let accepted: Segment | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !accepted; attempt += 1) {
      const candidate = buildSegment(rng, course.ids, from, tierProfile(tier));
      if (verifySegment(context, contextObstacles, candidate, tuning)) accepted = candidate;
    }
    if (!accepted) {
      // Repli : une chaîne serrée sans rien d'autre, vérifiée elle aussi. Si même cela échoue, on
      // accepte la dernière proposition et on le compte : les tests exigent que cela n'arrive jamais.
      course.fallbacks += 1;
      let plain: Segment | null = null;
      for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS && !accepted; attempt += 1) {
        plain = buildPlainSegment(rng, course.ids, from);
        if (verifySegment(context, contextObstacles, plain, tuning)) accepted = plain;
      }
      if (!accepted) {
        accepted = plain!;
        course.unverified += 1;
      }
    }
    state.anchors.push(...accepted.anchors);
    state.obstacles.push(...accepted.obstacles);
    state.pickups.push(...accepted.pickups);
    const top = accepted.anchors.at(-1)!;
    course.lastX = top.pos.x;
    course.lastY = top.pos.y;
    course.segments += 1;
  }
  course.rngState = rng.getState();
}

/** Retire ce qui est passé loin sous la brume, pour garder les listes courtes. */
export function pruneCourse(state: SimState, fogY: number): void {
  const belowY = fogY - PRUNE_BEHIND;
  if (state.anchors.length > 0 && state.anchors[0]!.pos.y < belowY) {
    state.anchors = state.anchors.filter((a) => a.pos.y >= belowY || a.id === state.rope?.anchorId);
  }
  if (state.obstacles.length > 0 && state.obstacles[0]!.y1 < belowY) state.obstacles = state.obstacles.filter((o) => o.y1 >= belowY);
  if (state.pickups.length > 0 && state.pickups[0]!.pos.y < belowY) state.pickups = state.pickups.filter((p) => p.pos.y >= belowY);
}

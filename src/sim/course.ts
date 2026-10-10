import { createRng } from '../core/math/rng';
import { buildPlainSegment, buildSegment, tierProfile, type IdCounters, type Segment, type TierProfile } from './generator';
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

/**
 * Ce que le parcours doit être : une course libre qui monte sans fin depuis
 * `startY`, avec le profil du palier, ou un niveau fixe de `startY` à `endY`
 * avec son propre profil.
 */
export type CoursePlan =
  | { readonly kind: 'infinite'; readonly startY: number }
  | { readonly kind: 'level'; readonly levelId: number; readonly startY: number; readonly endY: number; readonly profile: TierProfile };

export const FREE_RUN: CoursePlan = { kind: 'infinite', startY: 0 };

export interface CourseState {
  readonly seed: number;
  readonly plan: CoursePlan;
  rngState: number;
  /** Étoiles engendrées depuis le début, prises ou non : sert aux étoiles d'un niveau. */
  pickupsTotal: number;
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
/** Un niveau est engendré jusqu'à cette hauteur au-dessus de sa ligne d'arrivée, pour le dernier balancement. */
const BEYOND_FINISH = 6;

export function createCourse(seed: number, plan: CoursePlan): CourseState {
  return {
    seed,
    plan,
    rngState: createRng(seed).getState(),
    pickupsTotal: 0,
    lastX: 0,
    lastY: plan.startY,
    ids: { anchor: 1, obstacle: 1, pickup: 1 },
    segments: 0,
    fallbacks: 0,
    unverified: 0,
  };
}

/** Ajoute des segments tant que le sommet est sous `untilY`. Modifie l'état en place. */
export function extendCourse(state: SimState, untilY: number, tuning: Tuning): void {
  const course = state.course;
  const rng = createRng(course.seed);
  rng.setState(course.rngState);
  const origin = { x: 0, y: course.plan.startY };
  // Un niveau s'arrête un peu au-dessus de sa ligne d'arrivée ; la course libre ne s'arrête jamais.
  const limit = course.plan.kind === 'level' ? Math.min(untilY, course.plan.endY + BEYOND_FINISH) : untilY;
  while (course.lastY < limit) {
    const from = state.anchors.at(-1)?.pos ?? null;
    const profile = course.plan.kind === 'level' ? course.plan.profile : tierProfile(Math.floor(course.lastY / tuning.tierHeight));
    const context = state.anchors.slice(-CONTEXT_ANCHORS);
    const contextObstacles = state.obstacles.filter((o) => o.y1 >= course.lastY - 8);
    let accepted: Segment | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !accepted; attempt += 1) {
      const candidate = buildSegment(rng, course.ids, from, origin, profile, rng.pick(profile.archetypes));
      if (verifySegment(context, contextObstacles, candidate, tuning)) accepted = candidate;
    }
    if (!accepted) {
      // Repli : une chaîne serrée sans rien d'autre, vérifiée elle aussi. Si même cela échoue, on
      // accepte la dernière proposition et on le compte : les tests exigent que cela n'arrive jamais.
      course.fallbacks += 1;
      let plain: Segment | null = null;
      for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS && !accepted; attempt += 1) {
        plain = buildPlainSegment(rng, course.ids, from, origin);
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
    course.pickupsTotal += accepted.pickups.length;
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

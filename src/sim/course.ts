import { createRng, type Rng } from '../core/math/rng';
import type { Vec2 } from '../core/math/vec2';
import { environmentOf, eventsAt, type EventKind, type ScheduledEvent } from './events';
import { buildPlainSegment, buildSegment, tierProfile, type IdCounters, type Segment, type SegmentContext, type TierProfile } from './generator';
import type { Anchor, Obstacle, SimState } from './state';
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
  | {
      readonly kind: 'level';
      readonly levelId: number;
      readonly startY: number;
      readonly endY: number;
      readonly profile: TierProfile;
      /** Événements du niveau, à des hauteurs fixes au-dessus de son départ. */
      readonly events: readonly ScheduledEvent[];
    };

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
/**
 * Course libre : chance qu'un segment porte un événement, et événements permis
 * par palier. Décision du propriétaire : les six dès que la zone d'apprentissage
 * du palier 0 est passée, pour que la grimpe sans fin ait toutes les nouveautés.
 */
const FREE_EVENT_CHANCE = 0.5;
const FREE_EVENT_KINDS: readonly EventKind[] = ['bascule', 'vent', 'panne', 'pluie', 'alerte', 'cable', 'traversiere'];
function freeEventsFor(tier: number): readonly EventKind[] {
  return tier >= 1 ? FREE_EVENT_KINDS : [];
}

/** Longueur d'un événement de course libre : un segment, puisque les segments s'arrêtent à ses bords. */
const FREE_EVENT_LENGTH = 20;

/**
 * Course libre : tire éventuellement un événement qui commence deux mètres
 * au-dessus du segment qui débute à `segmentY`, pendant le premier vol.
 */
function scheduleFreeEvent(state: SimState, rng: Rng, tier: number, segmentY: number): void {
  const kinds = freeEventsFor(tier);
  if (kinds.length === 0 || rng.next() >= FREE_EVENT_CHANCE) return;
  // Jamais deux événements qui se chevauchent : le précédent doit être fini avant ce segment. Et jamais deux fois le même de suite.
  const last = state.schedule.at(-1);
  if (last && state.groundY + last.at + last.length + 6 > segmentY) return;
  const kind = rng.pick(kinds.filter((k) => k !== last?.kind));
  const side: -1 | 1 = rng.next() < 0.5 ? -1 : 1;
  state.schedule.push({ kind, at: segmentY - state.groundY + 2, length: FREE_EVENT_LENGTH, side, strength: 3 });
  state.eventRuntimes.push({ startStep: null, endStep: null });
}

/**
 * Les conditions d'un segment sont celles en vigueur trois mètres au-dessus de
 * son point d'entrée, et aucun de ses points ne dépasse la frontière suivante :
 * ainsi chaque segment est engendré et prouvé entièrement dans un seul jeu de
 * conditions, et l'on en change pendant le vol qui quitte un point d'entrée.
 */
const LOOKAHEAD = 3;
function segmentContext(state: SimState, segmentY: number): SegmentContext {
  const referenceY = segmentY + LOOKAHEAD;
  const active = eventsAt(state.schedule, state.groundY, referenceY);
  const boundaries = state.schedule.flatMap((e) => [state.groundY + e.at, state.groundY + e.at + e.length]).filter((b) => b > referenceY);
  return {
    env: environmentOf(active),
    entryEnv: environmentOf(eventsAt(state.schedule, state.groundY, segmentY)),
    cable: active.some((e) => e.kind === 'traversiere') ? 'traversiere' : active.some((e) => e.kind === 'cable') ? 'cable' : 'none',
    maxY: boundaries.length > 0 ? Math.min(...boundaries) - 1 : Infinity,
  };
}

/**
 * Vérifie un segment ; s'il porte des points qui glissent, les prouve à chaque
 * bout de leur course et au milieu. Un câble court doit passer dans les trois
 * positions : on l'attrape où il est. Une traversière balaie toute la largeur,
 * on peut l'attendre en pendant au point d'avant : il suffit qu'une des trois
 * positions fasse passer le segment.
 */
function verifyWithCables(context: readonly Anchor[], contextObstacles: readonly Obstacle[], segment: Segment, tuning: Tuning, conditions: SegmentContext): boolean {
  const { env, entryEnv } = conditions;
  if (!segment.anchors.some((a) => a.cable)) return verifySegment(context, contextObstacles, segment, tuning, env, entryEnv);
  const placements: ((a: Anchor) => Vec2)[] = [(a) => a.cable!.from, (a) => a.pos, (a) => a.cable!.to];
  const passes = (place: (a: Anchor) => Vec2): boolean => {
    const anchors = segment.anchors.map((a) => (a.cable ? { ...a, pos: place(a) } : a));
    return verifySegment(context, contextObstacles, { ...segment, anchors }, tuning, env, entryEnv);
  };
  return conditions.cable === 'traversiere' ? placements.some(passes) : placements.every(passes);
}

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
    const tier = Math.floor(course.lastY / tuning.tierHeight);
    const profile = course.plan.kind === 'level' ? course.plan.profile : tierProfile(tier);
    if (course.plan.kind === 'infinite') scheduleFreeEvent(state, rng, tier, course.lastY);
    const conditions = segmentContext(state, course.lastY);
    const context = state.anchors.slice(-CONTEXT_ANCHORS);
    const contextObstacles = state.obstacles.filter((o) => o.y1 >= course.lastY - 8);
    let accepted: Segment | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !accepted; attempt += 1) {
      const candidate = buildSegment(rng, course.ids, from, origin, profile, rng.pick(profile.archetypes), conditions);
      if (verifyWithCables(context, contextObstacles, candidate, tuning, conditions)) accepted = candidate;
    }
    if (!accepted) {
      // Repli : une chaîne serrée sans rien d'autre, vérifiée elle aussi. Si même cela échoue, on
      // accepte la dernière proposition et on le compte : les tests exigent que cela n'arrive jamais.
      course.fallbacks += 1;
      let plain: Segment | null = null;
      for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS && !accepted; attempt += 1) {
        plain = buildPlainSegment(rng, course.ids, from, origin, conditions);
        if (verifySegment(context, contextObstacles, plain, tuning, conditions.env, conditions.entryEnv)) accepted = plain;
      }
      if (!accepted) {
        accepted = plain!;
        course.unverified += 1;
      }
    }
    state.anchors.push(...accepted.anchors);
    state.obstacles.push(...accepted.obstacles);
    // Dans un niveau, franchir la ligne d'arrivée gagne aussitôt : une étoile au-dessus serait impossible à prendre, et l'étoile « toutes les étoiles » avec elle.
    const pickups = course.plan.kind === 'level' ? accepted.pickups.filter((pickup) => pickup.pos.y < course.plan.endY) : accepted.pickups;
    state.pickups.push(...pickups);
    course.pickupsTotal += pickups.length;
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

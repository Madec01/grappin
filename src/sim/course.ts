import { createRng } from '../core/math/rng';
import type { Anchor, SimState } from './state';

/**
 * Parcours d'essai de la phase 1 : une colonne de points d'accroche dont
 * l'espacement grandit avec la hauteur, tirée d'une graine.
 *
 * Ce parcours n'est pas vérifié : il sert à régler le pendule. Le générateur
 * par segments vérifié par un robot arrive en phase 2. L'état du générateur
 * vit dans `SimState.course` pour qu'un clone poursuive la même suite.
 */

export interface CourseState {
  readonly seed: number;
  rngState: number;
  /** Position du dernier point engendré. */
  lastX: number;
  lastY: number;
  nextId: number;
}

/** Largeur jouable : les points restent entre -limit et +limit. */
export const COURSE_HALF_WIDTH = 4;

export function createCourse(seed: number): CourseState {
  return { seed, rngState: createRng(seed).getState(), lastX: 0, lastY: 0, nextId: 1 };
}

/** Espacement nominal entre deux points à une hauteur donnée. */
export function spacingAt(height: number): number {
  return 3 + Math.min(1.5, height / 40);
}

/** Ajoute des points tant que le dernier est sous `untilY`. Modifie l'état en place. */
export function extendCourse(state: SimState, untilY: number): void {
  const course = state.course;
  const rng = createRng(course.seed);
  rng.setState(course.rngState);
  while (course.lastY < untilY) {
    let x: number;
    let y: number;
    if (course.nextId === 1) {
      x = 0.8;
      y = 4;
    } else {
      const s = spacingAt(course.lastY);
      const dy = s * (0.55 + 0.35 * rng.next());
      // On alterne les côtés ; si le pas sort de la largeur, on repart de l'autre côté, puis on borne.
      const side = course.lastX > 0 ? -1 : 1;
      const dx = side * s * (0.4 + 0.6 * rng.next());
      x = course.lastX + dx;
      if (x > COURSE_HALF_WIDTH || x < -COURSE_HALF_WIDTH) x = course.lastX - dx;
      x = Math.max(-COURSE_HALF_WIDTH, Math.min(COURSE_HALF_WIDTH, x));
      y = course.lastY + dy;
    }
    const anchor: Anchor = { id: course.nextId, pos: { x, y }, kind: 'normal' };
    state.anchors.push(anchor);
    course.nextId += 1;
    course.lastX = x;
    course.lastY = y;
  }
  course.rngState = rng.getState();
}

/** Retire les points passés sous la brume depuis longtemps, pour garder la liste courte. */
export function pruneCourse(state: SimState, belowY: number): void {
  if (state.anchors.length === 0 || state.anchors[0]!.pos.y >= belowY) return;
  state.anchors = state.anchors.filter((a) => a.pos.y >= belowY || a.id === state.rope?.anchorId);
}

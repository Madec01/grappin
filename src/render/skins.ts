import { doorGauge, doorState } from '../sim/cycles';
import { RING_CENTRE_RATIO } from '../sim/rules';
import type { Obstacle, Ring, SimState } from '../sim/state';
import type { Tuning } from '../sim/tuning';
import { noise } from './effects';
import { mixColor } from './sling';
import { COLOR } from './style';

/**
 * Habillages des obstacles à comportement (surface de rebond, paroi cassable,
 * porte) et des anneaux de précision : ce qui, dans leur dessin, se calcule de
 * l'état sans PixiJS ni temps réel. Le rendu (`renderer.ts`) pose les formes,
 * ce fichier dit quoi poser et dans quel état.
 *
 * Règle : tout se lit de l'état de la simulation, jamais de l'horloge de
 * l'écran. Une porte se lit de `state.step` (cycle, jauge, clignotement), une
 * paroi cassable de la vitesse du personnage, un anneau de sa traversée en
 * cours : une même image se redessine toujours pareille, ce qui rend les
 * captures reproductibles. Les motifs (fissures) viennent du numéro de
 * l'obstacle, par un bruit déterministe.
 */

/**
 * Teintes dérivées des couleurs d'espèce : la masse d'un obstacle à comportement reste sombre comme celle d'un obstacle solide, mais
 * prend un soupçon de sa teinte, pour que même sans le contour on sente à quelle famille elle appartient.
 */
export const SKIN = {
  /** Masse d'une surface de rebond. */
  bounceBody: mixColor(COLOR.obstacle, COLOR.bounce, 0.12),
  /** Masse d'une paroi cassable : sombre, et un cran plus chaude quand le personnage va assez vite pour la traverser. */
  smashBody: mixColor(COLOR.obstacle, COLOR.smash, 0.08),
  smashBodyLit: mixColor(COLOR.obstacle, COLOR.smash, 0.22),
  /** Fissures d'une paroi cassable : une braise éteinte, puis la braise rougie à blanc quand la paroi est prête à céder. */
  crackDim: mixColor(COLOR.smash, COLOR.obstacle, 0.25),
  crackHot: mixColor(COLOR.smash, COLOR.white, 0.62),
  /** Masse d'une porte fermée, et le pâle de son contour tireté quand elle est ouverte et de sa jauge quand elle est fermée. */
  doorBody: mixColor(COLOR.obstacle, COLOR.door, 0.3),
  doorPale: mixColor(COLOR.door, COLOR.white, 0.45),
  /** Anneau traversé en cours : le cœur s'éclaircit vers le blanc. */
  ringHot: mixColor(COLOR.ring, COLOR.white, 0.55),
} as const;

/** Le cycle d'une onde de pas : de 0 à 1, `hz` fois par seconde de simulation (jamais de temps réel). */
export function stepWave(step: number, stepSeconds: number, hz: number): number {
  return 0.5 + 0.5 * Math.sin(2 * Math.PI * hz * step * stepSeconds);
}

/** Une porte qui avertit clignote à ce rythme (Hz, sur le temps de la simulation) : assez vif pour se voir, assez lent pour ne pas fatiguer. */
export const DOOR_BLINK_HZ = 3;

/**
 * Où en est une porte, du point de vue du dessin : ouverte (contour tireté pâle, la masse se remplit),
 * qui avertit (contour qui s'allume et clignote, la masse presque pleine), fermée (masse pleine), ou
 * fermée mais laissant passer le personnage qu'elle a surpris à l'intérieur (masse fantôme).
 */
export type DoorPhase = 'ouverte' | 'avertit' | 'fermee' | 'passage';

export interface DoorLook {
  readonly phase: DoorPhase;
  /** Jauge de 0 à 1 de la phase courante (voir `doorGauge`) : la part de la phase déjà écoulée. */
  readonly gauge: number;
  /** Clignotement de 0 à 1, calé sur le pas de simulation ; 1 hors avertissement (le contour est alors franc). */
  readonly beat: number;
}

/** Ce qu'il faut dessiner d'une porte à ce pas ; `inside` : le personnage s'y trouve (voir `SimState.doorsInside`). */
export function doorLook(box: Pick<Obstacle, 'id'>, state: Pick<SimState, 'step' | 'doorsInside'>, tuning: Tuning): DoorLook {
  const gauge = doorGauge(box.id, state.step, tuning);
  const cycle = doorState(box.id, state.step, tuning);
  if (cycle === 'ouverte') return { phase: 'ouverte', gauge, beat: 1 };
  if (cycle === 'se ferme') return { phase: 'avertit', gauge, beat: stepWave(state.step, tuning.stepSeconds, DOOR_BLINK_HZ) };
  return { phase: state.doorsInside.includes(box.id) ? 'passage' : 'fermee', gauge, beat: 1 };
}

/** Où en est un anneau : libre, en cours de traversée (loin du centre, ou déjà passé près du centre) ou traversé. */
export type RingPhase = 'libre' | 'traverse' | 'centre' | 'prise';

/** L'état d'un anneau du point de vue du dessin : `closest` dit que le personnage est dans le disque, et jusqu'où il s'est approché du centre. */
export function ringPhase(ring: Pick<Ring, 'taken' | 'closest' | 'radius'>): RingPhase {
  if (ring.taken) return 'prise';
  if (ring.closest === null) return 'libre';
  return ring.closest <= ring.radius * RING_CENTRE_RATIO ? 'centre' : 'traverse';
}

/**
 * Fissures d'une paroi cassable : des lignes brisées dans le repère de la
 * paroi, `u` le long de sa plus grande dimension et `v` en travers, de 0 à 1 chacun, à plat
 * (u, v, u, v...). En fractions et non en pixels : le motif ne change pas avec le zoom, il
 * se pose sur le rectangle une fois converti.
 */
export type Crack = readonly number[];

/** Une fissure par tranche de cette longueur (mètres) de la paroi, au moins une : une paroi plus longue a plus de fissures, pas de plus grandes. */
export const CRACK_SPACING = 0.9;
/** Les quatre niveaux, en travers, par où passe la fissure principale (de 0 à 1) : elle traverse la paroi de bord à bord. */
const CRACK_LEVELS: readonly number[] = [0, 0.38, 0.64, 1];
/** Écart latéral maximal d'un sommet de la fissure à l'axe de sa tranche, en part de la tranche. */
const CRACK_WANDER = 0.42;
/** Branche latérale qui part du milieu de la fissure : sa portée le long de la paroi (part de la tranche) et sa montée en travers. */
const BRANCH_REACH = 0.34;
const BRANCH_RISE = 0.3;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Le motif de fissures de la paroi numéro `id` et de longueur `longLength`
 * (mètres) : une fissure en éclair par tranche, avec une branche qui en part. Le
 * même motif à chaque appel, d'après le numéro seul.
 */
export function crackPattern(id: number, longLength: number): Crack[] {
  const count = Math.max(1, Math.round(longLength / CRACK_SPACING));
  const cracks: Crack[] = [];
  for (let slice = 0; slice < count; slice += 1) {
    const seed = id * 977 + slice * 61;
    const centre = (slice + 0.5 + (noise(seed) - 0.5) * 0.3) / count;
    const points: number[] = [];
    let middle = { u: centre, v: 0.5 };
    CRACK_LEVELS.forEach((v, index) => {
      const u = clamp01(centre + (noise(seed + 7 + index) - 0.5) * 2 * (CRACK_WANDER / count));
      points.push(u, v);
      if (index === 1) middle = { u, v };
    });
    cracks.push(points);
    // Une branche, d'un côté ou de l'autre, qui part du coude et monte ou descend un peu.
    const side = noise(seed + 31) < 0.5 ? -1 : 1;
    const up = noise(seed + 43) < 0.5 ? -1 : 1;
    cracks.push([middle.u, middle.v, clamp01(middle.u + (side * BRANCH_REACH) / count), clamp01(middle.v + up * BRANCH_RISE)]);
  }
  return cracks;
}

/** Les dents du ressort d'une surface de rebond : une par tranche de cette longueur en pixels, deux au moins. */
const SPRING_PERIOD = 15;

export function springTeeth(lengthPixels: number): number {
  return Math.max(2, Math.round(lengthPixels / SPRING_PERIOD));
}

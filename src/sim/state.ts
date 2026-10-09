import type { Vec2 } from '../core/math/vec2';
import type { CourseState } from './course';

/**
 * État complet de la simulation, en données simples.
 *
 * Pas de classe ni de méthode : l'état se clone par copie profonde et se
 * sérialise de façon stable, ce qui rend les rejeux, les tests et le futur
 * vérificateur de parcours possibles.
 */

export type AnchorKind = 'normal';

export interface Anchor {
  readonly id: number;
  readonly pos: Vec2;
  readonly kind: AnchorKind;
}

export interface Rope {
  /** Identifiant du point accroché. */
  readonly anchorId: number;
  /** Longueur de corde : fixée au moment du tap, puis raccourcie par le treuil jusqu'à `ropeMin`. */
  length: number;
}

export interface Hero {
  pos: Vec2;
  vel: Vec2;
  /** Vrai tant que le personnage est posé sur le toit de départ. */
  grounded: boolean;
}

export type Status = 'alive' | 'dead';

/** Événements de règles émis pendant un pas, consommés par le rendu et le son. */
export type RuleEvent =
  | { readonly type: 'attach'; readonly anchorId: number }
  | { readonly type: 'release'; readonly perfect: boolean; readonly combo: number }
  | { readonly type: 'kick' }
  | { readonly type: 'death'; readonly height: number };

export interface SimState {
  /** Numéro du pas courant. */
  step: number;
  hero: Hero;
  rope: Rope | null;
  anchors: Anchor[];
  /** Point visé, surligné avant le tap, ou null si aucun point n'est à portée. */
  targetId: number | null;
  /** Dernier pas où le point visé était réellement à portée, pour le coyote time. */
  targetValidStep: number;
  /** Pas de l'appui reçu sans accroche possible et encore en mémoire, ou -1. */
  pressStep: number;
  /** Dernier point lâché et pas du lâcher : on ne le reprend pas tout de suite. */
  lastAnchorId: number | null;
  releaseStep: number;
  /** Nombre de pas consécutifs passés pendu sous la vitesse minimale. */
  hangSteps: number;
  /** État du générateur de parcours, cloné avec le reste. */
  course: CourseState;
  /** Niveau de la brume, en mètres. */
  fogY: number;
  /** Hauteur maximale atteinte, en mètres. */
  height: number;
  score: number;
  combo: number;
  status: Status;
  /** Journal des gestes : pas et nature, pour rejouer une partie. */
  inputs: { readonly step: number; readonly kind: 'press' | 'release' }[];
}

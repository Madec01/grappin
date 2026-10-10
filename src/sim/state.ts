import type { Vec2 } from '../core/math/vec2';
import type { CourseState } from './course';
import type { Environment } from './environment';
import type { EventKind, EventRuntime, ScheduledEvent } from './events';

/**
 * État complet de la simulation, en données simples.
 *
 * Pas de classe ni de méthode : l'état se clone par copie profonde et se
 * sérialise de façon stable, ce qui rend les rejeux, les tests et le futur
 * vérificateur de parcours possibles.
 */

/** Normal ; fragile, casse après une seconde de tenue ; propulseur, booste le lâcher. */
/** Espèces de prises : normale, fragile (casse après une seconde), propulseur, électrique (piège à cycles), à éclipse (accrochable deux secondes sur quatre). */
export type AnchorKind = 'normal' | 'fragile' | 'booster' | 'electrique' | 'eclipse';

export interface Anchor {
  readonly id: number;
  /** Position du moment : fixe, sauf pour un point sur câble qui glisse. */
  pos: Vec2;
  readonly kind: AnchorKind;
  /** Vrai une fois cassée : ni visée, ni dessinée. */
  broken: boolean;
  /** Point sur câble : il va et vient entre ces deux positions. */
  readonly cable?: { readonly from: Vec2; readonly to: Vec2; /** Durée d'un aller-retour, en secondes. */ readonly period: number };
}

/** Obstacle fixe : boîte alignée sur les axes, en mètres, Y vers le haut. Le toucher tue, le frôler rapporte. */
export interface Obstacle {
  readonly id: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Étoile de la route haute, ou étoile de pluie qui tombe : ramassée au passage. */
export interface Pickup {
  readonly id: number;
  pos: Vec2;
  taken: boolean;
  readonly vel?: Vec2;
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

/** Vivant, mort, ou arrivé en haut d'un niveau. */
export type Status = 'alive' | 'dead' | 'won';

/** Événements de règles émis pendant un pas, consommés par le rendu et le son. */
export type RuleEvent =
  | { readonly type: 'attach'; readonly anchorId: number }
  | {
      readonly type: 'release';
      readonly perfect: boolean;
      readonly combo: number;
      /** Durée de la tenue, en secondes, et genre du point lâché ; `forced` si la casse a lâché le personnage. */
      readonly held: number;
      readonly kind: AnchorKind;
      readonly forced: boolean;
    }
  | { readonly type: 'rescue'; readonly chancesLeft: number }
  | { readonly type: 'finish'; readonly height: number }
  | { readonly type: 'event'; readonly kind: EventKind; readonly phase: 'start' | 'end' }
  | { readonly type: 'kick' }
  | { readonly type: 'boost' }
  | { readonly type: 'break'; readonly anchorId: number }
  | { readonly type: 'graze'; readonly obstacleId: number }
  | { readonly type: 'pickup'; readonly pickupId: number }
  | { readonly type: 'tier'; readonly tier: number; readonly name: string }
  | { readonly type: 'death'; readonly height: number; readonly cause: 'fog' | 'obstacle' | 'fall' }
  /** Décharge d'une prise électrique tenue quand elle se charge : corde lâchée, personnage repoussé et étourdi. */
  | { readonly type: 'shock'; readonly anchorId: number };

export interface SimState {
  /** Numéro du pas courant. */
  step: number;
  hero: Hero;
  rope: Rope | null;
  /** Pas de la dernière accroche, pour la casse des accroches fragiles. */
  attachStep: number;
  /** Nombre d'accroches depuis le début de la partie : la première reçoit l'élan de départ. */
  attachCount: number;
  /** Secondes chances restantes contre la brume, talisman « Seconde chance ». */
  chancesLeft: number;
  anchors: Anchor[];
  obstacles: Obstacle[];
  pickups: Pickup[];
  /** Obstacles déjà frôlés depuis la dernière accroche : un bonus par obstacle et par corde. */
  grazed: number[];
  /** Palier nommé atteint. */
  tier: number;
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
  /** Hauteur du toit de départ : le personnage s'y pose, la hauteur se compte depuis là. */
  groundY: number;
  /** Ligne d'arrivée d'un niveau, ou null en course libre. */
  finishY: number | null;
  /** Événements planifiés et ce qu'on en retient ; conditions physiques du moment. */
  schedule: ScheduledEvent[];
  eventRuntimes: EventRuntime[];
  env: Environment;
  /** Facteur de vitesse de la brume (alerte), lampadaires éteints (panne), générateur de la pluie d'étoiles. */
  fogFactor: number;
  lightsOff: boolean;
  rainRng: number;
  /** Hauteur maximale atteinte, en mètres. */
  height: number;
  score: number;
  combo: number;
  /** Pas jusqu'auquel le personnage, secoué par une décharge, ne vise ni n'attrape rien. */
  stunUntilStep: number;
  status: Status;
  /** Journal des gestes : pas et nature, pour rejouer une partie. */
  inputs: { readonly step: number; readonly kind: 'press' | 'release' }[];
}

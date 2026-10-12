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

/**
 * Espèces de prises : normale, fragile (casse après une seconde), propulseur,
 * électrique (piège à cycles), à éclipse (accrochable deux secondes sur
 * quatre), lanceur (fronde), roue (motorisée : accroché, le personnage est
 * entraîné en rotation à vitesse constante, sans treuil, et lâche quand il veut).
 */
export type AnchorKind = 'normal' | 'fragile' | 'booster' | 'electrique' | 'eclipse' | 'lanceur' | 'roue';

/** Le moteur d'une roue : le sens de rotation, +1 vers la gauche (sens trigonométrique, vu de face), -1 vers la droite. La vitesse est un réglage (`wheelSpeed`). */
export interface Motor {
  readonly spin: -1 | 1;
}

export interface Anchor {
  readonly id: number;
  /** Position du moment : fixe, sauf pour un point sur câble qui glisse. */
  pos: Vec2;
  readonly kind: AnchorKind;
  /** Vrai une fois cassée : ni visée, ni dessinée. */
  broken: boolean;
  /** Point sur câble : il va et vient entre ces deux positions. */
  readonly cable?: { readonly from: Vec2; readonly to: Vec2; /** Durée d'un aller-retour, en secondes. */ readonly period: number };
  /** Roue motorisée : son moteur. */
  readonly motor?: Motor;
  /** Prise d'une bande d'accordéon (lot 3, T3) : la bande gauche (-1) ou droite (1) ; la prise glisse avec elle (`cable`). */
  readonly band?: -1 | 1;
}

/**
 * Espèces d'obstacles (brief du 11 octobre 2026, lot 2). Solide : le toucher
 * fait rebondir en perdant l'élan et lâche la corde. Rebond : une surface qui
 * renvoie le personnage selon son angle d'arrivée, presque sans perte, sans
 * étourdir ni casser la série. Cassable : une paroi que l'on traverse en volant
 * en éclats si l'on arrive assez vite (`smashSpeed`), solide sinon. Porte :
 * tour à tour solide et franchissable, par cycles lents (`cycles.ts`), jamais
 * refermée sur le personnage.
 */
export type ObstacleKind = 'solide' | 'rebond' | 'cassable' | 'porte' | 'tournant';

/** Barre qui tourne autour d'un pivot (obstacle « tournant », O2 du brief) : longueur en mètres, vitesse en tours par seconde (signée), phase en tours. */
export interface Rotor {
  readonly pivot: Vec2;
  readonly length: number;
  readonly spin: number;
  readonly phase: number;
}

/** Va-et-vient horizontal d'un obstacle (ouverture mobile, L3 du brief) : amplitude en mètres de part et d'autre de la position de repos, période d'un aller-retour en secondes, phase en tours. */
export interface Slide {
  readonly amplitude: number;
  readonly period: number;
  readonly phase: number;
}

/**
 * Obstacle : boîte alignée sur les axes, en mètres, Y vers le haut. Le frôler
 * rapporte ; le toucher dépend de son espèce. Un obstacle qui bouge (voir
 * `moving.ts`) garde ici sa boîte de repos : un tournant, le carré qui
 * contient la barre quelle que soit sa position ; un panneau qui glisse, sa
 * place au repos.
 */
export interface Obstacle {
  readonly id: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Espèce ; absente, l'obstacle est solide. */
  readonly kind?: ObstacleKind;
  /** Paroi cassable traversée : plus rien, ni solide, ni dessinée. */
  broken?: true;
  /** Obstacle tournant : la barre et son pivot. */
  readonly rotor?: Rotor;
  /** Panneau qui glisse : son va-et-vient. */
  readonly slide?: Slide;
}

/**
 * Zones qui modifient le mouvement (brief du 11 octobre 2026, section 8).
 * Ascendant : une poussée vers le haut, progressive près des bords, qui
 * traverse de grands espaces et offre une sortie de descente. Latéral : une
 * poussée de côté, localisée, à anticiper. Accélération : un couloir qui
 * accélère le long de son axe seulement, jusqu'à un plafond. Freinage : une
 * zone qui retire progressivement de la vitesse, jamais sous un plancher.
 * Poche (lot 3, T6) : la gravité y est faible, en douceur à l'entrée et à la
 * sortie ; les vols s'allongent, le grappin sert à courber et à freiner.
 */
export type ZoneKind = 'ascendant' | 'lateral' | 'acceleration' | 'freinage' | 'poche';

export interface Zone {
  readonly id: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly kind: ZoneKind;
  /** Poussée en m/s² (ascendant, latéral, accélération), part de vitesse retirée par seconde (freinage), ou part de gravité gardée (poche). */
  readonly strength: number;
  /** Direction unitaire de la poussée ; nulle pour le freinage et la poche. */
  readonly dir: Vec2;
  /** Couloir d'accélération : vitesse le long de l'axe au-delà de laquelle il n'accélère plus, en m/s. */
  readonly cap?: number;
}

/**
 * Anneau de précision : rien de solide, un cercle à traverser en vol. Le
 * traverser rapporte, et près du centre davantage, avec un cran de série : les
 * belles trajectoires se récompensent. Un anneau raté ne coûte rien.
 */
export interface Ring {
  readonly id: number;
  readonly pos: Vec2;
  readonly radius: number;
  /** Distance la plus courte au centre pendant la traversée en cours, ou null hors de l'anneau. */
  closest: number | null;
  taken: boolean;
}

/** Étoile de la route haute, ou étoile de pluie qui tombe : ramassée au passage. */
export interface Pickup {
  readonly id: number;
  pos: Vec2;
  taken: boolean;
  readonly vel?: Vec2;
  /** Étoile de pluie : un bonus de score, qui ne compte pas parmi les étoiles requises d'un niveau. */
  readonly bonus?: true;
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
  | { readonly type: 'pickup'; readonly pickupId: number; readonly bonus: boolean }
  | { readonly type: 'tier'; readonly tier: number; readonly name: string }
  | { readonly type: 'death'; readonly height: number; readonly cause: 'fog' | 'fall' }
  /** Choc contre un obstacle : rebond, corde lâchée, série à zéro, étourdi un instant. */
  | { readonly type: 'bump'; readonly obstacleId: number }
  /** Rebond sur une surface de rebond : renvoyé presque sans perte, corde lâchée, ni série perdue ni étourdi. */
  | { readonly type: 'bounce'; readonly obstacleId: number }
  /** Paroi cassable traversée assez vite : elle vole en éclats et rapporte. */
  | { readonly type: 'smash'; readonly obstacleId: number }
  /** Anneau de précision traversé ; `centred` si le passage est près du centre. */
  | { readonly type: 'ring'; readonly ringId: number; readonly centred: boolean }
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
  rings: Ring[];
  zones: Zone[];
  /** Obstacles déjà frôlés depuis la dernière accroche : un bonus par obstacle et par corde. */
  grazed: number[];
  /** Portes dans lesquelles le personnage se trouve : une porte ne se referme jamais sur lui, il en sort d'abord. */
  doorsInside: number[];
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
  /** Traction du doigt sur un lanceur tenu, en mètres de monde, plafonnée ; nulle sinon. */
  pull: Vec2;
  status: Status;
  /** Journal des gestes : pas et nature, pour rejouer une partie. */
  /** Journal des entrées : appuis et relâchés, un relâché depuis un lanceur portant sa traction. */
  inputs: { readonly step: number; readonly kind: 'press' | 'release'; readonly pull?: Vec2 }[];
}

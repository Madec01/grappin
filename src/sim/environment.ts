import { normalize, scale, type Vec2 } from '../core/math/vec2';
import type { Tuning } from './tuning';

/**
 * Conditions physiques du moment : la direction de la gravité et le vent.
 *
 * D'ordinaire la gravité tire vers le bas et il n'y a pas de vent. Les
 * événements des niveaux les changent : la bascule fait tourner la gravité
 * d'un quart de tour, le coup de vent ajoute une poussée latérale. Tout le
 * reste de la physique lit ces deux vecteurs et n'a pas d'autre notion de
 * « bas ».
 */
export interface Environment {
  /** Direction unitaire de la gravité ; plus courte pendant l'inversion d'un plafond, où elle faiblit jusqu'à rien avant de repousser vers le haut (`invertedGravity`). */
  readonly gravityDir: Vec2;
  /** Accélération du vent, en m/s². */
  readonly wind: Vec2;
  /**
   * Plafond (lot 5 B, T2) : la gravité s'inverse, et la caméra ne tourne PAS
   * avec elle (brief : « ne pas tout compenser visuellement par une caméra qui
   * rendrait la transformation imperceptible ») : le personnage se balance
   * au-dessus des prises, à l'écran comme dans le monde. Vrai pendant toute
   * l'inversion, retournements compris.
   */
  readonly inverted?: true;
}

export const STILL: Environment = { gravityDir: { x: 0, y: -1 }, wind: { x: 0, y: 0 } };

/** Accélération totale subie en vol : gravité (multipliée par `gravityScale`, moins que 1 dans une poche de faible gravité) et vent. */
export function acceleration(env: Environment, tuning: Tuning, gravityScale = 1): Vec2 {
  const g = tuning.gravity * gravityScale;
  return { x: env.gravityDir.x * g + env.wind.x, y: env.gravityDir.y * g + env.wind.y };
}

/** Le « haut » : à l'opposé de la gravité. */
export function upOf(env: Environment): Vec2 {
  return scale(env.gravityDir, -1);
}

/**
 * Gravité en cours de bascule : de « vers le bas » à « vers le côté `side` »,
 * pour `t` de 0 à 1 ; et au-delà, jusqu'à « vers le haut » pour `t` de 1 à 2
 * (le plafond, un demi-tour par le côté `side`). Interpolation du vecteur puis
 * normalisation : pas de trigonométrie, donc identique sur tout moteur.
 */
export function turnedGravity(side: -1 | 1, t: number): Vec2 {
  const k = t < 0 ? 0 : t > 2 ? 2 : t;
  // `|| 0` évite un zéro négatif, qui casserait l'égalité des empreintes d'état.
  if (k <= 1) return normalize({ x: side * k || 0, y: k - 1 || 0 });
  return normalize({ x: side * (2 - k) || 0, y: k - 1 || 0 });
}

/** Vrai si la gravité tire vers le bas, à peu de chose près : le toit de départ ne retient que dans ce cas. */
export function isUpright(env: Environment): boolean {
  return env.gravityDir.y < -0.99;
}

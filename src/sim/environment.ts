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
  /** Direction unitaire de la gravité. */
  readonly gravityDir: Vec2;
  /** Accélération du vent, en m/s². */
  readonly wind: Vec2;
}

export const STILL: Environment = { gravityDir: { x: 0, y: -1 }, wind: { x: 0, y: 0 } };

/** Accélération totale subie en vol : gravité et vent. */
export function acceleration(env: Environment, tuning: Tuning): Vec2 {
  return { x: env.gravityDir.x * tuning.gravity + env.wind.x, y: env.gravityDir.y * tuning.gravity + env.wind.y };
}

/** Le « haut » : à l'opposé de la gravité. */
export function upOf(env: Environment): Vec2 {
  return scale(env.gravityDir, -1);
}

/**
 * Gravité en cours de bascule : de « vers le bas » à « vers le côté `side` »,
 * pour `t` de 0 à 1. Interpolation du vecteur puis normalisation : pas de
 * trigonométrie, donc identique sur tout moteur.
 */
export function turnedGravity(side: -1 | 1, t: number): Vec2 {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  // `|| 0` évite un zéro négatif, qui casserait l'égalité des empreintes d'état.
  return normalize({ x: side * k || 0, y: k - 1 || 0 });
}

/** Vrai si la gravité tire vers le bas, à peu de chose près : le toit de départ ne retient que dans ce cas. */
export function isUpright(env: Environment): boolean {
  return env.gravityDir.y < -0.99;
}

import { clampLength, length, normalize, perpendicular, scale, type Vec2 } from '../core/math/vec2';
import { upOf, type Environment } from './environment';

/**
 * Le lanceur, idée du propriétaire du 10 octobre 2026 : on s'y accroche, on
 * est tiré jusqu'à lui et tenu là ; puis on tire avec le doigt à l'opposé de
 * là où l'on veut aller, et plus on tire, plus le lancer est fort. Il permet
 * des murs à trou qu'il faut viser.
 *
 * La traction est en mètres de monde, plafonnée à `PULL_MAX` ; en dessous de
 * `PULL_MIN`, le lancer part tout droit vers le haut, à la force minimale, pour
 * qu'un simple tap ne colle pas le personnage au lanceur. Tout est déterministe
 * et sans trigonométrie : les directions que le vérificateur essaie sont une
 * table de vecteurs unitaires.
 */

/** Traction : au-delà de ce rayon, tirer n'ajoute rien ; en deçà de `PULL_MIN`, le lancer part vers le haut. */
export const PULL_MAX = 2.5;
export const PULL_MIN = 0.25;
/** Vitesse de lancer à traction minimale et maximale, en m/s. */
export const LAUNCH_MIN_SPEED = 6;
export const LAUNCH_MAX_SPEED = 15;
/** Rien ne doit gêner autour d'un lanceur : le personnage y est tenu, tiré jusqu'à `PULL_MAX`. */
export const LANCEUR_CLEARANCE = PULL_MAX + 0.6;

export function clampPull(pull: Vec2): Vec2 {
  return clampLength(pull, PULL_MAX);
}

/** Où est tenu le personnage : au lanceur, reculé de la traction. */
export function pulledPosition(anchor: Vec2, pull: Vec2): Vec2 {
  const p = clampPull(pull);
  return { x: anchor.x + p.x, y: anchor.y + p.y };
}

/** Vitesse du lancer selon la longueur de traction, linéaire de la force minimale à la maximale. */
export function launchSpeed(pullLength: number): number {
  const k = Math.min(1, Math.max(0, pullLength) / PULL_MAX);
  return LAUNCH_MIN_SPEED + k * (LAUNCH_MAX_SPEED - LAUNCH_MIN_SPEED);
}

/** Vitesse de départ du lancer : à l'opposé de la traction, ou vers le haut si l'on n'a presque pas tiré. */
export function launchVelocity(pull: Vec2, env: Environment): Vec2 {
  const p = clampPull(pull);
  const len = length(p);
  const v = len < PULL_MIN ? scale(upOf(env), LAUNCH_MIN_SPEED) : scale(normalize(p), -launchSpeed(len));
  // Jamais de zéro négatif : il ferait deux parties « différentes » d'un même lancer.
  return { x: v.x || 0, y: v.y || 0 };
}

/** (sinus, cosinus) des angles de −80° à 80° par pas de 10°, autour du haut : l'éventail des lancers que le vérificateur essaie. */
const FAN: readonly (readonly [number, number])[] = [
  [-0.9848, 0.1736],
  [-0.9397, 0.342],
  [-0.866, 0.5],
  [-0.766, 0.6428],
  [-0.6428, 0.766],
  [-0.5, 0.866],
  [-0.342, 0.9397],
  [-0.1736, 0.9848],
  [0, 1],
  [0.1736, 0.9848],
  [0.342, 0.9397],
  [0.5, 0.866],
  [0.6428, 0.766],
  [0.766, 0.6428],
  [0.866, 0.5],
  [0.9397, 0.342],
  [0.9848, 0.1736],
];
/** Les forces essayées : minimale, moyenne, maximale, en longueur de traction. */
const STRENGTHS: readonly number[] = [PULL_MIN, (PULL_MIN + PULL_MAX) / 2, PULL_MAX];

/**
 * Les tractions que le vérificateur essaie depuis un lanceur : dix-sept
 * directions dans le demi-plan du haut (selon la gravité du moment), à trois
 * forces. Un joueur qui vise peut faire tout cela.
 */
export function launchSet(env: Environment): Vec2[] {
  const up = upOf(env);
  const right = perpendicular(up);
  const pulls: Vec2[] = [];
  for (const [sin, cos] of FAN) {
    const dir = { x: right.x * sin + up.x * cos, y: right.y * sin + up.y * cos };
    for (const strength of STRENGTHS) pulls.push(scale(dir, -strength));
  }
  return pulls;
}

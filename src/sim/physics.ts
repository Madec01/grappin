import { add, clampLength, dot, length, lengthSq, normalize, scale, sub, type Vec2 } from '../core/math/vec2';
import type { Tuning } from './tuning';

/**
 * Physique du personnage : vol libre et pendule à corde.
 *
 * Un pas fait trois choses, toujours dans le même ordre : la gravité, la
 * corde, le déplacement. La corde est une corde et non une tige : elle ne
 * retient le personnage que lorsqu'elle est tendue et qu'il s'en éloigne.
 * Quand elle est molle, le personnage vole librement jusqu'à ce qu'elle se
 * tende à nouveau. Seules les quatre opérations et la racine carrée sont
 * utilisées : le résultat est identique sur tout moteur JavaScript.
 */

export interface Body {
  readonly pos: Vec2;
  readonly vel: Vec2;
}

/** Tolérance sous laquelle une corde est considérée tendue. */
const TAUT_EPSILON = 1e-6;

/**
 * Retire la composante radiale sortante de la vitesse si la corde est tendue.
 * Si la corde est molle ou si le personnage se rapproche du point, la vitesse
 * est rendue telle quelle.
 */
export function constrainVelocity(pos: Vec2, vel: Vec2, anchor: Vec2, ropeLength: number): Vec2 {
  const r = sub(pos, anchor);
  const d = length(r);
  if (d === 0 || d < ropeLength - TAUT_EPSILON) return vel;
  const n = scale(r, 1 / d);
  const outward = dot(vel, n);
  if (outward <= 0) return vel;
  return sub(vel, scale(n, outward));
}

/**
 * Avance le personnage d'un pas. `anchor` vaut null en vol libre.
 *
 * Après le déplacement, si le personnage a dépassé la longueur de corde, il
 * est ramené sur le cercle et sa vitesse est contrainte une seconde fois,
 * afin que la corde garde exactement sa longueur à chaque pas.
 */
export function integrate(body: Body, anchor: Vec2 | null, ropeLength: number, tuning: Tuning): Body {
  const dt = tuning.stepSeconds;
  let vel: Vec2 = { x: body.vel.x, y: body.vel.y - tuning.gravity * dt };
  if (anchor) vel = constrainVelocity(body.pos, vel, anchor, ropeLength);
  let pos = add(body.pos, scale(vel, dt));
  if (anchor) {
    const r = sub(pos, anchor);
    const d = length(r);
    if (d > ropeLength) {
      pos = add(anchor, scale(r, ropeLength / d));
      vel = constrainVelocity(pos, vel, anchor, ropeLength);
    }
  }
  return { pos, vel: clampLength(vel, tuning.maxSpeed) };
}

/**
 * Treuil : la corde passe de `oldLength` à `newLength` pendant ce pas.
 *
 * Si la corde est tendue, le personnage est tiré vers le point à la vitesse
 * d'enroulement, et sa vitesse le long du cercle est augmentée d'une part
 * `spin` de ce que donnerait la conservation du moment cinétique, comme un
 * patineur qui ramène les bras. C'est la source d'énergie du jeu : sans elle,
 * un pendule ne monte jamais plus haut que son élan de départ. Si la corde est
 * molle, rien ne change : elle se tendra plus tard.
 */
export function reelIn(body: Body, anchor: Vec2, oldLength: number, newLength: number, spin: number, dt: number): Body {
  if (newLength >= oldLength) return body;
  const r = sub(body.pos, anchor);
  const d = length(r);
  if (d === 0 || d < oldLength - TAUT_EPSILON) return body;
  const n = scale(r, 1 / d);
  const t: Vec2 = { x: -n.y, y: n.x };
  const radial = dot(body.vel, n);
  const along = dot(body.vel, t);
  const pulled = -(oldLength - newLength) / dt;
  const spun = along * (1 + spin * (oldLength / newLength - 1));
  const vel = add(scale(n, radial < pulled ? radial : pulled), scale(t, spun));
  return { pos: body.pos, vel };
}

/**
 * Pompage : accroché et sans élan, le personnage se relance le long du cercle
 * dans le sens où il va déjà, comme un enfant qui pousse sur une balançoire.
 * L'élan se mesure par la vitesse qu'aurait le personnage au point bas du
 * cercle, pas par sa vitesse du moment, qui est faible en haut de chaque
 * balancement même quand l'élan est bon. Cela garantit un balancement jamais
 * mou une fois la corde au plus court, où le treuil n'apporte plus rien. La
 * vitesse plancher reste bien sous ce qu'un joueur obtient par ses lâchers :
 * le jeu ne joue pas à sa place.
 */
export function swingAssist(body: Body, anchor: Vec2, ropeLength: number, tuning: Tuning): Body {
  if (tuning.swingAssistAccel <= 0) return body;
  const bottomY = anchor.y - ropeLength;
  const bottomSpeedSq = lengthSq(body.vel) + 2 * tuning.gravity * (body.pos.y - bottomY);
  if (bottomSpeedSq >= tuning.swingAssistSpeed * tuning.swingAssistSpeed) return body;
  const n = normalize(sub(body.pos, anchor));
  if (n.x === 0 && n.y === 0) return body;
  const tangent: Vec2 = { x: -n.y, y: n.x };
  const along = dot(body.vel, tangent);
  if (along > -0.05 && along < 0.05) return body;
  const sign = along > 0 ? 1 : -1;
  return { pos: body.pos, vel: add(body.vel, scale(tangent, sign * tuning.swingAssistAccel * tuning.stepSeconds)) };
}

/**
 * Un pas de personnage accroché : pompage, treuil puis mouvement. Renvoie le
 * corps déplacé et la nouvelle longueur de corde. Partagé par la simulation et
 * le vérificateur de parcours, qui jouent ainsi exactement la même physique.
 */
export function swingStep(body: Body, anchor: Vec2, ropeLength: number, tuning: Tuning): { body: Body; ropeLength: number } {
  const assisted = swingAssist(body, anchor, ropeLength, tuning);
  const shorter = Math.max(tuning.ropeMin, ropeLength - tuning.reelSpeed * tuning.stepSeconds);
  const pulled = reelIn(assisted, anchor, ropeLength, shorter, tuning.reelSpin, tuning.stepSeconds);
  return { body: integrate(pulled, anchor, shorter, tuning), ropeLength: shorter };
}

/** Position en vol libre après `t` secondes, sans corde ni plafond : sert à viser. */
export function freeFlightAt(body: Body, t: number, tuning: Tuning): Vec2 {
  return {
    x: body.pos.x + body.vel.x * t,
    y: body.pos.y + body.vel.y * t - 0.5 * tuning.gravity * t * t,
  };
}

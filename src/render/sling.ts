import type { Graphics } from 'pixi.js';
import type { Vec2 } from '../core/math/vec2';
import { PULL_MAX } from '../sim/launcher';

/**
 * Le lanceur vu de près : la coupe en « Y » qui le dessine, l'élastique qui va
 * de ses deux pointes au personnage tiré, et la force de la traction. Que de
 * la géométrie et de la couleur, sans simulation ni temps réel : le rendu pose
 * les formes, ce fichier dit où elles vont. Les positions sont en pixels, dans
 * le repère de l'écran (y vers le bas).
 *
 * La coupe est un « U » aux bords évasés, ouvert vers le haut, sur un court
 * pied : une fronde. Le disque du lanceur est au creux, le personnage tiré
 * vers le bas (donc lancé vers le haut) quitte la coupe par son ouverture.
 */

/** Rayon de la coupe : presque deux fois celui du disque, et au moins sept pixels de plus, pour qu'elle se lise même très dézoomée. */
const CUP_SCALE = 1.8;
const CUP_MIN_MARGIN = 7;

/** Pointes de la coupe, en fractions de son rayon : écart de chaque côté et hauteur au-dessus du centre. */
const TIP_SPREAD = 1.3;
const TIP_RISE = 1;
/** Pied de la coupe, sous son creux, en fraction du rayon. */
const STEM_LENGTH = 0.55;

/** Épaisseur de l'élastique, en pixels : fin au repos, gras à pleine traction. */
export const BAND_WIDTH_MIN = 1.5;
export const BAND_WIDTH_MAX = 4.5;

/** Rayon, en pixels, de la coupe d'un lanceur dont le disque a le rayon `discRadius`. */
export function cupRadius(discRadius: number): number {
  return Math.max(discRadius * CUP_SCALE, discRadius + CUP_MIN_MARGIN);
}

/** Les deux pointes de la coupe de rayon `cup` centrée en (`x`, `y`), là où l'élastique s'attache. */
export function cupTips(x: number, y: number, cup: number): { readonly left: Vec2; readonly right: Vec2 } {
  return {
    left: { x: x - TIP_SPREAD * cup, y: y - TIP_RISE * cup },
    right: { x: x + TIP_SPREAD * cup, y: y - TIP_RISE * cup },
  };
}

/**
 * Ajoute au tracé la coupe de rayon `cup` centrée en (`x`, `y`) : de la pointe
 * droite au creux puis à la pointe gauche, et le pied. Plusieurs coupes peuvent
 * s'ajouter au même tracé, d'un seul lot.
 */
export function traceCup(g: Graphics, x: number, y: number, cup: number): void {
  const tips = cupTips(x, y, cup);
  g.moveTo(tips.right.x, tips.right.y).lineTo(x + cup, y).arc(x, y, cup, 0, Math.PI).lineTo(tips.left.x, tips.left.y);
  g.moveTo(x, y + cup).lineTo(x, y + cup * (1 + STEM_LENGTH));
}

/** Part de la force maximale que la traction (en mètres de monde) représente : 0 sans traction, 1 à `PULL_MAX` et au-delà. */
export function pullRatio(pull: Vec2): number {
  return Math.min(1, Math.hypot(pull.x, pull.y) / PULL_MAX);
}

/** Épaisseur de l'élastique pour une force `ratio` de 0 à 1 : elle grandit avec la traction. */
export function bandWidth(ratio: number): number {
  const k = Math.min(1, Math.max(0, ratio));
  return BAND_WIDTH_MIN + (BAND_WIDTH_MAX - BAND_WIDTH_MIN) * k;
}

/** Couleur entre `from` et `to` (0xRRGGBB), canal par canal : `t` de 0 à 1. */
export function mixColor(from: number, to: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const channel = (shift: number): number => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * k);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

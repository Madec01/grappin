import type { Graphics } from 'pixi.js';
import type { Vec2 } from '../core/math/vec2';

/**
 * Le tube de néon : une forme, son halo, son cœur.
 *
 * Pas de filtre de flou, qui coûterait trop cher sur un téléphone : un halo est
 * la même forme tracée trois fois. Un trait large à faible opacité, un trait
 * moyen à opacité moyenne, puis le cœur net. Sur le fond nuit, les trois
 * passes empilées donnent un dégradé de lumière à peu de frais. Rien ici ne
 * dépend de la simulation ; les assistants ne font que poser des formes sur un
 * `Graphics`, que le rendu a vidé au début de l'image.
 *
 * Coût : trois passes par forme et par lot. Un lot regroupe toutes les formes
 * d'une même couleur (par exemple tous les points normaux) en un seul tracé,
 * si bien que le nombre d'ordres de dessin reste celui des lots, pas des formes.
 */

/** Une couche du halo : de combien elle dépasse le bord de la forme, en pixels, et son opacité. */
export interface HaloLayer {
  readonly reach: number;
  readonly alpha: number;
}

/**
 * Les deux couches du halo, de la plus large à la plus proche du cœur : un trait
 * très pâle, puis un trait moyen. Une troisième couche adoucirait encore le
 * dégradé, au prix d'une passe de plus par forme ; deux suffisent à l'écran
 * d'un téléphone.
 */
export const HALO: readonly HaloLayer[] = [
  { reach: 8, alpha: 0.12 },
  { reach: 3.5, alpha: 0.32 },
];

/** Passes d'un tube complet : le halo, puis le cœur. */
export const NEON_PASSES = HALO.length + 1;

/**
 * Les couches du halo à poser. `spread` allonge la portée (un halo plus large),
 * `strength` en renforce l'opacité, sans jamais dépasser 1 ; à zéro, il n'y a
 * plus de halo du tout : le tube est coupé et il ne reste que son cœur.
 */
export function haloLayers(spread = 1, strength = 1): HaloLayer[] {
  if (strength <= 0 || spread <= 0) return [];
  return HALO.map((layer) => ({ reach: layer.reach * spread, alpha: Math.min(1, layer.alpha * strength) }));
}

/** Pose une forme sur le `Graphics` ; `grow` est de combien les formes pleines doivent s'élargir, en pixels (0 pour le cœur). */
export type Trace = (g: Graphics, grow: number) => void;

/** Ce qui fait un tube : la couleur du cœur, celle du halo, et son intensité. */
export interface NeonStyle {
  /** Couleur du cœur. */
  readonly color: number;
  /** Couleur du halo. */
  readonly halo: number;
  /** Opacité du cœur ; celle du halo la suit. 1 par défaut. */
  readonly alpha?: number;
  /** Portée du halo, 1 par défaut. */
  readonly spread?: number;
  /** Force du halo, 1 par défaut ; 0 pour un tube éteint. */
  readonly strength?: number;
  /** Quelles passes poser : toutes (défaut), le halo seul ou le cœur seul. Sert à poser tous les halos avant tous les cœurs. */
  readonly pass?: 'all' | 'halo' | 'core';
}

export interface NeonStrokeStyle extends NeonStyle {
  /** Épaisseur du cœur, en pixels. */
  readonly width: number;
  readonly cap?: 'butt' | 'round' | 'square';
  readonly join?: 'miter' | 'round' | 'bevel';
}

function wantsHalo(style: NeonStyle): boolean {
  return style.pass !== 'core';
}

function wantsCore(style: NeonStyle): boolean {
  return style.pass !== 'halo';
}

/** Tube en trait : le halo en deux traits plus larges, puis le cœur. */
export function neonStroke(g: Graphics, trace: Trace, style: NeonStrokeStyle): void {
  const { color, halo, width, alpha = 1, cap, join } = style;
  const shape = { ...(cap === undefined ? {} : { cap }), ...(join === undefined ? {} : { join }) };
  if (wantsHalo(style)) {
    for (const layer of haloLayers(style.spread, (style.strength ?? 1) * alpha)) {
      trace(g, 0);
      g.stroke({ width: width + 2 * layer.reach, color: halo, alpha: layer.alpha, ...shape });
    }
  }
  if (wantsCore(style)) {
    trace(g, 0);
    g.stroke({ width, color, alpha, ...shape });
  }
}

/** Tube en surface : le halo en deux formes élargies, puis le cœur plein. */
export function neonFill(g: Graphics, trace: Trace, style: NeonStyle): void {
  const { color, halo, alpha = 1 } = style;
  if (wantsHalo(style)) {
    for (const layer of haloLayers(style.spread, (style.strength ?? 1) * alpha)) {
      trace(g, layer.reach);
      g.fill({ color: halo, alpha: layer.alpha });
    }
  }
  if (wantsCore(style)) {
    trace(g, 0);
    g.fill({ color, alpha });
  }
}

/** Anneau de tube autour de (`x`, `y`). */
export function neonCircle(g: Graphics, x: number, y: number, radius: number, style: NeonStrokeStyle): void {
  neonStroke(g, (target) => target.circle(x, y, radius), style);
}

/** Disques pleins, tous de ce rayon, aux positions données : un seul lot. */
export function neonDiscs(g: Graphics, centers: readonly Vec2[], radius: number, style: NeonStyle): void {
  if (centers.length === 0) return;
  neonFill(
    g,
    (target, grow) => {
      for (const center of centers) target.circle(center.x, center.y, radius + grow);
    },
    style,
  );
}

/** Segment de tube, de `from` à `to`. */
export function neonLine(g: Graphics, from: Vec2, to: Vec2, style: NeonStrokeStyle): void {
  neonStroke(g, (target) => target.moveTo(from.x, from.y).lineTo(to.x, to.y), style);
}

/** Ligne brisée de tube : une suite de points reliés. */
export function neonPolyline(g: Graphics, points: readonly Vec2[], style: NeonStrokeStyle): void {
  if (points.length < 2) return;
  neonStroke(
    g,
    (target) => {
      points.forEach((point, index) => (index === 0 ? target.moveTo(point.x, point.y) : target.lineTo(point.x, point.y)));
    },
    style,
  );
}

/**
 * Contours de rectangles de tube : `rects` en x, y, largeur, hauteur, d'un seul
 * lot. Le halo est fait de rectangles pleins élargis (aux coins arrondis) et
 * non de traits épais : un trait plus épais que le rectangle n'est pas mince,
 * ses bords intérieurs se croiseraient. Poser le corps du rectangle entre la
 * passe `halo` et la passe `core` cache ce qui déborde à l'intérieur.
 */
export function neonRects(g: Graphics, rects: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[], style: NeonStrokeStyle): void {
  if (rects.length === 0) return;
  if (wantsHalo(style)) {
    neonFill(
      g,
      (target, grow) => {
        for (const rect of rects) target.roundRect(rect.x - grow, rect.y - grow, rect.width + 2 * grow, rect.height + 2 * grow, grow);
      },
      { ...style, pass: 'halo' },
    );
  }
  if (wantsCore(style)) {
    neonStroke(
      g,
      (target) => {
        for (const rect of rects) target.rect(rect.x, rect.y, rect.width, rect.height);
      },
      { ...style, pass: 'core' },
    );
  }
}

/** Rectangle arrondi de tube, en contour. */
export function neonRoundRect(g: Graphics, x: number, y: number, width: number, height: number, radius: number, style: NeonStrokeStyle): void {
  neonStroke(g, (target) => target.roundRect(x, y, width, height, radius), style);
}

/** Barre pleine aux coins arrondis, avec son halo : la barre d'expérience. */
export function neonBar(g: Graphics, x: number, y: number, width: number, height: number, style: NeonStyle): void {
  neonFill(g, (target, grow) => target.roundRect(x - grow, y - grow, width + 2 * grow, height + 2 * grow, height / 2 + grow), style);
}

/** Étoile pleine de tube : `points(grow)` donne ses sommets, élargis de `grow` pixels pour le halo. */
export function neonPoly(g: Graphics, points: (grow: number) => number[], style: NeonStyle): void {
  neonFill(g, (target, grow) => target.poly(points(grow)), style);
}

import type { Vec2 } from '../core/math/vec2';

/** Boîte alignée sur les axes, en mètres, Y vers le haut. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Distance entre le bord d'un cercle et une boîte : négative ou nulle si
 * le cercle touche la boîte. Quatre opérations et une racine carrée.
 */
export function circleBoxGap(center: Vec2, radius: number, box: Box): number {
  const dx = center.x < box.x0 ? box.x0 - center.x : center.x > box.x1 ? center.x - box.x1 : 0;
  const dy = center.y < box.y0 ? box.y0 - center.y : center.y > box.y1 ? center.y - box.y1 : 0;
  return Math.sqrt(dx * dx + dy * dy) - radius;
}

/**
 * Le segment [a, b] traverse-t-il la boîte ? Méthode des tranches : on
 * restreint le paramètre t de [0, 1] à chaque paire de faces ; s'il reste un
 * intervalle, il y a traversée.
 */
export function segmentCrossesBox(a: Vec2, b: Vec2, box: Box): boolean {
  let tMin = 0;
  let tMax = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const axes: [number, number, number, number][] = [
    [a.x, dx, box.x0, box.x1],
    [a.y, dy, box.y0, box.y1],
  ];
  for (const [start, delta, low, high] of axes) {
    if (delta === 0) {
      if (start < low || start > high) return false;
      continue;
    }
    let t0 = (low - start) / delta;
    let t1 = (high - start) / delta;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tMin) tMin = t0;
    if (t1 < tMax) tMax = t1;
    if (tMin > tMax) return false;
  }
  return true;
}

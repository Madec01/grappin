import { describe, expect, it } from 'vitest';
import type { Graphics } from 'pixi.js';
import { BAND_WIDTH_MAX, BAND_WIDTH_MIN, bandWidth, cupTips, mixColor, pullRatio, traceCup } from '../src/render/sling';
import { PULL_MAX } from '../src/sim/launcher';

/** Un faux tracé qui note les ordres reçus. */
function recorder() {
  const calls: string[] = [];
  const g = {
    moveTo: (x: number, y: number) => (calls.push(`M ${x},${y}`), g),
    lineTo: (x: number, y: number) => (calls.push(`L ${x},${y}`), g),
    arc: (x: number, y: number, r: number, from: number, to: number) => (calls.push(`A ${x},${y} r${r} ${from}→${to.toFixed(4)}`), g),
  };
  return { g: g as unknown as Graphics, calls };
}

describe('force de la traction', () => {
  it('va de 0 sans traction à 1 à la traction maximale, et ne dépasse pas 1', () => {
    expect(pullRatio({ x: 0, y: 0 })).toBe(0);
    expect(pullRatio({ x: 0, y: -PULL_MAX / 2 })).toBeCloseTo(0.5, 12);
    expect(pullRatio({ x: PULL_MAX, y: 0 })).toBe(1);
    expect(pullRatio({ x: 10, y: -10 })).toBe(1);
  });

  it('l\'élastique s\'épaissit avec la force, entre ses bornes', () => {
    expect(bandWidth(0)).toBe(BAND_WIDTH_MIN);
    expect(bandWidth(1)).toBe(BAND_WIDTH_MAX);
    expect(bandWidth(0.5)).toBeGreaterThan(bandWidth(0.25));
    expect(bandWidth(-1)).toBe(BAND_WIDTH_MIN);
    expect(bandWidth(7)).toBe(BAND_WIDTH_MAX);
  });
});

describe('couleur de l\'élastique', () => {
  it('mélange canal par canal, de la première couleur à la seconde', () => {
    expect(mixColor(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixColor(0x3dffc0, 0xe6fbff, 0)).toBe(0x3dffc0);
    expect(mixColor(0x3dffc0, 0xe6fbff, 1)).toBe(0xe6fbff);
    expect(mixColor(0x000000, 0xff8040, 0.5)).toBe(0x804020);
  });

  it('borne le mélange à 0 et 1', () => {
    expect(mixColor(0x102030, 0x405060, -3)).toBe(0x102030);
    expect(mixColor(0x102030, 0x405060, 3)).toBe(0x405060);
  });
});

describe('coupe du lanceur', () => {
  it('ses deux pointes sont au-dessus du centre et de part et d\'autre, évasées au-delà du rayon', () => {
    const { left, right } = cupTips(100, 200, 14);
    expect(left.y).toBeLessThan(200);
    expect(left.y).toBe(right.y);
    expect(100 - left.x).toBe(right.x - 100);
    expect(right.x - 100).toBeGreaterThan(14);
  });

  it('se trace de la pointe droite à la pointe gauche par le creux, ouverte vers le haut, sur un pied', () => {
    const { g, calls } = recorder();
    traceCup(g, 100, 200, 14);
    const { left, right } = cupTips(100, 200, 14);
    expect(calls[0]).toBe(`M ${right.x},${right.y}`);
    expect(calls[1]).toBe('L 114,200');
    // Le creux : la demi-circonférence du bas, du bout droit au bout gauche.
    expect(calls[2]).toBe(`A 100,200 r14 0→${Math.PI.toFixed(4)}`);
    expect(calls[3]).toBe(`L ${left.x},${left.y}`);
    // Le pied part du bas du creux, vers le bas.
    expect(calls[4]).toBe('M 100,214');
    expect(calls[5]!.startsWith('L 100,')).toBe(true);
    expect(Number(calls[5]!.slice('L 100,'.length))).toBeGreaterThan(214);
  });
});

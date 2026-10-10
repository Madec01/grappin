import type { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { HALO, NEON_PASSES, haloLayers, neonBar, neonCircle, neonDiscs, neonLine, neonPoly, neonRects, neonStroke } from '../src/render/neon';

/**
 * Un `Graphics` de pacotille qui note ce qu'on lui demande : les tracés posés
 * et les passes de remplissage ou de trait, dans l'ordre. Les assistants du
 * néon ne font que poser des formes, il n'y a rien d'autre à tester sans WebGL.
 */
interface Pass {
  readonly kind: 'fill' | 'stroke';
  readonly color: number;
  readonly alpha: number;
  readonly width?: number;
  /** Rayons des disques tracés juste avant cette passe, ou longueur du tracé. */
  readonly radii: number[];
  readonly shapes: number;
}

function fakeGraphics(): { readonly g: Graphics; readonly passes: Pass[] } {
  const passes: Pass[] = [];
  let radii: number[] = [];
  let shapes = 0;
  const finish = (kind: 'fill' | 'stroke', style: { color: number; alpha?: number; width?: number }): void => {
    passes.push({ kind, color: style.color, alpha: style.alpha ?? 1, ...(style.width === undefined ? {} : { width: style.width }), radii, shapes });
    radii = [];
    shapes = 0;
  };
  const g = {
    circle: (_x: number, _y: number, r: number) => {
      radii.push(r);
      shapes += 1;
      return g;
    },
    rect: () => {
      shapes += 1;
      return g;
    },
    roundRect: () => {
      shapes += 1;
      return g;
    },
    poly: () => {
      shapes += 1;
      return g;
    },
    moveTo: () => g,
    lineTo: () => {
      shapes += 1;
      return g;
    },
    fill: (style: { color: number; alpha?: number }) => {
      finish('fill', style);
      return g;
    },
    stroke: (style: { color: number; alpha?: number; width?: number }) => {
      finish('stroke', style);
      return g;
    },
  };
  return { g: g as unknown as Graphics, passes };
}

const TUBE = { color: 0xffffff, halo: 0x00ffff };

describe('couches d\'un halo', () => {
  it('compte deux ou trois halos puis le cœur : au plus quatre passes par forme', () => {
    expect(HALO.length).toBeGreaterThanOrEqual(2);
    expect(HALO.length).toBeLessThanOrEqual(3);
    expect(NEON_PASSES).toBe(HALO.length + 1);
    expect(haloLayers()).toHaveLength(HALO.length);
  });

  it('va du plus large et plus pâle au plus proche du cœur et plus dense', () => {
    const layers = haloLayers();
    for (let i = 1; i < layers.length; i += 1) {
      expect(layers[i]!.reach).toBeLessThan(layers[i - 1]!.reach);
      expect(layers[i]!.alpha).toBeGreaterThan(layers[i - 1]!.alpha);
    }
    // Le trait le plus large est très pâle (0,08 à 0,18), le plus proche du cœur vers 0,35 : la recette du style.
    expect(layers[0]!.alpha).toBeGreaterThanOrEqual(0.08);
    expect(layers[0]!.alpha).toBeLessThanOrEqual(0.18);
    expect(layers.at(-1)!.alpha).toBeGreaterThanOrEqual(0.3);
    expect(layers.at(-1)!.alpha).toBeLessThanOrEqual(0.4);
  });

  it('s\'allonge avec spread, se renforce avec strength sans dépasser 1', () => {
    const base = haloLayers();
    const wide = haloLayers(2);
    expect(wide.map((layer) => layer.reach)).toEqual(base.map((layer) => layer.reach * 2));
    expect(wide.map((layer) => layer.alpha)).toEqual(base.map((layer) => layer.alpha));
    const strong = haloLayers(1, 2);
    expect(strong.map((layer) => layer.alpha)).toEqual(base.map((layer) => layer.alpha * 2));
    expect(haloLayers(1, 100).every((layer) => layer.alpha === 1)).toBe(true);
  });

  it('disparaît quand le tube est éteint : force nulle ou portée nulle', () => {
    expect(haloLayers(1, 0)).toEqual([]);
    expect(haloLayers(0, 1)).toEqual([]);
    expect(haloLayers(1, -1)).toEqual([]);
  });
});

describe('tube en trait', () => {
  it('trace le halo en traits de plus en plus fins, puis le cœur net', () => {
    const { g, passes } = fakeGraphics();
    neonCircle(g, 10, 10, 20, { ...TUBE, width: 2 });
    expect(passes).toHaveLength(NEON_PASSES);
    expect(passes.every((pass) => pass.kind === 'stroke')).toBe(true);
    const widths = passes.map((pass) => pass.width!);
    for (let i = 1; i < widths.length; i += 1) expect(widths[i]).toBeLessThan(widths[i - 1]!);
    expect(widths.at(-1)).toBe(2);
    expect(passes.map((pass) => pass.color)).toEqual([...HALO.map(() => TUBE.halo), TUBE.color]);
    expect(passes.at(-1)!.alpha).toBe(1);
    for (let i = 1; i < passes.length - 1; i += 1) expect(passes[i]!.alpha).toBeGreaterThan(passes[i - 1]!.alpha);
  });

  it('élargit le trait du halo de deux fois sa portée de part et d\'autre du cœur', () => {
    const { g, passes } = fakeGraphics();
    neonLine(g, { x: 0, y: 0 }, { x: 10, y: 0 }, { ...TUBE, width: 3 });
    const layers = haloLayers();
    expect(passes.slice(0, layers.length).map((pass) => pass.width)).toEqual(layers.map((layer) => 3 + 2 * layer.reach));
  });

  it('un tube éteint (force nulle) n\'a plus que son cœur, à l\'opacité demandée', () => {
    const { g, passes } = fakeGraphics();
    neonCircle(g, 0, 0, 10, { ...TUBE, width: 2, strength: 0, alpha: 0.12 });
    expect(passes).toHaveLength(1);
    expect(passes[0]!.alpha).toBeCloseTo(0.12);
  });

  it('la passe demandée seule : tous les halos d\'abord, tous les cœurs ensuite', () => {
    const halo = fakeGraphics();
    neonCircle(halo.g, 0, 0, 10, { ...TUBE, width: 2, pass: 'halo' });
    expect(halo.passes).toHaveLength(NEON_PASSES - 1);
    expect(halo.passes.every((pass) => pass.color === TUBE.halo)).toBe(true);
    const core = fakeGraphics();
    neonCircle(core.g, 0, 0, 10, { ...TUBE, width: 2, pass: 'core' });
    expect(core.passes).toHaveLength(1);
    expect(core.passes[0]!.color).toBe(TUBE.color);
  });

  it('une opacité de cœur plus faible adoucit aussi le halo', () => {
    const { g, passes } = fakeGraphics();
    neonCircle(g, 0, 0, 10, { ...TUBE, width: 2, alpha: 0.5 });
    const full = fakeGraphics();
    neonCircle(full.g, 0, 0, 10, { ...TUBE, width: 2 });
    passes.forEach((pass, index) => expect(pass.alpha).toBeCloseTo(full.passes[index]!.alpha * 0.5));
  });

  it('regroupe les rectangles d\'un lot : un seul ordre de dessin par passe, halo en rectangles pleins, cœur en contour', () => {
    const { g, passes } = fakeGraphics();
    neonRects(
      g,
      [
        { x: 0, y: 0, width: 10, height: 5 },
        { x: 20, y: 0, width: 10, height: 5 },
        { x: 40, y: 0, width: 10, height: 5 },
      ],
      { ...TUBE, width: 2 },
    );
    expect(passes).toHaveLength(NEON_PASSES);
    expect(passes.every((pass) => pass.shapes === 3)).toBe(true);
    // Un trait plus épais que le rectangle croiserait ses bords : le halo est fait de rectangles pleins.
    expect(passes.slice(0, -1).every((pass) => pass.kind === 'fill')).toBe(true);
    expect(passes.at(-1)!.kind).toBe('stroke');
  });

  it('un lot de rectangles se pose en deux temps : les halos, puis le contour net', () => {
    const rects = [{ x: 0, y: 0, width: 10, height: 5 }];
    const halo = fakeGraphics();
    neonRects(halo.g, rects, { ...TUBE, width: 2, pass: 'halo' });
    expect(halo.passes).toHaveLength(NEON_PASSES - 1);
    const core = fakeGraphics();
    neonRects(core.g, rects, { ...TUBE, width: 2, pass: 'core' });
    expect(core.passes).toHaveLength(1);
    expect(core.passes[0]).toMatchObject({ kind: 'stroke', color: TUBE.color });
  });

  it('ne trace rien d\'un lot vide', () => {
    const { g, passes } = fakeGraphics();
    neonRects(g, [], { ...TUBE, width: 2 });
    neonDiscs(g, [], 5, TUBE);
    expect(passes).toEqual([]);
  });

  it('transmet l\'extrémité et le raccord du trait', () => {
    const calls: unknown[] = [];
    const g = { circle: () => g, stroke: (style: unknown) => calls.push(style), fill: () => g } as unknown as Graphics;
    neonStroke(g, (target) => target.circle(0, 0, 1), { ...TUBE, width: 2, cap: 'round', join: 'bevel' });
    expect(calls.every((style) => (style as { cap: string; join: string }).cap === 'round' && (style as { join: string }).join === 'bevel')).toBe(true);
  });
});

describe('tube en surface', () => {
  it('élargit les disques du halo de leur portée, puis pose le cœur au rayon exact', () => {
    const { g, passes } = fakeGraphics();
    neonDiscs(g, [{ x: 5, y: 5 }], 10, TUBE);
    expect(passes).toHaveLength(NEON_PASSES);
    expect(passes.every((pass) => pass.kind === 'fill')).toBe(true);
    const layers = haloLayers();
    expect(passes.map((pass) => pass.radii[0])).toEqual([...layers.map((layer) => 10 + layer.reach), 10]);
    expect(passes.at(-1)!.color).toBe(TUBE.color);
  });

  it('regroupe tous les disques d\'une même couleur dans chaque passe', () => {
    const { g, passes } = fakeGraphics();
    neonDiscs(
      g,
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 40, y: 0 },
        { x: 60, y: 0 },
      ],
      6,
      TUBE,
    );
    expect(passes).toHaveLength(NEON_PASSES);
    expect(passes.every((pass) => pass.radii.length === 4)).toBe(true);
  });

  it('une étoile et une barre prennent aussi leurs trois passes', () => {
    const star = fakeGraphics();
    neonPoly(star.g, (grow) => [0, -10 - grow, 3, -3, 10 + grow, 0, 3, 3, 0, 10 + grow, -3, 3, -10 - grow, 0, -3, -3], TUBE);
    expect(star.passes).toHaveLength(NEON_PASSES);
    const bar = fakeGraphics();
    neonBar(bar.g, 0, 0, 100, 10, TUBE);
    expect(bar.passes).toHaveLength(NEON_PASSES);
  });
});

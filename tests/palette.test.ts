import { describe, expect, it } from 'vitest';
import type { MusicFamily } from '../src/data/musique';
import { COLOR, PALETTES, mixPalette, paletteFor, type Palette } from '../src/render/style';

/** Les cinq ambiances ; le menu reprend la première. */
const FAMILIES: readonly MusicFamily[] = ['biome1', 'biome2', 'biome3', 'biome4', 'boss'];

/** Les couleurs qui portent un sens, jamais ambiantes : cœur et halo de chaque espèce de prise, étoiles, obstacles, bords de la ville. */
const SPECIES: Record<string, number> = {
  star: COLOR.star,
  starHalo: COLOR.starHalo,
  fragile: COLOR.fragile,
  wear: COLOR.wear,
  booster: COLOR.booster,
  launcher: COLOR.launcher,
  electric: COLOR.electric,
  electricCharged: COLOR.electricCharged,
  eclipse: COLOR.eclipse,
  obstacleEdge: COLOR.obstacleEdge,
  cityEdge: COLOR.cityEdge,
};

const FIELDS = Object.keys(PALETTES.biome1) as (keyof Palette)[];

/** Les trois canaux d'une couleur 0xRRGGBB. */
function channels(color: number): number[] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function distance(a: number, b: number): number {
  const [ar = 0, ag = 0, ab = 0] = channels(a);
  const [br = 0, bg = 0, bb = 0] = channels(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

describe('palettes', () => {
  it('chaque famille a la sienne, et le menu reprend celle du premier biome', () => {
    for (const family of [...FAMILIES, 'menu'] as const) expect(paletteFor(family)).toBe(PALETTES[family]);
    expect(PALETTES.menu).toBe(PALETTES.biome1);
    // Le fond du premier biome est celui d'origine du jeu.
    expect(PALETTES.biome1.background).toBe(0x070b16);
    expect(PALETTES.biome1.halo).toBe(0x38e8ff);
  });

  it('les cinq ambiances sont toutes différentes : fond, halo, brume et ville', () => {
    for (let i = 0; i < FAMILIES.length; i += 1) {
      for (let j = i + 1; j < FAMILIES.length; j += 1) {
        const a = PALETTES[FAMILIES[i]!];
        const b = PALETTES[FAMILIES[j]!];
        expect(a).not.toEqual(b);
        for (const field of ['background', 'halo', 'tube', 'fog', 'fogEdge', 'city', 'accent'] as const) expect(a[field], `${FAMILIES[i]} / ${FAMILIES[j]} : ${field}`).not.toBe(b[field]);
        // Les halos se distinguent à l'œil, pas seulement au bit près.
        expect(distance(a.halo, b.halo), `${FAMILIES[i]} / ${FAMILIES[j]}`).toBeGreaterThan(60);
      }
    }
  });

  it('chaque couleur est un 0xRRGGBB, et le fond reste nuit : sombre, bien plus que le halo', () => {
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      for (const field of FIELDS) {
        expect(Number.isInteger(palette[field]), `${family}.${field}`).toBe(true);
        expect(palette[field]).toBeGreaterThanOrEqual(0);
        expect(palette[field]).toBeLessThanOrEqual(0xffffff);
      }
      expect(Math.max(...channels(palette.background)), family).toBeLessThan(0x20);
      expect(Math.max(...channels(palette.halo)), family).toBeGreaterThan(0xb0);
    }
  });

  it('plage sûre : aucune couleur ambiante ne se confond avec une espèce de prise, une étoile ou un obstacle', () => {
    for (const family of FAMILIES) {
      for (const field of FIELDS) {
        for (const [name, color] of Object.entries(SPECIES)) expect(PALETTES[family][field], `${family}.${field} / ${name}`).not.toBe(color);
      }
    }
  });
});

describe('mixPalette', () => {
  const a = PALETTES.biome1;
  const b = PALETTES.boss;

  it('aux extrémités, c\'est la palette donnée elle-même', () => {
    expect(mixPalette(a, b, 0)).toBe(a);
    expect(mixPalette(a, b, 1)).toBe(b);
    expect(mixPalette(a, b, -3)).toBe(a);
    expect(mixPalette(a, b, 7)).toBe(b);
  });

  it('mélange canal par canal : à mi-chemin, la moyenne de chaque champ', () => {
    const half = mixPalette(a, b, 0.5);
    for (const field of FIELDS) {
      const expected = channels(a[field]).map((channel, index) => Math.round((channel + channels(b[field])[index]!) / 2));
      expect(channels(half[field]), field).toEqual(expected);
    }
    expect(half.background).toBe(0x0d0910);
  });

  it('chaque canal reste entre les deux palettes, et s\'éloigne de la première à mesure que t grandit', () => {
    let before = a;
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const mixed = mixPalette(a, b, t);
      for (const field of FIELDS) {
        channels(mixed[field]).forEach((channel, index) => {
          const low = Math.min(channels(a[field])[index]!, channels(b[field])[index]!);
          const high = Math.max(channels(a[field])[index]!, channels(b[field])[index]!);
          expect(channel).toBeGreaterThanOrEqual(low);
          expect(channel).toBeLessThanOrEqual(high);
        });
      }
      expect(distance(mixed.halo, a.halo)).toBeGreaterThan(distance(before.halo, a.halo));
      before = mixed;
    }
  });

  it('est pure : les palettes données ne bougent pas, deux appels donnent la même chose, et mélanger deux palettes égales ne change rien', () => {
    const snapshot = JSON.stringify([a, b]);
    expect(mixPalette(a, b, 0.3)).toEqual(mixPalette(a, b, 0.3));
    expect(mixPalette(a, b, 0.3)).not.toBe(mixPalette(a, b, 0.3));
    expect(JSON.stringify([a, b])).toBe(snapshot);
    expect(mixPalette(b, b, 0.4)).toEqual(b);
  });
});

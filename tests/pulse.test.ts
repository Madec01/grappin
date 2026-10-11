import { describe, expect, it } from 'vitest';
import { SILENT_PULSE, pulseAt, syntheticRhythm, type Pulse } from '../src/audio/rhythm';
import type { MusicFamily } from '../src/data/musique';
import { PULSE, ambientHalo, cityLots, effectColor, fogSheetAlpha, multiplierPop, pulsedPalette, rimBoost, speciesGlow, starSparkle, uiGlow } from '../src/render/pulse';
import { COLOR, PALETTES, type Palette } from '../src/render/style';

/** Les cinq ambiances ; le menu reprend la première. */
const FAMILIES: readonly MusicFamily[] = ['biome1', 'biome2', 'biome3', 'biome4', 'boss'];
const FIELDS = Object.keys(PALETTES.biome1) as (keyof Palette)[];

/** Les couleurs qui portent un sens : aucune couleur d'ambiance ne doit jamais en prendre une. */
const SPECIES: readonly number[] = [
  COLOR.star,
  COLOR.starHalo,
  COLOR.fragile,
  COLOR.wear,
  COLOR.booster,
  COLOR.launcher,
  COLOR.electric,
  COLOR.electricCharged,
  COLOR.eclipse,
  COLOR.obstacleEdge,
  COLOR.cityEdge,
];

/** Un pouls à la main : tout à zéro sauf ce qu'on précise. */
function pulse(parts: Partial<Pulse>): Pulse {
  return { ...SILENT_PULSE, ...parts };
}

/** Les trois canaux d'une couleur 0xRRGGBB. */
function channels(color: number): number[] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/** Le plus grand écart de canal entre deux couleurs. */
function gap(a: number, b: number): number {
  const ca = channels(a);
  const cb = channels(b);
  return Math.max(...ca.map((channel, index) => Math.abs(channel - cb[index]!)));
}

/** Pouls d'un métronome à 120 temps par minute, à l'instant `t`. */
const metronome = syntheticRhythm(120, 120);
const beatAt = (t: number): Pulse => pulseAt(metronome, t);

/** Une grille de pouls qui couvre le domaine, bords compris. */
function grid(): Pulse[] {
  const levels = [0, 0.05, 0.3, 0.7, 1];
  const out: Pulse[] = [];
  for (const beat of levels) {
    for (const strength of levels) {
      for (const bass of levels) {
        for (const high of [0, 0.5, 1]) out.push(pulse({ beat, strength, bass, mid: 0.5, high, count: 3, inBar: 3, bars: 5, bpm: 120 }));
      }
    }
  }
  return out;
}

describe('au silence, rien ne bouge', () => {
  it('pulsedPalette rend la palette reçue elle-même, pour chaque ambiance', () => {
    for (const family of [...FAMILIES, 'menu'] as const) expect(pulsedPalette(PALETTES[family], SILENT_PULSE)).toBe(PALETTES[family]);
  });

  it('un pouls sans temps ni graves (tempo connu, piste pas encore partie) est aussi muet', () => {
    const waiting = pulse({ bpm: 120, mid: 0.9, high: 0.9 });
    for (const family of FAMILIES) expect(pulsedPalette(PALETTES[family], waiting)).toBe(PALETTES[family]);
    // Un temps retombé à zéro avec une force restante ne change rien non plus, tant que la couleur d'effet est encore le halo.
    expect(pulsedPalette(PALETTES.biome2, pulse({ strength: 1, count: 4, inBar: 1, bars: 0 }))).toBe(PALETTES.biome2);
    // Mais plus loin dans la musique, la couleur d'effet a tourné : la palette n'est plus la même, même au creux du temps.
    expect(pulsedPalette(PALETTES.boss, pulse({ strength: 1, count: 40, inBar: 1, bars: 10 }))).not.toBe(PALETTES.boss);
  });

  it('chaque multiplicateur vaut exactement 1, chaque ajout exactement 0', () => {
    expect(ambientHalo(SILENT_PULSE)).toEqual({ spread: 1, strength: 1 });
    expect(speciesGlow(SILENT_PULSE)).toBe(1);
    expect(rimBoost(SILENT_PULSE)).toBe(1);
    expect(multiplierPop(SILENT_PULSE)).toBe(1);
    for (const base of [0, 0.5, 0.85, 1]) expect(fogSheetAlpha(base, SILENT_PULSE)).toBe(base);
    for (const seconds of [0, 0.13, 7.7, 1234.5]) {
      for (const seed of [0, 1, 17, 90210]) expect(starSparkle(SILENT_PULSE, seconds, seed)).toBe(1);
    }
    expect(cityLots(PALETTES.biome1, SILENT_PULSE)).toBeNull();
  });

  it('la couleur d\'effet est le halo, et le halo des titres l\'accent', () => {
    for (const family of FAMILIES) {
      expect(effectColor(PALETTES[family], SILENT_PULSE)).toBe(PALETTES[family].halo);
      expect(uiGlow(PALETTES[family], SILENT_PULSE)).toBe(PALETTES[family].accent);
    }
  });
});

describe('bornes', () => {
  it('le fond ne s\'éclaircit jamais de plus de 12 % vers la brume', () => {
    expect(PULSE.background.max).toBeLessThanOrEqual(0.15);
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      for (const sample of grid()) {
        const lit = pulsedPalette(palette, sample);
        channels(palette.background).forEach((from, index) => {
          const to = channels(palette.fog)[index]!;
          const now = channels(lit.background)[index]!;
          // Entre le fond et la brume, et à au plus 12 % du chemin (un cran d'arrondi près).
          expect(now, `${family} canal ${index}`).toBeGreaterThanOrEqual(Math.min(from, to));
          expect(Math.abs(now - from), `${family} canal ${index}`).toBeLessThanOrEqual(Math.abs(to - from) * 0.15 + 0.5);
        });
      }
    }
  });

  it('ne touche que le fond, la crête de brume, la ville et le halo : tout le reste est celui de la palette', () => {
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      for (const sample of grid()) {
        const lit = pulsedPalette(palette, sample);
        expect(Object.keys(lit).sort()).toEqual([...FIELDS].sort());
        for (const field of ['altitudeLine', 'altitudeLabel', 'roofFill', 'tube', 'pale', 'fog', 'accent'] as const) expect(lit[field], `${family}.${field}`).toBe(palette[field]);
      }
    }
  });

  it('la ville ne va qu\'à moitié vers le halo, la crête de brume s\'éclaircit sans dépasser le blanc', () => {
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      const bassy = pulsedPalette(palette, pulse({ bass: 1 }));
      expect(gap(bassy.city, palette.city)).toBeGreaterThan(0);
      // 50 % du chemin du trait de ville vers le halo, à un cran d'arrondi près.
      channels(palette.city).forEach((from, index) => {
        const to = channels(palette.halo)[index]!;
        expect(Math.abs(channels(bassy.city)[index]! - (from + (to - from) * PULSE.city.bass))).toBeLessThanOrEqual(0.5);
      });
      const edge = pulsedPalette(palette, pulse({ beat: 1, strength: 1, count: 1, inBar: 1 }));
      channels(palette.fogEdge).forEach((from, index) => {
        expect(channels(edge.fogEdge)[index]!).toBeGreaterThanOrEqual(from);
        expect(channels(edge.fogEdge)[index]!).toBeLessThanOrEqual(255);
      });
      expect(gap(edge.fogEdge, palette.fogEdge)).toBeGreaterThan(0);
    }
  });

  it('les multiplicateurs restent au moins à 1, et bornés par leurs réglages', () => {
    for (const sample of grid()) {
      const halo = ambientHalo(sample);
      expect(halo.spread).toBeGreaterThanOrEqual(1);
      expect(halo.spread).toBeLessThanOrEqual(1 + PULSE.halo.spread);
      expect(halo.strength).toBeGreaterThanOrEqual(1);
      expect(halo.strength).toBeLessThanOrEqual(1 + PULSE.halo.strength);
      expect(speciesGlow(sample)).toBeGreaterThanOrEqual(1);
      expect(speciesGlow(sample)).toBeLessThanOrEqual(1 + PULSE.species.strength);
      expect(rimBoost(sample)).toBeGreaterThanOrEqual(1);
      expect(rimBoost(sample)).toBeLessThanOrEqual(1 + PULSE.rim.strength);
      expect(multiplierPop(sample)).toBeGreaterThanOrEqual(1);
      expect(multiplierPop(sample)).toBeLessThanOrEqual(1 + PULSE.ui.multiplier);
      expect(fogSheetAlpha(0.85, sample)).toBeGreaterThanOrEqual(0.85);
      expect(fogSheetAlpha(0.85, sample)).toBeLessThanOrEqual(0.85 + PULSE.fogSheet.bass);
      expect(fogSheetAlpha(0.99, sample)).toBeLessThanOrEqual(1);
      const sparkle = starSparkle(sample, 3.21, 5);
      expect(sparkle).toBeGreaterThanOrEqual(1 - PULSE.star.reach);
      expect(sparkle).toBeLessThanOrEqual(1 + PULSE.star.reach);
    }
  });

  it('les réglages de pleine force sont ceux annoncés', () => {
    const full = pulse({ beat: 1, strength: 1, bass: 1, count: 1, inBar: 1 });
    expect(ambientHalo(full)).toEqual({ spread: 1.5, strength: 1.8 });
    expect(speciesGlow(full)).toBeCloseTo(1.35, 10);
    expect(rimBoost(full)).toBeCloseTo(1.4, 10);
    expect(multiplierPop(full)).toBeCloseTo(1.12, 10);
  });

  it('un pouls hors domaine (négatif, trop grand, NaN) ne sort pas des mêmes bornes', () => {
    const wild = [pulse({ beat: 9, strength: 5, bass: 7, high: 4, count: 2, inBar: 2, bars: 1 }), pulse({ beat: -3, strength: -1, bass: -2, high: -1, count: 2, inBar: 2, bars: 1 }), pulse({ beat: Number.NaN, strength: Number.NaN, bass: Number.NaN, high: Number.NaN, count: 2, inBar: 2, bars: 1 })];
    for (const sample of wild) {
      const halo = ambientHalo(sample);
      for (const value of [halo.spread, halo.strength, speciesGlow(sample), rimBoost(sample), multiplierPop(sample), fogSheetAlpha(0.85, sample), starSparkle(sample, 1.7, 3)]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(halo.spread).toBeGreaterThanOrEqual(1);
      expect(halo.spread).toBeLessThanOrEqual(1 + PULSE.halo.spread);
      const lit = pulsedPalette(PALETTES.biome2, sample);
      for (const field of FIELDS) expect(Number.isInteger(lit[field]) && lit[field] >= 0 && lit[field] <= 0xffffff, field).toBe(true);
    }
  });

  it('est pure : la palette donnée ne bouge pas, deux appels donnent la même chose', () => {
    const palette = PALETTES.biome3;
    const snapshot = JSON.stringify(palette);
    const hit = pulse({ beat: 1, strength: 1, bass: 0.6, count: 6, inBar: 2, bars: 1 });
    expect(pulsedPalette(palette, hit)).toEqual(pulsedPalette(palette, hit));
    expect(pulsedPalette(palette, hit)).not.toBe(palette);
    expect(JSON.stringify(palette)).toBe(snapshot);
  });
});

describe('la couleur d\'effet', () => {
  /** Les couleurs que la couleur d'effet parcourt, dans l'ordre. */
  const cycle = (palette: Palette): number[] => [palette.halo, palette.accent, palette.fogEdge];

  it('tourne halo, accent, crête de brume toutes les deux mesures, et recommence', () => {
    const palette = PALETTES.biome2;
    const [halo, accent, edge] = cycle(palette) as [number, number, number];
    // Un temps quelconque de chaque mesure (ici le deuxième : le fondu du premier temps est fini).
    const at = (bars: number): number => effectColor(palette, pulse({ beat: 0.4, strength: 1, count: bars * 4 + 1, inBar: 1, bars, bpm: 120 }));
    expect([0, 1].map(at)).toEqual([halo, halo]);
    expect([2, 3].map(at)).toEqual([accent, accent]);
    expect([4, 5].map(at)).toEqual([edge, edge]);
    expect([6, 7].map(at)).toEqual([halo, halo]);
    expect([8, 9].map(at)).toEqual([accent, accent]);
    // Avant le premier temps fort (mesures négatives), le halo.
    expect(at(-1)).toBe(halo);
  });

  it('au changement, le premier temps fond de l\'ancienne couleur vers la nouvelle', () => {
    const palette = PALETTES.biome2;
    const first = (beat: number): number => effectColor(palette, pulse({ beat, strength: 1, count: 8, inBar: 0, bars: 2, bpm: 120 }));
    expect(first(1)).toBe(palette.halo);
    expect(first(1e-9)).toBe(palette.accent);
    const middle = first(Math.exp(-1.5));
    expect(gap(middle, palette.halo)).toBeGreaterThan(0);
    expect(gap(middle, palette.accent)).toBeGreaterThan(0);
    // Le fondu ne dépend pas de la force du temps.
    expect(effectColor(palette, pulse({ beat: Math.exp(-1.5), strength: 0.2, count: 8, inBar: 0, bars: 2, bpm: 120 }))).toBe(middle);
  });

  it('suit un vrai métronome à 120 : halo, puis accent, puis crête, puis halo, sans jamais claquer d\'une image à l\'autre', () => {
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      const [halo, accent, edge] = cycle(palette) as [number, number, number];
      // Au plus un petit pas de couleur par image à 60 images par seconde, sur toute la durée de trois cycles.
      const widest = Math.max(gap(halo, accent), gap(accent, edge), gap(edge, halo));
      let previous = effectColor(palette, beatAt(0));
      const seen: number[] = [];
      for (let t = 1 / 60; t < 26; t += 1 / 60) {
        const color = effectColor(palette, beatAt(t));
        expect(gap(color, previous), `${family} à ${t.toFixed(3)} s`).toBeLessThanOrEqual(widest * 0.08 + 1);
        previous = color;
        if (seen[seen.length - 1] !== color) seen.push(color);
      }
      // Aux mesures 1, 3, 5, 7 (2 s, 6 s, 10 s, 14 s) : le plateau du bloc.
      expect(effectColor(palette, beatAt(2.2))).toBe(halo);
      expect(effectColor(palette, beatAt(6.2))).toBe(accent);
      expect(effectColor(palette, beatAt(10.2))).toBe(edge);
      expect(effectColor(palette, beatAt(14.2))).toBe(halo);
      expect(effectColor(palette, beatAt(18.2))).toBe(accent);
      // Le fondu vient bien de la couleur précédente : le premier instant d'un bloc est encore l'ancienne.
      expect(effectColor(palette, beatAt(4.0))).toBe(halo);
      expect(effectColor(palette, beatAt(8.0))).toBe(accent);
      expect(seen.length).toBeGreaterThan(3);
    }
  });

  it('le fondu va droit et sans retour de l\'ancienne couleur à la nouvelle', () => {
    const palette = PALETTES.biome2;
    let before = Number.POSITIVE_INFINITY;
    // Le temps qui commence la mesure 2, de t = 4 s à 4,5 s.
    for (let t = 4; t <= 4.5; t += 1 / 120) {
      const remaining = gap(effectColor(palette, beatAt(t)), palette.accent);
      expect(remaining).toBeLessThanOrEqual(before);
      before = remaining;
    }
    expect(before).toBeLessThanOrEqual(1);
  });

  it('reste une couleur d\'ambiance : jamais celle d\'une espèce de prise, d\'une étoile ou d\'un obstacle', () => {
    for (const family of FAMILIES) {
      for (let t = 0; t < 30; t += 1 / 30) {
        const color = effectColor(PALETTES[family], beatAt(t));
        for (const species of SPECIES) expect(color, `${family} à ${t.toFixed(2)} s`).not.toBe(species);
      }
    }
  });

  it('donne aussi le halo des titres dès que la musique marque les temps', () => {
    const palette = PALETTES.biome2;
    const hit = pulse({ beat: 0.4, strength: 1, count: 9, inBar: 1, bars: 2, bpm: 120 });
    expect(uiGlow(palette, hit)).toBe(effectColor(palette, hit));
    expect(uiGlow(palette, hit)).toBe(palette.accent);
  });
});

describe('le pouls dans la palette', () => {
  it('le fond, la crête et le halo suivent le pouls ; sur le temps le fond est plus clair, au creux presque à la palette', () => {
    const palette = PALETTES.biome2;
    const onBeat = pulsedPalette(palette, beatAt(1));
    // Le creux d'un temps : le pouls tombé à 5 %, sans graves (celles du métronome remontent un peu avant le temps suivant).
    const trough = pulsedPalette(palette, { ...beatAt(1.49), bass: 0 });
    const sum = (color: number): number => channels(color).reduce((a, b) => a + b, 0);
    expect(sum(onBeat.background)).toBeGreaterThan(sum(palette.background));
    expect(sum(onBeat.fogEdge)).toBeGreaterThan(sum(palette.fogEdge));
    expect(sum(onBeat.background)).toBeGreaterThan(sum(trough.background));
    expect(gap(trough.background, palette.background)).toBeLessThanOrEqual(2);
    expect(onBeat.halo).toBe(effectColor(palette, beatAt(1)));
  });

  it('les graves teintent la ville même hors du temps', () => {
    const palette = PALETTES.biome4;
    const quiet = pulsedPalette(palette, pulse({ count: 4, inBar: 0, bpm: 120 }));
    const bassy = pulsedPalette(palette, pulse({ count: 4, inBar: 0, bass: 0.8, bpm: 120 }));
    expect(quiet).toBe(palette);
    expect(gap(bassy.city, palette.city)).toBeGreaterThan(0);
    expect(gap(bassy.city, palette.halo)).toBeLessThan(gap(palette.city, palette.halo));
  });

  it('ne touche jamais les couleurs du langage du jeu, ni ne produit l\'une d\'elles', () => {
    const snapshot = JSON.stringify(COLOR);
    for (const family of FAMILIES) {
      for (const sample of grid()) {
        const lit = pulsedPalette(PALETTES[family], sample);
        for (const field of FIELDS) for (const species of SPECIES) expect(lit[field], `${family}.${field}`).not.toBe(species);
      }
    }
    expect(JSON.stringify(COLOR)).toBe(snapshot);
  });
});

describe('les immeubles qui dansent', () => {
  const palette = pulsedPalette(PALETTES.biome2, pulse({ beat: 1, strength: 1, count: 4, inBar: 0, bpm: 120 }));

  it('les pairs s\'allument sur les temps pairs, les impairs sur les autres, avec deux couleurs au plus', () => {
    for (const inBar of [0, 2]) {
      const lots = cityLots(palette, pulse({ beat: 1, strength: 1, count: 4 + inBar, inBar, bpm: 120 }));
      expect(lots).not.toBeNull();
      const [even, odd] = lots!;
      expect(odd).toBe(palette.city);
      expect(even).not.toBe(palette.city);
      // Allumé : plus près du halo que le trait de la palette.
      expect(gap(even, palette.halo)).toBeLessThan(gap(palette.city, palette.halo));
    }
    for (const inBar of [1, 3]) {
      const lots = cityLots(palette, pulse({ beat: 1, strength: 1, count: 4 + inBar, inBar, bpm: 120 }));
      const [even, odd] = lots!;
      expect(even).toBe(palette.city);
      expect(odd).not.toBe(palette.city);
    }
  });

  it('retombent avec le temps, et s\'éteignent d\'un coup de lot : sans temps, un seul lot', () => {
    const lit = (beat: number): number => cityLots(palette, pulse({ beat, strength: 1, count: 4, inBar: 0, bpm: 120 }))?.[0] ?? palette.city;
    expect(gap(lit(1), palette.city)).toBeGreaterThan(gap(lit(0.5), palette.city));
    expect(gap(lit(0.5), palette.city)).toBeGreaterThan(gap(lit(0.1), palette.city));
    expect(cityLots(palette, pulse({ beat: 0, strength: 1, count: 4, inBar: 0, bpm: 120 }))).toBeNull();
    expect(cityLots(palette, pulse({ beat: 1, strength: 0, count: 4, inBar: 0, bpm: 120 }))).toBeNull();
  });
});

describe('le scintillement des étoiles', () => {
  const treble = (high: number): Pulse => pulse({ high, count: 4, inBar: 0, bpm: 120 });

  it('croît avec les aigus : son écart à 1 est proportionnel, et nul sans aigus', () => {
    for (let seconds = 0; seconds < 12; seconds += 0.37) {
      const half = Math.abs(starSparkle(treble(0.5), seconds, 3) - 1);
      const full = Math.abs(starSparkle(treble(1), seconds, 3) - 1);
      expect(full).toBeCloseTo(half * 2, 10);
      expect(starSparkle(treble(0), seconds, 3)).toBe(1);
    }
  });

  it('est déterministe, décalé d\'une étoile à l\'autre, et doux d\'une image à l\'autre', () => {
    expect(starSparkle(treble(1), 4.2, 7)).toBe(starSparkle(treble(1), 4.2, 7));
    const sample = (seed: number): number[] => Array.from({ length: 60 }, (_, i) => starSparkle(treble(1), i / 5, seed));
    expect(sample(1)).not.toEqual(sample(2));
    // À soixante images par seconde, jamais plus que la pente maximale d'une courbe douce entre deux tirages extrêmes.
    const steepest = (2 * PULSE.star.reach * 1.5 * PULSE.star.hz) / 60;
    let previous = starSparkle(treble(1), 0, 9);
    for (let t = 1 / 60; t < 10; t += 1 / 60) {
      const value = starSparkle(treble(1), t, 9);
      expect(Math.abs(value - previous)).toBeLessThanOrEqual(steepest + 1e-9);
      previous = value;
    }
  });
});

describe('les réglages', () => {
  it('sont tous des parts entre 0 et 1, et le fond ne peut pas dépasser son plafond', () => {
    for (const group of Object.values(PULSE)) {
      for (const [name, value] of Object.entries(group)) {
        if (name === 'bars' || name === 'hz') continue;
        expect(value, name).toBeGreaterThanOrEqual(0);
        expect(value, name).toBeLessThanOrEqual(1);
      }
    }
    expect(PULSE.background.beat + PULSE.background.bass).toBeLessThanOrEqual(PULSE.background.max + 1e-12);
    expect(PULSE.effect.bars).toBe(2);
  });
});

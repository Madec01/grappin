import { describe, expect, it } from 'vitest';
import { BEAT_DECAY, SILENT_PULSE, pulseAt, syntheticRhythm, type Pulse } from '../src/audio/rhythm';
import type { MusicFamily } from '../src/data/musique';
import { PULSE, PUNCH_MAX, ambientHalo, cityLots, cityStroke, effectColor, fogSheetAlpha, multiplierPop, pulsedPalette, rimBoost, speciesGlow, starSparkle, uiGlow } from '../src/render/pulse';
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
    // Dès que la musique marque les temps, la couleur d'effet est celle du temps : la palette n'est plus la même, même au creux du temps.
    expect(pulsedPalette(PALETTES.biome2, pulse({ strength: 1, count: 4, inBar: 1, bars: 0 }))).not.toBe(PALETTES.biome2);
    expect(pulsedPalette(PALETTES.boss, pulse({ strength: 1, count: 40, inBar: 1, bars: 10 }))).not.toBe(PALETTES.boss);
  });

  it('chaque multiplicateur vaut exactement 1, chaque ajout exactement 0', () => {
    expect(ambientHalo(SILENT_PULSE)).toEqual({ spread: 1, strength: 1 });
    expect(cityStroke(SILENT_PULSE)).toEqual({ width: 1, alpha: 1 });
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
  it('le fond ne s\'éclaircit jamais de plus de son plafond vers la brume', () => {
    // Monté de 0,24 à 0,4 sur demande d'un pouls nerveux (0.12.1) : au-delà, le fond concurrencerait les tubes.
    expect(PULSE.background.max).toBeLessThanOrEqual(0.4);
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      for (const sample of grid()) {
        const lit = pulsedPalette(palette, sample);
        const effect = channels(effectColor(palette, sample));
        channels(palette.background).forEach((from, index) => {
          const to = channels(palette.fog)[index]!;
          const now = channels(lit.background)[index]!;
          // Vers la brume d'au plus le plafond du chemin, puis vers la couleur d'effet d'au plus sa part (un cran d'arrondi près à chaque mélange).
          expect(now, `${family} canal ${index}`).toBeGreaterThanOrEqual(Math.min(from, to, effect[index]!));
          const towardFog = Math.abs(to - from) * PULSE.background.max + 0.5;
          const towardEffect = Math.abs(effect[index]! - from) * PULSE.background.tint * PUNCH_MAX + 0.5;
          expect(Math.abs(now - from), `${family} canal ${index}`).toBeLessThanOrEqual(towardFog + towardEffect);
        });
      }
    }
  });

  it('ne touche que le fond, la crête de brume, la dalle du toit, la ville et le halo : tout le reste est celui de la palette', () => {
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      for (const sample of grid()) {
        const lit = pulsedPalette(palette, sample);
        expect(Object.keys(lit).sort()).toEqual([...FIELDS].sort());
        for (const field of ['altitudeLine', 'altitudeLabel', 'tube', 'pale', 'fog', 'accent', 'effectA', 'effectB', 'effectC'] as const) expect(lit[field], `${family}.${field}`).toBe(palette[field]);
        // La dalle du toit ne va vers la couleur d'effet que de sa part, sur le temps.
        const effect = channels(effectColor(palette, sample));
        channels(palette.roofFill).forEach((from, index) => {
          expect(Math.abs(channels(lit.roofFill)[index]! - from), `${family} dalle canal ${index}`).toBeLessThanOrEqual(Math.abs(effect[index]! - from) * PULSE.roof.beat * PUNCH_MAX + 0.5);
        });
      }
    }
  });

  it('la ville va vers la couleur d\'effet de sa part avec les graves, la crête de brume s\'éclaircit sans dépasser le blanc', () => {
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      const bassy = pulsedPalette(palette, pulse({ bass: 1 }));
      expect(gap(bassy.city, palette.city)).toBeGreaterThan(0);
      // La part réglée du chemin du trait de ville vers la couleur d'effet (ici le halo : rien ne bat), à un cran d'arrondi près.
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
      expect(halo.spread).toBeLessThanOrEqual(1 + PULSE.halo.spread * PUNCH_MAX);
      expect(halo.strength).toBeGreaterThanOrEqual(1);
      expect(halo.strength).toBeLessThanOrEqual(1 + PULSE.halo.strength * PUNCH_MAX);
      expect(speciesGlow(sample)).toBeGreaterThanOrEqual(1);
      expect(speciesGlow(sample)).toBeLessThanOrEqual(1 + PULSE.species.strength * PUNCH_MAX);
      expect(rimBoost(sample)).toBeGreaterThanOrEqual(1);
      expect(rimBoost(sample)).toBeLessThanOrEqual(1 + PULSE.rim.strength * PUNCH_MAX);
      expect(multiplierPop(sample)).toBeGreaterThanOrEqual(1);
      expect(multiplierPop(sample)).toBeLessThanOrEqual(1 + PULSE.ui.multiplier * PUNCH_MAX);
      const stroke = cityStroke(sample);
      expect(stroke.width).toBeGreaterThanOrEqual(1);
      expect(stroke.width).toBeLessThanOrEqual(1 + PULSE.city.width * PUNCH_MAX);
      expect(stroke.alpha).toBeGreaterThanOrEqual(1);
      expect(stroke.alpha).toBeLessThanOrEqual(1 + PULSE.city.alpha * PUNCH_MAX);
      expect(fogSheetAlpha(0.85, sample)).toBeGreaterThanOrEqual(0.85);
      expect(fogSheetAlpha(0.85, sample)).toBeLessThanOrEqual(0.85 + PULSE.fogSheet.bass);
      expect(fogSheetAlpha(0.99, sample)).toBeLessThanOrEqual(1);
      const sparkle = starSparkle(sample, 3.21, 5);
      expect(sparkle).toBeGreaterThanOrEqual(1 - PULSE.star.reach);
      expect(sparkle).toBeLessThanOrEqual(1 + PULSE.star.reach);
    }
  });

  it('les réglages de pleine force sont ceux annoncés, et le temps fort frappe plus fort', () => {
    const full = pulse({ beat: 1, strength: 1, bass: 1, count: 1, inBar: 1 });
    expect(ambientHalo(full).spread).toBeCloseTo(1.8, 10);
    expect(ambientHalo(full).strength).toBeCloseTo(2, 10);
    expect(speciesGlow(full)).toBeCloseTo(1.9, 10);
    expect(rimBoost(full)).toBeCloseTo(2, 10);
    expect(multiplierPop(full)).toBeCloseTo(1.3, 10);
    expect(cityStroke(full).width).toBeCloseTo(1.8, 10);
    expect(cityStroke(full).alpha).toBeCloseTo(1.6, 10);
    const downbeat = pulse({ beat: 1, strength: 1, bass: 1, count: 4, inBar: 0 });
    expect(ambientHalo(downbeat).spread).toBeCloseTo(1 + 0.8 * PUNCH_MAX, 10);
    expect(multiplierPop(downbeat)).toBeCloseTo(1 + 0.3 * PUNCH_MAX, 10);
    expect(PUNCH_MAX).toBeCloseTo(1.5, 10);
  });

  it('un temps moyen frappe presque à plein, un temps faible frappe encore, un temps absent pas du tout', () => {
    const at = (strength: number): number => multiplierPop(pulse({ beat: 1, strength, count: 1, inBar: 1 })) - 1;
    // Sur les pistes du jeu, la force médiane d'un temps est entre 0,35 et 0,65 : le coup y vaut plus des deux tiers du plein.
    expect(at(0.35)).toBeGreaterThan(PULSE.ui.multiplier * 0.7);
    expect(at(0.6)).toBeGreaterThan(PULSE.ui.multiplier * 0.8);
    expect(at(0.05)).toBeGreaterThanOrEqual(PULSE.ui.multiplier * PULSE.beat.floor);
    expect(at(1)).toBeCloseTo(PULSE.ui.multiplier, 10);
    // Plus fort est le temps, plus fort est le coup, jamais au-delà du plein.
    for (const [weak, strong] of [[0, 0.1], [0.1, 0.5], [0.5, 0.9], [0.9, 1]]) expect(at(weak!)).toBeLessThan(at(strong!));
    expect(multiplierPop(pulse({ beat: 0, strength: 1, count: 1, inBar: 1 }))).toBe(1);
  });

  it('les graves ne comptent qu\'au-dessus de leur seuil, puis jusqu\'à fond', () => {
    expect(rimBoost(pulse({ bass: PULSE.bass.from }))).toBe(1);
    expect(fogSheetAlpha(0.5, pulse({ bass: PULSE.bass.from - 0.05 }))).toBe(0.5);
    expect(rimBoost(pulse({ bass: 1 }))).toBeCloseTo(1 + PULSE.rim.strength, 10);
    expect(rimBoost(pulse({ bass: (1 + PULSE.bass.from) / 2 }))).toBeCloseTo(1 + PULSE.rim.strength / 2, 10);
    for (const family of FAMILIES) expect(pulsedPalette(PALETTES[family], pulse({ bass: PULSE.bass.from }))).toBe(PALETTES[family]);
  });

  it('un pouls hors domaine (négatif, trop grand, NaN) ne sort pas des mêmes bornes', () => {
    const wild = [pulse({ beat: 9, strength: 5, bass: 7, high: 4, count: 2, inBar: 2, bars: 1 }), pulse({ beat: -3, strength: -1, bass: -2, high: -1, count: 2, inBar: 2, bars: 1 }), pulse({ beat: Number.NaN, strength: Number.NaN, bass: Number.NaN, high: Number.NaN, count: 2, inBar: 2, bars: 1 })];
    for (const sample of wild) {
      const halo = ambientHalo(sample);
      for (const value of [halo.spread, halo.strength, speciesGlow(sample), rimBoost(sample), multiplierPop(sample), fogSheetAlpha(0.85, sample), starSparkle(sample, 1.7, 3)]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(halo.spread).toBeGreaterThanOrEqual(1);
      expect(halo.spread).toBeLessThanOrEqual(1 + PULSE.halo.spread * PUNCH_MAX);
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
  /** Les couleurs d'effet d'une palette, dans l'ordre des temps de la mesure : A, B, C, B. */
  const sequence = (palette: Palette): number[] => [palette.effectA, palette.effectB, palette.effectC, palette.effectB];

  it('change à chaque temps : A sur le temps fort, puis B, C, B, et recommence', () => {
    const palette = PALETTES.biome2;
    const [a, b, c] = sequence(palette) as [number, number, number, number];
    // Loin dans le temps (le fondu du début est fini).
    const at = (count: number): number => effectColor(palette, pulse({ beat: 0.2, strength: 1, count, inBar: count % 4, bars: Math.floor(count / 4), bpm: 120 }));
    expect([0, 1, 2, 3].map(at)).toEqual([a, b, c, b]);
    expect([4, 5, 6, 7].map(at)).toEqual([a, b, c, b]);
    expect([40, 41].map(at)).toEqual([a, b]);
    // Avant le premier temps, le halo.
    expect(effectColor(palette, pulse({ beat: 0.2, count: -1 }))).toBe(palette.halo);
  });

  it('au début de chaque temps, fond de la couleur du temps précédent vers la nouvelle, puis tient franche', () => {
    const palette = PALETTES.biome2;
    const [a, b] = sequence(palette) as [number, number, number, number];
    // Le deuxième temps : il vient de B ? Non : de A, le temps fort qui le précède.
    const second = (beat: number): number => effectColor(palette, pulse({ beat, strength: 1, count: 5, inBar: 1, bars: 1, bpm: 120 }));
    expect(second(1)).toBe(a);
    expect(second(1e-9)).toBe(b);
    const middle = second(Math.exp(-BEAT_DECAY * PULSE.effect.blend * 0.5));
    expect(gap(middle, a)).toBeGreaterThan(0);
    expect(gap(middle, b)).toBeGreaterThan(0);
    // Passé la part de fondu, la couleur est franche.
    expect(second(Math.exp(-BEAT_DECAY * PULSE.effect.blend * 1.01))).toBe(b);
    // Le fondu ne dépend pas de la force du temps.
    expect(effectColor(palette, pulse({ beat: Math.exp(-0.45), strength: 0.2, count: 5, inBar: 1, bars: 1, bpm: 120 }))).toBe(second(Math.exp(-0.45)));
    // Le temps fort revient de B (le quatrième temps) vers A.
    const first = (beat: number): number => effectColor(palette, pulse({ beat, strength: 1, count: 8, inBar: 0, bars: 2, bpm: 120 }));
    expect(first(1)).toBe(b);
    expect(first(1e-9)).toBe(a);
  });

  it('suit un vrai métronome à 120 : une couleur par temps, un fondu court, sans jamais claquer d\'une image à l\'autre', () => {
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      const [a, b, c] = sequence(palette) as [number, number, number, number];
      const widest = Math.max(gap(a, b), gap(b, c), gap(c, a));
      // Le fondu dure `blend` d'un temps de 0,5 s : à 60 images par seconde, au plus une dizaine d'images pour tout l'écart.
      const framesPerBlend = Math.max(1, Math.floor((PULSE.effect.blend * 0.5) / (1 / 60)));
      let previous = effectColor(palette, beatAt(0));
      const seen = new Set<number>();
      for (let t = 1 / 60; t < 10; t += 1 / 60) {
        const color = effectColor(palette, beatAt(t));
        expect(gap(color, previous), `${family} à ${t.toFixed(3)} s`).toBeLessThanOrEqual((1.5 * widest) / framesPerBlend + 1);
        previous = color;
        seen.add(color);
      }
      // Au milieu de chaque temps (fondu fini) : A à 0,25 s, B à 0,75 s, C à 1,25 s, B à 1,75 s, A à 2,25 s.
      expect(effectColor(palette, beatAt(0.25))).toBe(a);
      expect(effectColor(palette, beatAt(0.75))).toBe(b);
      expect(effectColor(palette, beatAt(1.25))).toBe(c);
      expect(effectColor(palette, beatAt(1.75))).toBe(b);
      expect(effectColor(palette, beatAt(2.25))).toBe(a);
      expect(seen.has(a) && seen.has(b) && seen.has(c)).toBe(true);
    }
  });

  it('le fondu va droit et sans retour de l\'ancienne couleur à la nouvelle', () => {
    const palette = PALETTES.biome2;
    let before = Number.POSITIVE_INFINITY;
    // Le deuxième temps, de t = 0,5 s à 0,75 s : de A vers B.
    for (let t = 0.5; t <= 0.75; t += 1 / 240) {
      const remaining = gap(effectColor(palette, beatAt(t)), palette.effectB);
      expect(remaining).toBeLessThanOrEqual(before);
      before = remaining;
    }
    expect(before).toBe(0);
  });

  it('reste une couleur d\'ambiance : jamais celle d\'une espèce de prise, d\'une étoile ou d\'un obstacle', () => {
    for (const family of FAMILIES) {
      for (let t = 0; t < 10; t += 1 / 30) {
        const color = effectColor(PALETTES[family], beatAt(t));
        for (const species of SPECIES) expect(color, `${family} à ${t.toFixed(2)} s`).not.toBe(species);
      }
    }
  });

  it('supporte une place dans la mesure hors domaine', () => {
    const palette = PALETTES.boss;
    expect(effectColor(palette, pulse({ beat: 0.2, count: 3, inBar: 7 }))).toBe(palette.effectB);
    expect(effectColor(palette, pulse({ beat: 0.2, count: 3, inBar: -1 }))).toBe(palette.effectB);
    expect(effectColor(palette, pulse({ beat: 0.2, count: 3, inBar: Number.NaN }))).toBe(palette.effectA);
  });

  it('donne aussi le halo des titres dès que la musique marque les temps', () => {
    const palette = PALETTES.biome2;
    const hit = pulse({ beat: 0.2, strength: 1, count: 9, inBar: 1, bars: 2, bpm: 120 });
    expect(uiGlow(palette, hit)).toBe(effectColor(palette, hit));
    expect(uiGlow(palette, hit)).toBe(palette.effectB);
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

describe('les structures du décor qui dansent', () => {
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
    // Un temps sans force frappe encore au plancher : la ville s'allume, moins qu'à plein.
    const weak = cityLots(palette, pulse({ beat: 1, strength: 0, count: 4, inBar: 0, bpm: 120 }))?.[0] ?? palette.city;
    expect(gap(weak, palette.city)).toBeGreaterThan(0);
    expect(gap(weak, palette.city)).toBeLessThan(gap(lit(1), palette.city));
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
  it('sont des parts entre 0 et 1 ou des gains bornés, et le fond ne peut pas dépasser son plafond', () => {
    // Les gains disent de combien un multiplicateur grandit sur un coup plein : jamais plus du double. Le reste sont des parts.
    const gains = new Set(['beat.downbeat', 'halo.spread', 'halo.strength', 'species.strength', 'rim.strength', 'ui.multiplier', 'city.width', 'city.alpha']);
    for (const [groupName, group] of Object.entries(PULSE)) {
      for (const [name, value] of Object.entries(group)) {
        if (name === 'hz') continue;
        expect(value, `${groupName}.${name}`).toBeGreaterThanOrEqual(0);
        expect(value, `${groupName}.${name}`).toBeLessThanOrEqual(gains.has(`${groupName}.${name}`) ? 2 : 1);
      }
    }
    expect(PULSE.background.beat + PULSE.background.bass).toBeLessThanOrEqual(PULSE.background.max + 1e-12);
    expect(PULSE.effect.blend).toBeGreaterThan(0);
    expect(PULSE.effect.blend).toBeLessThanOrEqual(0.5);
  });
});

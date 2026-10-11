import { describe, expect, it } from 'vitest';
import { analyseRhythm, fft } from '../src/audio/analysis';
import { createRng } from '../src/core/math/rng';

const SAMPLE_RATE = 22050;

/** Un morceau de batterie synthétique : un coup de grosse caisse ou un coup de charleston sur chaque temps, selon le motif. */
function drumTrack(bpm: number, seconds: number, pattern: readonly ('kick' | 'hat' | 'rest')[], offset = 0): Float32Array {
  const rng = createRng(7);
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < samples.length; i += 1) samples[i] = (rng.next() - 0.5) * 0.02;
  const period = 60 / bpm;
  for (let beat = 0; ; beat += 1) {
    const start = offset + beat * period;
    if (start >= seconds) break;
    const hit = pattern[beat % pattern.length]!;
    if (hit === 'rest') continue;
    const from = Math.round(start * SAMPLE_RATE);
    if (hit === 'kick') {
      // Une sinusoïde grave qui s'éteint en 80 ms, et un clic.
      for (let n = 0; n < Math.round(0.25 * SAMPLE_RATE) && from + n < samples.length; n += 1) {
        const t = n / SAMPLE_RATE;
        samples[from + n] = samples[from + n]! + 0.8 * Math.exp(-t / 0.08) * Math.sin(2 * Math.PI * 60 * t);
      }
    }
    const clickLength = Math.round((hit === 'kick' ? 0.004 : 0.012) * SAMPLE_RATE);
    for (let n = 0; n < clickLength && from + n < samples.length; n += 1) {
      samples[from + n] = samples[from + n]! + (hit === 'kick' ? 0.5 : 0.35) * (rng.next() - 0.5) * 2;
    }
  }
  return samples;
}

/** L'écart entre un instant et le temps vrai le plus proche d'une grille. */
function gridError(t: number, period: number, offset: number): number {
  const phase = (t - offset) / period;
  return Math.abs(phase - Math.round(phase)) * period;
}

describe('la transformée de Fourier', () => {
  it('place une sinusoïde dans sa case', () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i += 1) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    fft(re, im);
    const magnitudes = Array.from(re, (value, k) => Math.hypot(value, im[k]!));
    expect(magnitudes[5]).toBeCloseTo(32, 6);
    expect(magnitudes[59]).toBeCloseTo(32, 6);
    magnitudes.forEach((value, k) => {
      if (k !== 5 && k !== 59) expect(value).toBeLessThan(1e-9);
    });
  });
});

describe("l'analyse du rythme", () => {
  it('retrouve le tempo et pose les temps sur les coups', () => {
    const bpm = 128;
    const offset = 0.2;
    const rhythm = analyseRhythm(drumTrack(bpm, 30, ['kick'], offset), SAMPLE_RATE);
    expect(rhythm.duration).toBeCloseTo(30, 3);
    expect(Math.abs(rhythm.bpm - bpm)).toBeLessThan(1.5);
    const period = 60 / bpm;
    const expected = Math.floor((30 - offset) / period) + 1;
    expect(Math.abs(rhythm.beats.length - expected)).toBeLessThanOrEqual(3);
    const errors = rhythm.beats.map((t) => gridError(t, period, offset));
    const onGrid = errors.filter((error) => error < 0.03).length;
    expect(onGrid / errors.length).toBeGreaterThan(0.9);
    // Les coups sont tous francs : la force est haute partout.
    const meanStrength = rhythm.strength.reduce((sum, value) => sum + value, 0) / rhythm.strength.length;
    expect(meanStrength).toBeGreaterThan(0.6);
    for (let i = 1; i < rhythm.beats.length; i += 1) expect(rhythm.beats[i]!).toBeGreaterThan(rhythm.beats[i - 1]!);
  });

  it('devine le temps fort là où la grosse caisse frappe le plus fort', () => {
    const bpm = 120;
    const period = 60 / bpm;
    // Mesure : grosse caisse, charleston, grosse caisse plus douce (clic seul), charleston.
    const pattern = ['kick', 'hat', 'hat', 'hat'] as const;
    for (const lead of [0, 1]) {
      const shifted = [...pattern.slice(pattern.length - lead), ...pattern.slice(0, pattern.length - lead)];
      const rhythm = analyseRhythm(drumTrack(bpm, 24, shifted, 0.1), SAMPLE_RATE);
      const downbeatTime = rhythm.beats[rhythm.downbeat]!;
      // Le temps fort tombe sur une grosse caisse : à `lead` temps du début, puis toutes les mesures.
      const barPeriod = 4 * period;
      expect(gridError(downbeatTime, barPeriod, 0.1 + lead * period)).toBeLessThan(0.05);
    }
  });

  it('livre des bandes entre 0 et 1, à la cadence demandée, et un silence reste plat', () => {
    const rhythm = analyseRhythm(drumTrack(100, 6, ['kick']), SAMPLE_RATE, { envelopeRate: 10 });
    expect(rhythm.envelope.rate).toBe(10);
    expect(rhythm.envelope.bass.length).toBe(60);
    for (const value of [...rhythm.envelope.bass, ...rhythm.envelope.mid, ...rhythm.envelope.high]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...rhythm.envelope.bass)).toBeGreaterThan(0.8);
    const silence = analyseRhythm(new Float32Array(SAMPLE_RATE * 3), SAMPLE_RATE);
    expect(silence.beats).toEqual([]);
    expect(silence.envelope.bass.every((value) => value === 0)).toBe(true);
  });
});

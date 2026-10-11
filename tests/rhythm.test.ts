import { describe, expect, it } from 'vitest';
import { BEAT_DECAY, SILENT_PULSE, decodeBytes, decodeRhythm, encodeBytes, encodeRhythm, pulseAt, syntheticRhythm, type Rhythm } from '../src/audio/rhythm';

const METRONOME = syntheticRhythm(120, 10);

describe('le pouls', () => {
  it('vaut 1 sur un temps et retombe à 5 % juste avant le suivant', () => {
    expect(pulseAt(METRONOME, 0).beat).toBeCloseTo(1, 6);
    expect(pulseAt(METRONOME, 0.25).beat).toBeCloseTo(Math.exp(-BEAT_DECAY / 2), 6);
    expect(pulseAt(METRONOME, 0.499).beat).toBeCloseTo(Math.exp(-BEAT_DECAY), 2);
    expect(pulseAt(METRONOME, 0.5).beat).toBeCloseTo(1, 6);
  });

  it('compte les temps, leur place dans la mesure et les mesures écoulées', () => {
    expect(pulseAt(METRONOME, 0)).toMatchObject({ count: 0, inBar: 0, bars: 0, strength: 1, bpm: 120 });
    expect(pulseAt(METRONOME, 0.5)).toMatchObject({ count: 1, inBar: 1, bars: 0, strength: 0.7 });
    expect(pulseAt(METRONOME, 1.6)).toMatchObject({ count: 3, inBar: 3, bars: 0 });
    expect(pulseAt(METRONOME, 2)).toMatchObject({ count: 4, inBar: 0, bars: 1, strength: 1 });
  });

  it('respecte le temps fort désigné par downbeat', () => {
    const rhythm: Rhythm = { ...METRONOME, downbeat: 1 };
    expect(pulseAt(rhythm, 0)).toMatchObject({ count: 0, inBar: 3, bars: -1 });
    expect(pulseAt(rhythm, 0.5)).toMatchObject({ count: 1, inBar: 0, bars: 0 });
    expect(pulseAt(rhythm, 2.5)).toMatchObject({ count: 5, inBar: 0, bars: 1 });
  });

  it('avant le premier temps, seul le contenu des bandes bouge', () => {
    const rhythm: Rhythm = { ...METRONOME, beats: [0.3, 0.8], strength: [1, 1] };
    const pulse = pulseAt(rhythm, 0.1);
    expect(pulse).toMatchObject({ beat: 0, count: -1, inBar: 0, bars: 0, bpm: 120 });
    expect(pulse.bass).toBeGreaterThan(0);
  });

  it('reboucle avec la piste, et lit les bandes en interpolant entre deux échantillons', () => {
    expect(pulseAt(METRONOME, METRONOME.duration + 0.5)).toEqual(pulseAt(METRONOME, 0.5));
    const rhythm: Rhythm = { ...METRONOME, envelope: { rate: 10, bass: [0, 1], mid: [0.5], high: [] } };
    expect(pulseAt(rhythm, 0.05).bass).toBeCloseTo(0.5, 6);
    expect(pulseAt(rhythm, 0.1).bass).toBeCloseTo(1, 6);
    expect(pulseAt(rhythm, 5).bass).toBeCloseTo(1, 6);
    expect(pulseAt(rhythm, 3).mid).toBeCloseTo(0.5, 6);
    expect(pulseAt(rhythm, 3).high).toBe(0);
  });

  it('le silence est un pouls à zéro, sans temps', () => {
    expect(SILENT_PULSE).toEqual({ beat: 0, strength: 0, count: -1, inBar: 0, bars: 0, bass: 0, mid: 0, high: 0, bpm: 0 });
  });
});

describe('le métronome synthétique', () => {
  it('bat à la cadence demandée, temps fort à 1 et les autres à 0.7, avec des bandes qui bougent', () => {
    const rhythm = syntheticRhythm(90, 8);
    expect(rhythm.beats.length).toBe(12);
    expect(rhythm.beats[1]! - rhythm.beats[0]!).toBeCloseTo(60 / 90, 3);
    expect(rhythm.strength.slice(0, 5)).toEqual([1, 0.7, 0.7, 0.7, 1]);
    expect(rhythm.envelope.bass.length).toBe(8 * rhythm.envelope.rate);
    expect(Math.max(...rhythm.envelope.mid) - Math.min(...rhythm.envelope.mid)).toBeGreaterThan(0.5);
    for (const value of [...rhythm.envelope.bass, ...rhythm.envelope.mid, ...rhythm.envelope.high]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('le fichier de rythme', () => {
  it('encode des valeurs entre 0 et 1 en base64, et les relit à 1/255 près, quelle que soit la longueur', () => {
    for (const values of [[], [0.5], [0, 1], [0.1, 0.2, 0.3], [0.25, 0.5, 0.75, 1]]) {
      const decoded = decodeBytes(encodeBytes(values));
      expect(decoded.length).toBe(values.length);
      decoded.forEach((value, i) => expect(Math.abs(value - values[i]!)).toBeLessThanOrEqual(1 / 255));
    }
    expect(encodeBytes([1, 1, 1])).toBe('////');
    expect(decodeBytes(encodeBytes([2, -1]))).toEqual([1, 0]);
  });

  it('refuse un base64 mal formé', () => {
    expect(() => decodeBytes('abc')).toThrow();
    expect(() => decodeBytes('ab$=')).toThrow();
  });

  it('se relit tel quel', () => {
    const rhythm: Rhythm = { ...syntheticRhythm(128.4, 4), downbeat: 2 };
    const text = encodeRhythm(rhythm);
    const back = decodeRhythm(text);
    expect(back.bpm).toBeCloseTo(128.4, 3);
    expect(back.duration).toBe(4);
    expect(back.beatsPerBar).toBe(4);
    expect(back.downbeat).toBe(2);
    expect(back.beats).toEqual(rhythm.beats);
    expect(back.strength.length).toBe(rhythm.strength.length);
    expect(back.envelope.rate).toBe(rhythm.envelope.rate);
    expect(back.envelope.bass.length).toBe(rhythm.envelope.bass.length);
    back.envelope.high.forEach((value, i) => expect(Math.abs(value - rhythm.envelope.high[i]!)).toBeLessThanOrEqual(1 / 255));
    // Le pouls lu depuis le fichier est celui du rythme d'origine.
    expect(pulseAt(back, 1.3).count).toBe(pulseAt(rhythm, 1.3).count);
  });

  it('refuse ce qui n\'est pas un rythme', () => {
    expect(() => decodeRhythm('nope')).toThrow();
    expect(() => decodeRhythm('[]')).toThrow();
    expect(() => decodeRhythm('{}')).toThrow();
    const good = JSON.parse(encodeRhythm(syntheticRhythm(100, 2))) as Record<string, unknown>;
    expect(() => decodeRhythm(JSON.stringify({ ...good, beats: 'x' }))).toThrow();
    expect(() => decodeRhythm(JSON.stringify({ ...good, strength: 'AA==' }))).toThrow(/une force par temps/);
    expect(() => decodeRhythm(JSON.stringify({ ...good, envelope: { rate: 20 } }))).toThrow();
  });
});

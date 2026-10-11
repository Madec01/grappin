import { describe, expect, it, vi } from 'vitest';
import { PERFECT_PITCH_STEPS, RECIPES, browserSfx, cueFor, perfectPitch, silentSfx, type SoundId } from '../src/audio/sfx';
import type { RuleEvent } from '../src/sim/state';

const release = (parts: Partial<Extract<RuleEvent, { type: 'release' }>>): RuleEvent => ({ type: 'release', perfect: false, combo: 0, held: 0.5, kind: 'normal', forced: false, ...parts });

describe('les bruitages', () => {
  it('chaque événement du geste a sa note, les autres se taisent', () => {
    expect(cueFor({ type: 'attach', anchorId: 1 })).toEqual({ id: 'attach', pitch: 1 });
    expect(cueFor(release({}))).toEqual({ id: 'release', pitch: 1 });
    expect(cueFor(release({ perfect: true, combo: 1 }))).toEqual({ id: 'perfect', pitch: 1 });
    expect(cueFor(release({ kind: 'lanceur' }))).toEqual({ id: 'launch', pitch: 1 });
    // Un lâcher forcé ne sonne pas lui-même : la casse, la décharge ou le choc sonne à sa place.
    expect(cueFor(release({ forced: true }))).toBeNull();
    expect(cueFor({ type: 'boost' })).toEqual({ id: 'boost', pitch: 1 });
    expect(cueFor({ type: 'pickup', pickupId: 3, bonus: false })).toEqual({ id: 'pickup', pitch: 1 });
    expect(cueFor({ type: 'pickup', pickupId: 3, bonus: true })).toEqual({ id: 'pickup', pitch: 1.25 });
    expect(cueFor({ type: 'graze', obstacleId: 2 })).toEqual({ id: 'graze', pitch: 1 });
    expect(cueFor({ type: 'bump', obstacleId: 2 })).toEqual({ id: 'bump', pitch: 1 });
    expect(cueFor({ type: 'shock', anchorId: 2 })).toEqual({ id: 'shock', pitch: 1 });
    expect(cueFor({ type: 'break', anchorId: 2 })).toEqual({ id: 'break', pitch: 1 });
    expect(cueFor({ type: 'death', height: 10, cause: 'fog' })).toEqual({ id: 'fog', pitch: 1 });
    expect(cueFor({ type: 'death', height: 10, cause: 'fall' })).toEqual({ id: 'fall', pitch: 1 });
    expect(cueFor({ type: 'finish', height: 120 })).toEqual({ id: 'finish', pitch: 1 });
    expect(cueFor({ type: 'tier', tier: 2, name: 'x' })).toEqual({ id: 'tier', pitch: 1 });
  });

  it('la série monte la note du parfait d\'un demi-ton par parfait, jusqu\'à huit', () => {
    expect(perfectPitch(0)).toBe(1);
    expect(perfectPitch(1)).toBe(1);
    expect(perfectPitch(2)).toBeCloseTo(Math.pow(2, 1 / 12), 10);
    expect(perfectPitch(1 + PERFECT_PITCH_STEPS)).toBeCloseTo(Math.pow(2, PERFECT_PITCH_STEPS / 12), 10);
    expect(perfectPitch(100)).toBe(perfectPitch(1 + PERFECT_PITCH_STEPS));
    expect(cueFor(release({ perfect: true, combo: 4 }))?.pitch).toBeCloseTo(perfectPitch(4), 10);
  });

  it('chaque son a une recette courte, à fréquences audibles et volumes raisonnables', () => {
    const ids: SoundId[] = ['attach', 'release', 'perfect', 'launch', 'boost', 'pickup', 'graze', 'bump', 'shock', 'break', 'fog', 'fall', 'finish', 'tier'];
    for (const id of ids) {
      const recipe = RECIPES[id];
      const parts = [...recipe.tones, ...(recipe.breaths ?? [])];
      expect(parts.length, id).toBeGreaterThan(0);
      for (const part of parts) {
        expect(part.seconds, id).toBeGreaterThan(0);
        expect(part.seconds + (part.at ?? 0), id).toBeLessThanOrEqual(1);
        expect(part.gain, id).toBeGreaterThan(0);
        expect(part.gain, id).toBeLessThanOrEqual(0.4);
        expect(part.from, id).toBeGreaterThanOrEqual(40);
        expect(part.to, id).toBeGreaterThanOrEqual(40);
        expect(Math.max(part.from, part.to), id).toBeLessThanOrEqual(8000);
      }
    }
  });

  it('le lecteur du navigateur crée son contexte audio à la construction, pas au premier geste, et le geste le reprend', () => {
    const calls: string[] = [];
    class FakeContext {
      state = 'suspended';
      sampleRate = 100;
      currentTime = 0;
      destination = {};
      constructor() {
        calls.push('new');
      }
      createGain() {
        return { gain: { value: 0 }, connect: () => undefined };
      }
      createBuffer(_channels: number, frames: number) {
        return { getChannelData: () => new Float32Array(frames) };
      }
      resume() {
        calls.push('resume');
        this.state = 'running';
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', FakeContext);
    try {
      const player = browserSfx();
      expect(calls).toEqual(['new']);
      player.unlock();
      expect(calls).toEqual(['new', 'resume']);
      player.unlock();
      expect(calls).toEqual(['new', 'resume']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('le lecteur muet accepte tout sans rien faire', () => {
    const player = silentSfx();
    expect(() => {
      player.unlock();
      player.setEnabled(false);
      player.play({ id: 'perfect', pitch: 1.5 });
    }).not.toThrow();
  });
});

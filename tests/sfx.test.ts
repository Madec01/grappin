import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ESCAPE_PITCH, PERFECT_PITCH_STEPS, SAMPLES, browserSfx, cueFor, perfectPitch, silentSfx, type SoundId } from '../src/audio/sfx';
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
    // Un rail lance comme un lanceur ; un passage qui se referme sonne grave, avec l'échantillon du rebond.
    expect(cueFor(release({ kind: 'rail' }))).toEqual({ id: 'launch', pitch: 1 });
    expect(cueFor({ type: 'escape', obstacleId: 4 })).toEqual({ id: 'bounce', pitch: ESCAPE_PITCH });
  });

  it('la série monte la note du parfait d\'un demi-ton par parfait, jusqu\'à huit', () => {
    expect(perfectPitch(0)).toBe(1);
    expect(perfectPitch(1)).toBe(1);
    expect(perfectPitch(2)).toBeCloseTo(Math.pow(2, 1 / 12), 10);
    expect(perfectPitch(1 + PERFECT_PITCH_STEPS)).toBeCloseTo(Math.pow(2, PERFECT_PITCH_STEPS / 12), 10);
    expect(perfectPitch(100)).toBe(perfectPitch(1 + PERFECT_PITCH_STEPS));
    expect(cueFor(release({ perfect: true, combo: 4 }))?.pitch).toBeCloseTo(perfectPitch(4), 10);
  });

  it('chaque son a son échantillon, présent dans public/sons, à volume raisonnable, et sa source est dite', () => {
    const ids: SoundId[] = ['attach', 'release', 'perfect', 'launch', 'boost', 'pickup', 'graze', 'bump', 'bounce', 'smash', 'ring', 'shock', 'break', 'fog', 'fall', 'finish', 'tier'];
    expect(Object.keys(SAMPLES).sort()).toEqual([...ids].sort());
    const files = new Set<string>();
    for (const id of ids) {
      const sample = SAMPLES[id];
      expect(sample.file, id).toMatch(/^sons\/[a-z]+\.mp3$/);
      expect(existsSync(resolve('public', sample.file)), sample.file).toBe(true);
      expect(statSync(resolve('public', sample.file)).size, sample.file).toBeLessThan(40_000);
      expect(sample.gain, id).toBeGreaterThan(0);
      expect(sample.gain, id).toBeLessThanOrEqual(1);
      expect(sample.source, id).toMatch(/^(Interface Sounds|Impact Sounds|Sci-fi Sounds|RPG Audio), /);
      files.add(sample.file);
    }
    expect(files.size).toBe(ids.length);
    expect(existsSync(resolve('public/sons/LICENCE-kenney.txt'))).toBe(true);
  });

  it('le lecteur du navigateur crée son contexte audio à la construction, pas au premier geste, et le geste le reprend ; les échantillons se chargent et jouent avec leur hauteur', async () => {
    const calls: string[] = [];
    const started: { rate: number; gain: number }[] = [];
    class FakeContext {
      state = 'suspended';
      sampleRate = 100;
      currentTime = 0;
      destination = {};
      constructor() {
        calls.push('new');
      }
      createGain() {
        const node = { gain: { value: 0 }, connect: () => node };
        return node;
      }
      createBufferSource() {
        const source = { buffer: null as unknown, playbackRate: { value: 1 }, connect: (node: { gain: { value: number } }) => ({ connect: () => undefined, gain: node.gain }), start: () => undefined };
        const origin = source.connect;
        source.connect = (node) => {
          started.push({ rate: source.playbackRate.value, gain: node.gain.value });
          return origin(node);
        };
        return source;
      }
      decodeAudioData(bytes: ArrayBuffer) {
        calls.push(`decode ${bytes.byteLength}`);
        return Promise.resolve({ length: bytes.byteLength });
      }
      resume() {
        calls.push('resume');
        this.state = 'running';
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', FakeContext);
    try {
      const fetched: string[] = [];
      const fetcher = (url: string) => {
        fetched.push(url);
        return Promise.resolve({ ok: !url.endsWith('frole.mp3'), arrayBuffer: () => Promise.resolve(new ArrayBuffer(url.length)) });
      };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const player = browserSfx('/jeu/', fetcher);
      expect(calls).toEqual(['new']);
      expect(fetched).toHaveLength(17);
      expect(fetched[0]).toBe('/jeu/sons/accroche.mp3');
      await new Promise((done) => setTimeout(done, 0));
      // Seize décodés : le frôlé, que le serveur a refusé, est signalé et ignoré.
      expect(calls.filter((call) => call.startsWith('decode'))).toHaveLength(16);
      expect(warn).toHaveBeenCalledTimes(1);
      // Rien ne joue avant le geste, ni sons coupés.
      player.play({ id: 'attach', pitch: 1 });
      expect(started).toHaveLength(0);
      player.unlock();
      expect(calls.filter((call) => call === 'resume')).toHaveLength(1);
      player.unlock();
      expect(calls.filter((call) => call === 'resume')).toHaveLength(1);
      player.play({ id: 'perfect', pitch: 1.5 });
      expect(started).toEqual([{ rate: 1.5, gain: SAMPLES.perfect.gain }]);
      player.play({ id: 'graze', pitch: 1 });
      expect(started).toHaveLength(1);
      player.setEnabled(false);
      player.play({ id: 'attach', pitch: 1 });
      expect(started).toHaveLength(1);
      warn.mockRestore();
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

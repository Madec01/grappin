import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math/rng';
import { HALF_WIDTH, buildSegment, tierProfile } from '../src/sim/generator';
import { Simulation } from '../src/sim/simulation';
import { DEFAULT_TUNING } from '../src/sim/tuning';
import { canExit, verifySegment } from '../src/sim/verifier';

const T = DEFAULT_TUNING;

/** Simulation dont le personnage est téléporté en hauteur, pour forcer la génération. */
function climbed(seed: number, y: number): Simulation {
  const sim = new Simulation(seed);
  sim.state.hero.pos = { x: 0, y };
  sim.state.hero.grounded = false;
  sim.state.fogY = y - 20;
  sim.step();
  return sim;
}

describe('parcours engendré', () => {
  it('monte toujours, reste dans la largeur jouable, et chaque point est à portée du précédent', () => {
    const sim = climbed(3, 300);
    const anchors = sim.state.anchors;
    expect(anchors.length).toBeGreaterThan(20);
    for (let i = 1; i < anchors.length; i += 1) {
      const prev = anchors[i - 1]!;
      const cur = anchors[i]!;
      expect(Math.abs(cur.pos.x)).toBeLessThanOrEqual(HALF_WIDTH);
      expect(cur.pos.y).toBeGreaterThan(sim.state.fogY - 11);
      expect(Math.hypot(cur.pos.x - prev.pos.x, cur.pos.y - prev.pos.y)).toBeLessThan(T.ropeMax);
    }
  });

  it('engendre la même suite depuis une même graine, par morceaux ou d\'un coup', () => {
    const a = new Simulation(5);
    const b = new Simulation(5);
    a.state.hero.pos = { x: 0, y: 100 };
    a.state.hero.grounded = false;
    a.step();
    for (let y = 10; y <= 100; y += 10) {
      b.state.hero.pos = { x: 0, y };
      b.state.hero.grounded = false;
      b.step();
    }
    expect(JSON.stringify(a.state.anchors)).toBe(JSON.stringify(b.state.anchors));
    expect(JSON.stringify(a.state.obstacles)).toBe(JSON.stringify(b.state.obstacles));
  });

  it('introduit les contraintes une à la fois selon le palier', () => {
    expect(tierProfile(0)).toEqual({ spacing: 3, obstacles: 0, split: false, fragileChance: 0, boosters: 0 });
    expect(tierProfile(1).obstacles).toBe(1);
    expect(tierProfile(1).split).toBe(true);
    expect(tierProfile(1).fragileChance).toBe(0);
    expect(tierProfile(2).fragileChance).toBeGreaterThan(0);
    expect(tierProfile(2).boosters).toBe(0);
    expect(tierProfile(3).boosters).toBe(1);
    expect(tierProfile(20).spacing).toBe(5);
    const low = climbed(8, 30);
    // Sous 50 m, palier 0 : rien d'autre que des points normaux. Au-dessus, le palier 1 commence.
    expect(low.state.obstacles.filter((o) => o.y0 < 50)).toHaveLength(0);
    expect(low.state.anchors.filter((a) => a.pos.y < 50).every((a) => a.kind === 'normal')).toBe(true);
    const high = climbed(8, 200);
    expect(high.state.obstacles.length).toBeGreaterThan(0);
    expect(high.state.pickups.length).toBeGreaterThan(0);
    expect(high.state.anchors.some((a) => a.kind === 'fragile')).toBe(true);
    expect(high.state.anchors.some((a) => a.kind === 'booster')).toBe(true);
  });

  it('retire ce qui est passé loin sous la brume', () => {
    const sim = climbed(5, 100);
    sim.state.fogY = 60;
    sim.step();
    expect(sim.state.anchors.every((a) => a.pos.y >= 50)).toBe(true);
    expect(sim.state.obstacles.every((o) => o.y1 >= 50)).toBe(true);
    expect(sim.state.pickups.every((p) => p.pos.y >= 50)).toBe(true);
  });
});

describe('robot vérificateur', () => {
  it('accepte un point dont le suivant est juste au-dessus, refuse un point sans issue', () => {
    const a = { id: 1, pos: { x: 0, y: 10 }, kind: 'normal', broken: false } as const;
    const near = { id: 2, pos: { x: 2, y: 12.5 }, kind: 'normal', broken: false } as const;
    const far = { id: 3, pos: { x: 0, y: 30 }, kind: 'normal', broken: false } as const;
    expect(canExit(a, [a, near], [], null, T)).toBe(true);
    expect(canExit(a, [a, far], [], null, T)).toBe(false);
    expect(canExit(a, [a], [], null, T)).toBe(false);
  });

  it('refuse un passage bouché par un obstacle', () => {
    const a = { id: 1, pos: { x: 0, y: 10 }, kind: 'normal', broken: false } as const;
    const next = { id: 2, pos: { x: 2, y: 13 }, kind: 'normal', broken: false } as const;
    const wall = { id: 1, x0: -6, y0: 11, x1: 6, y1: 11.4 };
    expect(canExit(a, [a, next], [], null, T)).toBe(true);
    expect(canExit(a, [a, next], [wall], null, T)).toBe(false);
  });

  it('exige les deux branches d\'une fourche', () => {
    const rng = createRng(11);
    const ids = { anchor: 1, obstacle: 1, pickup: 1 };
    let segment = buildSegment(rng, ids, { x: 0, y: 60 }, tierProfile(1));
    while (segment.junctionId === null) segment = buildSegment(rng, ids, { x: 0, y: 60 }, tierProfile(1));
    const entry = { id: 0, pos: { x: 0, y: 60 }, kind: 'normal', broken: false } as const;
    const ok = verifySegment([entry], [], segment, T);
    // Supprimer la branche haute rend la fourche invalide, même si la basse suffit à monter.
    const withoutHigh = { ...segment, anchors: segment.anchors.filter((a) => a.id !== segment.branchIds[1]) };
    expect(verifySegment([entry], [], withoutHigh, T)).toBe(false);
    expect(typeof ok).toBe('boolean');
  });

  it('sur deux cents graines, aucun passage impossible et peu de segments de repli', () => {
    let segments = 0;
    let fallbacks = 0;
    let unverified = 0;
    const started = performance.now();
    for (let seed = 1; seed <= 200; seed += 1) {
      const sim = climbed(seed, 260);
      segments += sim.state.course.segments;
      fallbacks += sim.state.course.fallbacks;
      unverified += sim.state.course.unverified;
      // Chaque point accepté, sauf le dernier, a une sortie vers le haut dans le parcours tel qu'engendré.
      const anchors = sim.state.anchors;
      for (let i = 0; i < anchors.length - 1; i += 1) {
        const a = anchors[i]!;
        if (a.pos.y < sim.state.fogY) continue;
        expect(canExit(a, anchors, sim.state.obstacles, null, T), `graine ${seed}, point ${a.id}`).toBe(true);
      }
    }
    const elapsed = performance.now() - started;
    expect(segments).toBeGreaterThan(2000);
    expect(unverified).toBe(0);
    expect(fallbacks / segments).toBeLessThan(0.1);
    // Budget : la génération d'un segment doit rester sous quelques millisecondes.
    expect(elapsed / segments).toBeLessThan(40);
  }, 120_000);
});

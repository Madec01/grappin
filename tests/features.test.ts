import { describe, expect, it } from 'vitest';
import { bestAnchor, inSight } from '../src/sim/aim';
import { circleBoxGap, segmentCrossesBox } from '../src/sim/geometry';
import { BEGINNER, REASONABLE, playRobot } from '../src/sim/robot';
import { Simulation } from '../src/sim/simulation';
import type { Anchor } from '../src/sim/state';
import { DEFAULT_TUNING, withTuning } from '../src/sim/tuning';

const T = DEFAULT_TUNING;
const SECOND = Math.round(1 / T.stepSeconds);

/** Simulation nue : un seul point, sans brume, personnage en vol sous le point. */
function bare(kind: Anchor['kind'] = 'normal'): Simulation {
  const sim = new Simulation(1, withTuning(T, { fogBaseSpeed: 0, fogStart: -1000 }));
  sim.state.anchors = [{ id: 1, pos: { x: 0, y: 10 }, kind, broken: false }];
  sim.state.obstacles = [];
  sim.state.pickups = [];
  sim.state.course.lastY = 10_000;
  sim.state.hero = { pos: { x: 0, y: 7 }, vel: { x: 0, y: 0 }, grounded: false };
  sim.state.targetId = 1;
  sim.state.targetValidStep = sim.state.step;
  return sim;
}

describe('géométrie', () => {
  const box = { x0: 0, y0: 0, x1: 2, y1: 1 };
  it('mesure l\'écart entre un cercle et une boîte', () => {
    expect(circleBoxGap({ x: 1, y: 0.5 }, 0.3, box)).toBeLessThan(0);
    expect(circleBoxGap({ x: 1, y: 2 }, 0.3, box)).toBeCloseTo(0.7, 9);
    expect(circleBoxGap({ x: 3, y: 2 }, 0, box)).toBeCloseTo(Math.SQRT2, 9);
  });
  it('détecte la traversée d\'une boîte par un segment', () => {
    expect(segmentCrossesBox({ x: 1, y: -1 }, { x: 1, y: 2 }, box)).toBe(true);
    expect(segmentCrossesBox({ x: -1, y: 0.5 }, { x: 3, y: 0.5 }, box)).toBe(true);
    expect(segmentCrossesBox({ x: -1, y: 2 }, { x: 3, y: 2 }, box)).toBe(false);
    expect(segmentCrossesBox({ x: -1, y: -1 }, { x: -0.5, y: 3 }, box)).toBe(false);
    expect(segmentCrossesBox({ x: 1, y: 0.5 }, { x: 1, y: 0.5 }, box)).toBe(true);
  });
});

describe('ligne de vue', () => {
  it('un point caché derrière un obstacle n\'est pas visable', () => {
    const anchor: Anchor = { id: 1, pos: { x: 0, y: 5 }, kind: 'normal', broken: false };
    const slab = { id: 1, x0: -1, y0: 3, x1: 1, y1: 3.4 };
    const body = { pos: { x: 0, y: 1 }, vel: { x: 0, y: 0 } };
    expect(inSight(body.pos, anchor, [])).toBe(true);
    expect(inSight(body.pos, anchor, [slab])).toBe(false);
    expect(bestAnchor([anchor], [slab], body, false, null, T)).toBeNull();
    expect(bestAnchor([anchor], [], body, false, null, T)?.id).toBe(1);
  });
});

describe('accroches spéciales', () => {
  it('une accroche fragile casse après une seconde et lâche le personnage', () => {
    const sim = bare('fragile');
    expect(sim.press()).toBe(true);
    sim.run(Math.round(T.fragileSeconds / T.stepSeconds) - 2);
    expect(sim.state.rope).not.toBeNull();
    sim.run(4);
    expect(sim.state.rope).toBeNull();
    expect(sim.state.anchors[0]!.broken).toBe(true);
    const types = sim.drain().map((e) => e.type);
    expect(types).toContain('break');
    expect(types).toContain('release');
    // Cassée, elle n'est plus visée.
    sim.run(5);
    expect(sim.state.targetId).toBeNull();
  });

  it('un propulseur multiplie la vitesse au lâcher sans changer sa direction', () => {
    const sim = bare('booster');
    sim.press();
    sim.run(30);
    const before = { ...sim.state.hero.vel };
    sim.release();
    const after = sim.state.hero.vel;
    expect(after.x).toBeCloseTo(before.x * T.boostFactor, 9);
    expect(after.y).toBeCloseTo(before.y * T.boostFactor, 9);
    expect(sim.drain().some((e) => e.type === 'boost')).toBe(true);
  });
});

describe('obstacles, étoiles et paliers', () => {
  it('toucher un obstacle fait rebondir sans tuer, et le frôler rapporte une fois par corde', () => {
    const sim = bare();
    sim.state.obstacles = [{ id: 7, x0: -3, y0: 5, x1: 3, y1: 5.4 }];
    sim.state.hero = { pos: { x: 0, y: 6.2 }, vel: { x: 0, y: 0 }, grounded: false };
    sim.state.combo = 4;
    sim.step();
    const graze = sim.drain().filter((e) => e.type === 'graze');
    expect(graze).toHaveLength(1);
    expect(sim.state.score).toBeGreaterThan(0);
    sim.run(3);
    expect(sim.drain().filter((e) => e.type === 'graze')).toHaveLength(0);
    // Il tombe sur la corniche : un choc, la série à zéro, et il s'y pose, vivant, jamais dedans.
    sim.run(SECOND);
    expect(sim.state.status).toBe('alive');
    const events = sim.drain();
    expect(events.some((e) => e.type === 'bump' && e.obstacleId === 7)).toBe(true);
    expect(events.some((e) => e.type === 'death')).toBe(false);
    expect(sim.state.combo).toBe(0);
    expect(sim.state.hero.pos.y).toBeGreaterThanOrEqual(5.4 + T.heroRadius - 1e-6);
    expect(Math.abs(sim.state.hero.vel.y)).toBeLessThan(0.5);
  });

  it('un choc de côté renvoie le personnage en arrière, moins vite, et le laisse étourdi un instant', () => {
    const sim = bare();
    sim.state.obstacles = [{ id: 8, x0: 1, y0: 0, x1: 2, y1: 40 }];
    sim.state.hero = { pos: { x: 0.2, y: 20 }, vel: { x: 6, y: 2 }, grounded: false };
    sim.run(Math.round(0.2 * SECOND));
    const events = sim.drain();
    expect(events.some((e) => e.type === 'bump' && e.obstacleId === 8)).toBe(true);
    expect(sim.state.hero.vel.x).toBeLessThan(0);
    expect(Math.abs(sim.state.hero.vel.x)).toBeLessThan(6 * 0.5);
    expect(sim.state.hero.pos.x).toBeLessThanOrEqual(1 - T.heroRadius + 1e-6);
    expect(sim.state.stunUntilStep).toBeGreaterThan(0);
    expect(sim.state.status).toBe('alive');
  });

  it('une étoile ramassée disparaît et rapporte', () => {
    const sim = bare();
    sim.state.pickups = [{ id: 3, pos: { x: 0, y: 6.5 }, taken: false }];
    // La hauteur part de la position du personnage : seul le bonus de l'étoile compte dans le score.
    sim.state.height = sim.state.hero.pos.y;
    sim.step();
    expect(sim.state.pickups[0]!.taken).toBe(true);
    expect(sim.state.score).toBeCloseTo(T.pickupScore, 6);
    expect(sim.drain().some((e) => e.type === 'pickup')).toBe(true);
    sim.run(5);
    expect(sim.drain().some((e) => e.type === 'pickup')).toBe(false);
  });

  it('franchir un palier émet son nom', () => {
    const sim = bare();
    sim.state.hero.pos = { x: 0, y: T.tierHeight + 1 };
    sim.state.course.lastY = 0;
    sim.step();
    expect(sim.state.tier).toBe(1);
    expect(sim.drain().find((e) => e.type === 'tier')).toMatchObject({ type: 'tier', tier: 1, name: 'Les gouttières' });
  });
});

describe('robots joueurs', () => {
  it('un débutant survit plus de dix secondes sur chacune de vingt graines', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const report = playRobot(seed, T, 20, BEGINNER);
      expect(report.seconds, `graine ${seed}`).toBeGreaterThan(10);
    }
  });

  it('un joueur raisonnable monte au moins trente mètres en une minute sur la plupart des graines', () => {
    const reports = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) => playRobot(seed, T, 60, REASONABLE));
    expect(reports.filter((r) => r.height >= 30).length).toBeGreaterThanOrEqual(7);
  });
});

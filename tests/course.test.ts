import { describe, expect, it } from 'vitest';
import { COURSE_HALF_WIDTH, spacingAt } from '../src/sim/course';
import { Simulation } from '../src/sim/simulation';
import { DEFAULT_TUNING } from '../src/sim/tuning';

describe('parcours d\'essai', () => {
  it('monte toujours, reste dans la largeur jouable et espace les points selon la hauteur', () => {
    const sim = new Simulation(3);
    sim.state.hero.pos = { x: 0, y: 300 };
    sim.state.hero.grounded = false;
    sim.step();
    const anchors = sim.state.anchors;
    expect(anchors.length).toBeGreaterThan(50);
    for (let i = 1; i < anchors.length; i += 1) {
      const prev = anchors[i - 1]!;
      const cur = anchors[i]!;
      expect(cur.pos.y).toBeGreaterThan(prev.pos.y);
      expect(Math.abs(cur.pos.x)).toBeLessThanOrEqual(COURSE_HALF_WIDTH);
      const s = spacingAt(prev.pos.y);
      expect(cur.pos.y - prev.pos.y).toBeGreaterThanOrEqual(0.55 * s - 1e-9);
      expect(cur.pos.y - prev.pos.y).toBeLessThanOrEqual(0.9 * s + 1e-9);
      // Chaque point reste à portée du précédent : le parcours d'essai n'a pas de trou.
      expect(Math.hypot(cur.pos.x - prev.pos.x, cur.pos.y - prev.pos.y)).toBeLessThan(DEFAULT_TUNING.ropeMax);
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
  });

  it('retire les points passés loin sous la brume', () => {
    const sim = new Simulation(5);
    sim.state.hero.pos = { x: 0, y: 100 };
    sim.state.hero.grounded = false;
    sim.state.fogY = 60;
    sim.step();
    expect(sim.state.anchors.every((a) => a.pos.y >= 50)).toBe(true);
  });
});

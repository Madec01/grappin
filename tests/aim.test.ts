import { describe, expect, it } from 'vitest';
import { chooseTarget } from '../src/sim/aim';
import { Simulation } from '../src/sim/simulation';
import { DEFAULT_TUNING } from '../src/sim/tuning';

const T = DEFAULT_TUNING;

/** Simulation avec deux points à portée, placés à la main. */
function twoAnchors(): Simulation {
  const sim = new Simulation(1);
  sim.state.anchors = [
    { id: 10, pos: { x: -3, y: 6 }, kind: 'normal', broken: false },
    { id: 11, pos: { x: 3, y: 6 }, kind: 'normal', broken: false },
  ];
  sim.state.hero = { pos: { x: 0, y: 3 }, vel: { x: 0, y: 0 }, grounded: false };
  sim.state.targetId = null;
  return sim;
}

describe('ciblage', () => {
  it('vise le point qui se trouve sur la trajectoire en cours', () => {
    const sim = twoAnchors();
    sim.state.hero.vel = { x: 6, y: 4 };
    expect(chooseTarget(sim.state, T).targetId).toBe(11);
    sim.state.hero.vel = { x: -6, y: 4 };
    expect(chooseTarget(sim.state, T).targetId).toBe(10);
  });

  it('garde le point courant tant qu\'un autre n\'est pas nettement meilleur', () => {
    const sim = twoAnchors();
    sim.state.hero.vel = { x: 6, y: 4 };
    sim.state.targetId = 11;
    // Légère dérive vers la gauche : les deux points sont presque équivalents, on ne change pas.
    sim.state.hero.vel = { x: -0.5, y: 4 };
    expect(chooseTarget(sim.state, T).targetId).toBe(11);
    // Franche dérive : on change.
    sim.state.hero.vel = { x: -8, y: 4 };
    expect(chooseTarget(sim.state, T).targetId).toBe(10);
  });

  it('ignore les points hors de portée', () => {
    const sim = twoAnchors();
    sim.state.anchors = [{ id: 20, pos: { x: 0, y: 3 + T.ropeMax + 0.1 }, kind: 'normal', broken: false }];
    expect(chooseTarget(sim.state, T).targetId).toBeNull();
  });

  it('coyote time : le point reste visé un court instant après être sorti de portée, puis le tap échoue', () => {
    const sim = twoAnchors();
    sim.state.anchors = [{ id: 30, pos: { x: 0, y: 3 + T.ropeMax - 0.05 }, kind: 'normal', broken: false }];
    sim.state.targetId = null;
    expect(chooseTarget(sim.state, T).targetId).toBe(30);
    sim.state.targetId = 30;
    sim.state.targetValidStep = sim.state.step;
    // Le personnage tombe : le point sort de portée au pas suivant.
    sim.state.hero.vel = { x: 0, y: -10 };
    sim.step();
    expect(sim.state.targetId).toBe(30);
    expect(sim.press()).toBe(true);
    const sim2 = twoAnchors();
    sim2.state.anchors = [{ id: 30, pos: { x: 0, y: 3 + T.ropeMax - 0.05 }, kind: 'normal', broken: false }];
    sim2.state.targetId = 30;
    sim2.state.targetValidStep = sim2.state.step;
    sim2.state.hero.vel = { x: 0, y: -10 };
    const coyoteSteps = Math.round(T.coyoteSeconds / T.stepSeconds);
    sim2.run(coyoteSteps + 2);
    expect(sim2.state.targetId).toBeNull();
    expect(sim2.press()).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { levelById } from '../src/data/levels';
import { levelPlan } from '../src/meta/traversee';
import { SHADOW_POINTS, fragileGauge, isDark, shadowPoints, windSide } from '../src/render/cues';
import { STILL } from '../src/sim/environment';
import { LIGHT_OFF_SECONDS, LIGHT_PERIOD_SECONDS, lightIsOff } from '../src/sim/events';
import { freeFlightAt } from '../src/sim/physics';
import { Simulation } from '../src/sim/simulation';
import type { AnchorKind, SimState } from '../src/sim/state';
import { DEFAULT_TUNING } from '../src/sim/tuning';

/** Simulation tout juste accrochée au premier point, que l'on peut faire d'une espèce donnée. */
function hold(kind: AnchorKind): Simulation {
  const sim = new Simulation(3);
  expect(sim.press()).toBe(true);
  const id = sim.state.rope!.anchorId;
  sim.state.anchors = sim.state.anchors.map((anchor) => (anchor.id === id ? { ...anchor, kind } : anchor));
  return sim;
}

/** Place le personnage, corde tenue, en (0, 20) avec la vitesse donnée. */
function flying(sim: Simulation, vel: { x: number; y: number }): SimState {
  sim.state.hero.pos = { x: 0, y: 20 };
  sim.state.hero.vel = vel;
  return sim.state;
}

describe('ombre prédictive', () => {
  it('est vide sans corde', () => {
    const sim = new Simulation(3);
    expect(shadowPoints(sim.state, DEFAULT_TUNING)).toEqual([]);
  });

  it('suit le vol libre sur shadowSeconds, en six points de plus en plus loin', () => {
    const state = flying(hold('normal'), { x: 10, y: 4 });
    const points = shadowPoints(state, DEFAULT_TUNING);
    expect(points).toHaveLength(SHADOW_POINTS);
    const body = { pos: state.hero.pos, vel: state.hero.vel };
    points.forEach((point, i) => {
      const t = (DEFAULT_TUNING.shadowSeconds * (i + 1)) / SHADOW_POINTS;
      expect(point).toEqual(freeFlightAt(body, t, DEFAULT_TUNING));
    });
    expect(points.at(-1)).toEqual(freeFlightAt(body, DEFAULT_TUNING.shadowSeconds, DEFAULT_TUNING));
    expect(points[0]!.x).toBeGreaterThan(state.hero.pos.x);
  });

  it('respecte le réglage de durée', () => {
    const state = flying(hold('normal'), { x: 10, y: 4 });
    const tuning = { ...DEFAULT_TUNING, shadowSeconds: 1 };
    expect(shadowPoints(state, tuning).at(-1)).toEqual(freeFlightAt({ pos: state.hero.pos, vel: state.hero.vel }, 1, tuning));
  });

  it('montre le lâcher d\'un propulseur tel qu\'il sera : vitesse multipliée', () => {
    const state = flying(hold('booster'), { x: 10, y: 4 });
    const boosted = { x: 10 * DEFAULT_TUNING.boostFactor, y: 4 * DEFAULT_TUNING.boostFactor };
    const expected = freeFlightAt({ pos: state.hero.pos, vel: boosted }, DEFAULT_TUNING.shadowSeconds, DEFAULT_TUNING);
    const last = shadowPoints(state, DEFAULT_TUNING).at(-1)!;
    expect(last.x).toBeCloseTo(expected.x, 9);
    expect(last.y).toBeCloseTo(expected.y, 9);
  });

  it('plafonne la vitesse du lâcher d\'un propulseur comme le fait la simulation', () => {
    const state = flying(hold('booster'), { x: 20, y: 0 });
    const last = shadowPoints(state, DEFAULT_TUNING).at(-1)!;
    expect(last.x).toBeCloseTo(DEFAULT_TUNING.maxSpeed * DEFAULT_TUNING.shadowSeconds, 9);
  });
});

describe('jauge de l\'accroche fragile', () => {
  it('n\'existe pas sans corde ni sur un point qui n\'est pas fragile', () => {
    expect(fragileGauge(new Simulation(3).state, DEFAULT_TUNING)).toBeNull();
    expect(fragileGauge(hold('normal').state, DEFAULT_TUNING)).toBeNull();
    expect(fragileGauge(hold('booster').state, DEFAULT_TUNING)).toBeNull();
  });

  it('part de zéro à la saisie et monte à un en une seconde de tenue', () => {
    const sim = hold('fragile');
    const anchorId = sim.state.rope!.anchorId;
    const gauge = fragileGauge(sim.state, DEFAULT_TUNING)!;
    expect(gauge.wear).toBe(0);
    expect(gauge.pos).toEqual(sim.state.anchors.find((a) => a.id === anchorId)!.pos);

    sim.run(60);
    expect(fragileGauge(sim.state, DEFAULT_TUNING)!.wear).toBeCloseTo(0.5, 9);
    sim.run(59);
    expect(fragileGauge(sim.state, DEFAULT_TUNING)!.wear).toBeLessThan(1);
  });

  it('disparaît quand l\'accroche casse, au pas même du « Crac »', () => {
    const sim = hold('fragile');
    sim.run(121);
    expect(sim.state.rope).toBeNull();
    expect(fragileGauge(sim.state, DEFAULT_TUNING)).toBeNull();
    expect(sim.drain().some((event) => event.type === 'break')).toBe(true);
  });

  it('reste à un, sans dépasser ni diviser par zéro, si la fragilité est réglée à zéro', () => {
    const sim = hold('fragile');
    const tuning = { ...DEFAULT_TUNING, fragileSeconds: 0 };
    expect(fragileGauge(sim.state, tuning)!.wear).toBe(1);
  });
});

describe('ombre prédictive sous une gravité tournée', () => {
  it('suit la gravité et le vent du moment', () => {
    const state = flying(hold('normal'), { x: 0, y: 0 });
    state.env = { gravityDir: { x: 1, y: 0 }, wind: { x: 0, y: 0 } };
    const last = shadowPoints(state, DEFAULT_TUNING).at(-1)!;
    expect(last).toEqual(freeFlightAt({ pos: state.hero.pos, vel: state.hero.vel }, DEFAULT_TUNING.shadowSeconds, DEFAULT_TUNING, state.env));
    expect(last.x).toBeGreaterThan(state.hero.pos.x);
    expect(last.y).toBeCloseTo(state.hero.pos.y, 9);
  });
});

describe('lampadaires éteints', () => {
  it('rien n\'est éteint hors de la panne, même à l\'instant où un lampadaire le serait', () => {
    const state = new Simulation(3).state;
    const id = state.anchors[0]!.id;
    state.env = STILL;
    expect(state.lightsOff).toBe(false);
    for (let step = 0; step < 1000; step += 100) {
      state.step = step;
      expect(isDark(state, id, DEFAULT_TUNING)).toBe(false);
    }
  });

  it('pendant la panne, suit lightIsOff, par vagues : chaque lampadaire dans le noir la moitié du temps', () => {
    const state = new Simulation(3).state;
    const id = state.anchors[0]!.id;
    state.lightsOff = true;
    let dark = 0;
    const steps = Math.round((2 * LIGHT_PERIOD_SECONDS) / DEFAULT_TUNING.stepSeconds);
    for (let step = 0; step < steps; step += 1) {
      state.step = step;
      expect(isDark(state, id, DEFAULT_TUNING)).toBe(lightIsOff(id, step, DEFAULT_TUNING));
      if (isDark(state, id, DEFAULT_TUNING)) dark += 1;
    }
    expect(dark / steps).toBeCloseTo(LIGHT_OFF_SECONDS / LIGHT_PERIOD_SECONDS, 2);
  });
});

describe('côté du vent', () => {
  /** Départ du niveau donné, hauteur et calendrier compris. */
  const levelState = (id: number) => new Simulation(1, DEFAULT_TUNING, levelPlan(levelById(id)!)).state;

  it('se lit dans le calendrier, vers la gauche au niveau 6 et vers la droite au niveau 9', () => {
    for (const [id, side] of [[6, -1], [9, 1]] as const) {
      const state = levelState(id);
      // Rien n'a commencé : le vent n'a pas encore de côté propre, on retombe sur la droite.
      state.eventRuntimes.forEach((runtime, i) => {
        if (state.schedule[i]!.kind === 'vent') runtime.startStep = 5;
      });
      expect(windSide(state)).toBe(side);
    }
  });

  it('ne lit que le vent commencé, le plus récent s\'il y en a plusieurs', () => {
    const state = levelState(9);
    state.schedule = [
      { kind: 'vent', at: 10, length: 20, side: -1, strength: 3 },
      { kind: 'bascule', at: 20, length: 20, side: 1 },
      { kind: 'vent', at: 50, length: 20, side: 1, strength: 3 },
    ];
    state.eventRuntimes = [{ startStep: 100, endStep: 400 }, { startStep: 300, endStep: null }, { startStep: null, endStep: null }];
    expect(windSide(state)).toBe(-1);
    state.eventRuntimes[2]!.startStep = 700;
    expect(windSide(state)).toBe(1);
  });
});

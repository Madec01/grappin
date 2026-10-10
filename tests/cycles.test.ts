import { describe, expect, it } from 'vitest';
import { ECLIPSE_LIT_SECONDS, ECLIPSE_PERIOD_SECONDS, ELECTRIC_CHARGED_SECONDS, ELECTRIC_PERIOD_SECONDS, ELECTRIC_WARNING_SECONDS, electricState, grabbable, isCharged, isLit, isOptional } from '../src/sim/cycles';
import { SHOCK_STUN_SECONDS } from '../src/sim/rules';
import { tierProfile } from '../src/sim/generator';
import { Simulation } from '../src/sim/simulation';
import type { Anchor } from '../src/sim/state';
import { DEFAULT_TUNING as T, withTuning } from '../src/sim/tuning';
import { canExit } from '../src/sim/verifier';

const SECOND = Math.round(1 / T.stepSeconds);

/** Une partie sans brume ni autre point que ceux posés par le test, le personnage lâché près d'eux. */
function alone(anchors: Anchor[]): Simulation {
  const plan = { kind: 'level' as const, levelId: 95, startY: 0, endY: 400, profile: { spacing: 3, obstacles: 0, split: false, fragileChance: 0, boosters: 0, archetypes: ['chaine' as const], spread: 1, electric: 0, eclipse: 0 }, events: [] };
  const sim = new Simulation(7, withTuning(T, { fogBaseSpeed: 0, fogStart: -1000 }), plan);
  sim.state.anchors = anchors;
  sim.state.obstacles = [];
  sim.state.pickups = [];
  sim.state.hero = { pos: { x: 0, y: 20 }, vel: { x: 0, y: 0 }, grounded: false };
  sim.state.rope = null;
  // Le niveau engendré visait déjà son premier point : on oublie cette cible, qui n'existe plus.
  sim.state.targetId = null;
  sim.state.targetValidStep = -1_000_000;
  return sim;
}

/** Le premier pas, à partir de `from`, où la prise est dans l'état voulu. */
function stepWhen(from: number, wanted: (step: number) => boolean): number {
  for (let step = from; step < from + 10 * SECOND; step += 1) if (wanted(step)) return step;
  throw new Error('État jamais atteint');
}

describe('cycles des prises', () => {
  it('la prise électrique est chargée 1,5 s, avertit 0,6 s avant, et reste calme le reste du cycle de 4 s', () => {
    const counts = { calme: 0, avertit: 0, chargee: 0 };
    const period = Math.round(ELECTRIC_PERIOD_SECONDS * SECOND);
    for (let step = 0; step < period; step += 1) counts[electricState(1, step, T)] += 1;
    expect(counts.chargee).toBe(Math.round(ELECTRIC_CHARGED_SECONDS * SECOND));
    expect(counts.avertit).toBe(Math.round(ELECTRIC_WARNING_SECONDS * SECOND));
    expect(counts.calme).toBe(period - counts.chargee - counts.avertit);
    // L'avertissement précède immédiatement la charge.
    const charged = stepWhen(1, (step) => isCharged(1, step, T) && !isCharged(1, step - 1, T));
    expect(electricState(1, charged - 1, T)).toBe('avertit');
  });

  it('la prise à éclipse est allumée deux secondes sur quatre, et deux prises voisines ne battent pas ensemble', () => {
    const period = Math.round(ECLIPSE_PERIOD_SECONDS * SECOND);
    let lit = 0;
    for (let step = 0; step < period; step += 1) if (isLit(5, step, T)) lit += 1;
    expect(lit).toBe(Math.round(ECLIPSE_LIT_SECONDS * SECOND));
    const firstOff = stepWhen(0, (step) => !isLit(5, step, T));
    const firstOff6 = stepWhen(0, (step) => !isLit(6, step, T));
    expect(firstOff6).not.toBe(firstOff);
  });

  it('une éclipse éteinte ne s\'attrape pas, une cassée non plus ; électrique et éclipse sont facultatives pour le vérificateur', () => {
    const eclipse: Anchor = { id: 5, pos: { x: 0, y: 10 }, kind: 'eclipse', broken: false };
    const litStep = stepWhen(0, (step) => isLit(5, step, T));
    const offStep = stepWhen(0, (step) => !isLit(5, step, T));
    expect(grabbable(eclipse, litStep, T)).toBe(true);
    expect(grabbable(eclipse, offStep, T)).toBe(false);
    expect(grabbable({ ...eclipse, kind: 'normal', broken: true }, litStep, T)).toBe(false);
    // Une électrique ne s'attrape que calme : ni quand elle avertit, ni quand elle est chargée.
    const electric: Anchor = { id: 3, pos: { x: 0, y: 10 }, kind: 'electrique', broken: false };
    expect(grabbable(electric, stepWhen(0, (step) => electricState(3, step, T) === 'calme'), T)).toBe(true);
    expect(grabbable(electric, stepWhen(0, (step) => electricState(3, step, T) === 'avertit'), T)).toBe(false);
    expect(grabbable(electric, stepWhen(0, (step) => electricState(3, step, T) === 'chargee'), T)).toBe(false);
    expect(isOptional(eclipse)).toBe(true);
    expect(isOptional({ ...eclipse, kind: 'electrique' })).toBe(true);
    expect(isOptional({ ...eclipse, kind: 'fragile' })).toBe(false);
  });
});

describe('règles des prises à cycles', () => {
  const electric: Anchor = { id: 3, pos: { x: 0.5, y: 23 }, kind: 'electrique', broken: false };

  it('attraper une prise électrique calme accroche ; chargée ou sur le point de l\'être, l\'anneau ne s\'y pose pas et l\'appui ne fait rien', () => {
    const calm = alone([{ ...electric }]);
    calm.state.step = stepWhen(0, (step) => electricState(3, step, T) === 'calme' && electricState(3, step + 2, T) === 'calme');
    calm.step();
    expect(calm.state.targetId).toBe(3);
    calm.press();
    expect(calm.state.rope?.anchorId).toBe(3);
    expect(calm.state.status).toBe('alive');

    for (const wanted of ['chargee', 'avertit'] as const) {
      const hot = alone([{ ...electric }]);
      hot.state.step = stepWhen(0, (step) => electricState(3, step, T) === wanted && electricState(3, step + 2, T) === wanted);
      hot.step();
      expect(hot.state.targetId, wanted).toBeNull();
      hot.press();
      expect(hot.state.rope, wanted).toBeNull();
      expect(hot.state.status, wanted).toBe('alive');
    }
  });

  it('pendre à une prise électrique quand elle se charge donne une décharge : corde lâchée, repoussé, série à zéro, étourdi 0,7 s, puis tout redevient possible', () => {
    const sim = alone([{ ...electric }]);
    sim.state.step = stepWhen(0, (step) => electricState(3, step, T) === 'calme' && electricState(3, step + 2, T) === 'calme');
    sim.step();
    sim.press();
    expect(sim.state.rope?.anchorId).toBe(3);
    sim.state.combo = 4;
    const chargedAt = stepWhen(sim.state.step, (step) => isCharged(3, step, T));
    sim.run(chargedAt - sim.state.step + 1);
    expect(sim.state.status).toBe('alive');
    expect(sim.state.rope).toBeNull();
    expect(sim.state.combo).toBe(0);
    expect(Math.hypot(sim.state.hero.vel.x, sim.state.hero.vel.y)).toBeGreaterThan(3);
    const events = sim.drain();
    expect(events.some((e) => e.type === 'shock' && e.anchorId === 3)).toBe(true);
    expect(events.some((e) => e.type === 'death')).toBe(false);
    // Étourdi : aucune cible et aucun appui ne prend, puis la visée revient.
    sim.run(2);
    expect(sim.state.targetId).toBeNull();
    sim.press();
    expect(sim.state.rope).toBeNull();
    sim.run(Math.round(SHOCK_STUN_SECONDS * SECOND) + 2);
    expect(sim.state.step).toBeGreaterThanOrEqual(sim.state.stunUntilStep);
  });

  it('une éclipse éteinte n\'est pas visée ; allumée, elle s\'attrape, et la corde lâche quand elle s\'éteint, sans casse', () => {
    const eclipse: Anchor = { id: 5, pos: { x: 0.5, y: 23 }, kind: 'eclipse', broken: false };
    const dark = alone([{ ...eclipse }]);
    dark.state.step = stepWhen(0, (step) => !isLit(5, step, T) && !isLit(5, step + 2, T));
    dark.step();
    expect(dark.state.targetId).toBeNull();
    dark.press();
    expect(dark.state.rope).toBeNull();

    const lit = alone([{ ...eclipse }]);
    lit.state.step = stepWhen(0, (step) => isLit(5, step, T) && isLit(5, step + 2, T));
    lit.step();
    expect(lit.state.targetId).toBe(5);
    lit.press();
    expect(lit.state.rope?.anchorId).toBe(5);
    lit.run(Math.round(ECLIPSE_LIT_SECONDS * SECOND) + 2);
    expect(lit.state.rope).toBeNull();
    expect(lit.state.status).toBe('alive');
    expect(lit.state.anchors[0]!.broken).toBe(false);
    expect(lit.drain().some((e) => e.type === 'release' && e.forced)).toBe(true);
  });
});

describe('génération et vérification des prises à cycles', () => {
  it('le vérificateur ne compte jamais une éclipse ni une électrique comme sortie', () => {
    const from: Anchor = { id: 1, pos: { x: 0, y: 10 }, kind: 'normal', broken: false };
    const shortcut: Anchor = { id: 2, pos: { x: -1, y: 13 }, kind: 'eclipse', broken: false };
    const trap: Anchor = { id: 3, pos: { x: 1, y: 13 }, kind: 'electrique', broken: false };
    const plain: Anchor = { id: 4, pos: { x: -1, y: 13 }, kind: 'normal', broken: false };
    expect(canExit(from, [from, shortcut, trap], [], null, T)).toBe(false);
    expect(canExit(from, [from, plain], [], null, T)).toBe(true);
  });

  it('les paliers hauts posent des prises à cycles, jamais en premier ni en dernier point de segment, et le parcours reste prouvé', () => {
    expect(tierProfile(2)).toMatchObject({ electric: 0, eclipse: 0 });
    expect(tierProfile(3)).toMatchObject({ electric: 0, eclipse: 1 });
    expect(tierProfile(4)).toMatchObject({ electric: 1, eclipse: 1 });
    expect(tierProfile(6)).toMatchObject({ electric: 1, eclipse: 2 });
    let electrics = 0;
    let eclipses = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const sim = new Simulation(seed);
      sim.state.hero.pos = { x: 0, y: 400 };
      sim.state.hero.grounded = false;
      sim.state.fogY = 380;
      sim.step();
      const { anchors } = sim.state;
      electrics += anchors.filter((a) => a.kind === 'electrique').length;
      eclipses += anchors.filter((a) => a.kind === 'eclipse').length;
      expect(sim.state.course.unverified, `graine ${seed}`).toBe(0);
      expect(anchors.at(-1)?.kind, `graine ${seed}`).not.toMatch(/electrique|eclipse/);
      // Chaque prise à cycles a un voisin normal à portée de corde : elle n'est jamais isolée.
      for (const special of anchors.filter((a) => a.kind === 'electrique' || a.kind === 'eclipse')) {
        const near = anchors.some((a) => a.id !== special.id && !(a.kind === 'electrique' || a.kind === 'eclipse') && Math.hypot(a.pos.x - special.pos.x, a.pos.y - special.pos.y) <= T.ropeMax);
        expect(near, `graine ${seed}, point ${special.id}`).toBe(true);
      }
    }
    expect(electrics).toBeGreaterThan(5);
    expect(eclipses).toBeGreaterThan(5);
  });
});

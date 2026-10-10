import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/data/levels';
import { levelPlan, levelTuning } from '../src/meta/traversee';
import { STILL, isUpright, turnedGravity } from '../src/sim/environment';
import { ALERT_FOG_FACTOR, CABLE_PERIOD_SECONDS, TURN_SECONDS, cablePosition, environmentOf, eventsAt, lightIsOff } from '../src/sim/events';
import { freeFlightAt } from '../src/sim/physics';
import { isPerfectRelease } from '../src/sim/rules';
import { Simulation } from '../src/sim/simulation';
import type { ScheduledEvent } from '../src/sim/events';
import type { Anchor } from '../src/sim/state';
import { DEFAULT_TUNING, withTuning } from '../src/sim/tuning';
import { canExit } from '../src/sim/verifier';

const T = DEFAULT_TUNING;
const SECOND = Math.round(1 / T.stepSeconds);

/** Niveau d'essai de 400 m sans brume, avec les événements donnés. */
function level(events: readonly ScheduledEvent[]): Simulation {
  const plan = { kind: 'level' as const, levelId: 99, startY: 0, endY: 400, profile: { spacing: 3, obstacles: 0, split: false, fragileChance: 0, boosters: 0, archetypes: ['chaine' as const] }, events };
  return new Simulation(7, withTuning(T, { fogBaseSpeed: 0, fogStart: -1000 }), plan);
}

/**
 * Téléporte le personnage à une hauteur et joue deux pas : le premier enregistre
 * la hauteur atteinte, le second fait franchir les seuils des événements.
 */
function climbTo(sim: Simulation, y: number): void {
  sim.state.hero.pos = { x: 0, y };
  sim.state.hero.vel = { x: 0, y: 0 };
  sim.state.hero.grounded = false;
  sim.state.rope = null;
  sim.step();
  sim.step();
}

describe('environnement', () => {
  it('la gravité tournée part du bas et finit de côté, toujours unitaire', () => {
    expect(turnedGravity(1, 0)).toEqual({ x: 0, y: -1 });
    expect(turnedGravity(1, 1)).toEqual({ x: 1, y: 0 });
    expect(turnedGravity(-1, 1)).toEqual({ x: -1, y: 0 });
    const mid = turnedGravity(1, 0.5);
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(1, 9);
    expect(isUpright(STILL)).toBe(true);
    expect(isUpright({ gravityDir: mid, wind: STILL.wind })).toBe(false);
  });

  it('le vol libre suit la gravité et le vent du moment', () => {
    const body = { pos: { x: 0, y: 10 }, vel: { x: 0, y: 0 } };
    const right = freeFlightAt(body, 1, T, { gravityDir: { x: 1, y: 0 }, wind: { x: 0, y: 0 } });
    expect(right.x).toBeCloseTo(T.gravity / 2, 9);
    expect(right.y).toBeCloseTo(10, 9);
    const windy = freeFlightAt(body, 1, T, { gravityDir: { x: 0, y: -1 }, wind: { x: 3, y: 0 } });
    expect(windy.x).toBeCloseTo(1.5, 9);
    expect(windy.y).toBeCloseTo(10 - T.gravity / 2, 9);
  });

  it('le lâcher parfait se juge à l\'opposé de la gravité du moment', () => {
    const turned = { gravityDir: { x: 1, y: 0 }, wind: { x: 0, y: 0 } };
    // Gravité vers la droite : « monter », c'est aller vers la gauche, de côté c'est le long de y.
    expect(isPerfectRelease(-4, 4, T, turned)).toBe(true);
    expect(isPerfectRelease(4, 4, T, turned)).toBe(false);
    expect(isPerfectRelease(4, 4, T, STILL)).toBe(true);
  });
});

describe('calendrier des événements', () => {
  it('sait quels événements couvrent une hauteur, et leurs conditions pleines', () => {
    const schedule = [
      { kind: 'bascule' as const, at: 20, length: 30, side: -1 as const },
      { kind: 'vent' as const, at: 60, length: 20, side: 1 as const, strength: 3 },
    ];
    expect(eventsAt(schedule, 100, 110).map((e) => e.kind)).toEqual([]);
    expect(eventsAt(schedule, 100, 130).map((e) => e.kind)).toEqual(['bascule']);
    expect(environmentOf(eventsAt(schedule, 100, 130)).gravityDir).toEqual({ x: -1, y: 0 });
    expect(environmentOf(eventsAt(schedule, 100, 165)).wind).toEqual({ x: 3, y: 0 });
    expect(environmentOf([])).toEqual(STILL);
  });

  it('la bascule tourne la gravité en deux secondes, la tient, puis la ramène', () => {
    const sim = level([{ kind: 'bascule', at: 20, length: 30, side: 1 }]);
    climbTo(sim, 21);
    expect(sim.drain().some((e) => e.type === 'event' && e.kind === 'bascule' && e.phase === 'start')).toBe(true);
    // La rotation commence au pas qui suit le départ : d'abord à peine, puis de plus en plus.
    sim.run(3);
    expect(sim.state.env.gravityDir.x).toBeGreaterThan(0);
    expect(sim.state.env.gravityDir.x).toBeLessThan(0.1);
    sim.run(Math.round(TURN_SECONDS * SECOND) + 2);
    expect(sim.state.env.gravityDir).toEqual({ x: 1, y: 0 });
    climbTo(sim, 51);
    expect(sim.drain().some((e) => e.type === 'event' && e.kind === 'bascule' && e.phase === 'end')).toBe(true);
    sim.run(Math.round(TURN_SECONDS * SECOND) + 2);
    expect(sim.state.env.gravityDir).toEqual({ x: 0, y: -1 });
  });

  it('pendant la bascule, tomber de côté hors de la ville est une chute', () => {
    const sim = level([{ kind: 'bascule', at: 20, length: 100, side: 1 }]);
    climbTo(sim, 21);
    sim.run(Math.round(TURN_SECONDS * SECOND) + 2);
    sim.run(6 * SECOND);
    expect(sim.state.status).toBe('dead');
    expect(sim.drain().find((e) => e.type === 'death')).toMatchObject({ type: 'death', cause: 'fall' });
  });

  it('le vent pousse de côté, l\'alerte double la brume, la panne éteint par vagues', () => {
    const windy = level([{ kind: 'vent', at: 20, length: 30, side: -1, strength: 3 }]);
    climbTo(windy, 21);
    windy.run(2 * SECOND);
    expect(windy.state.env.wind.x).toBeCloseTo(-3, 9);
    expect(windy.state.hero.vel.x).toBeLessThan(-2);

    const alert = new Simulation(3, T, { kind: 'level', levelId: 98, startY: 0, endY: 400, profile: { spacing: 3, obstacles: 0, split: false, fragileChance: 0, boosters: 0, archetypes: ['chaine'] }, events: [{ kind: 'alerte', at: 20, length: 30 }] });
    climbTo(alert, 21);
    expect(alert.state.fogFactor).toBe(ALERT_FOG_FACTOR);
    const before = alert.state.fogY;
    alert.run(SECOND);
    expect(alert.state.fogY - before).toBeCloseTo(T.fogBaseSpeed * ALERT_FOG_FACTOR, 2);

    const dark = level([{ kind: 'panne', at: 20, length: 30 }]);
    climbTo(dark, 21);
    expect(dark.state.lightsOff).toBe(true);
    const offs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => lightIsOff(id, dark.state.step, T));
    expect(offs.some(Boolean)).toBe(true);
    expect(offs.every(Boolean)).toBe(false);
    climbTo(dark, 51);
    expect(dark.state.lightsOff).toBe(false);
  });

  it('la pluie fait tomber des étoiles, de façon déterministe', () => {
    const rainy = level([{ kind: 'pluie', at: 20, length: 30 }]);
    climbTo(rainy, 21);
    const before = rainy.state.pickups.length;
    rainy.run(3 * SECOND);
    const falling = rainy.state.pickups.filter((p) => p.vel);
    expect(falling.length).toBeGreaterThanOrEqual(4);
    expect(rainy.state.pickups.length).toBeGreaterThan(before);
    for (const star of falling) expect(star.vel!.y).toBeLessThan(0);
    const twin = level([{ kind: 'pluie', at: 20, length: 30 }]);
    climbTo(twin, 21);
    twin.run(3 * SECOND);
    expect(twin.snapshot()).toBe(rainy.snapshot());
  });

  it('un point sur câble va et vient entre ses deux bouts', () => {
    const anchor: Anchor = { id: 1, pos: { x: 0, y: 10 }, kind: 'normal', broken: false, cable: { from: { x: -1.6, y: 10 }, to: { x: 1.6, y: 10 } } };
    expect(cablePosition(anchor, 0, T)).toEqual({ x: -1.6, y: 10 });
    expect(cablePosition(anchor, Math.round((CABLE_PERIOD_SECONDS / 2) * SECOND), T).x).toBeCloseTo(1.6, 6);
    expect(cablePosition(anchor, Math.round(CABLE_PERIOD_SECONDS * SECOND), T).x).toBeCloseTo(-1.6, 6);
    const sim = level([{ kind: 'cable', at: 10, length: 60 }]);
    const cabled = sim.state.anchors.filter((a) => a.cable);
    expect(cabled.length).toBeGreaterThan(0);
    const first = cabled[0]!;
    const x0 = first.pos.x;
    sim.run(Math.round(0.75 * SECOND));
    expect(sim.state.anchors.find((a) => a.id === first.id)!.pos.x).not.toBe(x0);
  });
});

describe('vérification sous un événement', () => {
  it('sous gravité tournée, un point voisin de côté est atteignable, un point trop loin ne l\'est pas', () => {
    const turned = { gravityDir: { x: 1, y: 0 }, wind: { x: 0, y: 0 } };
    const a: Anchor = { id: 1, pos: { x: 0, y: 10 }, kind: 'normal', broken: false };
    const near: Anchor = { id: 2, pos: { x: -1, y: 13 }, kind: 'normal', broken: false };
    const far: Anchor = { id: 3, pos: { x: 0, y: 30 }, kind: 'normal', broken: false };
    expect(canExit(a, [a, near], [], null, T, turned)).toBe(true);
    expect(canExit(a, [a, far], [], null, T, turned)).toBe(false);
  });

  it('les niveaux à événements s\'engendrent sans segment non vérifié, et la course libre planifie des événements en hauteur', () => {
    for (const lvl of LEVELS) {
      const sim = new Simulation(lvl.seed, levelTuning(lvl, T), levelPlan(lvl));
      expect(sim.state.course.unverified, lvl.name).toBe(0);
      expect(sim.state.schedule).toHaveLength(lvl.events.length);
    }
    const free = new Simulation(11);
    free.state.hero.pos = { x: 0, y: 400 };
    free.state.hero.grounded = false;
    free.state.fogY = 380;
    free.step();
    expect(free.state.schedule.length).toBeGreaterThan(0);
    expect(free.state.course.unverified).toBe(0);
  });

  it('la course libre tire les six événements au hasard dès le palier 1, jamais dans la zone d\'apprentissage, jamais deux fois le même de suite', () => {
    const seen = new Set<string>();
    let scheduled = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      const free = new Simulation(seed);
      free.state.hero.pos = { x: 0, y: 400 };
      free.state.hero.grounded = false;
      free.state.fogY = 380;
      free.step();
      const { schedule } = free.state;
      scheduled += schedule.length;
      for (const [i, event] of schedule.entries()) {
        seen.add(event.kind);
        expect(event.at, `graine ${seed}`).toBeGreaterThanOrEqual(T.tierHeight);
        if (i > 0) expect(event.kind, `graine ${seed}`).not.toBe(schedule[i - 1]!.kind);
        // Jamais deux événements qui se chevauchent.
        if (i > 0) expect(event.at, `graine ${seed}`).toBeGreaterThanOrEqual(schedule[i - 1]!.at + schedule[i - 1]!.length);
      }
      expect(free.state.course.unverified, `graine ${seed}`).toBe(0);
    }
    expect([...seen].sort()).toEqual(['alerte', 'bascule', 'cable', 'panne', 'pluie', 'vent']);
    // Sur 400 m à une chance sur deux par segment d'une vingtaine de mètres, au moins une poignée d'événements par partie.
    expect(scheduled / 24).toBeGreaterThan(5);
  });
});

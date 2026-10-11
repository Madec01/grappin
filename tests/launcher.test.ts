import { describe, expect, it } from 'vitest';
import { STILL, turnedGravity } from '../src/sim/environment';
import { tierProfile } from '../src/sim/generator';
import { LAUNCH_MAX_SPEED, LAUNCH_MIN_SPEED, PULL_MAX, PULL_MIN, clampPull, launchSet, launchSpeed, launchVelocity, pulledPosition } from '../src/sim/launcher';
import { Simulation, replay } from '../src/sim/simulation';
import type { Anchor, Obstacle } from '../src/sim/state';
import { DEFAULT_TUNING as T, withTuning } from '../src/sim/tuning';
import { canExit } from '../src/sim/verifier';

const SECOND = Math.round(1 / T.stepSeconds);

/** Une partie sans brume, avec les seuls points et obstacles posés par le test, le personnage lâché à 20 m. */
function alone(anchors: Anchor[], obstacles: Obstacle[] = []): Simulation {
  const plan = { kind: 'level' as const, levelId: 94, startY: 0, endY: 400, profile: { spacing: 3, obstacles: 0, split: false, fragileChance: 0, boosters: 0, archetypes: ['chaine' as const], spread: 1, electric: 0, eclipse: 0 }, events: [] };
  const sim = new Simulation(7, withTuning(T, { fogBaseSpeed: 0, fogStart: -1000 }), plan);
  sim.state.anchors = anchors;
  sim.state.obstacles = obstacles;
  sim.state.pickups = [];
  sim.state.hero = { pos: { x: 0, y: 20 }, vel: { x: 0, y: 0 }, grounded: false };
  sim.state.rope = null;
  sim.state.targetId = null;
  sim.state.targetValidStep = -1_000_000;
  return sim;
}

describe('lanceur : traction et lancer', () => {
  it('la traction est plafonnée, le personnage est reculé d\'autant, et la vitesse va de la force minimale à la maximale', () => {
    expect(clampPull({ x: 10, y: 0 })).toEqual({ x: PULL_MAX, y: 0 });
    expect(pulledPosition({ x: 1, y: 2 }, { x: 0, y: -1 })).toEqual({ x: 1, y: 1 });
    expect(launchSpeed(0)).toBe(LAUNCH_MIN_SPEED);
    expect(launchSpeed(PULL_MAX)).toBe(LAUNCH_MAX_SPEED);
    expect(launchSpeed(PULL_MAX / 2)).toBeCloseTo((LAUNCH_MIN_SPEED + LAUNCH_MAX_SPEED) / 2, 9);
  });

  it('le lancer part à l\'opposé de la traction ; sans traction, tout droit vers le haut selon la gravité', () => {
    const v = launchVelocity({ x: 0, y: -PULL_MAX }, STILL);
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.y).toBeCloseTo(LAUNCH_MAX_SPEED, 9);
    const sideways = launchVelocity({ x: -1, y: -1 }, STILL);
    expect(sideways.x).toBeGreaterThan(0);
    expect(sideways.y).toBeGreaterThan(0);
    expect(Math.hypot(sideways.x, sideways.y)).toBeCloseTo(launchSpeed(Math.SQRT2), 9);
    expect(launchVelocity({ x: PULL_MIN / 2, y: 0 }, STILL)).toEqual({ x: 0, y: LAUNCH_MIN_SPEED });
    // Gravité tournée vers la droite : « le haut » est à gauche.
    const turned = { gravityDir: turnedGravity(1, 1), wind: { x: 0, y: 0 } };
    expect(launchVelocity({ x: 0, y: 0 }, turned)).toEqual({ x: -LAUNCH_MIN_SPEED, y: 0 });
  });

  it('l\'éventail du vérificateur couvre le demi-plan du haut par pas de cinq degrés, à quatre forces', () => {
    const pulls = launchSet(STILL);
    expect(pulls).toHaveLength(33 * 4);
    for (const pull of pulls) {
      const v = launchVelocity(pull, STILL);
      expect(v.y).toBeGreaterThan(0);
      expect(Math.hypot(v.x, v.y)).toBeGreaterThanOrEqual(LAUNCH_MIN_SPEED - 1e-9);
      expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(LAUNCH_MAX_SPEED + 1e-9);
    }
  });
});

describe('lanceur : règles', () => {
  const launcher: Anchor = { id: 1, pos: { x: 0.4, y: 23 }, kind: 'lanceur', broken: false };
  const above: Anchor = { id: 2, pos: { x: 0, y: 31 }, kind: 'normal', broken: false };

  it('attraper un lanceur tire le personnage jusqu\'à lui et l\'y tient, sans balancement ni élan', () => {
    const sim = alone([{ ...launcher }, { ...above }]);
    sim.step();
    expect(sim.state.targetId).toBe(1);
    sim.press();
    expect(sim.state.rope?.anchorId).toBe(1);
    sim.run(SECOND);
    expect(sim.state.hero.pos).toEqual(launcher.pos);
    expect(sim.state.hero.vel).toEqual({ x: 0, y: 0 });
    expect(sim.state.status).toBe('alive');
  });

  it('tirer recule le personnage, et relâcher le lance à l\'opposé, plus fort si l\'on a plus tiré, sans toucher à la série de parfaits', () => {
    const sim = alone([{ ...launcher }, { ...above }]);
    sim.step();
    sim.press();
    sim.state.combo = 3;
    sim.aim({ x: 0.5, y: -1.5 });
    sim.step();
    expect(sim.state.hero.pos.x).toBeCloseTo(launcher.pos.x + 0.5, 9);
    expect(sim.state.hero.pos.y).toBeCloseTo(launcher.pos.y - 1.5, 9);
    sim.release({ x: 0, y: -PULL_MAX });
    expect(sim.state.rope).toBeNull();
    expect(sim.state.hero.vel.y).toBeCloseTo(LAUNCH_MAX_SPEED, 9);
    expect(sim.state.combo).toBe(3);
    const events = sim.drain();
    expect(events.some((e) => e.type === 'boost')).toBe(false);
    expect(events.find((e) => e.type === 'release')).toMatchObject({ kind: 'lanceur', perfect: false, forced: false });
    expect(sim.state.pull).toEqual({ x: 0, y: 0 });

    const soft = alone([{ ...launcher }, { ...above }]);
    soft.step();
    soft.press();
    soft.release();
    expect(soft.state.hero.vel).toEqual({ x: 0, y: LAUNCH_MIN_SPEED });
  });

  it('le journal garde la traction du relâché : le rejeu redonne exactement la même partie', () => {
    const sim = alone([{ ...launcher }, { ...above }]);
    sim.step();
    sim.press();
    sim.run(5);
    sim.release({ x: -0.8, y: -1.9 });
    sim.run(2 * SECOND);
    expect(sim.state.inputs.at(-1)).toMatchObject({ kind: 'release', pull: { x: -0.8, y: -1.9 } });
    const twin = alone([{ ...launcher }, { ...above }]);
    const inputs = sim.state.inputs;
    for (let i = 0; i < inputs.length; i += 1) {
      // Rejoué à la main, pas par `replay` : la partie de test n'a pas de plan rejouable, ses points sont posés par le test.
      const input = inputs[i]!;
      while (twin.state.step < input.step) twin.step();
      if (input.kind === 'press') twin.press();
      else twin.release(input.pull);
    }
    while (twin.state.step < sim.state.step) twin.step();
    expect(twin.snapshot()).toBe(sim.snapshot());
    expect(typeof replay).toBe('function');
  });
});

describe('lanceur : vérification et génération', () => {
  const launcher: Anchor = { id: 1, pos: { x: 0, y: 10 }, kind: 'lanceur', broken: false };
  const target: Anchor = { id: 2, pos: { x: 0.5, y: 19.5 }, kind: 'normal', broken: false };
  const wallY = 15;
  const leftWall: Obstacle = { id: 1, x0: -6, y0: wallY, x1: -1.2, y1: wallY + 0.4 };
  const rightWall: Obstacle = { id: 2, x0: 1.2, y0: wallY, x1: 6, y1: wallY + 0.4 };

  it('depuis un lanceur, une sortie existe à travers un trou dans le mur, pas quand le mur est plein', () => {
    expect(canExit(launcher, [launcher, target], [leftWall, rightWall], null, T)).toBe(true);
    const full: Obstacle = { id: 3, x0: -6, y0: wallY, x1: 6, y1: wallY + 0.4 };
    expect(canExit(launcher, [launcher, target], [full], null, T)).toBe(false);
    // Un point trop haut pour la force maximale n'est pas une sortie.
    const tooHigh: Anchor = { id: 3, pos: { x: 0, y: 40 }, kind: 'normal', broken: false };
    expect(canExit(launcher, [launcher, tooHigh], [], null, T)).toBe(false);
  });

  /** Le profil d'un niveau de test, fourches permises ou non. */
  const plan = (split: boolean) => ({ kind: 'level' as const, levelId: 93, startY: 0, endY: 120, profile: { spacing: 4, obstacles: 1, split, fragileChance: 0, boosters: 0, archetypes: ['lanceur' as const], spread: 1.2, electric: 0, eclipse: 0 }, events: [] });

  /** Les pans du mur à trou d'un lanceur : les obstacles sur la ligne du mur, entre 4,5 et 6 m au-dessus de lui, qui touchent les bords de la zone. */
  function wallOf(launcher: Anchor, obstacles: readonly Obstacle[]): Obstacle[] {
    const edge = obstacles.find((o) => o.y0 > launcher.pos.y + 4.4 && o.y0 < launcher.pos.y + 6.1 && (o.x0 < -4 || o.x1 > 4));
    if (!edge) return [];
    return obstacles.filter((o) => o.y0 === edge.y0).sort((p, q) => p.x0 - q.x0);
  }

  it('le motif lanceur apparaît dès le palier 2 : un lanceur, un mur à trou DÉCALÉ au-dessus (un tir vertical bute), la chaîne reprend plus haut, et tout reste prouvé', () => {
    expect(tierProfile(1).archetypes).not.toContain('lanceur');
    expect(tierProfile(2).archetypes).toContain('lanceur');
    let launchers = 0;
    for (let seed = 1; seed <= 16; seed += 1) {
      const sim = new Simulation(seed, T, plan(false));
      const { anchors, obstacles } = sim.state;
      const found = anchors.filter((a) => a.kind === 'lanceur');
      launchers += found.length;
      expect(sim.state.course.unverified, `graine ${seed}`).toBe(0);
      for (const l of found) {
        // Sans fourche : deux pans sur la même ligne, séparés d'un trou de 2,4 m.
        const pans = wallOf(l, obstacles);
        expect(pans.length, `graine ${seed}, lanceur ${l.id}`).toBe(2);
        const [a, b] = pans as [Obstacle, Obstacle];
        expect(b.x0 - a.x1).toBeCloseTo(2.4, 6);
        // Le trou est décalé : la colonne au-dessus du lanceur, à la largeur du personnage, est bouchée.
        const gapX = (a.x1 + b.x0) / 2;
        expect(Math.abs(gapX - l.pos.x), `graine ${seed}, lanceur ${l.id}`).toBeGreaterThanOrEqual(1.9 - 1e-6);
        expect(pans.some((pan) => pan.x0 <= l.pos.x - T.heroRadius && pan.x1 >= l.pos.x + T.heroRadius), `graine ${seed}, lanceur ${l.id}`).toBe(true);
        // Un point au-dessus du mur, à portée d'un lancer.
        expect(anchors.some((n) => n.pos.y > a.y1 + 3 && n.pos.y < a.y1 + 6)).toBe(true);
      }
    }
    expect(launchers).toBeGreaterThan(16);
  });

  it('fourches permises : une fois sur deux, deux trous, un large et sûr, un étroit surmonté d\'une étoile, et le vérificateur exige qu\'un lancer attrape chaque route', () => {
    let twoRoutes = 0;
    let oneRoute = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      const sim = new Simulation(seed, T, plan(true));
      const { anchors, obstacles, pickups } = sim.state;
      expect(sim.state.course.unverified, `graine ${seed}`).toBe(0);
      for (const l of anchors.filter((a) => a.kind === 'lanceur')) {
        // Au-dessus de la ligne d'arrivée, les étoiles sont retirées (0.6.3) : un lanceur tout en haut ne se juge pas ici.
        if (l.pos.y + 8 > 120) continue;
        const pans = wallOf(l, obstacles);
        if (pans.length === 2) {
          oneRoute += 1;
          continue;
        }
        expect(pans.length, `graine ${seed}, lanceur ${l.id}`).toBe(3);
        twoRoutes += 1;
        const [a, b, c] = pans as [Obstacle, Obstacle, Obstacle];
        const gaps = [b.x0 - a.x1, c.x0 - b.x1].sort((p, q) => p - q);
        expect(gaps[0]).toBeCloseTo(1.8, 6);
        expect(gaps[1]).toBeCloseTo(2.8, 6);
        // Les deux trous sont décalés du lanceur, de part et d'autre.
        const centres = [(a.x1 + b.x0) / 2, (b.x1 + c.x0) / 2];
        for (const x of centres) expect(Math.abs(x - l.pos.x), `graine ${seed}`).toBeGreaterThanOrEqual(1.9 - 1e-6);
        expect((centres[0]! - l.pos.x) * (centres[1]! - l.pos.x)).toBeLessThan(0);
        // L'étoile est juste au-dessus du trou étroit.
        const tightX = b.x0 - a.x1 < c.x0 - b.x1 ? centres[0]! : centres[1]!;
        expect(pickups.some((s) => Math.abs(s.pos.x - tightX) < 1e-6 && s.pos.y > a.y1 && s.pos.y < a.y1 + 2)).toBe(true);
        // Une sortie au-dessus de chaque trou, et le lanceur est la fourche dont les deux branches sont exigées.
        for (const x of centres) expect(anchors.some((n) => Math.abs(n.pos.x - x) < 1e-6 && n.pos.y > a.y1 + 3 && n.pos.y < a.y1 + 6)).toBe(true);
      }
    }
    expect(twoRoutes).toBeGreaterThan(4);
    expect(oneRoute).toBeGreaterThan(4);
  });
});

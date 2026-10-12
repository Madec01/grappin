import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math/rng';
import { ATELIER_ELEMENTS, atelierEvents, atelierProfile } from '../src/data/atelier';
import { SCENES, SERPENTIN_SCENE_AT, SERPENTIN_SCENE_LENGTH, buildScene, sceneEvents } from '../src/data/scenes';
import { STILL, turnedGravity } from '../src/sim/environment';
import { SERPENTIN_LENGTH, SERPENTIN_STAGES, SERPENTIN_TURN_SECONDS, environmentOf, eventBoundaries, eventLength, eventsAt, serpentinTilt } from '../src/sim/events';
import { ACCORDION_HEIGHT, ACCORDION_PERIOD, HALF_WIDTH, POCKET_GRAVITY, POCKET_HEIGHT, POCKET_RISE, accordion, buildSegment, pocket, tierProfile, type Archetype } from '../src/sim/generator';
import { POCKET_RAMP, freeFlightAt, gravityScale, integrate, swingStep, zoneAcceleration } from '../src/sim/physics';
import { BEGINNER, REASONABLE, playRobot } from '../src/sim/robot';
import { Simulation } from '../src/sim/simulation';
import type { Anchor, Zone } from '../src/sim/state';
import { DEFAULT_TUNING as T, withTuning } from '../src/sim/tuning';
import { canExit, verifySegment } from '../src/sim/verifier';

/** Lot 3 (0.14.0), les transformations du terrain : serpentin, accordéon, poche de faible gravité. */

const SECOND = Math.round(1 / T.stepSeconds);
const ids = (): { anchor: number; obstacle: number; pickup: number; ring: number; zone: number } => ({ anchor: 1, obstacle: 1, pickup: 1, ring: 1, zone: 1 });
const pouch: Zone = { id: 1, x0: -15, y0: 10, x1: 15, y1: 22, kind: 'poche', strength: POCKET_GRAVITY, dir: { x: 0, y: 0 } };

describe('la poche de faible gravité', () => {
  it('allège la gravité en son cœur, en douceur sur la rampe depuis ses bords, et ne pousse pas', () => {
    expect(gravityScale([pouch], { x: 0, y: 16 })).toBe(POCKET_GRAVITY);
    expect(gravityScale([pouch], { x: 0, y: 5 })).toBe(1);
    expect(gravityScale([pouch], { x: 0, y: 10 })).toBe(1);
    // À mi-rampe, à mi-chemin entre la gravité pleine et celle de la poche ; en sortant, pareil.
    expect(gravityScale([pouch], { x: 0, y: 10 + POCKET_RAMP / 2 })).toBeCloseTo(1 + (POCKET_GRAVITY - 1) / 2, 9);
    expect(gravityScale([pouch], { x: 0, y: 22 - POCKET_RAMP / 2 })).toBeCloseTo(1 + (POCKET_GRAVITY - 1) / 2, 9);
    expect(gravityScale([], { x: 0, y: 16 })).toBe(1);
    expect(zoneAcceleration([pouch], { x: 0, y: 16 }, { x: 3, y: 3 })).toEqual({ x: 0, y: 0 });
  });

  it('un vol dans la poche monte bien plus haut et plus longtemps qu\'à l\'air libre', () => {
    const body = { pos: { x: 0, y: 14 }, vel: { x: 0, y: 6 } };
    let light = body;
    let top = body.pos.y;
    for (let i = 0; i < 3 * SECOND; i += 1) {
      light = integrate(light, null, 0, T, STILL, [pouch]);
      top = Math.max(top, light.pos.y);
    }
    // À l'air libre, 2,4 m de montée ; dans la poche, près de trois fois plus (la rampe de sortie, où la gravité revient, retient un peu).
    const freeTop = 14 + (6 * 6) / (2 * T.gravity);
    expect(top).toBeGreaterThan(freeTop + 4);
    expect(top).toBeLessThan(14 + (6 * 6) / (2 * T.gravity * POCKET_GRAVITY) + 0.1);
    // Après une seconde, à l'air libre on redescend déjà ; dans la poche, on monte encore.
    expect(freeFlightAt(body, 1, T).y - freeFlightAt(body, 0.9, T).y).toBeLessThan(0);
    let later = body;
    for (let i = 0; i < SECOND; i += 1) later = integrate(later, null, 0, T, STILL, [pouch]);
    expect(later.vel.y).toBeGreaterThan(0);
  });

  it('accroché dans la poche, le balancement se joue avec la gravité du lieu', () => {
    const anchor = { x: 0, y: 18 };
    let swing = { body: { pos: { x: 0, y: 15 }, vel: { x: 3, y: 0 } }, ropeLength: 3 };
    let swingFree = swing;
    for (let i = 0; i < SECOND / 2; i += 1) {
      swing = swingStep(swing.body, anchor, swing.ropeLength, T, STILL, [pouch]);
      swingFree = swingStep(swingFree.body, anchor, swingFree.ropeLength, T, STILL, []);
    }
    // Moins retenu par la gravité, le personnage monte plus haut le long du cercle.
    expect(swing.body.pos.y).toBeGreaterThan(swingFree.body.pos.y);
  });

  it('le générateur pose une poche de toute la largeur, des prises plus espacées dedans, et la chaîne reprend au-dessus', () => {
    const { zone, anchors, exit } = pocket(ids(), { x: 1, y: 100 }, HALF_WIDTH);
    expect(zone.kind).toBe('poche');
    expect(zone.strength).toBe(POCKET_GRAVITY);
    expect(zone.y1 - zone.y0).toBe(POCKET_HEIGHT);
    expect(zone.x0).toBeLessThan(-HALF_WIDTH - 1);
    expect(zone.x1).toBeGreaterThan(HALF_WIDTH + 1);
    expect(anchors.length).toBeGreaterThanOrEqual(3);
    for (const a of anchors) {
      expect(a.pos.y).toBeGreaterThan(zone.y0);
      expect(a.pos.y).toBeLessThan(zone.y1);
      expect(Math.abs(a.pos.x)).toBeLessThanOrEqual(HALF_WIDTH);
    }
    for (let i = 1; i < anchors.length; i += 1) expect(anchors[i]!.pos.y - anchors[i - 1]!.pos.y).toBeGreaterThan(4);
    expect(exit.y).toBe(100 + POCKET_RISE);
    expect(exit.y).toBeGreaterThan(zone.y1);
  });
});

describe('l\'accordéon', () => {
  it('deux bandes en miroir sur câble, écartées à l\'instant zéro puis resserrées, dans l\'ordre des hauteurs', () => {
    const { anchors, exit } = accordion(ids(), { x: 0.5, y: 100 }, HALF_WIDTH);
    expect(anchors).toHaveLength(6);
    expect(anchors.filter((a) => a.band === -1)).toHaveLength(3);
    expect(anchors.filter((a) => a.band === 1)).toHaveLength(3);
    for (let i = 1; i < anchors.length; i += 1) expect(anchors[i]!.pos.y).toBeGreaterThan(anchors[i - 1]!.pos.y);
    for (const a of anchors) {
      expect(a.cable?.period).toBe(ACCORDION_PERIOD);
      // La bande gauche part de la gauche vers le milieu, la droite de la droite : en miroir.
      expect(Math.sign(a.cable!.from.x - a.pos.x)).toBe(a.band);
      expect(Math.sign(a.cable!.to.x - a.pos.x)).toBe(-a.band!);
      expect(Math.abs(a.cable!.from.x)).toBeLessThanOrEqual(HALF_WIDTH);
      expect(a.cable!.from.y).toBe(a.pos.y);
    }
    // Resserrées, les bandes se touchent presque ; écartées, elles sont hors de portée l'une de l'autre.
    const left = anchors.find((a) => a.band === -1)!;
    const right = anchors.find((a) => a.band === 1)!;
    expect(right.cable!.to.x - left.cable!.to.x).toBeLessThan(2);
    expect(right.cable!.from.x - left.cable!.from.x).toBeGreaterThan(5.6);
    expect(exit.y).toBe(100 + ACCORDION_HEIGHT);
  });

  it('dans une partie, les deux bandes bougent en miroir, se rapprochent puis s\'écartent', () => {
    const sim = new Simulation(3, withTuning(T, { fogBaseSpeed: 0 }), { kind: 'scene', sceneId: 'accordeon', startY: 0 });
    const gap = (): number => {
      const left = sim.state.anchors.find((a) => a.band === -1)!;
      const right = sim.state.anchors.find((a) => a.band === 1 && Math.abs(a.pos.y - left.pos.y) < 2)!;
      return right.pos.x - left.pos.x;
    };
    sim.step();
    const open = gap();
    sim.run(Math.round((ACCORDION_PERIOD / 2) * SECOND));
    const tight = gap();
    sim.run(Math.round((ACCORDION_PERIOD / 2) * SECOND));
    expect(tight).toBeLessThan(open - 4);
    expect(gap()).toBeCloseTo(open, 2);
    const left = sim.state.anchors.find((a) => a.band === -1)!;
    const right = sim.state.anchors.find((a) => a.band === 1)!;
    expect(left.pos.x + right.pos.x).toBeCloseTo(left.cable!.from.x + left.cable!.to.x + right.cable!.from.x + right.cable!.to.x - (left.pos.x + right.pos.x), 6);
  });

  it('les segments d\'accordéon se prouvent dans leurs trois états, et leurs prises de bande ne deviennent ni fragiles, ni câbles d\'événement', () => {
    let built = 0;
    let proven = 0;
    const profile = tierProfile(5);
    for (let seed = 1; seed <= 24; seed += 1) {
      const rng = createRng(seed);
      const from = { x: rng.next() * 4 - 2, y: 100 };
      const segment = buildSegment(rng, ids(), from, { x: 0, y: 0 }, profile, 'accordeon', { env: STILL, entryEnv: STILL, cable: 'cable', maxY: Infinity });
      const bands = segment.anchors.filter((a) => a.band !== undefined);
      if (bands.length === 0) continue;
      built += 1;
      expect(bands.every((a) => a.kind === 'normal' && a.cable?.period === ACCORDION_PERIOD)).toBe(true);
      const entry: Anchor = { id: 0, pos: from, kind: 'normal', broken: false };
      const placed = (f: (a: Anchor) => { x: number; y: number }): typeof segment => ({ ...segment, anchors: segment.anchors.map((a) => (a.cable ? { ...a, pos: f(a) } : a)) });
      const all = verifySegment([entry], [], segment, T) && verifySegment([entry], [], placed((a) => a.cable!.from), T) && verifySegment([entry], [], placed((a) => a.cable!.to), T);
      if (all) proven += 1;
    }
    expect(built).toBeGreaterThanOrEqual(20);
    expect(proven / built).toBeGreaterThanOrEqual(0.9);
  });
});

describe('le serpentin', () => {
  it('s\'incline par stades sur sa longueur : oblique, horizontal, oblique, puis rien', () => {
    expect(SERPENTIN_STAGES).toEqual([0.5, 1, 0.5]);
    expect(serpentinTilt(-0.1)).toBe(0);
    expect(serpentinTilt(0.1)).toBe(0.5);
    expect(serpentinTilt(0.5)).toBe(1);
    expect(serpentinTilt(0.9)).toBe(0.5);
    expect(serpentinTilt(1)).toBe(0);
    expect(eventLength('serpentin')).toBe(SERPENTIN_LENGTH);
    expect(eventLength('vent')).toBe(20);
    expect(eventBoundaries({ kind: 'serpentin', at: 30, length: 45 })).toEqual([30, 75, 45, 60]);
    expect(eventBoundaries({ kind: 'bascule', at: 30, length: 45 })).toEqual([30, 75]);
  });

  it('le vérificateur reçoit la gravité du stade à la hauteur demandée, et un quart de tour sans hauteur', () => {
    const schedule = [{ kind: 'serpentin' as const, at: 20, length: 45, side: -1 as const }];
    expect(environmentOf(eventsAt(schedule, 100, 115)).gravityDir).toEqual(STILL.gravityDir);
    expect(environmentOf(eventsAt(schedule, 100, 125), 100, 125).gravityDir).toEqual(turnedGravity(-1, 0.5));
    expect(environmentOf(eventsAt(schedule, 100, 140), 100, 140).gravityDir).toEqual({ x: -1, y: 0 });
    expect(environmentOf(eventsAt(schedule, 100, 155), 100, 155).gravityDir).toEqual(turnedGravity(-1, 0.5));
    expect(environmentOf(eventsAt(schedule, 100, 125)).gravityDir).toEqual({ x: -1, y: 0 });
  });

  it('en partie, la gravité tourne en douceur vers chaque stade, et revient au bas après la fin', () => {
    const plan = { kind: 'level' as const, levelId: 97, startY: 0, endY: 400, profile: { spacing: 3, obstacles: 0, split: false, fragileChance: 0, boosters: 0, archetypes: ['chaine' as const], spread: 1, electric: 0, eclipse: 0 }, events: [{ kind: 'serpentin' as const, at: 20, length: 45, side: 1 as const }] };
    const sim = new Simulation(7, withTuning(T, { fogBaseSpeed: 0, fogStart: -1000 }), plan);
    // Le personnage est tenu en l'air à une hauteur donnée (sous une gravité de côté, il tomberait hors du monde) : seule l'inclinaison compte ici.
    let heldY = 0;
    const hold = (steps: number): void => {
      for (let i = 0; i < steps; i += 1) {
        sim.state.hero.pos = { x: 0, y: heldY };
        sim.state.hero.vel = { x: 0, y: 0 };
        sim.state.hero.grounded = false;
        sim.state.rope = null;
        sim.step();
      }
    };
    const climbTo = (y: number): void => {
      heldY = y;
      hold(2);
    };
    const stageSteps = Math.round((SERPENTIN_TURN_SECONDS / 2) * SECOND);
    climbTo(21);
    expect(sim.drain().some((e) => e.type === 'event' && e.kind === 'serpentin' && e.phase === 'start')).toBe(true);
    hold(3);
    expect(sim.state.env.gravityDir.x).toBeGreaterThan(0);
    expect(sim.state.env.gravityDir.x).toBeLessThan(0.05);
    hold(stageSteps + 2);
    expect(sim.state.env.gravityDir).toEqual(turnedGravity(1, 0.5));
    expect(sim.state.eventRuntimes[0]!.tilt).toBe(0.5);
    climbTo(36);
    hold(stageSteps + 2);
    expect(sim.state.env.gravityDir).toEqual({ x: 1, y: 0 });
    climbTo(51);
    hold(stageSteps + 2);
    expect(sim.state.env.gravityDir).toEqual(turnedGravity(1, 0.5));
    climbTo(66);
    expect(sim.drain().some((e) => e.type === 'event' && e.kind === 'serpentin' && e.phase === 'end')).toBe(true);
    hold(stageSteps + 2);
    expect(sim.state.env.gravityDir).toEqual(STILL.gravityDir);
    expect(sim.state.status).toBe('alive');
    expect(sim.state.course.unverified).toBe(0);
  });

  it('un niveau sous serpentin se prouve stade par stade : chaque point a une sortie dans la gravité de sa hauteur', () => {
    const plan = { kind: 'level' as const, levelId: 96, startY: 0, endY: 120, profile: tierProfile(3), events: [{ kind: 'serpentin' as const, at: 20, length: 45, side: -1 as const }] };
    const sim = new Simulation(11, T, plan);
    expect(sim.state.course.unverified).toBe(0);
    const anchors = sim.state.anchors;
    const stolen: number[] = [];
    for (const a of anchors.slice(0, -1)) {
      const env = environmentOf(eventsAt(sim.state.schedule, 0, a.pos.y), 0, a.pos.y);
      if (!canExit(a, anchors, sim.state.obstacles, null, T, env, sim.state.zones, sim.state.rings)) stolen.push(a.id);
    }
    expect(stolen, stolen.join(',')).toHaveLength(0);
    // Les trois stades ont bien été traversés par le parcours.
    const tilts = new Set(anchors.map((a) => environmentOf(eventsAt(sim.state.schedule, 0, a.pos.y), 0, a.pos.y).gravityDir.x.toFixed(2)));
    expect(tilts.size).toBeGreaterThanOrEqual(3);
  });
});

describe('les scènes et l\'atelier du lot 3', () => {
  it('les trois scènes se prouvent, portent leur mécanique, et le robot raisonnable les grimpe loin', () => {
    for (const id of ['serpentin', 'accordeon', 'poche'] as const) {
      const scene = SCENES.find((s) => s.id === id)!;
      const segment = buildScene(id, ids(), { x: 0, y: 0 });
      expect(verifySegment([], [], segment, T), id).toBe(true);
      const sim = new Simulation(5, T, { kind: 'scene', sceneId: id, startY: 0 });
      expect(sim.state.course.unverified, id).toBe(0);
      if (id === 'poche') expect(sim.state.zones.some((z) => z.kind === 'poche')).toBe(true);
      if (id === 'accordeon') expect(sim.state.anchors.filter((a) => a.band !== undefined)).toHaveLength(6);
      if (id === 'serpentin') {
        expect(sceneEvents(id)).toEqual([{ kind: 'serpentin', at: SERPENTIN_SCENE_AT, length: SERPENTIN_SCENE_LENGTH, side: 1 }]);
        expect(sim.state.schedule).toHaveLength(1);
      }
      let tilted = 0;
      const report = playRobot(5, T, 60, REASONABLE, { kind: 'scene', sceneId: id, startY: 0 }, (state) => {
        tilted = Math.max(tilted, Math.abs(state.env.gravityDir.x));
      });
      expect(report.alive, scene.name).toBe(true);
      expect(report.height, scene.name).toBeGreaterThan(80);
      if (id === 'serpentin') expect(tilted).toBeCloseTo(1, 2);
    }
    expect(sceneEvents('roue')).toEqual([]);
  });

  it('le débutant passe l\'accordéon et la poche', () => {
    for (const id of ['accordeon', 'poche'] as const) {
      const report = playRobot(5, T, 40, BEGINNER, { kind: 'scene', sceneId: id, startY: 0 });
      expect(report.height, id).toBeGreaterThan(26);
    }
  });

  it('l\'atelier connaît les trois transformations (et celles du lot 5 B après elles), et une partie n\'engendre qu\'elles', () => {
    expect(ATELIER_ELEMENTS.filter((e) => e.group === 'transformations').map((e) => e.id)).toEqual(['serpentin', 'accordeon', 'poche', 'plafond', 'faille', 'carrousel', 'depliante', 'convoyeur']);
    expect(atelierEvents(['serpentin', 'vent'])).toEqual(['serpentin', 'vent']);
    expect(atelierProfile(['accordeon', 'poche']).archetypes).toEqual(['accordeon', 'poche']);
    const pouches = new Simulation(2, T, { kind: 'atelier', startY: 0, selection: ['poche'] });
    expect(pouches.state.zones.length).toBeGreaterThan(0);
    expect(pouches.state.zones.every((z) => z.kind === 'poche')).toBe(true);
    const bands = new Simulation(2, T, { kind: 'atelier', startY: 0, selection: ['accordeon'] });
    expect(bands.state.anchors.filter((a) => a.band !== undefined).length).toBeGreaterThanOrEqual(6);
    const winding = new Simulation(2, T, { kind: 'atelier', startY: 0, selection: ['serpentin'] });
    expect(winding.state.schedule.length).toBeGreaterThan(0);
    expect(winding.state.schedule.every((e) => e.kind === 'serpentin' && e.length === SERPENTIN_LENGTH)).toBe(true);
    expect(winding.state.course.unverified).toBe(0);
    // Un seul événement choisi : il revient, segment après segment.
    expect(winding.state.schedule.length).toBeGreaterThanOrEqual(1);
  });

  it('la course libre ouvre la poche au palier 2 et l\'accordéon au palier 4', () => {
    const has = (tier: number, archetype: Archetype): boolean => tierProfile(tier).archetypes.includes(archetype);
    expect(has(1, 'poche')).toBe(false);
    expect(has(2, 'poche')).toBe(true);
    expect(has(3, 'accordeon')).toBe(false);
    expect(has(4, 'accordeon')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math/rng';
import { ATELIER_ELEMENTS, atelierProfile } from '../src/data/atelier';
import { LEVELS } from '../src/data/levels';
import { SCENES, buildScene } from '../src/data/scenes';
import { switchGauge } from '../src/sim/cycles';
import { CLOSE_SECONDS, ELASTIC_RISE, LOCK_WIDTH, MAGNET_LIFT, MAGNET_RISE, SHUT_SECONDS, accordion, buildSegment, elasticHold, escapeCorridor, magnetHold, railHold, switchLock, tierProfile, type Archetype, type Segment } from '../src/sim/generator';
import { DEFAULT_RAIL, ELASTIC_MAX_STRETCH, MAGNET_CORE_RADIUS, RAIL_DRAG, RAIL_POSITIONS, RAIL_SPEED, SWITCH_HOLD_SECONDS, elasticStep, elasticStretch, magnetStep, railDirection, railParam, railPoint, railPull, railSet, railVelocity } from '../src/sim/holds';
import { closerOffset, closerState, isMoving, obstacleAt } from '../src/sim/moving';
import { isSolidNow, provableObstacles } from '../src/sim/obstacles';
import { BEGINNER, REASONABLE, playRobot } from '../src/sim/robot';
import { Simulation } from '../src/sim/simulation';
import type { Anchor, Obstacle } from '../src/sim/state';
import { DEFAULT_TUNING as T, withTuning } from '../src/sim/tuning';
import { verifySegment } from '../src/sim/verifier';

/** Lot 5, partie A (0.15.0) : l'aimant, l'interrupteur, le rail, le lien élastique, le passage qui se referme. */

const SECOND = Math.round(1 / T.stepSeconds);
const ids = (): { anchor: number; obstacle: number; pickup: number; ring: number; zone: number } => ({ anchor: 1, obstacle: 1, pickup: 1, ring: 1, zone: 1 });

describe('l\'aimant', () => {
  it('attire vers son noyau d\'où que l\'on vienne, en courbe, et y suspend le personnage', () => {
    const core = { x: 0, y: 20 };
    for (const start of [{ pos: { x: -5, y: 17 }, vel: { x: 0, y: 0 } }, { pos: { x: 4, y: 22 }, vel: { x: -6, y: 4 } }, { pos: { x: 0.5, y: 14 }, vel: { x: 8, y: 2 } }]) {
      let body = start;
      let farthest = 0;
      for (let k = 0; k < 3 * SECOND; k += 1) {
        body = magnetStep(body, core, T);
        farthest = Math.max(farthest, Math.hypot(body.pos.x - core.x, body.pos.y - core.y));
      }
      expect(Math.hypot(body.pos.x - core.x, body.pos.y - core.y), JSON.stringify(start)).toBeLessThan(MAGNET_CORE_RADIUS);
      expect(Math.hypot(body.vel.x, body.vel.y)).toBeLessThan(1);
      expect(farthest).toBeLessThan(12);
    }
  });

  it('le générateur le pose au-dessus du point courant et reprend la chaîne à portée du noyau, trop haut pour un balancement', () => {
    const { anchor, exit } = magnetHold(ids(), { x: 1, y: 100 }, 4);
    expect(anchor.kind).toBe('aimant');
    expect(anchor.pos.y).toBe(100 + MAGNET_LIFT);
    expect(exit.y).toBe(100 + MAGNET_RISE);
    expect(Math.hypot(exit.x - anchor.pos.x, exit.y - anchor.pos.y)).toBeLessThan(T.ropeMax * T.verifyCatchRatio);
  });
});

describe('le lien élastique', () => {
  const anchor = { x: 0, y: 20 };
  it('mou, laisse voler ; tendu, retient, rappelle plus fort qu\'il ne retient, et jamais au-delà de l\'étirement maximal', () => {
    let body = { pos: { x: 0, y: 23 }, vel: { x: 0, y: -8 } };
    const rest = 3;
    let deepest = Infinity;
    let fastestUp = 0;
    for (let k = 0; k < 4 * SECOND; k += 1) {
      body = elasticStep(body, anchor, rest, T);
      deepest = Math.min(deepest, body.pos.y);
      if (body.pos.y >= anchor.y - rest) fastestUp = Math.max(fastestUp, body.vel.y);
    }
    expect(elasticStretch({ x: 0, y: anchor.y - rest - 1.2 }, anchor, rest)).toBeCloseTo(1.2, 9);
    expect(elasticStretch({ x: 0, y: anchor.y - 1 }, anchor, rest)).toBe(0);
    expect(deepest).toBeGreaterThanOrEqual(anchor.y - rest - ELASTIC_MAX_STRETCH - 1e-6);
    // Le rappel rend plus que la chute : la remontée à la longueur de repos dépasse la vitesse de la chute.
    expect(fastestUp).toBeGreaterThan(8);
  });

  it('se range sous la prise et rebondit de plus en plus haut, même pris de côté sans élan', () => {
    let body = { pos: { x: 2.5, y: 17 }, vel: { x: 3, y: 0 } };
    const rest = Math.hypot(2.5, 3);
    const tops: number[] = [];
    let prevVy = 0;
    for (let k = 0; k < 8 * SECOND; k += 1) {
      body = elasticStep(body, anchor, rest, T);
      if (prevVy > 0 && body.vel.y <= 0) tops.push(body.pos.y - anchor.y);
      prevVy = body.vel.y;
    }
    expect(tops.length).toBeGreaterThanOrEqual(3);
    expect(tops[2]!).toBeGreaterThan(tops[0]!);
    expect(tops.at(-1)!).toBeGreaterThan(3);
    expect(Math.abs(body.pos.x)).toBeLessThan(0.5);
  });

  it('le générateur le pose de côté, et la chaîne reprend bien plus haut : seul le rappel y monte', () => {
    const { anchor: link, exit } = elasticHold(ids(), { x: -1, y: 100 }, 1, 4);
    expect(link.kind).toBe('elastique');
    expect(link.pos.x).toBeGreaterThan(1);
    expect(exit.y).toBe(link.pos.y + ELASTIC_RISE);
  });
});

describe('le rail de lancement', () => {
  it('est un arc en dôme : le doigt choisit la position, la direction suit la normale, de 45° à gauche à 45° à droite', () => {
    expect(railParam({ x: 0, y: 0 })).toBe(0.5);
    expect(railParam({ x: -RAIL_DRAG, y: 3 })).toBe(0);
    expect(railParam({ x: 2 * RAIL_DRAG, y: 0 })).toBe(1);
    expect(railParam(railPull(0.25))).toBeCloseTo(0.25, 9);
    const pos = { x: 2, y: 30 };
    expect(railPoint(pos, DEFAULT_RAIL, 0.5)).toEqual({ x: 2, y: 30 + DEFAULT_RAIL.rise });
    expect(railPoint(pos, DEFAULT_RAIL, 0)).toEqual({ x: 2 - DEFAULT_RAIL.halfWidth, y: 30 });
    const left = railDirection(DEFAULT_RAIL, 0);
    const middle = railDirection(DEFAULT_RAIL, 0.5);
    const right = railDirection(DEFAULT_RAIL, 1);
    expect(middle).toEqual({ x: 0, y: 1 });
    expect(left.x).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(left.y).toBeCloseTo(Math.SQRT1_2, 3);
    expect(right.x).toBeCloseTo(Math.SQRT1_2, 3);
    expect(Math.hypot(railVelocity(DEFAULT_RAIL, 0.3).x, railVelocity(DEFAULT_RAIL, 0.3).y)).toBeCloseTo(RAIL_SPEED, 9);
    expect(railSet()).toHaveLength(RAIL_POSITIONS);
    expect(railSet()[0]).toBe(0);
    expect(railSet().at(-1)).toBe(1);
  });

  it('en partie, le doigt qui glisse déplace le personnage sur l\'arc, et le relâché lance selon la direction de l\'endroit', () => {
    const sim = new Simulation(5, withTuning(T, { fogBaseSpeed: 0 }), { kind: 'scene', sceneId: 'rail', startY: 0 });
    const rail = sim.state.anchors.find((a) => a.kind === 'rail')!;
    sim.state.hero.pos = { x: rail.pos.x, y: rail.pos.y - 2 };
    sim.state.hero.vel = { x: 0, y: 0 };
    sim.state.hero.grounded = false;
    sim.state.targetId = rail.id;
    sim.state.targetValidStep = sim.state.step;
    expect(sim.press()).toBe(true);
    sim.step();
    expect(sim.state.hero.pos).toEqual(railPoint(rail.pos, rail.rail!, 0.5));
    sim.aim({ x: -RAIL_DRAG, y: 0 });
    sim.step();
    expect(sim.state.hero.pos).toEqual(railPoint(rail.pos, rail.rail!, 0));
    expect(sim.release({ x: -RAIL_DRAG, y: 0 })).toBe(true);
    const v = sim.state.hero.vel;
    expect(v.x).toBeLessThan(0);
    expect(v.y).toBeGreaterThan(0);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(RAIL_SPEED, 6);
    // Un lancer ne se juge pas : la série reste.
    expect(sim.drain().find((e) => e.type === 'release')).toMatchObject({ kind: 'rail', perfect: false });
  });

  it('le générateur pose le rail sous un mur à trou décalé, comme un lanceur', () => {
    const { anchor, walls, exit } = railHold(ids(), { x: 0, y: 100 }, 5, 2.3, 4);
    expect(anchor.kind).toBe('rail');
    expect(anchor.rail).toEqual(DEFAULT_RAIL);
    expect(walls).toHaveLength(2);
    expect(walls[0]!.x1).toBeLessThan(walls[1]!.x0);
    expect(exit.y).toBeGreaterThan(105);
  });
});

describe('la prise interrupteur et son verrou', () => {
  it('le verrou est fermé, s\'ouvre tant que la prise est tenue et quatre secondes après, puis se referme ; sa jauge le dit', () => {
    const sim = new Simulation(5, withTuning(T, { fogBaseSpeed: 0 }), { kind: 'scene', sceneId: 'interrupteur', startY: 0 });
    const lever = sim.state.anchors.find((a) => a.kind === 'interrupteur')!;
    const lock = sim.state.obstacles.find((o) => o.switchedBy === lever.id)!;
    expect(lock.kind).toBe('porte');
    expect(lock.x1 - lock.x0).toBeCloseTo(LOCK_WIDTH, 9);
    expect(isSolidNow(lock, sim.state.step, T, [])).toBe(true);
    expect(switchGauge(lock, sim.state.step, T, SWITCH_HOLD_SECONDS)).toBe(1);
    sim.state.hero.pos = { x: lever.pos.x, y: lever.pos.y - 2 };
    sim.state.hero.vel = { x: 0, y: 0 };
    sim.state.hero.grounded = false;
    sim.state.targetId = lever.id;
    sim.state.targetValidStep = sim.state.step;
    expect(sim.press()).toBe(true);
    sim.run(10);
    expect(isSolidNow(lock, sim.state.step, T, [])).toBe(false);
    expect(switchGauge(lock, sim.state.step, T, SWITCH_HOLD_SECONDS)).toBe(0);
    sim.release();
    sim.run(2 * SECOND);
    expect(isSolidNow(lock, sim.state.step, T, [])).toBe(false);
    expect(switchGauge(lock, sim.state.step, T, SWITCH_HOLD_SECONDS)).toBeCloseTo(0.5, 1);
    sim.run(Math.round(SWITCH_HOLD_SECONDS * SECOND));
    expect(isSolidNow(lock, sim.state.step, T, [])).toBe(true);
    expect(switchGauge(lock, sim.state.step, T, SWITCH_HOLD_SECONDS)).toBe(1);
    // Le vérificateur ne compte pas sur le verrou : on le commande.
    expect(provableObstacles([lock])).toEqual([]);
  });

  it('le générateur pose le verrou au milieu du vol vers le point suivant', () => {
    const { anchor, door } = switchLock(ids(), { x: 0, y: 100 }, { x: 3, y: 104 });
    expect(anchor.kind).toBe('interrupteur');
    expect(door.switchedBy).toBe(anchor.id);
    expect((door.x0 + door.x1) / 2).toBeCloseTo(1.5, 9);
    expect((door.y0 + door.y1) / 2).toBeGreaterThan(102);
  });
});

describe('le passage qui se referme', () => {
  it('ses panneaux sont des obstacles qui bougent : armés et immobiles, puis ils ferment, restent fermés, rouvrent et se réarment', () => {
    const { walls } = escapeCorridor(ids(), { x: 0, y: 100 }, 4);
    const panel = walls.find((w) => w.closer?.side === 1)!;
    expect(isMoving(panel)).toBe(true);
    expect(provableObstacles(walls)).toHaveLength(2);
    expect(closerOffset(panel, 500, T)).toBe(0);
    expect(closerState(panel, 500, T)).toBe('arme');
    const triggered: Obstacle = { ...panel, triggeredStep: 1000 };
    expect(closerState(triggered, 1000, T)).toBe('se ferme');
    expect(closerOffset(triggered, 1000 + Math.round((CLOSE_SECONDS / 2) * SECOND), T)).toBeCloseTo(panel.closer!.travel / 2, 6);
    const shut = 1000 + Math.round(CLOSE_SECONDS * SECOND) + 10;
    expect(closerState(triggered, shut, T)).toBe('ferme');
    expect(obstacleAt(triggered, shut, T).x1).toBeCloseTo(panel.x1 + panel.closer!.travel, 6);
    const reopening = shut + Math.round(SHUT_SECONDS * SECOND);
    expect(closerState(triggered, reopening, T)).toBe('rouvre');
    expect(closerOffset(triggered, reopening + Math.round(CLOSE_SECONDS * SECOND), T)).toBe(0);
  });

  it('en partie, entrer dans le couloir déclenche la fermeture, annoncée ; sorti, le passage se referme derrière et ne se redéclenche plus', () => {
    const sim = new Simulation(5, withTuning(T, { fogBaseSpeed: 0 }), { kind: 'scene', sceneId: 'evasion', startY: 0 });
    const panel = sim.state.obstacles.find((o) => o.closer?.side === 1)!;
    expect(panel.triggeredStep).toBeUndefined();
    sim.state.hero.pos = { x: 0, y: panel.closer!.triggerY + 0.5 };
    sim.state.hero.vel = { x: 0, y: 0 };
    sim.state.hero.grounded = false;
    sim.step();
    expect(panel.triggeredStep).toBe(sim.state.step);
    expect(sim.drain().filter((e) => e.type === 'escape')).toHaveLength(1);
    // Passé au-dessus des panneaux : fermés derrière, et une fois le cycle fini, plus jamais déclenchés.
    sim.state.hero.pos = { x: 0, y: panel.y1 + 3 };
    sim.state.hero.vel = { x: 0, y: 0 };
    for (let k = 0; k < (2 * CLOSE_SECONDS + SHUT_SECONDS + 1) * SECOND; k += 1) {
      sim.state.hero.pos = { x: 0, y: panel.y1 + 3 };
      sim.state.hero.vel = { x: 0, y: 0 };
      sim.step();
    }
    expect(panel.triggeredStep).toBeUndefined();
    expect(closerOffset(panel, sim.state.step, T)).toBe(0);
  });
});

describe('les segments, scènes, robots, atelier et niveaux du lot 5 A', () => {
  it('les segments se construisent et se prouvent ; sans l\'aimant ou le lien, la suite est hors de portée', () => {
    const profile = tierProfile(5);
    const has = (archetype: Archetype, segment: Segment): boolean => (archetype === 'evasion' ? segment.obstacles.some((o) => o.closer) : segment.anchors.some((a) => a.kind === archetype));
    for (const archetype of ['aimant', 'interrupteur', 'rail', 'elastique', 'evasion'] as const) {
      let built = 0;
      let proven = 0;
      let without = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        const rng = createRng(seed);
        const from = { x: rng.next() * 4 - 2, y: 100 };
        const segment = buildSegment(rng, ids(), from, { x: 0, y: 0 }, profile, archetype);
        if (!has(archetype, segment)) continue;
        built += 1;
        const entry: Anchor = { id: 0, pos: from, kind: 'normal', broken: false };
        if (verifySegment([entry], [], segment, T)) proven += 1;
        if (archetype === 'aimant' || archetype === 'elastique') {
          const stripped: Segment = { ...segment, anchors: segment.anchors.filter((a) => a.kind !== archetype) };
          if (verifySegment([entry], [], stripped, T)) without += 1;
        }
      }
      expect(built, archetype).toBeGreaterThanOrEqual(8);
      expect(proven / built, archetype).toBeGreaterThanOrEqual(0.85);
      if (archetype === 'aimant' || archetype === 'elastique') expect(without / built, archetype).toBeLessThanOrEqual(0.15);
    }
  });

  it('les cinq scènes se prouvent, portent leur mécanique, et les robots les grimpent', () => {
    for (const id of ['aimant', 'interrupteur', 'rail', 'elastique', 'evasion'] as const) {
      const scene = SCENES.find((s) => s.id === id)!;
      const segment = buildScene(id, ids(), { x: 0, y: 0 });
      expect(verifySegment([], [], segment, T), id).toBe(true);
      if (id === 'evasion') expect(segment.obstacles.filter((o) => o.closer)).toHaveLength(2);
      else expect(segment.anchors.some((a) => a.kind === id), id).toBe(true);
      const held = new Set<string>();
      const report = playRobot(5, T, 45, REASONABLE, { kind: 'scene', sceneId: id, startY: 0 }, (state) => {
        const anchor = state.rope ? state.anchors.find((a) => a.id === state.rope?.anchorId) : undefined;
        if (anchor) held.add(anchor.kind);
      });
      expect(report.alive, scene.name).toBe(true);
      expect(report.height, scene.name).toBeGreaterThan(60);
      if (id !== 'evasion') expect([...held], id).toContain(id);
      const beginner = playRobot(5, T, 45, BEGINNER, { kind: 'scene', sceneId: id, startY: 0 });
      expect(beginner.height, `${scene.name}, débutant`).toBeGreaterThan(26);
    }
  }, 20_000);

  it('l\'atelier connaît les cinq éléments, et les paliers les ouvrent dans l\'ordre', () => {
    expect(ATELIER_ELEMENTS.filter((e) => ['aimant', 'interrupteur', 'rail', 'elastique', 'evasion'].includes(e.id))).toHaveLength(5);
    expect(atelierProfile(['rail', 'evasion']).archetypes).toEqual(['rail', 'evasion']);
    const has = (tier: number, archetype: Archetype): boolean => tierProfile(tier).archetypes.includes(archetype);
    expect(has(2, 'aimant')).toBe(false);
    expect(has(3, 'aimant') && has(3, 'interrupteur')).toBe(true);
    expect(has(3, 'rail')).toBe(false);
    expect(has(4, 'rail') && has(4, 'elastique')).toBe(true);
    expect(has(4, 'evasion')).toBe(false);
    expect(has(5, 'evasion')).toBe(true);
    const run = new Simulation(2, T, { kind: 'atelier', startY: 0, selection: ['aimant', 'evasion'] });
    expect(run.state.anchors.some((a) => a.kind === 'aimant')).toBe(true);
    expect(run.state.obstacles.some((o) => o.closer)).toBe(true);
    expect(run.state.course.unverified).toBe(0);
  });

  it('les niveaux 21 et 22 existent, se suivent, et portent les nouveautés', () => {
    expect(LEVELS).toHaveLength(22);
    const aimants = LEVELS.find((l) => l.id === 21)!;
    const rails = LEVELS.find((l) => l.id === 22)!;
    expect(aimants.startY).toBe(LEVELS.find((l) => l.id === 20)!.endY);
    expect(rails.startY).toBe(aimants.endY);
    expect(aimants.profile.archetypes).toContain('aimant');
    expect(aimants.profile.archetypes).toContain('interrupteur');
    expect(rails.profile.archetypes).toEqual(expect.arrayContaining(['rail', 'elastique', 'evasion']));
    // L'accordéon d'hier et le rail d'aujourd'hui vivent ensemble dans la même chaîne de constructeurs.
    expect(accordion(ids(), { x: 0, y: 100 }, 4).anchors).toHaveLength(6);
  });
});

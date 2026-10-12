import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math/rng';
import { SCENES, buildScene } from '../src/data/scenes';
import { BOUNCE_RESTITUTION, SMASH_KEEP, flightStep, needsSteps, startFlight } from '../src/sim/flight';
import { RICOCHET_WALL_RISE, SLIDE_AMPLITUDE, WHEEL_RISE, buildSegment, doorWall, hoop, ricochet, rotorBar, slidingWall, smashWall, wheel, type Archetype, type Segment, type TierProfile } from '../src/sim/generator';
import { obstacleAt } from '../src/sim/moving';
import { pulledPosition } from '../src/sim/launcher';
import { REASONABLE, playRobot } from '../src/sim/robot';
import { WORLD_HALF_WIDTH } from '../src/sim/rules';
import { Simulation } from '../src/sim/simulation';
import type { Anchor, Obstacle, Ring } from '../src/sim/state';
import { DEFAULT_TUNING as T, withTuning } from '../src/sim/tuning';
import { verifySegment } from '../src/sim/verifier';

/**
 * Retour du propriétaire (0.12.1) : « les cassables ne servent à rien en l'état,
 * il faut que ça rajoute de la difficulté ». Ces tests gardent ce qui rend
 * une mécanique obligatoire : le vérificateur la joue, et un passage exigé
 * ne se prouve pas sans elle.
 */

const SECOND = Math.round(1 / T.stepSeconds);
const ids = () => ({ anchor: 1, obstacle: 1, pickup: 1, ring: 1, zone: 1 });
const slab = (kind?: Obstacle['kind']): Obstacle => (kind ? { id: 7, x0: -2, y0: 4, x1: 2, y1: 4.4, kind } : { id: 7, x0: -2, y0: 4, x1: 2, y1: 4.4 });

/** Un mur au-dessus d'un lanceur va d'un bord du monde à l'autre : on ne le contourne pas par les côtés. */
function spansWorld(walls: readonly Obstacle[]): boolean {
  return Math.min(...walls.map((o) => o.x0)) <= -WORLD_HALF_WIDTH && Math.max(...walls.map((o) => o.x1)) >= WORLD_HALF_WIDTH;
}

/** Le même segment, sa mécanique retirée : rebonds et parois cassables devenus solides, anneaux ôtés. */
function stripped(segment: Segment): Segment {
  return { ...segment, rings: [], obstacles: segment.obstacles.map((o) => (o.kind === 'rebond' || o.kind === 'cassable' ? { id: o.id, x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1 } : o)) };
}

describe('le vol joué avec ses rencontres (flight.ts)', () => {
  it('une surface de rebond renvoie le vol, une paroi cassable cède à partir de smashSpeed et arrête sinon, un anneau accélère', () => {
    const bounce = startFlight({ pos: { x: 0, y: 6 }, vel: { x: 0, y: -8 } });
    for (let k = 0; k < SECOND / 2 && !bounce.ended; k += 1) flightStep(bounce, [slab('rebond')], [], [], T);
    expect(bounce.ended).toBe(false);
    expect(bounce.body.vel.y).toBeGreaterThan(0);
    expect(bounce.body.pos.y).toBeGreaterThan(4.4);
    const fast = startFlight({ pos: { x: 0, y: 6 }, vel: { x: 0, y: -12 } });
    for (let k = 0; k < SECOND / 2 && !fast.ended; k += 1) flightStep(fast, [slab('cassable')], [], [], T);
    expect(fast.ended).toBe(false);
    expect(fast.smashed.has(7)).toBe(true);
    expect(fast.body.pos.y).toBeLessThan(4);
    const slow = startFlight({ pos: { x: 0, y: 6 }, vel: { x: 0, y: -6 } });
    for (let k = 0; k < SECOND / 2 && !slow.ended; k += 1) flightStep(slow, [slab('cassable')], [], [], T);
    expect(slow.ended).toBe(true);
    const ring: Ring = { id: 1, pos: { x: 0, y: 5 }, radius: 1.1, closest: null, taken: false };
    const through = startFlight({ pos: { x: 0, y: 8 }, vel: { x: 0, y: -10 } });
    let before = 0;
    for (let k = 0; k < SECOND / 2; k += 1) {
      if (through.body.pos.y > 6.2) before = Math.hypot(through.body.vel.x, through.body.vel.y);
      flightStep(through, [], [ring], [], T);
    }
    expect(through.rings.has(1)).toBe(true);
    // Après l'anneau, plus vite que la seule gravité ne l'aurait fait : le coup d'accélération.
    expect(Math.hypot(through.body.vel.x, through.body.vel.y)).toBeGreaterThan(before * T.ringBoost - 0.5);
    expect(needsSteps([slab()], [], [])).toBe(false);
    expect(needsSteps([slab('rebond')], [], [])).toBe(true);
    expect(needsSteps([], [ring], [])).toBe(true);
    expect(BOUNCE_RESTITUTION).toBeLessThan(1);
    expect(SMASH_KEEP).toBeLessThan(1);
  });

  it('en jeu, tout anneau traversé accélère ; au centre, la série monte en plus', () => {
    const sim = new Simulation(1, withTuning(T, { fogBaseSpeed: 0, fogStart: -1000 }));
    sim.state.anchors = [{ id: 1, pos: { x: 0, y: 40 }, kind: 'normal', broken: false }];
    sim.state.obstacles = []; sim.state.pickups = []; sim.state.zones = [];
    sim.state.course.lastY = 10_000;
    sim.state.rings = [{ id: 1, pos: { x: 0, y: 5 }, radius: 1.1, closest: null, taken: false }];
    sim.state.hero = { pos: { x: 0.8, y: 8 }, vel: { x: 0, y: -10 }, grounded: false };
    sim.state.height = 8; sim.state.targetId = null;
    let fastest = 0;
    for (let k = 0; k < SECOND / 2; k += 1) { sim.step(); fastest = Math.max(fastest, Math.hypot(sim.state.hero.vel.x, sim.state.hero.vel.y)); }
    expect(sim.state.rings[0]!.taken).toBe(true);
    expect(sim.state.combo).toBe(0);
    // Sans l'anneau, la vitesse à 3 m de chute est de 12,2 m/s ; avec, un cran de plus.
    expect(fastest).toBeGreaterThan(13);
  });
});

describe('les usages exigés du générateur', () => {
  const profile: TierProfile = { spacing: 4.2, obstacles: 1, split: true, fragileChance: 0.2, boosters: 1, archetypes: ['chaine'], spread: 1.2, electric: 0, eclipse: 0 };
  const build = (seed: number, archetype: Archetype) => {
    const rng = createRng(seed);
    const from = { x: rng.next() * 4 - 2, y: 100 };
    const entry: Anchor = { id: 0, pos: from, kind: 'normal', broken: false };
    return { segment: buildSegment(rng, ids(), from, { x: 0, y: 0 }, profile, archetype), entry };
  };

  it('mur à percer, ricochet et percée : prouvés avec leur mécanique, jamais sans elle', () => {
    for (const archetype of ['brise', 'ricochet', 'percee'] as const) {
      let withFeature = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        const { segment, entry } = build(seed, archetype);
        const has = segment.obstacles.some((o) => o.kind === 'cassable' || o.kind === 'rebond');
        if (!has) continue;
        withFeature += 1;
        expect(verifySegment([entry], [], segment, T), `${archetype} ${seed}`).toBe(true);
        expect(verifySegment([entry], [], stripped(segment), T), `${archetype} ${seed} sans`).toBe(false);
      }
      expect(withFeature, archetype).toBeGreaterThan(12);
    }
  });

  it('sas et cerceau : un lanceur sous un mur dont le seul passage est une porte, ou un anneau étroit et décalé', () => {
    let doors = 0;
    let hoops = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const sas = build(seed, 'sas');
      const door = sas.segment.obstacles.find((o) => o.kind === 'porte');
      if (door) {
        doors += 1;
        expect(sas.segment.anchors.some((a) => a.kind === 'lanceur')).toBe(true);
        expect(spansWorld(sas.segment.obstacles.filter((o) => o.y0 === door.y0))).toBe(true);
        expect(verifySegment([sas.entry], [], sas.segment, T)).toBe(true);
      }
      const cerceau = build(seed, 'cerceau');
      if (cerceau.segment.rings.length > 0) {
        hoops += 1;
        const ring = cerceau.segment.rings[0]!;
        const launcher = cerceau.segment.anchors.find((a) => a.kind === 'lanceur')!;
        // L'anneau est dans le mur, décalé du lanceur, et la sortie de côté : on ne la voit pas à travers l'anneau depuis le bas.
        const panes = cerceau.segment.obstacles.filter((o) => Math.abs(o.y0 - (ring.pos.y - 0.2)) < 1e-6);
        expect(panes).toHaveLength(2);
        // D'un bord du monde à l'autre, et le trou plus étroit que l'anneau : y passer, c'est le traverser.
        expect(spansWorld(panes)).toBe(true);
        expect((panes[1]!.x0 - panes[0]!.x1) / 2 - T.heroRadius).toBeLessThanOrEqual(ring.radius);
        expect(Math.abs(ring.pos.x - launcher.pos.x)).toBeGreaterThan(1.5);
        expect(verifySegment([cerceau.entry], [], cerceau.segment, T)).toBe(true);
      }
    }
    expect(doors).toBeGreaterThan(10);
    expect(hoops).toBeGreaterThan(10);
  });

  it('fin du lot 2 : la roue est exigée (jamais prouvée sans son moteur), la glissière et le tournant se posent et se prouvent', () => {
    let wheels = 0;
    let slides = 0;
    let rotors = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const roue = build(seed, 'roue');
      const hub = roue.segment.anchors.find((a) => a.kind === 'roue');
      if (hub) {
        wheels += 1;
        expect(hub.motor, `graine ${seed}`).toBeDefined();
        // La sortie est dix mètres plus haut, du côté où la roue envoie : hors de portée d'un balancement ordinaire.
        const exit = roue.segment.anchors[roue.segment.anchors.indexOf(hub) + 1]!;
        expect(exit.pos.y - hub.pos.y).toBeCloseTo(WHEEL_RISE, 6);
        expect(verifySegment([roue.entry], [], roue.segment, T), `roue ${seed}`).toBe(true);
        const stripped: Segment = { ...roue.segment, anchors: roue.segment.anchors.map((a) => (a.kind === 'roue' ? { id: a.id, pos: a.pos, kind: 'normal', broken: false } : a)) };
        expect(verifySegment([roue.entry], [], stripped, T), `roue ${seed} sans moteur`).toBe(false);
      }
      const glissiere = build(seed, 'glissiere');
      const panes = glissiere.segment.obstacles.filter((o) => o.slide);
      if (panes.length > 0) {
        slides += 1;
        expect(panes).toHaveLength(2);
        expect(glissiere.segment.anchors.some((a) => a.kind === 'lanceur')).toBe(true);
        // Les deux panneaux glissent ensemble, et couvrent le monde quel que soit leur décalage.
        expect(panes[0]!.slide).toEqual(panes[1]!.slide);
        for (const step of [0, 300, 600]) expect(spansWorld(panes.map((o) => obstacleAt(o, step, T)))).toBe(true);
        expect(verifySegment([glissiere.entry], [], glissiere.segment, T), `glissière ${seed}`).toBe(true);
      }
      const tournant = build(seed, 'tournant');
      const bar = tournant.segment.obstacles.find((o) => o.kind === 'tournant');
      if (bar) {
        rotors += 1;
        expect(bar.rotor).toBeDefined();
        expect(Math.abs(bar.rotor!.spin)).toBeCloseTo(1 / 6, 6);
        expect(verifySegment([tournant.entry], [], tournant.segment, T), `tournant ${seed}`).toBe(true);
      }
    }
    expect(wheels).toBeGreaterThan(15);
    expect(slides).toBeGreaterThan(40);
    expect(rotors).toBeGreaterThan(10);
  });

  it('les constructeurs partagés : mur cassable sans trou, anneau-trou, ricochet à la hauteur réglée', () => {
    const launcher = { x: 0.5, y: 20 };
    const { wall, exit } = smashWall(ids(), launcher, 5, 0.6, 4);
    expect(wall.kind).toBe('cassable');
    expect(spansWorld([wall])).toBe(true);
    expect(exit.y).toBeGreaterThan(wall.y1 + 3);
    const h = hoop(ids(), launcher, 5, 2.8, 4);
    expect(h.walls).toHaveLength(2);
    expect(h.ring.pos.x).toBeCloseTo(2.7, 6);
    expect(h.walls[0]!.x1).toBeLessThan(h.ring.pos.x);
    expect(h.walls[1]!.x0).toBeGreaterThan(h.ring.pos.x);
    expect(spansWorld(h.walls)).toBe(true);
    const d = doorWall(ids(), launcher, 5, 2.8, 4);
    expect(d.walls.map((b) => b.kind ?? 'solide')).toEqual(['solide', 'porte', 'solide']);
    expect(spansWorld(d.walls)).toBe(true);
    const r = ricochet(ids(), launcher, RICOCHET_WALL_RISE, 1, 4);
    expect(r.boxes.map((b) => b.kind ?? 'solide')).toEqual(['solide', 'solide', 'solide', 'rebond']);
    expect(spansWorld(r.boxes.slice(0, 2))).toBe(true);
    expect(r.exit.x).toBeLessThan(launcher.x);
    const w = wheel(ids(), launcher, -1, 4);
    expect(w.anchor).toMatchObject({ kind: 'roue', motor: { spin: -1 } });
    expect(w.exit.x).toBeLessThan(launcher.x);
    expect(w.exit.y).toBeCloseTo(launcher.y + WHEEL_RISE, 6);
    const bar = rotorBar(ids(), { x: 1, y: 30 }, 1 / 6, 0.2);
    expect(bar).toMatchObject({ kind: 'tournant', rotor: { pivot: { x: 1, y: 30 }, spin: 1 / 6, phase: 0.2 } });
    expect(bar.x0).toBeCloseTo(-0.3, 9);
    expect(bar.x1).toBeCloseTo(2.3, 9);
    const g = slidingWall(ids(), launcher, 5, 4, 0.3);
    expect(g.walls.map((o) => o.slide?.amplitude)).toEqual([SLIDE_AMPLITUDE, SLIDE_AMPLITUDE]);
    expect(g.exit).toEqual({ x: launcher.x, y: launcher.y + 5 + 4.2 });
  });
});

describe('les scènes des usages exigés', () => {
  it('le ricochet et le mur à percer ne se prouvent pas sans leur mécanique ; le robot raisonnable passe chaque scène, par sa mécanique', () => {
    for (const scene of SCENES) {
      const segment = buildScene(scene.id, ids(), { x: 0, y: 0 });
      expect(verifySegment([], [], segment, T), scene.id).toBe(true);
      if (scene.id === 'rebond' || scene.id === 'cassable') expect(verifySegment([], [], stripped(segment), T), `${scene.id} sans`).toBe(false);
      // Les rencontres comptées dans la scène elle-même (sous 30 m), pas dans la course libre qui la suit : on ne contourne pas la scène.
      const counts = { bounce: 0, smash: 0, ring: 0, wheel: 0, launch: 0, bump: 0 };
      const report = playRobot(5, T, 40, REASONABLE, { kind: 'scene', sceneId: scene.id, startY: 0 }, (state, events) => {
        if (state.hero.pos.y > 30) return;
        for (const e of events) {
          if (e.type === 'bounce' || e.type === 'smash' || e.type === 'ring' || e.type === 'bump') counts[e.type] += 1;
          if (e.type === 'attach' && state.anchors.find((a) => a.id === e.anchorId)?.kind === 'roue') counts.wheel += 1;
          if (e.type === 'release' && e.kind === 'lanceur') counts.launch += 1;
        }
      });
      expect(report.height, scene.name).toBeGreaterThan(24);
      if (scene.id === 'rebond') expect(counts.bounce).toBeGreaterThan(0);
      if (scene.id === 'cassable') expect(counts.smash).toBeGreaterThan(0);
      if (scene.id === 'anneau') expect(counts.ring).toBeGreaterThan(0);
      if (scene.id === 'roue') expect(counts.wheel).toBeGreaterThan(0);
      // Sous la glissière, le robot attend que le trou passe : un seul tir, aucun choc.
      if (scene.id === 'glissiere') expect(counts).toMatchObject({ launch: 1, bump: 0 });
    }
    // Dix-huit scènes, chacune prouvée puis jouée quarante secondes par le robot : plus de cinq secondes quand les autres tests se partagent le processeur.
  }, 30_000);
});

describe('deux corrections de 0.12.1', () => {
  it('posé sur une corniche, le personnage n\'est plus étourdi sans fin : il vise et attrape (B-012)', () => {
    const sim = new Simulation(1, withTuning(T, { fogBaseSpeed: 0, fogStart: -1000 }));
    sim.state.anchors = [{ id: 1, pos: { x: 0, y: 14 }, kind: 'normal', broken: false }];
    sim.state.obstacles = [{ id: 1, x0: -2, y0: 9, x1: 2, y1: 9.4 }];
    sim.state.pickups = []; sim.state.rings = []; sim.state.zones = [];
    sim.state.course.lastY = 10_000;
    sim.state.hero = { pos: { x: 0, y: 11 }, vel: { x: 0, y: -3 }, grounded: false };
    sim.state.height = 11; sim.state.targetId = null;
    let bumps = 0;
    for (let k = 0; k < 2 * SECOND; k += 1) { sim.step(); bumps += sim.drain().filter((e) => e.type === 'bump').length; }
    expect(bumps).toBeLessThanOrEqual(3);
    expect(sim.state.hero.pos.y).toBeCloseTo(9.7, 1);
    expect(sim.state.stunUntilStep).toBeLessThan(sim.state.step);
    expect(sim.state.targetId).toBe(1);
    expect(sim.press()).toBe(true);
  });

  it('un relâché avec traction depuis un lanceur part de la position reculée, comme le doigt et le vérificateur', () => {
    const sim = new Simulation(5, T, { kind: 'scene', sceneId: 'cassable', startY: 0 });
    const launcher = sim.state.anchors.find((a) => a.kind === 'lanceur')!;
    sim.state.hero = { pos: { x: launcher.pos.x, y: launcher.pos.y - 2 }, vel: { x: 0, y: 0 }, grounded: false };
    sim.state.targetId = launcher.id; sim.state.targetValidStep = sim.state.step;
    expect(sim.press()).toBe(true);
    sim.run(10);
    const pull = { x: -1, y: -1.5 };
    expect(sim.release(pull)).toBe(true);
    expect(sim.state.hero.pos).toEqual(pulledPosition(launcher.pos, pull));
  });
});

import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math/rng';
import { SCENES, buildScene } from '../src/data/scenes';
import { bestAnchor } from '../src/sim/aim';
import { BOOST_CAP, DRIFT_STRENGTH, UPDRAFT_RISE, UPDRAFT_STRENGTH, buildSegment, type Archetype, type TierProfile } from '../src/sim/generator';
import { BRAKE_FLOOR, NO_ZONES, ZONE_RAMP, flightAt, flightSamples, freeFlightAt, integrate, zoneAcceleration, zoneAt } from '../src/sim/physics';
import { REASONABLE, playRobot } from '../src/sim/robot';
import { Simulation } from '../src/sim/simulation';
import type { Anchor, Zone } from '../src/sim/state';
import { DEFAULT_TUNING as T } from '../src/sim/tuning';
import { verifySegment } from '../src/sim/verifier';
import { shadowPoints } from '../src/render/cues';

const up: Zone = { id: 1, x0: -2, y0: 0, x1: 2, y1: 10, kind: 'ascendant', strength: 10, dir: { x: 0, y: 1 } };
const side: Zone = { id: 2, x0: -5, y0: 0, x1: 5, y1: 4, kind: 'lateral', strength: 5, dir: { x: 1, y: 0 } };
const boost: Zone = { id: 3, x0: -1, y0: 0, x1: 1, y1: 6, kind: 'acceleration', strength: 22, dir: { x: 0, y: 1 }, cap: 14 };
const brake: Zone = { id: 4, x0: -2, y0: 0, x1: 2, y1: 3, kind: 'freinage', strength: 2.5, dir: { x: 0, y: 0 } };
const ids = (): { anchor: number; obstacle: number; pickup: number; ring: number; zone: number } => ({ anchor: 1, obstacle: 1, pickup: 1, ring: 1, zone: 1 });

describe('la physique des zones', () => {
  it('un courant pousse dans sa direction, en douceur près de ses bords, et rien hors de lui', () => {
    expect(zoneAcceleration([up], { x: 0, y: 5 }, { x: 0, y: 0 })).toEqual({ x: 0, y: UPDRAFT_STRENGTH });
    expect(zoneAcceleration([up], { x: 3, y: 5 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    // À un tiers de la rampe du bord, un tiers de la poussée.
    expect(zoneAcceleration([up], { x: -2 + ZONE_RAMP / 3, y: 5 }, { x: 0, y: 0 }).y).toBeCloseTo(UPDRAFT_STRENGTH / 3, 9);
    expect(zoneAcceleration([side], { x: 0, y: 2 }, { x: 0, y: 0 })).toEqual({ x: DRIFT_STRENGTH, y: 0 });
    expect(zoneAt([up, side], { x: 0, y: 2 })).toBe(up);
    expect(zoneAt([up], { x: 0, y: 12 })).toBeNull();
  });

  it('un couloir accélère le long de son axe seulement, jusqu\'à son plafond', () => {
    expect(zoneAcceleration([boost], { x: 0, y: 3 }, { x: 3, y: 5 })).toEqual({ x: 0, y: 22 });
    expect(zoneAcceleration([boost], { x: 0, y: 3 }, { x: 3, y: BOOST_CAP })).toEqual({ x: 0, y: 0 });
    let body = { pos: { x: 0, y: 0.5 }, vel: { x: 0, y: 2 } };
    for (let i = 0; i < 60; i += 1) body = integrate(body, null, 0, T, undefined, [boost]);
    // Sous le plafond, ou juste au-dessus d'un pas de gravité : jamais emballé.
    expect(body.vel.y).toBeLessThanOrEqual(BOOST_CAP + 1e-9);
    expect(body.vel.y).toBeGreaterThan(8);
  });

  it('une zone de freinage retire une part de la vitesse par seconde, jamais sous le plancher', () => {
    expect(zoneAcceleration([brake], { x: 0, y: 1 }, { x: 4, y: 0 })).toEqual({ x: -10, y: 0 });
    expect(zoneAcceleration([brake], { x: 0, y: 1 }, { x: BRAKE_FLOOR, y: 0 })).toEqual({ x: 0, y: 0 });
    const still = { ...T, gravity: 0 };
    const wide = { ...brake, x0: -50, x1: 50 };
    let body = { pos: { x: 0, y: 1.5 }, vel: { x: 8, y: 0 } };
    for (let i = 0; i < 120; i += 1) body = integrate(body, null, 0, still, undefined, [wide]);
    // En une seconde à 2,5 par seconde, 8 m/s seraient tombés sous 1 m/s : le plancher retient à 2.
    expect(body.vel.x).toBeLessThanOrEqual(BRAKE_FLOOR + 0.1);
    expect(body.vel.x).toBeGreaterThanOrEqual(BRAKE_FLOOR - 0.1);
  });

  it('sans zone, le vol échantillonné suit la formule fermée ; sous un courant, il est joué pas à pas et monte plus haut', () => {
    const body = { pos: { x: 0, y: 1 }, vel: { x: 1, y: 6 } };
    const closed = flightSamples(body, 1, 0.25, T);
    expect(closed).toHaveLength(4);
    closed.forEach((sample, i) => expect(sample.pos).toEqual(freeFlightAt(body, 0.25 * (i + 1), T)));
    const carried = flightSamples(body, 1, 0.25, T, undefined, [up]);
    expect(carried[3]!.pos.y).toBeGreaterThan(closed[3]!.pos.y + 3);
    expect(flightAt(body, 1, T, undefined, [up]).pos).toEqual(carried[3]!.pos);
    expect(flightAt(body, 1, T, undefined, NO_ZONES).pos).toEqual(closed[3]!.pos);
  });

  it('la visée et l\'ombre prédictive tiennent compte du courant', () => {
    const body = { pos: { x: 0, y: 1 }, vel: { x: 0, y: 6 } };
    const low: Anchor = { id: 1, pos: { x: 0, y: 3.4 }, kind: 'normal', broken: false };
    const high: Anchor = { id: 2, pos: { x: 0, y: 6 }, kind: 'normal', broken: false };
    // Sans courant, dans 0,35 s le personnage est vers 2,6 m : le point bas est plus proche ; porté à 10 m/s², il est plus haut et préfère le point haut.
    expect(bestAnchor([low, high], [], body, false, null, T)?.id).toBe(1);
    expect(bestAnchor([low, high], [], body, false, null, T, undefined, [{ ...up, strength: 30 }])?.id).toBe(2);
    const sim = new Simulation(1);
    sim.press();
    sim.run(30);
    const free = shadowPoints(sim.state, T);
    sim.state.zones = [{ ...up, x0: -20, x1: 20, y0: -10, y1: 100, strength: 40 }];
    const carried = shadowPoints(sim.state, T);
    expect(carried[5]!.y).toBeGreaterThan(free[5]!.y);
  });

  it('les zones font partie de l\'état déterministe, clonées et rejouées à l\'identique', () => {
    const a = new Simulation(5, T, { kind: 'scene', sceneId: 'courant', startY: 0 });
    const b = new Simulation(5, T, { kind: 'scene', sceneId: 'courant', startY: 0 });
    expect(a.state.zones.length).toBeGreaterThan(0);
    a.press();
    b.press();
    a.run(400);
    b.run(400);
    expect(a.snapshot()).toBe(b.snapshot());
  });
});

describe('le générateur des zones', () => {
  const profile: TierProfile = { spacing: 4.2, obstacles: 2, split: true, fragileChance: 0.2, boosters: 1, archetypes: ['chaine'], spread: 1.2, electric: 1, eclipse: 1, rings: 1, bouncers: 1 };
  const build = (seed: number, archetype: Archetype) => {
    const rng = createRng(seed);
    const from = { x: rng.next() * 4 - 2, y: 100 };
    const segment = buildSegment(rng, ids(), from, { x: 0, y: 0 }, profile, archetype);
    return { segment, from };
  };

  it('courant : une colonne qui part au-dessus du point d\'entrée et porte jusqu\'à un point hors de portée de corde ; dérive : une bande de toute la largeur ; fusée : un couloir puis un freinage', () => {
    const counts = { courant: 0, derive: 0, fusee: 0 };
    for (let seed = 1; seed <= 30; seed += 1) {
      for (const archetype of ['courant', 'derive', 'fusee'] as const) {
        const { segment } = build(seed, archetype);
        if (segment.zones.length === 0) continue;
        counts[archetype] += 1;
        if (archetype === 'courant') {
          const zone = segment.zones[0]!;
          expect(zone.kind).toBe('ascendant');
          // Le point d'entrée : le plus haut sous la colonne, prises à cycles exclues (une électrique se pose à côté de lui, un peu plus haut).
          const below = segment.anchors.filter((a) => a.pos.y < zone.y0 && a.kind !== 'electrique' && a.kind !== 'eclipse').reduce((best, a) => (a.pos.y > best.pos.y ? a : best));
          const above = segment.anchors.filter((a) => a.pos.y > zone.y1).reduce((best, a) => (a.pos.y < best.pos.y ? a : best));
          expect(above.pos.y - below.pos.y).toBeCloseTo(UPDRAFT_RISE, 6);
          expect(zone.y0).toBeGreaterThan(below.pos.y);
          expect(zone.y1).toBeLessThan(above.pos.y);
        }
        if (archetype === 'derive') {
          expect(segment.zones[0]!.kind).toBe('lateral');
          expect(segment.zones[0]!.x1 - segment.zones[0]!.x0).toBeGreaterThan(8);
        }
        if (archetype === 'fusee') {
          expect(segment.zones.map((z) => z.kind)).toEqual(['acceleration', 'freinage']);
          expect(segment.zones[1]!.y0).toBeGreaterThan(segment.zones[0]!.y1);
        }
        // Rien ne se pose dans une zone : ni obstacle, ni prise ajoutée, ni anneau.
        for (const zone of segment.zones) {
          for (const box of segment.obstacles) expect(box.x1 <= zone.x0 || box.x0 >= zone.x1 || box.y1 <= zone.y0 || box.y0 >= zone.y1, `obstacle ${seed} ${archetype}`).toBe(true);
          for (const anchor of segment.anchors.filter((a) => a.kind === 'electrique' || a.kind === 'eclipse')) expect(zoneAt([zone], anchor.pos), `prise ${seed} ${archetype}`).toBeNull();
          for (const ring of segment.rings) expect(zoneAt([zone], ring.pos), `anneau ${seed} ${archetype}`).toBeNull();
        }
      }
    }
    expect(counts.courant).toBeGreaterThan(15);
    expect(counts.derive).toBeGreaterThan(15);
    expect(counts.fusee).toBeGreaterThan(10);
  });

  it('les segments à zones se prouvent avec leurs zones ; un courant retiré laisse presque toujours sa sortie hors de portée', () => {
    let proven = 0;
    let withZone = 0;
    let unreachable = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const { segment, from } = build(seed, 'courant');
      const entry: Anchor = { id: 0, pos: from, kind: 'normal', broken: false };
      if (segment.zones.length === 0) continue;
      withZone += 1;
      if (verifySegment([entry], [], segment, T)) proven += 1;
      if (!verifySegment([entry], [], { ...segment, zones: [] }, T)) unreachable += 1;
    }
    expect(withZone).toBeGreaterThan(10);
    expect(proven).toBe(withZone);
    // Un balancement très énergique peut parfois atteindre la sortie sans le courant : il porte le joueur ordinaire, il n'est pas un mur.
    expect(unreachable).toBeGreaterThanOrEqual(withZone * 0.8);
  });
});

describe('les scènes des zones', () => {
  it('se prouvent, commencent une partie avec leurs zones, et le robot les grimpe', () => {
    for (const id of ['courant', 'derive', 'fusee'] as const) {
      const scene = SCENES.find((s) => s.id === id)!;
      const segment = buildScene(id, ids(), { x: 0, y: 0 });
      expect(segment.zones.length, id).toBeGreaterThan(0);
      expect(verifySegment([], [], segment, T), id).toBe(true);
      const sim = new Simulation(5, T, { kind: 'scene', sceneId: id, startY: 0 });
      expect(sim.state.zones.map((z) => z.kind)).toEqual(segment.zones.map((z) => z.kind));
      expect(sim.state.course.unverified, id).toBe(0);
      const report = playRobot(5, T, 40, REASONABLE, { kind: 'scene', sceneId: id, startY: 0 });
      expect(report.height, scene.name).toBeGreaterThan(24);
    }
  });
});

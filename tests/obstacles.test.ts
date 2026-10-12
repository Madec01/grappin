import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math/rng';
import { SCENES, buildScene } from '../src/data/scenes';
import { DOOR_OPEN_SECONDS, DOOR_PERIOD_SECONDS, DOOR_WARNING_SECONDS, doorGauge, doorState } from '../src/sim/cycles';
import { RING_RADIUS, buildSegment, type TierProfile } from '../src/sim/generator';
import { provableObstacles, solidObstacles } from '../src/sim/obstacles';
import { BOUNCE_RESTITUTION, RING_CENTRE_RATIO, canSmash } from '../src/sim/rules';
import { REASONABLE, playRobot } from '../src/sim/robot';
import { Simulation } from '../src/sim/simulation';
import type { Obstacle, RuleEvent } from '../src/sim/state';
import { DEFAULT_TUNING as T, withTuning } from '../src/sim/tuning';
import { verifySegment } from '../src/sim/verifier';

const SECOND = Math.round(1 / T.stepSeconds);

/** Simulation nue, sans brume ni parcours : un point hors de portée, le personnage en vol là où on le met. */
function bare(hero: { x: number; y: number }, vel: { x: number; y: number }, step = 0): Simulation {
  const sim = new Simulation(1, withTuning(T, { fogBaseSpeed: 0, fogStart: -1000 }));
  sim.state.anchors = [{ id: 1, pos: { x: 0, y: 40 }, kind: 'normal', broken: false }];
  sim.state.obstacles = [];
  sim.state.pickups = [];
  sim.state.rings = [];
  sim.state.course.lastY = 10_000;
  sim.state.hero = { pos: hero, vel, grounded: false };
  // La hauteur part d'ici : aucun point de score pour la téléportation.
  sim.state.height = hero.y;
  sim.state.targetId = null;
  sim.state.step = step;
  return sim;
}

/** Joue jusqu'à `steps` pas et rend tous les événements. */
function play(sim: Simulation, steps: number): RuleEvent[] {
  const events: RuleEvent[] = [];
  for (let i = 0; i < steps && sim.state.status === 'alive'; i += 1) {
    sim.step();
    events.push(...sim.drain());
  }
  return events;
}

const slab = (kind?: Obstacle['kind']): Obstacle => (kind ? { id: 7, x0: -2, y0: 4, x1: 2, y1: 4.4, kind } : { id: 7, x0: -2, y0: 4, x1: 2, y1: 4.4 });

/** Le premier pas à partir duquel la porte 7 reste dans l'état voulu pendant au moins `seconds`. */
function stepWhenDoor(state: ReturnType<typeof doorState>, seconds: number): number {
  const need = Math.round(seconds / T.stepSeconds);
  for (let step = 0; step < 4 * DOOR_PERIOD_SECONDS * SECOND; step += 1) {
    let ok = true;
    for (let k = 0; k < need && ok; k += 1) if (doorState(7, step + k, T) !== state) ok = false;
    if (ok) return step;
  }
  throw new Error('état introuvable');
}

describe('surfaces de rebond', () => {
  it('renvoient presque toute la vitesse, sans étourdir ni casser la série ; un obstacle solide, lui, étourdit et remet la série à zéro', () => {
    const sim = bare({ x: 0, y: 6 }, { x: 1, y: -8 });
    sim.state.obstacles = [slab('rebond')];
    sim.state.combo = 3;
    const events = play(sim, SECOND);
    const bounce = events.find((e) => e.type === 'bounce');
    expect(bounce).toEqual({ type: 'bounce', obstacleId: 7 });
    expect(events.some((e) => e.type === 'bump')).toBe(false);
    expect(sim.state.combo).toBe(3);
    expect(sim.state.stunUntilStep).toBe(0);
    // Après le rebond, le personnage remonte presque aussi vite qu'il descendait : il repasse au-dessus de 5,5 m.
    expect(Math.max(...events.map(() => sim.state.hero.pos.y), sim.state.hero.pos.y)).toBeGreaterThan(4.4);
    const solid = bare({ x: 0, y: 6 }, { x: 1, y: -8 });
    solid.state.obstacles = [slab()];
    solid.state.combo = 3;
    const bumps = play(solid, SECOND);
    expect(bumps.some((e) => e.type === 'bump')).toBe(true);
    expect(solid.state.combo).toBe(0);
    expect(solid.state.stunUntilStep).toBeGreaterThan(0);
  });

  it('la vitesse renvoyée vaut la restitution du rebond, et la corde est lâchée', () => {
    const sim = bare({ x: 0, y: 4.4 + T.heroRadius + 0.01 }, { x: 0, y: -10 });
    sim.state.obstacles = [slab('rebond')];
    sim.step();
    const events = sim.drain();
    expect(events.map((e) => e.type)).toContain('bounce');
    // La gravité du pas s'ajoute avant le contact : la vitesse renvoyée vaut la restitution de la vitesse d'arrivée.
    const arrival = 10 + T.gravity * T.stepSeconds;
    expect(sim.state.hero.vel.y).toBeCloseTo(arrival * BOUNCE_RESTITUTION, 6);
  });
});

describe('parois cassables', () => {
  it('cèdent à partir de smashSpeed, rapportent, et résistent en dessous', () => {
    const fast = bare({ x: 0, y: 6 }, { x: 0, y: -12 });
    fast.state.obstacles = [slab('cassable')];
    expect(canSmash(fast.state, T)).toBe(true);
    const events = play(fast, SECOND);
    expect(events.find((e) => e.type === 'smash')).toEqual({ type: 'smash', obstacleId: 7 });
    expect(fast.state.obstacles[0]!.broken).toBe(true);
    expect(fast.state.hero.pos.y).toBeLessThan(4);
    expect(fast.state.score).toBeGreaterThanOrEqual(T.smashScore);
    const slow = bare({ x: 0, y: 6 }, { x: 0, y: -6 });
    slow.state.obstacles = [slab('cassable')];
    expect(canSmash(slow.state, T)).toBe(false);
    const bumps = play(slow, SECOND);
    expect(bumps.some((e) => e.type === 'bump')).toBe(true);
    expect(slow.state.obstacles[0]!.broken).toBeUndefined();
    expect(slow.state.hero.pos.y).toBeGreaterThan(4.4);
  });
});

describe('portes intermittentes', () => {
  it('ont un cycle lent : ouvertes 3,6 s sur 6, préviennent 0,8 s avant, et une jauge qui se remplit puis se vide', () => {
    expect(doorState(0, 0, T)).toBe('ouverte');
    expect(doorState(0, Math.round((DOOR_OPEN_SECONDS - DOOR_WARNING_SECONDS / 2) * SECOND), T)).toBe('se ferme');
    expect(doorState(0, Math.round((DOOR_OPEN_SECONDS + 0.1) * SECOND), T)).toBe('fermee');
    expect(doorState(0, Math.round((DOOR_PERIOD_SECONDS + 0.1) * SECOND), T)).toBe('ouverte');
    let previous = -1;
    for (let step = 0; step < DOOR_OPEN_SECONDS * SECOND; step += 1) {
      const gauge = doorGauge(0, step, T);
      expect(gauge).toBeGreaterThanOrEqual(previous);
      previous = gauge;
    }
    expect(previous).toBeLessThanOrEqual(1);
    expect(doorGauge(0, Math.round(DOOR_OPEN_SECONDS * SECOND), T)).toBeCloseTo(0, 6);
    // Deux portes ne battent pas ensemble.
    expect(doorState(3, Math.round((DOOR_OPEN_SECONDS - 0.5) * SECOND), T)).not.toBe(doorState(0, Math.round((DOOR_OPEN_SECONDS - 0.5) * SECOND), T));
  });

  it('ouvertes, on les traverse et on vise au travers ; fermées, elles repoussent et coupent la vue', () => {
    const open = bare({ x: 0, y: 6 }, { x: 0, y: -6 }, stepWhenDoor('ouverte', 1));
    open.state.obstacles = [slab('porte')];
    expect(solidObstacles(open.state, T)).toHaveLength(0);
    const quiet = play(open, SECOND / 2);
    expect(quiet.some((e) => e.type === 'bump')).toBe(false);
    expect(open.state.hero.pos.y).toBeLessThan(4);
    const closed = bare({ x: 0, y: 6 }, { x: 0, y: -6 }, stepWhenDoor('fermee', 1));
    closed.state.obstacles = [slab('porte')];
    expect(solidObstacles(closed.state, T)).toHaveLength(1);
    const bumps = play(closed, SECOND / 2);
    expect(bumps.some((e) => e.type === 'bump')).toBe(true);
    expect(closed.state.hero.pos.y).toBeGreaterThan(4.4);
  });

  it('ne se referment jamais sur le personnage : dedans quand elle se ferme, il en sort sans choc', () => {
    // Posé dans la porte, immobile, 0,1 s avant qu'elle se ferme : il tombe au travers sans être repoussé.
    const closing = stepWhenDoor('fermee', 1) - Math.round(0.1 * SECOND);
    const sim = bare({ x: 0, y: 4.2 }, { x: 0, y: 0 }, closing);
    sim.state.obstacles = [slab('porte')];
    const events = play(sim, SECOND);
    expect(events.some((e) => e.type === 'bump')).toBe(false);
    expect(sim.state.hero.pos.y).toBeLessThan(4);
    expect(sim.state.doorsInside).toEqual([]);
  });

  it('ne comptent pas pour le vérificateur, qui tient les surfaces de rebond et les parois cassables pour solides', () => {
    const boxes: Obstacle[] = [slab('porte'), { ...slab('rebond'), id: 8 }, { ...slab('cassable'), id: 9 }, { ...slab('cassable'), id: 10, broken: true }, { ...slab(), id: 11 }];
    expect(provableObstacles(boxes).map((b) => b.id)).toEqual([8, 9, 11]);
  });
});

describe('anneaux de précision', () => {
  const ring = { id: 1, pos: { x: 0, y: 5 }, radius: RING_RADIUS, closest: null, taken: false };

  it('rapportent à la sortie de l\'anneau ; au centre, davantage et un cran de série ; ratés, rien', () => {
    const centre = bare({ x: 0, y: 8 }, { x: 0, y: -10 });
    centre.state.rings = [{ ...ring }];
    const events = play(centre, SECOND);
    expect(events.find((e) => e.type === 'ring')).toEqual({ type: 'ring', ringId: 1, centred: true });
    expect(centre.state.combo).toBe(1);
    expect(centre.state.score).toBeGreaterThanOrEqual(T.ringCentreScore);
    expect(centre.state.rings[0]!.taken).toBe(true);
    const edge = bare({ x: RING_RADIUS * (RING_CENTRE_RATIO + 0.3), y: 8 }, { x: 0, y: -10 });
    edge.state.rings = [{ ...ring }];
    const side = play(edge, SECOND);
    expect(side.find((e) => e.type === 'ring')).toEqual({ type: 'ring', ringId: 1, centred: false });
    expect(edge.state.combo).toBe(0);
    expect(edge.state.score).toBe(T.ringScore);
    const miss = bare({ x: 3, y: 8 }, { x: 0, y: -10 });
    miss.state.rings = [{ ...ring }];
    expect(play(miss, SECOND).some((e) => e.type === 'ring')).toBe(false);
    expect(miss.state.rings[0]!.taken).toBe(false);
  });

  it('le passage se juge au plus près du centre, pas au premier contact', () => {
    // Entré par le bord, le personnage passe à 0,2 m du centre : c'est le centre qui compte.
    const sim = bare({ x: 0.2, y: 8 }, { x: 0, y: -10 });
    sim.state.rings = [{ ...ring }];
    const events = play(sim, SECOND);
    expect(events.find((e) => e.type === 'ring')).toEqual({ type: 'ring', ringId: 1, centred: true });
  });
});

describe('le générateur du lot 2', () => {
  const profile: TierProfile = { spacing: 4, obstacles: 1, split: true, fragileChance: 0, boosters: 0, archetypes: ['chaine', 'escalier', 'couloir'], spread: 1.2, electric: 0, eclipse: 0, bouncers: 1, breakables: 1, doors: 1, rings: 1 };

  it('pose des surfaces de rebond, des parois cassables, des portes plus larges et des anneaux, chacun à l\'écart des points', () => {
    const seen = { rebond: 0, cassable: 0, porte: 0, rings: 0 };
    for (let seed = 1; seed <= 40; seed += 1) {
      const rng = createRng(seed);
      const ids = { anchor: 1, obstacle: 1, pickup: 1, ring: 1, zone: 1 };
      const segment = buildSegment(rng, ids, null, { x: 0, y: 0 }, profile, rng.pick(profile.archetypes));
      for (const box of segment.obstacles) {
        if (box.kind === 'rebond') seen.rebond += 1;
        if (box.kind === 'cassable') seen.cassable += 1;
        if (box.kind === 'porte') {
          seen.porte += 1;
          expect(box.x1 - box.x0).toBeGreaterThanOrEqual(2);
        }
        for (const ring of segment.rings) expect(Math.hypot(Math.max(box.x0 - ring.pos.x, 0, ring.pos.x - box.x1), Math.max(box.y0 - ring.pos.y, 0, ring.pos.y - box.y1))).toBeGreaterThanOrEqual(ring.radius + 0.6 - 1e-9);
      }
      for (const ring of segment.rings) {
        seen.rings += 1;
        expect(ring.radius).toBe(RING_RADIUS);
        for (const a of segment.anchors) expect(Math.hypot(a.pos.x - ring.pos.x, a.pos.y - ring.pos.y)).toBeGreaterThanOrEqual(RING_RADIUS + 0.4 - 1e-9);
        // Entre deux points consécutifs, au-dessus de la ligne qui les joint.
        expect(segment.anchors.some((a, i) => i > 0 && a.pos.y < ring.pos.y && (segment.anchors[i + 1]?.pos.y ?? -Infinity) > ring.pos.y)).toBe(true);
      }
      expect(segment.obstacles.filter((b) => b.kind === 'porte').length).toBeLessThanOrEqual(1);
    }
    expect(seen.rebond).toBeGreaterThan(10);
    expect(seen.cassable).toBeGreaterThan(10);
    expect(seen.porte).toBeGreaterThan(10);
    expect(seen.rings).toBeGreaterThan(20);
  });

  it('sans ces réglages, un profil engendre exactement comme avant : ni espèce d\'obstacle ni anneau', () => {
    const rng = createRng(3);
    const segment = buildSegment(rng, { anchor: 1, obstacle: 1, pickup: 1, ring: 1, zone: 1 }, null, { x: 0, y: 0 }, { ...profile, bouncers: 0, breakables: 0, doors: 0, rings: 0 }, 'chaine');
    expect(segment.rings).toEqual([]);
    expect(segment.obstacles.every((b) => b.kind === undefined)).toBe(true);
  });
});

describe('les scènes de démonstration', () => {
  it('se prouvent chacune par le vérificateur, et la porte seule fait passer le tir du lanceur', () => {
    for (const scene of SCENES) {
      const segment = buildScene(scene.id, { anchor: 1, obstacle: 1, pickup: 1, ring: 1, zone: 1 }, { x: 0, y: 0 });
      expect(verifySegment([], [], segment, T), scene.id).toBe(true);
      expect(segment.anchors[0]!.pos).toEqual({ x: 0.8, y: 4 });
    }
    const porte = buildScene('porte', { anchor: 1, obstacle: 1, pickup: 1, ring: 1, zone: 1 }, { x: 0, y: 0 });
    const walled = { ...porte, obstacles: porte.obstacles.map((box): Obstacle => ({ id: box.id, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 })) };
    expect(verifySegment([], [], walled, T)).toBe(false);
  });

  it('commencent une partie par leur segment, puis la course libre continue, sans repli', () => {
    for (const scene of SCENES) {
      const sim = new Simulation(5, T, { kind: 'scene', sceneId: scene.id, startY: 0 });
      const built = buildScene(scene.id, { anchor: 1, obstacle: 1, pickup: 1, ring: 1, zone: 1 }, { x: 0, y: 0 });
      expect(sim.state.anchors.slice(0, built.anchors.length).map((a) => a.pos)).toEqual(built.anchors.map((a) => a.pos));
      expect(sim.state.anchors.length).toBeGreaterThan(built.anchors.length);
      expect(sim.state.course.unverified, scene.id).toBe(0);
      expect(sim.state.course.fallbacks, scene.id).toBe(0);
      expect(sim.state.finishY).toBeNull();
    }
  });

  it('le robot raisonnable grimpe chaque scène au-delà de son segment', () => {
    for (const scene of SCENES) {
      const report = playRobot(5, T, 40, REASONABLE, { kind: 'scene', sceneId: scene.id, startY: 0 });
      expect(report.height, scene.id).toBeGreaterThan(22);
    }
  }, 20_000); // vingt-trois scènes : quatre secondes ici, le double sur l'intégration continue
});

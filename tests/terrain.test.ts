import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/math/rng';
import { ATELIER_ELEMENTS, atelierEvents, atelierProfile } from '../src/data/atelier';
import { LEVELS } from '../src/data/levels';
import { PLAFOND_SCENE_AT, SCENES, buildScene } from '../src/data/scenes';
import { Camera } from '../src/render/camera';
import { verifyWithMotions } from '../src/sim/course';
import { STILL, turnedGravity } from '../src/sim/environment';
import { PLAFOND_LENGTH, PLAFOND_TILT, PLAFOND_TURN_SECONDS, cablePosition, environmentOf, invertedGravity } from '../src/sim/events';
import { CAROUSEL_ANCHORS, CAROUSEL_PERIOD, CAROUSEL_RADIUS, CAROUSEL_SHELL, CEILING_ANCHOR_ABOVE, CEILING_FIRST, CEILING_GAP_HALF, CEILING_HOOK_BELOW, CEILING_STEP, CONVEYOR_AMPLITUDE, CONVEYOR_ANCHOR_BELOW, CONVEYOR_PERIOD, FAULT_SECONDS, FAULT_TRAVEL, HINGE_SECONDS, PLAIN_CONTEXT, SWITCH_NEXT_RISE, UNFOLD_PANEL, buildSegment, carousel, ceilingRun, conveyor, fault, tierProfile, unfolding, type Archetype, type Segment, type SegmentContext } from '../src/sim/generator';
import { SWITCH_HOLD_SECONDS } from '../src/sim/holds';
import { ORBIT_PLACEMENTS, anchorPlacements, hingeTurns, isMobile, isMoving, obstacleAt, orbitPoint, orbitPosition, riftPosition, riftProgress, rotorEnds, slideOffset } from '../src/sim/moving';
import { provableObstacles } from '../src/sim/obstacles';
import { BEGINNER, REASONABLE, playRobot } from '../src/sim/robot';
import { applyHinges, applyRifts } from '../src/sim/rules';
import { Simulation } from '../src/sim/simulation';
import type { Anchor, RuleEvent } from '../src/sim/state';
import { DEFAULT_TUNING as T } from '../src/sim/tuning';
import { verifySegment } from '../src/sim/verifier';

/** Lot 5, partie B (0.16.0) : le plafond, la faille, le carrousel, la structure dépliante, le convoyeur. */

const SECOND = Math.round(1 / T.stepSeconds);
const ids = (): { anchor: number; obstacle: number; pickup: number; ring: number; zone: number } => ({ anchor: 1, obstacle: 1, pickup: 1, ring: 1, zone: 1 });
const INVERTED = environmentOf([{ kind: 'plafond', at: 0, length: PLAFOND_LENGTH }]);

describe('le plafond', () => {
  it('inverse la gravité en passant par l\'apesanteur, jamais par le côté, et le dit à la caméra, qui ne tourne pas', () => {
    expect(invertedGravity(0)).toEqual({ x: 0, y: -1 });
    expect(invertedGravity(PLAFOND_TILT / 2)).toEqual({ x: 0, y: 0 });
    expect(invertedGravity(PLAFOND_TILT)).toEqual({ x: 0, y: 1 });
    expect(Object.is(invertedGravity(PLAFOND_TILT / 2).y, -0)).toBe(false);
    expect(INVERTED).toEqual({ gravityDir: { x: 0, y: 1 }, wind: { x: 0, y: 0 }, inverted: true });
    expect(environmentOf([{ kind: 'bascule', at: 0, length: 20, side: 1 }]).inverted).toBeUndefined();
    // La bascule tourne encore par le côté, jusqu'à un quart de tour, et `turnedGravity` sait aller jusqu'au demi-tour.
    expect(turnedGravity(1, 1)).toEqual({ x: 1, y: 0 });
    expect(turnedGravity(-1, 2)).toEqual({ x: 0, y: 1 });
    const camera = new Camera(T.heroRadius, 390, 844);
    camera.snap({ x: 0, y: 0 }, { x: 0, y: 0 }, { gravityDir: { x: 1, y: 0 }, wind: { x: 0, y: 0 } });
    expect(Math.abs(camera.angle)).toBeGreaterThan(1);
    camera.snap({ x: 0, y: 0 }, { x: 0, y: 0 }, INVERTED);
    expect(camera.angle).toBe(0);
    camera.snap({ x: 0, y: 0 }, { x: 0, y: 0 }, { gravityDir: { x: 0, y: 0 }, wind: { x: 0, y: 0 }, inverted: true });
    expect(camera.angle).toBe(0);
  });

  it('en partie, la gravité faiblit puis repousse vers le haut en trois secondes, reste inversée sur la longueur de l\'événement, et revient de même', () => {
    const sim = new Simulation(5, T, { kind: 'scene', sceneId: 'plafond', startY: 0 });
    const seen: number[] = [];
    let inverted = 0;
    // Le personnage est posé haut, au-dessus du début de l'événement, et tenu là : seule la gravité change.
    for (let k = 0; k < Math.round((PLAFOND_TURN_SECONDS + 1) * SECOND); k += 1) {
      sim.state.hero.pos = { x: 0, y: PLAFOND_SCENE_AT + 1 };
      sim.state.hero.vel = { x: 0, y: 0 };
      sim.step();
      seen.push(sim.state.env.gravityDir.y);
      if (sim.state.env.inverted) inverted += 1;
    }
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((y, i) => i === 0 || y >= seen[i - 1]!)).toBe(true);
    expect(seen.some((y) => Math.abs(y) < 0.05)).toBe(true);
    expect(sim.state.env.gravityDir.x).toBe(0);
    // Le premier pas joue encore avec la hauteur d'avant : l'événement commence au second.
    expect(inverted).toBeGreaterThanOrEqual(seen.length - 1);
    // Au-dessus de la fin, la gravité redescend, et l'inversion cesse avec elle.
    for (let k = 0; k < Math.round((PLAFOND_TURN_SECONDS + 1) * SECOND); k += 1) {
      sim.state.hero.pos = { x: 0, y: PLAFOND_SCENE_AT + PLAFOND_LENGTH + 1 };
      sim.state.hero.vel = { x: 0, y: 0 };
      sim.step();
    }
    expect(sim.state.env.gravityDir).toEqual({ x: 0, y: -1 });
    expect(sim.state.env.inverted).toBeUndefined();
  });

  it('le générateur pose des plafonds à trou plus loin que la plus longue corde, un crochet sous chacun, une prise au-dessus de chaque trou, à des côtés alternés', () => {
    const from = { x: 1, y: 100 };
    const { walls, anchors } = ceilingRun(ids(), from, 4, 100 + CEILING_FIRST + 2 * CEILING_STEP + CEILING_ANCHOR_ABOVE + 0.1);
    expect(walls).toHaveLength(6);
    expect(anchors).toHaveLength(6);
    expect(CEILING_FIRST).toBeGreaterThan(T.ropeMax + T.heroRadius);
    expect(CEILING_STEP - CEILING_ANCHOR_ABOVE).toBeGreaterThan(T.ropeMax + T.heroRadius);
    for (let k = 0; k < 3; k += 1) {
      const y = from.y + CEILING_FIRST + k * CEILING_STEP;
      const [left, right] = [walls[2 * k]!, walls[2 * k + 1]!];
      expect(left.y0).toBe(y);
      expect(right.x0 - left.x1).toBeCloseTo(2 * CEILING_GAP_HALF, 9);
      const hook = anchors[2 * k]!;
      const above = anchors[2 * k + 1]!;
      expect(hook.pos).toEqual({ x: 0, y: y - CEILING_HOOK_BELOW });
      expect(above.pos.y).toBeCloseTo(y + CEILING_ANCHOR_ABOVE, 9);
      expect(above.pos.x).toBeCloseTo((left.x1 + right.x0) / 2, 9);
      expect(Math.sign(above.pos.x)).toBe(k % 2 === 0 ? -1 : 1);
    }
  });

  it('un segment de plafond se prouve sous la gravité inversée, son entrée sous la gravité d\'avant : le point d\'entrée mène à une prise de palier, pas à un trou', () => {
    const profile = tierProfile(5);
    let proven = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const rng = createRng(seed);
      const from = { x: rng.next() * 4 - 2, y: 100 };
      const context: SegmentContext = { env: INVERTED, entryEnv: STILL, cable: 'none', maxY: 100 + 14 + seed / 2 };
      const segment = buildSegment(rng, ids(), from, { x: 0, y: 0 }, profile, 'plafond', context);
      expect(segment.anchors[0]!.pos.y - from.y, `graine ${seed}`).toBeLessThanOrEqual(4);
      expect(segment.pickups).toHaveLength(0);
      const entry: Anchor = { id: 0, pos: from, kind: 'normal', broken: false };
      if (verifyWithMotions([entry], [], [], [], segment, T, context)) proven += 1;
    }
    expect(proven).toBeGreaterThanOrEqual(26);
  });
});

describe('la faille', () => {
  it('ses deux ensembles portent des dérives opposées, immobiles tant qu\'elle n\'est pas déclenchée, puis linéaires jusqu\'à l\'ouverture complète', () => {
    const { anchors, walls, exit } = fault(ids(), { x: 0.5, y: 100 }, 4);
    expect(anchors).toHaveLength(6);
    expect(walls).toHaveLength(2);
    expect(anchors.every((a) => a.rift !== undefined && isMobile(a))).toBe(true);
    expect(walls.every((w) => w.rift !== undefined && isMoving(w))).toBe(true);
    expect(anchors.map((a) => Math.sign(a.rift!.dx))).toEqual([-1, 1, -1, 1, -1, 1]);
    expect(anchors.map((a) => a.pos.y)).toEqual([...anchors.map((a) => a.pos.y)].sort((a, b) => a - b));
    expect(exit.y).toBeGreaterThan(anchors.at(-1)!.pos.y + 3);
    const left = anchors[0]!;
    const rift = left.rift!;
    expect(riftProgress(rift, undefined, 1000, T)).toBe(0);
    expect(riftProgress(rift, 100, 100, T)).toBe(0);
    expect(riftProgress(rift, 100, 100 + Math.round((FAULT_SECONDS / 2) * SECOND), T)).toBeCloseTo(0.5, 6);
    expect(riftProgress(rift, 100, 100 + 10 * SECOND, T)).toBe(1);
    const open = riftPosition({ ...left, riftStep: 100 }, 100 + 10 * SECOND, T);
    expect(open).toEqual({ x: rift.rest.x - FAULT_TRAVEL, y: rift.rest.y });
    const wall = walls[1]!;
    const moved = obstacleAt({ ...wall, riftStep: 100 }, 100 + 10 * SECOND, T);
    expect(moved.x0).toBeCloseTo(wall.x0 + FAULT_TRAVEL, 9);
    expect(provableObstacles(walls)).toHaveLength(0);
    expect(anchorPlacements(left)).toEqual([rift.rest, { x: rift.rest.x + rift.dx, y: rift.rest.y }]);
  });

  it('en partie, passer la ligne de déclenchement ouvre la faille d\'un coup, une fois, et le dit', () => {
    const sim = new Simulation(5, T, { kind: 'scene', sceneId: 'faille', startY: 0 });
    const rifts = sim.state.anchors.filter((a) => a.rift);
    expect(rifts.length).toBeGreaterThanOrEqual(6);
    const triggerY = rifts[0]!.rift!.triggerY;
    sim.state.hero.pos = { x: 0, y: triggerY - 1 };
    sim.step();
    expect(sim.state.anchors.every((a) => a.riftStep === undefined)).toBe(true);
    sim.state.hero.pos = { x: 0, y: triggerY + 0.5 };
    sim.state.hero.vel = { x: 0, y: 0 };
    sim.step();
    const events = sim.drain();
    expect(events.filter((e) => e.type === 'faille')).toHaveLength(1);
    expect(sim.state.anchors.filter((a) => a.rift).every((a) => a.riftStep !== undefined)).toBe(true);
    expect(sim.state.obstacles.filter((o) => o.rift).every((o) => o.riftStep !== undefined)).toBe(true);
    const before = rifts.map((a) => a.pos.x);
    sim.run(2 * SECOND);
    expect(sim.drain().some((e) => e.type === 'faille')).toBe(false);
    const after = sim.state.anchors.filter((a) => a.rift).map((a) => a.pos.x);
    for (let i = 0; i < after.length; i += 1) expect(Math.abs(after[i]! - before[i]!)).toBeGreaterThan(0.5);
    // Et `applyRifts` seul ne déclenche rien deux fois.
    const again: RuleEvent[] = [];
    applyRifts(sim.state, again);
    expect(again).toHaveLength(0);
  });
});

describe('le carrousel', () => {
  it('ses prises tournent autour du pivot et reviennent au bout d\'un tour ; sa coque de plots est ouverte en haut et en bas', () => {
    const { anchors, shell, exit } = carousel(ids(), { x: 1, y: 100 }, 4, 1);
    expect(anchors).toHaveLength(CAROUSEL_ANCHORS);
    const pivot = anchors[0]!.orbit!.pivot;
    for (const a of anchors) {
      expect(a.orbit).toBeDefined();
      expect(Math.hypot(a.pos.x - pivot.x, a.pos.y - pivot.y)).toBeCloseTo(CAROUSEL_RADIUS, 2);
      const later = orbitPosition(a.orbit!, Math.round(CAROUSEL_PERIOD * SECOND), T);
      expect(later.x).toBeCloseTo(a.pos.x, 1);
      expect(later.y).toBeCloseTo(a.pos.y, 1);
      const quarter = orbitPosition(a.orbit!, Math.round((CAROUSEL_PERIOD / 4) * SECOND), T);
      expect(Math.hypot(quarter.x - a.pos.x, quarter.y - a.pos.y)).toBeCloseTo(CAROUSEL_RADIUS * Math.SQRT2, 1);
      expect(anchorPlacements(a)).toHaveLength(ORBIT_PLACEMENTS.length);
      expect(anchorPlacements(a)[0]).toEqual(orbitPoint(a.orbit!, 0));
    }
    // Une prise est au sommet au pas zéro.
    expect(anchors.some((a) => Math.abs(a.pos.x - pivot.x) < 0.01 && a.pos.y > pivot.y)).toBe(true);
    expect(shell.length).toBeGreaterThan(10);
    for (const stud of shell) {
      const cx = (stud.x0 + stud.x1) / 2;
      const cy = (stud.y0 + stud.y1) / 2;
      expect(Math.hypot(cx - pivot.x, cy - pivot.y)).toBeCloseTo(CAROUSEL_SHELL, 2);
      expect(isMoving(stud)).toBe(false);
      // Jamais au-dessus ni au-dessous du pivot : les ouvertures.
      if (Math.abs(cx - pivot.x) < CAROUSEL_SHELL * 0.5) expect(Math.abs(cy - pivot.y)).toBeLessThan(CAROUSEL_SHELL * 0.9);
    }
    expect(provableObstacles(shell)).toHaveLength(shell.length);
    expect(exit.y).toBeGreaterThan(pivot.y + CAROUSEL_SHELL);
  });

  it('la couronne se prouve à trois phases d\'un tiers de tour, coque comprise', () => {
    const segment = buildScene('carrousel', ids(), { x: 0, y: 0 });
    expect(verifyWithMotions([], [], [], [], segment, T, PLAIN_CONTEXT)).toBe(true);
    expect(ORBIT_PLACEMENTS).toEqual([0, 1 / 9, 2 / 9]);
    expect(1 / CAROUSEL_ANCHORS).toBeCloseTo(3 * (ORBIT_PLACEMENTS[1] ?? 0), 9);
  });
});

describe('la structure dépliante', () => {
  it('son panneau à charnière est couché sur le vol, fermé, et se couche de l\'autre côté de sa charnière, déplié, en deux secondes de tenue', () => {
    const from = { x: 1, y: 100 };
    const next = { x: from.x - 2.6, y: from.y + SWITCH_NEXT_RISE };
    const { anchor, panel } = unfolding(ids(), from, next);
    expect(anchor.kind).toBe('interrupteur');
    expect(panel.switchedBy).toBe(anchor.id);
    expect(panel.kind).toBe('tournant');
    expect(panel.hinge).toEqual({ closedTurns: 0.5, openTurns: 0, seconds: HINGE_SECONDS });
    expect(panel.rotor?.arm).toEqual({ x: UNFOLD_PANEL / 2, y: 0 });
    expect(isMoving(panel)).toBe(true);
    expect(provableObstacles([panel])).toHaveLength(0);
    const pivot = panel.rotor!.pivot;
    // La charnière du côté de l'interrupteur (à droite ici, la prise suivante est à gauche).
    expect(pivot.x).toBeGreaterThan(from.x);
    const closed = rotorEnds(panel, 0, T)!;
    // Fermé : de la charnière vers la prise suivante, à l'horizontale, au-dessus de la ligne du vol.
    expect(closed.a.y).toBeCloseTo(pivot.y, 3);
    expect(closed.b.y).toBeCloseTo(pivot.y, 3);
    expect(Math.min(closed.a.x, closed.b.x)).toBeCloseTo(pivot.x - UNFOLD_PANEL, 3);
    expect(pivot.y).toBeGreaterThan((from.y + next.y) / 2);
    // À mi-course, il pointe vers le haut : il bascule par le haut, jamais par là où l'on pend.
    expect(hingeTurns({ ...panel, hingeProgress: 0.5 })).toBeCloseTo(0.25, 9);
    const open = rotorEnds({ ...panel, hingeProgress: 1 }, 0, T)!;
    expect(Math.max(open.a.x, open.b.x)).toBeCloseTo(pivot.x + UNFOLD_PANEL, 3);
    expect(open.a.y).toBeCloseTo(pivot.y, 3);
    // Déplié, il est loin de la pendaison sous la prise suivante.
    expect(Math.min(open.a.x, open.b.x)).toBeGreaterThan(next.x + 1);
    // Le progrès suit la commande de l'interrupteur, à son rythme, dans les deux sens.
    const state = { obstacles: [{ ...panel }], step: 0 } as unknown as Parameters<typeof applyHinges>[0];
    state.obstacles[0]!.openUntilStep = 10 * SECOND;
    for (let k = 0; k < Math.round(HINGE_SECONDS * SECOND); k += 1) applyHinges(state, T);
    expect(state.obstacles[0]!.hingeProgress).toBeCloseTo(1, 6);
    state.obstacles[0]!.openUntilStep = 0;
    for (let k = 0; k < Math.round((HINGE_SECONDS / 2) * SECOND); k += 1) applyHinges(state, T);
    expect(state.obstacles[0]!.hingeProgress).toBeCloseTo(0.5, 6);
  });

  it('en partie, tenir la prise déplie le panneau, qui reste déplié quatre secondes après le lâcher puis se replie', () => {
    const sim = new Simulation(5, T, { kind: 'scene', sceneId: 'depliante', startY: 0 });
    const lever = sim.state.anchors.find((a) => a.kind === 'interrupteur')!;
    const panel = (): number => sim.state.obstacles.find((o) => o.hinge)!.hingeProgress ?? 0;
    expect(panel()).toBe(0);
    // Le personnage est pendu à la prise et y reste.
    sim.state.hero.pos = { x: lever.pos.x, y: lever.pos.y - 2 };
    sim.state.hero.grounded = false;
    sim.state.rope = { anchorId: lever.id, length: 2 };
    sim.state.attachStep = sim.state.step;
    sim.run(Math.round((HINGE_SECONDS + 0.5) * SECOND));
    expect(panel()).toBe(1);
    sim.release();
    // Lâché, le personnage tombe sur le toit ; la brume est tenue loin, pour que la partie dure.
    const run = (steps: number): void => {
      for (let k = 0; k < steps; k += 1) {
        sim.state.fogY = -100;
        sim.step();
      }
    };
    run(Math.round((SWITCH_HOLD_SECONDS - 0.5) * SECOND));
    expect(panel()).toBe(1);
    run(Math.round((HINGE_SECONDS + 1) * SECOND));
    expect(panel()).toBe(0);
  });
});

describe('le convoyeur', () => {
  it('ses plateformes vont et viennent à contresens, surface et prise ensemble, et la dernière est un lanceur sous un mur à trou fixe', () => {
    const { anchors, slabs, walls, exit } = conveyor(ids(), { x: 1, y: 100 }, 4);
    expect(anchors).toHaveLength(3);
    expect(slabs).toHaveLength(2);
    expect(walls).toHaveLength(2);
    expect(anchors.map((a) => a.kind)).toEqual(['normal', 'normal', 'lanceur']);
    expect(anchors.every((a) => a.cable !== undefined && a.cable.period === CONVEYOR_PERIOD)).toBe(true);
    for (let k = 0; k < 2; k += 1) {
      const a = anchors[k]!;
      const slab = slabs[k]!;
      expect(slab.slide?.proven).toBe(true);
      expect(slab.y0).toBeCloseTo(a.pos.y + CONVEYOR_ANCHOR_BELOW, 9);
      // Au pas zéro et à mi-période, la surface est décalée exactement comme sa prise.
      for (const step of [0, Math.round((CONVEYOR_PERIOD / 2) * SECOND)]) {
        const anchorDx = cablePosition(a, step, T).x - a.pos.x;
        expect(slideOffset(slab.slide!, step, T)).toBeCloseTo(anchorDx, 6);
        expect(Math.abs(anchorDx)).toBeCloseTo(CONVEYOR_AMPLITUDE, 6);
      }
      expect(Math.sign(slabs[0]!.slide!.amplitude)).toBe(-Math.sign(anchors[1]!.cable!.to.x - anchors[1]!.pos.x));
    }
    expect(walls[0]!.y0).toBeGreaterThan(anchors[2]!.pos.y + 4);
    expect(walls[1]!.x0 - walls[0]!.x1).toBeGreaterThan(2);
    expect(exit.y).toBeGreaterThan(walls[0]!.y1);
    // Les surfaces ne comptent pas dans la preuve ordinaire (elles bougent) ; `verifyWithMotions` les joue à leurs positions.
    expect(provableObstacles(slabs)).toHaveLength(0);
  });

  it('un convoyeur se prouve : une de ses trois positions au moins fait passer la chaîne', () => {
    const segment = buildScene('convoyeur', ids(), { x: 0, y: 0 });
    expect(verifyWithMotions([], [], [], [], segment, T, PLAIN_CONTEXT)).toBe(true);
  });
});

describe('les segments, scènes, robots, atelier et niveaux du lot 5 B', () => {
  it('les segments se construisent et se prouvent, les prises qui bougent à trois positions', () => {
    const profile = tierProfile(5);
    const has = (archetype: Archetype, segment: Segment): boolean =>
      archetype === 'faille' ? segment.anchors.some((a) => a.rift) : archetype === 'carrousel' ? segment.anchors.some((a) => a.orbit) : archetype === 'depliante' ? segment.obstacles.some((o) => o.hinge) : segment.obstacles.some((o) => o.slide?.proven);
    for (const archetype of ['faille', 'carrousel', 'depliante', 'convoyeur'] as const) {
      let built = 0;
      let proven = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        const rng = createRng(seed);
        const from = { x: rng.next() * 4 - 2, y: 100 };
        const segment = buildSegment(rng, ids(), from, { x: 0, y: 0 }, profile, archetype);
        if (!has(archetype, segment)) continue;
        built += 1;
        const entry: Anchor = { id: 0, pos: from, kind: 'normal', broken: false };
        if (verifyWithMotions([entry], [], [], [], segment, T, PLAIN_CONTEXT)) proven += 1;
      }
      expect(built, archetype).toBeGreaterThanOrEqual(8);
      expect(proven / built, archetype).toBeGreaterThanOrEqual(0.85);
    }
  }, 20_000);

  it('les cinq scènes se prouvent, portent leur mécanique, et les robots les grimpent', () => {
    for (const id of ['plafond', 'faille', 'carrousel', 'depliante', 'convoyeur'] as const) {
      const scene = SCENES.find((s) => s.id === id)!;
      const segment = buildScene(id, ids(), { x: 0, y: 0 });
      expect(verifySegment([], [], segment, T), id).toBe(true);
      if (id === 'plafond') expect(scene.events?.[0]?.kind).toBe('plafond');
      if (id === 'faille') expect(segment.anchors.filter((a) => a.rift)).toHaveLength(6);
      if (id === 'carrousel') expect(segment.anchors.filter((a) => a.orbit)).toHaveLength(CAROUSEL_ANCHORS);
      if (id === 'depliante') expect(segment.obstacles.filter((o) => o.hinge)).toHaveLength(1);
      if (id === 'convoyeur') expect(segment.obstacles.filter((o) => o.slide?.proven)).toHaveLength(2);
      let inverted = false;
      const report = playRobot(5, T, 45, REASONABLE, { kind: 'scene', sceneId: id, startY: 0 }, (state) => {
        if (state.env.inverted) inverted = true;
      });
      expect(report.alive, scene.name).toBe(true);
      expect(report.height, scene.name).toBeGreaterThan(60);
      if (id === 'plafond') expect(inverted).toBe(true);
      const beginner = playRobot(5, T, 45, BEGINNER, { kind: 'scene', sceneId: id, startY: 0 });
      expect(beginner.height, `${scene.name}, débutant`).toBeGreaterThan(26);
    }
  }, 30_000);

  it('sous un plafond, la course engendre des plafonds à trou et jamais de repli', () => {
    const sim = new Simulation(5, T, { kind: 'scene', sceneId: 'plafond', startY: 0 });
    sim.state.hero.pos = { x: 0, y: PLAFOND_SCENE_AT + PLAFOND_LENGTH + 20 };
    sim.state.hero.grounded = false;
    sim.state.fogY = PLAFOND_SCENE_AT;
    sim.step();
    expect(sim.state.course.fallbacks).toBe(0);
    expect(sim.state.course.unverified).toBe(0);
    const ceilings = sim.state.obstacles.filter((o) => o.x0 <= -14 && o.y0 > PLAFOND_SCENE_AT && o.y0 < PLAFOND_SCENE_AT + PLAFOND_LENGTH);
    expect(ceilings.length).toBeGreaterThanOrEqual(2);
  });

  it('l\'atelier connaît les cinq éléments (le plafond est un événement), et les paliers les ouvrent dans l\'ordre', () => {
    expect(ATELIER_ELEMENTS.filter((e) => ['plafond', 'faille', 'carrousel', 'depliante', 'convoyeur'].includes(e.id)).every((e) => e.group === 'transformations')).toBe(true);
    expect(atelierProfile(['faille', 'convoyeur']).archetypes).toEqual(['faille', 'convoyeur']);
    expect(atelierEvents(['plafond', 'vent'])).toEqual(['plafond', 'vent']);
    const has = (tier: number, archetype: Archetype): boolean => tierProfile(tier).archetypes.includes(archetype);
    expect(has(2, 'faille')).toBe(false);
    expect(has(3, 'faille')).toBe(true);
    expect(has(3, 'carrousel') || has(3, 'convoyeur')).toBe(false);
    expect(has(4, 'carrousel') && has(4, 'convoyeur')).toBe(true);
    expect(has(4, 'depliante')).toBe(false);
    expect(has(5, 'depliante')).toBe(true);
    const run = new Simulation(2, T, { kind: 'atelier', startY: 0, selection: ['carrousel', 'faille'] });
    expect(run.state.anchors.some((a) => a.orbit)).toBe(true);
    expect(run.state.anchors.some((a) => a.rift)).toBe(true);
    expect(run.state.course.unverified).toBe(0);
    const ceiling = new Simulation(2, T, { kind: 'atelier', startY: 0, selection: ['plafond'] });
    expect(ceiling.state.schedule.some((e) => e.kind === 'plafond')).toBe(true);
  });

  it('les niveaux 23 et 24 existent, se suivent, et portent les nouveautés', () => {
    expect(LEVELS).toHaveLength(24);
    const plafond = LEVELS.find((l) => l.id === 23)!;
    const machines = LEVELS.find((l) => l.id === 24)!;
    expect(plafond.startY).toBe(LEVELS.find((l) => l.id === 22)!.endY);
    expect(machines.startY).toBe(plafond.endY);
    expect(plafond.events.filter((e) => e.kind === 'plafond')).toHaveLength(2);
    expect(plafond.profile.archetypes).toEqual(expect.arrayContaining(['faille', 'carrousel']));
    expect(machines.profile.archetypes).toEqual(expect.arrayContaining(['depliante', 'convoyeur']));
    expect(machines.events.some((e) => e.kind === 'plafond')).toBe(true);
  });
});

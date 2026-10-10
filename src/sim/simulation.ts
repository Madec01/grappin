import { chooseTarget } from './aim';
import { FREE_RUN, createCourse, extendCourse, pruneCourse, type CoursePlan } from './course';
import { STILL } from './environment';
import { applyEvents } from './events';
import { integrate, swingStep } from './physics';
import { applyBufferedPress, applyFall, applyFinish, applyFog, applyFragile, applyGround, applyHang, applyObstacles, applyPickups, applyScore, applyTier, press, release } from './rules';
import type { RuleEvent, SimState } from './state';
import { DEFAULT_TUNING, type Tuning } from './tuning';

/**
 * Simulation déterministe à pas fixe.
 *
 * Elle ignore le monde extérieur : pas d'horloge, pas de navigateur, pas de
 * rendu. Les gestes sont journalisés avec leur numéro de pas, de sorte qu'un
 * rejeu des mêmes gestes sur la même graine donne exactement le même état.
 */

export function createState(seed: number, tuning: Tuning, plan: CoursePlan = FREE_RUN): SimState {
  const state: SimState = {
    step: 0,
    hero: { pos: { x: 0, y: plan.startY + tuning.heroRadius }, vel: { x: 0, y: 0 }, grounded: true },
    rope: null,
    attachStep: 0,
    attachCount: 0,
    chancesLeft: tuning.secondChances,
    anchors: [],
    obstacles: [],
    pickups: [],
    grazed: [],
    tier: 0,
    targetId: null,
    targetValidStep: 0,
    pressStep: -1,
    lastAnchorId: null,
    releaseStep: -1_000_000,
    hangSteps: 0,
    course: createCourse(seed, plan),
    fogY: plan.startY + tuning.fogStart,
    groundY: plan.startY,
    finishY: plan.kind === 'level' ? plan.endY : null,
    schedule: plan.kind === 'level' ? [...plan.events] : [],
    eventRuntimes: plan.kind === 'level' ? plan.events.map(() => ({ startStep: null, endStep: null })) : [],
    env: STILL,
    fogFactor: 1,
    lightsOff: false,
    rainRng: (seed ^ 0x9e3779b9) >>> 0,
    // La hauteur part du centre du personnage posé sur le toit : les premiers centimètres ne comptent pas.
    height: plan.startY + tuning.heroRadius,
    score: 0,
    combo: 0,
    status: 'alive',
    inputs: [],
  };
  // Un niveau est engendré en entier dès le départ : on connaît ainsi son nombre d'étoiles.
  extendCourse(state, plan.kind === 'level' ? plan.endY + tuning.courseAhead : plan.startY + tuning.courseAhead, tuning);
  const aim = chooseTarget(state, tuning);
  state.targetId = aim.targetId;
  state.targetValidStep = aim.targetValidStep;
  return state;
}

export class Simulation {
  readonly tuning: Tuning;
  state: SimState;
  private events: RuleEvent[] = [];

  constructor(seed: number, tuning: Tuning = DEFAULT_TUNING, plan: CoursePlan = FREE_RUN, state?: SimState) {
    this.tuning = tuning;
    this.state = state ?? createState(seed, tuning, plan);
  }

  /** Le doigt se pose : accroche au point visé, ou garde l'appui en mémoire. Vrai si la corde part tout de suite. */
  press(): boolean {
    const outcome = press(this.state, this.tuning, this.events);
    if (outcome !== 'ignored') this.state.inputs.push({ step: this.state.step, kind: 'press' });
    return outcome === 'attached';
  }

  /** Le doigt se lève : libère le personnage. */
  release(): boolean {
    const ok = release(this.state, this.tuning, this.events);
    if (ok) this.state.inputs.push({ step: this.state.step, kind: 'release' });
    return ok;
  }

  /**
   * Avance d'un pas. Ordre fixe : événements, casse fragile, treuil et mouvement,
   * sol, chute, obstacles, étoiles, pendaison, score, palier, arrivée, brume, parcours, visée, appui en mémoire.
   */
  step(): void {
    const s = this.state;
    if (s.status !== 'alive') return;
    applyEvents(s, this.tuning, this.events);
    applyFragile(s, this.tuning, this.events);
    const anchor = s.rope ? (s.anchors.find((a) => a.id === s.rope!.anchorId)?.pos ?? null) : null;
    if (s.rope && anchor) {
      const swung = swingStep(s.hero, anchor, s.rope.length, this.tuning, s.env);
      s.hero.pos = swung.body.pos;
      s.hero.vel = swung.body.vel;
      s.rope.length = swung.ropeLength;
    } else {
      const moved = integrate(s.hero, null, 0, this.tuning, s.env);
      s.hero.pos = moved.pos;
      s.hero.vel = moved.vel;
    }
    s.step += 1;
    applyGround(s, this.tuning);
    applyFall(s, this.events);
    applyObstacles(s, this.tuning, this.events);
    applyPickups(s, this.tuning, this.events);
    applyHang(s, this.tuning, this.events);
    applyScore(s, this.tuning);
    applyTier(s, this.tuning, this.events);
    applyFinish(s, this.events);
    applyFog(s, this.tuning, this.events);
    extendCourse(s, s.hero.pos.y + this.tuning.courseAhead, this.tuning);
    pruneCourse(s, s.fogY);
    const aim = s.rope ? { targetId: null, targetValidStep: s.step } : chooseTarget(s, this.tuning);
    s.targetId = aim.targetId;
    s.targetValidStep = aim.targetValidStep;
    applyBufferedPress(s, this.tuning, this.events);
  }

  run(steps: number): void {
    for (let i = 0; i < steps && this.state.status === 'alive'; i += 1) this.step();
  }

  /** Événements émis depuis le dernier appel ; vide la file. */
  drain(): RuleEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Copie indépendante, qui poursuit à l'identique. */
  clone(): Simulation {
    return new Simulation(this.state.course.seed, this.tuning, this.state.course.plan, structuredClone(this.state));
  }

  /** Empreinte stable de l'état, pour les tests de déterminisme. */
  snapshot(): string {
    return JSON.stringify(this.state);
  }
}

/** Rejoue un journal de gestes sur une graine jusqu'à un pas donné. */
export function replay(
  seed: number,
  inputs: readonly { step: number; kind: 'press' | 'release' }[],
  untilStep: number,
  tuning: Tuning = DEFAULT_TUNING,
  plan: CoursePlan = FREE_RUN,
): Simulation {
  const sim = new Simulation(seed, tuning, plan);
  let next = 0;
  while (sim.state.step < untilStep && sim.state.status === 'alive') {
    while (next < inputs.length && inputs[next]!.step === sim.state.step) {
      if (inputs[next]!.kind === 'press') sim.press();
      else sim.release();
      next += 1;
    }
    sim.step();
  }
  return sim;
}

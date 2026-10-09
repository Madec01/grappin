import { chooseTarget } from './aim';
import { createCourse, extendCourse, pruneCourse } from './course';
import { integrate, reelIn } from './physics';
import { applyBufferedPress, applyFog, applyGround, applyHang, applyScore, press, release } from './rules';
import type { RuleEvent, SimState } from './state';
import { DEFAULT_TUNING, type Tuning } from './tuning';

/**
 * Simulation déterministe à pas fixe.
 *
 * Elle ignore le monde extérieur : pas d'horloge, pas de navigateur, pas de
 * rendu. Les gestes sont journalisés avec leur numéro de pas, de sorte qu'un
 * rejeu des mêmes gestes sur la même graine donne exactement le même état.
 */

/** Marge de génération au-dessus du personnage, en mètres. */
const COURSE_AHEAD = 24;
/** Les points passés sous la brume de plus de cette distance sont retirés. */
const COURSE_BEHIND = 10;

export function createState(seed: number, tuning: Tuning): SimState {
  const state: SimState = {
    step: 0,
    hero: { pos: { x: 0, y: tuning.heroRadius }, vel: { x: 0, y: 0 }, grounded: true },
    rope: null,
    anchors: [],
    targetId: null,
    targetValidStep: 0,
    pressStep: -1,
    lastAnchorId: null,
    releaseStep: -1_000_000,
    hangSteps: 0,
    course: createCourse(seed),
    fogY: tuning.fogStart,
    // La hauteur part du centre du personnage posé sur le toit : les premiers centimètres ne comptent pas.
    height: tuning.heroRadius,
    score: 0,
    combo: 0,
    status: 'alive',
    inputs: [],
  };
  extendCourse(state, COURSE_AHEAD);
  const aim = chooseTarget(state, tuning);
  state.targetId = aim.targetId;
  state.targetValidStep = aim.targetValidStep;
  return state;
}

export class Simulation {
  readonly tuning: Tuning;
  state: SimState;
  private events: RuleEvent[] = [];

  constructor(seed: number, tuning: Tuning = DEFAULT_TUNING, state?: SimState) {
    this.tuning = tuning;
    this.state = state ?? createState(seed, tuning);
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

  /** Avance d'un pas. Ordre fixe : treuil, mouvement, sol, pendaison, score, brume, parcours, visée, appui en mémoire. */
  step(): void {
    const s = this.state;
    if (s.status !== 'alive') return;
    const anchor = s.rope ? (s.anchors.find((a) => a.id === s.rope!.anchorId)?.pos ?? null) : null;
    if (s.rope && anchor) {
      const shorter = Math.max(this.tuning.ropeMin, s.rope.length - this.tuning.reelSpeed * this.tuning.stepSeconds);
      const pulled = reelIn(s.hero, anchor, s.rope.length, shorter, this.tuning.reelSpin, this.tuning.stepSeconds);
      s.hero.vel = pulled.vel;
      s.rope.length = shorter;
    }
    const moved = integrate(s.hero, anchor, s.rope?.length ?? 0, this.tuning);
    s.hero.pos = moved.pos;
    s.hero.vel = moved.vel;
    s.step += 1;
    applyGround(s, this.tuning);
    applyHang(s, this.tuning, this.events);
    applyScore(s, this.tuning);
    applyFog(s, this.tuning, this.events);
    extendCourse(s, s.hero.pos.y + COURSE_AHEAD);
    pruneCourse(s, s.fogY - COURSE_BEHIND);
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
    return new Simulation(this.state.course.seed, this.tuning, structuredClone(this.state));
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
): Simulation {
  const sim = new Simulation(seed, tuning);
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

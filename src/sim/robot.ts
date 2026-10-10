import { FREE_RUN, type CoursePlan } from './course';
import { PULL_MAX } from './launcher';
import type { Anchor } from './state';
import { Simulation } from './simulation';
import type { Tuning } from './tuning';

/**
 * Robots joueurs : des stratégies simples qui jouent une partie en Node,
 * sans navigateur, pour mesurer un réglage ou la courbe de difficulté.
 *
 * Le robot « raisonnable » accroche dès qu'un point est visé, garde le doigt
 * posé jusqu'à une vitesse cible ou une corde au plus court, puis lâche dans
 * la fenêtre du lâcher parfait. Le robot « débutant » fait pareil, mais avec
 * un temps de réaction et une fenêtre de lâcher plus large et plus
 * maladroite : il sert à vérifier qu'un nouveau joueur survit à ses premières
 * secondes.
 */

export interface RobotProfile {
  readonly name: string;
  /** Vitesse à partir de laquelle le robot accepte de lâcher. */
  readonly speedTarget: number;
  /** Pente minimale et maximale de la vitesse acceptée au lâcher. */
  readonly minSlope: number;
  readonly maxSlope: number;
  /** Temps de réaction appliqué à l'accroche et au lâcher, en secondes. */
  readonly reactionSeconds: number;
  /** Jamais plus longtemps pendu. */
  readonly maxHoldSeconds: number;
}

export const REASONABLE: RobotProfile = { name: 'raisonnable', speedTarget: 8, minSlope: 0.6, maxSlope: 1.8, reactionSeconds: 0, maxHoldSeconds: 2.5 };
export const BEGINNER: RobotProfile = { name: 'débutant', speedTarget: 6, minSlope: 0.3, maxSlope: 3, reactionSeconds: 0.25, maxHoldSeconds: 3 };

export interface RobotReport {
  readonly height: number;
  readonly seconds: number;
  readonly catches: number;
  readonly perfect: number;
  readonly maxSpeed: number;
  /** Tenue moyenne d'une corde, en secondes. */
  readonly hold: number;
  readonly alive: boolean;
  readonly won: boolean;
  readonly cause: 'fog' | 'obstacle' | 'fall' | null;
}

export function playRobot(seed: number, tuning: Tuning, seconds: number, profile: RobotProfile = REASONABLE, plan: CoursePlan = FREE_RUN): RobotReport {
  const sim = new Simulation(seed, tuning, plan);
  const reactionSteps = Math.round(profile.reactionSeconds / tuning.stepSeconds);
  let catches = 0;
  let perfect = 0;
  let maxSpeed = 0;
  let attachStep = 0;
  let holdTotal = 0;
  let cause: RobotReport['cause'] = null;
  /** Pas où le robot a décidé d'agir, exécuté après son temps de réaction. */
  let plannedPress = -1;
  let plannedRelease = -1;
  const limit = Math.round(seconds / tuning.stepSeconds);
  while (sim.state.status === 'alive' && sim.state.step < limit) {
    const s = sim.state;
    if (!s.rope) {
      if (s.targetId !== null && plannedPress < 0) plannedPress = s.step + reactionSteps;
      if (plannedPress >= 0 && s.step >= plannedPress) {
        plannedPress = -1;
        if (sim.press()) {
          catches += 1;
          attachStep = s.step;
        }
      }
    } else if (s.anchors.find((a) => a.id === s.rope?.anchorId)?.kind === 'lanceur') {
      // Sur un lanceur : après son temps de réaction, le robot vise le point le plus proche au-dessus et tire à l'opposé, aux deux tiers.
      const launcher = s.anchors.find((a) => a.id === s.rope?.anchorId)!;
      if (plannedRelease < 0) plannedRelease = s.step + reactionSteps;
      if (s.step >= plannedRelease) {
        plannedRelease = -1;
        let target: Anchor | null = null;
        for (const a of s.anchors) {
          if (a.id === launcher.id || a.broken || a.pos.y < launcher.pos.y + 1) continue;
          if (!target || Math.hypot(a.pos.x - launcher.pos.x, a.pos.y - launcher.pos.y) < Math.hypot(target.pos.x - launcher.pos.x, target.pos.y - launcher.pos.y)) target = a;
        }
        const dir = target ? { x: target.pos.x - launcher.pos.x, y: target.pos.y - launcher.pos.y } : { x: 0, y: 1 };
        const len = Math.hypot(dir.x, dir.y) || 1;
        sim.release({ x: (-dir.x / len) * PULL_MAX * 0.7, y: (-dir.y / len) * PULL_MAX * 0.7 });
      }
    } else if (s.step - attachStep > 10) {
      const held = (s.step - attachStep) * tuning.stepSeconds;
      const speed = Math.hypot(s.hero.vel.x, s.hero.vel.y);
      const ready = speed >= profile.speedTarget || s.rope.length <= tuning.ropeMin + 1e-9;
      const ax = Math.abs(s.hero.vel.x);
      const slope = ax > 0 ? s.hero.vel.y / ax : Infinity;
      const wants = (ready && s.hero.vel.y > 1 && slope > profile.minSlope && slope < profile.maxSlope) || held > profile.maxHoldSeconds;
      if (wants && plannedRelease < 0) plannedRelease = s.step + reactionSteps;
      if (plannedRelease >= 0 && s.step >= plannedRelease) {
        plannedRelease = -1;
        sim.release();
        holdTotal += held;
      }
    }
    sim.step();
    maxSpeed = Math.max(maxSpeed, Math.hypot(sim.state.hero.vel.x, sim.state.hero.vel.y));
    for (const e of sim.drain()) {
      if (e.type === 'release' && e.perfect) perfect += 1;
      if (e.type === 'death') cause = e.cause;
    }
  }
  const t = sim.state.step * tuning.stepSeconds;
  return { height: sim.state.height, seconds: t, catches, perfect, maxSpeed, hold: catches ? holdTotal / catches : 0, alive: sim.state.status === 'alive', won: sim.state.status === 'won', cause };
}

import { FREE_RUN, type CoursePlan } from './course';
import { flightStep, startFlight } from './flight';
import { PULL_MAX } from './launcher';
import { provableObstacles } from './obstacles';
import { zoneAt } from './physics';
import { bestLaunch } from './pilot';
import { releaseVelocity } from './rules';
import type { Anchor, RuleEvent, SimState } from './state';
import { Simulation } from './simulation';
import type { Tuning } from './tuning';
import { swingIsClear } from './verifier';

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
/** Temps minimal passé sur un lanceur avant de tirer, en secondes. */
export const LAUNCH_AIM_SECONDS = 0.35;
/** Le robot qui monte à plus de cette vitesse ignore un point visé plus bas que lui de cette distance : il attend la suite. */
const RISING_SPEED = 1;
const RISING_BELOW = 0.5;
/** Une zone où le vol du robot arrive dans ce temps compte comme « devant lui » : il monte vers elle. */
const ZONE_AHEAD_SECONDS = 0.4;
/** Avant de lâcher, le robot regarde ce temps de vol devant lui : s'il heurte un obstacle solide, il garde la corde et attend la suite du balancement. */
const LOOK_AHEAD_SECONDS = 0.5;

/** Vrai si le vol qui suivrait un lâcher maintenant ne heurte rien pendant `LOOK_AHEAD_SECONDS` (rebonds, fracas et anneaux joués). */
function releaseIsClear(state: SimState, tuning: Tuning): boolean {
  const flight = startFlight({ pos: state.hero.pos, vel: releaseVelocity(state, tuning) });
  const obstacles = provableObstacles(state.obstacles);
  const steps = Math.round(LOOK_AHEAD_SECONDS / tuning.stepSeconds);
  for (let k = 0; k < steps; k += 1) {
    flightStep(flight, obstacles, state.rings, state.zones, tuning, state.env);
    if (flight.ended) return false;
  }
  return true;
}

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
  readonly cause: 'fog' | 'fall' | null;
}

/** Ce qu'un observateur peut suivre pas à pas : l'état après le pas, et les événements de règles du pas. Pour les diagnostics. */
export type RobotTrace = (state: SimState, events: readonly RuleEvent[]) => void;

export function playRobot(seed: number, tuning: Tuning, seconds: number, profile: RobotProfile = REASONABLE, plan: CoursePlan = FREE_RUN, trace?: RobotTrace): RobotReport {
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
  /** Après un lancer, on ne rattrape rien sous le lanceur pendant un moment : on monte. */
  let launchedStep = -1_000_000;
  let launchedY = -Infinity;
  const launchWaitSteps = Math.round(1.5 / tuning.stepSeconds);
  /** Sur un lanceur, le robot prend le temps de bander la fronde : le personnage doit d'abord être tiré jusqu'au lanceur, et un pouce ne vise pas en moins d'un tiers de seconde. */
  const aimSteps = Math.max(reactionSteps, Math.round(LAUNCH_AIM_SECONDS / tuning.stepSeconds));
  const limit = Math.round(seconds / tuning.stepSeconds);
  while (sim.state.status === 'alive' && sim.state.step < limit) {
    const s = sim.state;
    if (!s.rope) {
      const target = s.targetId === null ? null : s.anchors.find((a) => a.id === s.targetId);
      const climbing = s.step - launchedStep > launchWaitSteps || (target !== null && target !== undefined && target.pos.y > launchedY + 1);
      // Porté vers le haut par une zone (un courant, une fusée), le robot ne rattrape pas un point sous lui : il monte d'abord, comme un
      // joueur. Hors zone, il attrape ce qu'il vise : refuser un point plus bas en plein vol rapide, c'est finir hors du monde.
      const ahead = (seconds: number): boolean => zoneAt(s.zones, { x: s.hero.pos.x + s.hero.vel.x * seconds, y: s.hero.pos.y + s.hero.vel.y * seconds }) !== null;
      const towardsZone = ahead(0) || ahead(ZONE_AHEAD_SECONDS / 2) || ahead(ZONE_AHEAD_SECONDS);
      const rising = towardsZone && s.hero.vel.y > RISING_SPEED && target !== null && target !== undefined && target.pos.y < s.hero.pos.y - RISING_BELOW;
      // Attraper ici mènerait-il dans un mur ? Saisi de loin, corde molle, le vol continue tout droit : le robot regarde le balancement
      // qui suivrait, comme le vérificateur, et attend un meilleur moment si un autre point est à portée ; mais un choc vaut mieux
      // qu'une sortie du monde : s'il tombe, ou si ce point est le dernier à portée, il attrape quand même.
      const others = target ? s.anchors.filter((a) => a.id !== target.id && !a.broken && Math.hypot(a.pos.x - s.hero.pos.x, a.pos.y - s.hero.pos.y) <= tuning.ropeMax).length : 0;
      const safe = target !== null && target !== undefined && (s.hero.vel.y < 0 || others === 0 || swingIsClear(target, { pos: s.hero.pos, vel: s.hero.vel }, s.anchors, provableObstacles(s.obstacles), tuning, s.env, s.zones));
      if (target && climbing && !rising && safe && plannedPress < 0) plannedPress = s.step + reactionSteps;
      if (plannedPress >= 0 && s.step >= plannedPress) {
        plannedPress = -1;
        if (sim.press()) {
          catches += 1;
          attachStep = s.step;
        }
      }
    } else if (s.anchors.find((a) => a.id === s.rope?.anchorId)?.kind === 'lanceur') {
      // Sur un lanceur : après son temps de réaction, le robot tire la traction que le vérificateur a prouvée (voir `pilot.ts`) ;
      // sans sortie prouvée, il vise le point le plus proche au-dessus et tire à l'opposé, aux deux tiers.
      const launcher = s.anchors.find((a) => a.id === s.rope?.anchorId)!;
      if (plannedRelease < 0) plannedRelease = s.step + aimSteps;
      if (s.step >= plannedRelease) {
        plannedRelease = -1;
        let target: Anchor | null = null;
        for (const a of s.anchors) {
          if (a.id === launcher.id || a.broken || a.pos.y < launcher.pos.y + 1) continue;
          if (!target || Math.hypot(a.pos.x - launcher.pos.x, a.pos.y - launcher.pos.y) < Math.hypot(target.pos.x - launcher.pos.x, target.pos.y - launcher.pos.y)) target = a;
        }
        const dir = target ? { x: target.pos.x - launcher.pos.x, y: target.pos.y - launcher.pos.y } : { x: 0, y: 1 };
        const len = Math.hypot(dir.x, dir.y) || 1;
        sim.release(bestLaunch(s, tuning) ?? { x: (-dir.x / len) * PULL_MAX * 0.7, y: (-dir.y / len) * PULL_MAX * 0.7 });
        launchedStep = s.step;
        launchedY = launcher.pos.y;
      }
    } else if (s.step - attachStep > 10) {
      const held = (s.step - attachStep) * tuning.stepSeconds;
      const speed = Math.hypot(s.hero.vel.x, s.hero.vel.y);
      const ready = speed >= profile.speedTarget || s.rope.length <= tuning.ropeMin + 1e-9;
      const ax = Math.abs(s.hero.vel.x);
      const slope = ax > 0 ? s.hero.vel.y / ax : Infinity;
      const wants = (ready && s.hero.vel.y > 1 && slope > profile.minSlope && slope < profile.maxSlope) || held > profile.maxHoldSeconds;
      // Un lâcher droit dans un mur n'est pas un lâcher : le robot attend le prochain moment, sauf s'il pend depuis trop longtemps.
      if (wants && plannedRelease < 0 && (held > 2 * profile.maxHoldSeconds || releaseIsClear(s, tuning))) plannedRelease = s.step + reactionSteps;
      if (plannedRelease >= 0 && s.step >= plannedRelease) {
        plannedRelease = -1;
        sim.release();
        holdTotal += held;
      }
    }
    sim.step();
    maxSpeed = Math.max(maxSpeed, Math.hypot(sim.state.hero.vel.x, sim.state.hero.vel.y));
    const events = sim.drain();
    for (const e of events) {
      if (e.type === 'release' && e.perfect) perfect += 1;
      if (e.type === 'death') cause = e.cause;
    }
    if (trace) trace(sim.state, events);
  }
  const t = sim.state.step * tuning.stepSeconds;
  return { height: sim.state.height, seconds: t, catches, perfect, maxSpeed, hold: catches ? holdTotal / catches : 0, alive: sim.state.status === 'alive', won: sim.state.status === 'won', cause };
}

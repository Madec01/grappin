import type { Vec2 } from '../core/math/vec2';
import { isMoving, obstacleGap } from './moving';
import { FREE_RUN, type CoursePlan } from './course';
import { flightStep, startFlight } from './flight';
import { PULL_MAX, launchVelocity, pulledPosition } from './launcher';
import { provableObstacles } from './obstacles';
import { constrainVelocity, swingStep, zoneAt, type Body } from './physics';
import { bestLaunch, bestRail } from './pilot';
import { railParam, railPoint, railPull, railVelocity } from './holds';
import { WORLD_HALF_WIDTH, releaseVelocity } from './rules';
import { upOf } from './environment';
import type { Anchor, RuleEvent, SimState } from './state';
import { Simulation } from './simulation';
import type { Tuning } from './tuning';
import { flightCatches, swingIsClear } from './verifier';

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
/** Avant de lâcher, le robot regarde ce temps de vol devant lui : s'il heurte un obstacle solide, il garde la corde et attend la suite du balancement. Partagé avec le pilote des scènes. */
export const LOOK_AHEAD_SECONDS = 0.5;
/** Avant d'attraper, le robot regarde ce temps de balancement sous la prise, contre ce qui bouge (la coque d'un carrousel). */
export const CATCH_LOOK_SECONDS = 1.5;
/** Avant de lâcher, le robot regarde ce qui bouge plus loin que les solides : une coque qui arrive se voit venir. */
export const MOVING_LOOK_AHEAD_SECONDS = 1.2;

/** Sous un mur à ouverture mobile, le robot attend que le trou passe, jamais plus longtemps que ceci (secondes) : la brume monte. */
export const LAUNCH_WAIT_MAX_SECONDS = 6;
/** Sur une roue, le robot ne lâche qu'une fois le moteur presque à sa vitesse, et presque à la verticale vers le haut : c'est là que la roue porte (10 m plus haut). Il y reste jusqu'à ce moment, au plus `WHEEL_HOLD_MAX_SECONDS`. */
export const WHEEL_READY_RATIO = 0.95;
const WHEEL_UP_RATIO = 0.5;
const WHEEL_HOLD_MAX_SECONDS = 8;
/** Sur un aimant, le robot lâche dès que le vol attrape une prise au-dessus de lui, et jamais plus de ce temps attiré. Sur un lien élastique, dès qu'il remonte et que le vol attrape. Partagés avec le pilote des scènes. */
export const MAGNET_HOLD_MAX_SECONDS = 4;
export const ELASTIC_HOLD_MAX_SECONDS = 7;
/** Sur une prise de carrousel, le robot se laisse porter jusqu'à un tour entier (`CAROUSEL_PERIOD`) : la sortie passe une fois par tour. */
export const ORBIT_HOLD_MAX_SECONDS = 9;
/** Un lien élastique ne vaut que pris en passant vite (sa puissance vient du mouvement d'arrivée) : sous cette vitesse, le robot le laisse, s'il a autre chose à portée. */
export const ELASTIC_CATCH_SPEED = 6;

/** Vrai si le vol `body` ne heurte, pendant `seconds`, aucun obstacle qui bouge (tournant, panneau qui glisse), regardé là où il sera à chaque pas. */
function clearOfMoving(state: SimState, body: Body, seconds: number, tuning: Tuning): boolean {
  const moving = state.obstacles.filter((box) => !box.broken && isMoving(box));
  if (moving.length === 0) return true;
  const flight = startFlight(body);
  const steps = Math.round(seconds / tuning.stepSeconds);
  for (let k = 0; k < steps; k += 1) {
    flightStep(flight, [], state.rings, state.zones, tuning, state.env);
    if (moving.some((box) => obstacleGap(flight.body.pos, tuning.heroRadius, box, state.step + k + 1, tuning) <= 0)) return false;
  }
  return true;
}

/**
 * Vrai si, attrapé maintenant, le balancement sous `target` pendant `seconds` ne
 * rencontre aucun obstacle qui bouge, regardé là où il sera : la coque d'un
 * carrousel balaie ce qui pend trop long sous sa couronne, on attrape quand
 * elle est passée. Partagé avec le pilote des scènes.
 */
export function catchIsClearOfMoving(state: SimState, target: Anchor, seconds: number, tuning: Tuning): boolean {
  const moving = state.obstacles.filter((box) => !box.broken && isMoving(box));
  if (moving.length === 0) return true;
  let ropeLength = Math.max(tuning.ropeMin, Math.min(tuning.ropeMax * tuning.coyoteReach, Math.hypot(target.pos.x - state.hero.pos.x, target.pos.y - state.hero.pos.y)));
  let body: Body = { pos: state.hero.pos, vel: constrainVelocity(state.hero.pos, state.hero.vel, target.pos, ropeLength) };
  const steps = Math.round(seconds / tuning.stepSeconds);
  for (let k = 0; k < steps; k += 1) {
    const swung = swingStep(body, target.pos, ropeLength, tuning, state.env, state.zones, target.motor ?? null);
    body = swung.body;
    ropeLength = swung.ropeLength;
    if (moving.some((box) => obstacleGap(body.pos, tuning.heroRadius, box, state.step + k + 1, tuning) <= 0)) return false;
  }
  return true;
}

/** Vrai si un tir de traction `pull` depuis le lanceur (ou le rail) tenu ne heurte, pendant le vol que le vérificateur regarde, aucun obstacle qui bouge : sous un mur à ouverture mobile, c'est le moment de tirer. Partagé avec le pilote des scènes. */
export function launchIsClear(state: SimState, pull: Vec2, tuning: Tuning): boolean {
  const launcher = state.rope ? state.anchors.find((a) => a.id === state.rope?.anchorId) : undefined;
  if (!launcher) return true;
  if (launcher.kind === 'rail' && launcher.rail) {
    const t = railParam(pull);
    return clearOfMoving(state, { pos: railPoint(launcher.pos, launcher.rail, t), vel: railVelocity(launcher.rail, t) }, tuning.verifyFlightSeconds, tuning);
  }
  return clearOfMoving(state, { pos: pulledPosition(launcher.pos, pull), vel: launchVelocity(pull, state.env) }, tuning.verifyFlightSeconds, tuning);
}

/** Avant de lâcher, le robot regarde aussi si le vol sort du monde dans ce temps (secondes) : un lâcher vers le bord, c'est une chute. Le temps pendant lequel, après un lâcher, il ne rattrape rien plus bas. */
export const EDGE_AHEAD_SECONDS = 1.5;
/** En vol, un robot qui file vers le bord du monde (là où il sera dans ce temps) attrape tout ce qui vient, même plus bas. Une seconde : à 7 m/s, une demi-seconde ne laissait plus rien à portée. */
export const EDGE_SOON_SECONDS = 1;
/** Le robot n'examine le vol d'un lâcher (`flightCatches`) qu'un pas sur ce nombre. */
export const RELEASE_EVERY = 4;
/** Le bord du monde se tient à cette marge en deçà de sa demi-largeur. */
export const EDGE_MARGIN = 1;

/** Vrai si le vol qui suivrait un lâcher maintenant ne heurte rien pendant `LOOK_AHEAD_SECONDS` (rebonds, fracas et anneaux joués), ni ne sort du monde pendant `EDGE_AHEAD_SECONDS`. */
function releaseIsClear(state: SimState, tuning: Tuning): boolean {
  const vel = releaseVelocity(state, tuning);
  const flight = startFlight({ pos: state.hero.pos, vel });
  const obstacles = provableObstacles(state.obstacles);
  // Ce qui bouge (tournants, panneaux qui glissent) n'est pas dans la preuve : le robot le regarde là où il sera, pas à pas.
  const moving = state.obstacles.filter((box) => !box.broken && isMoving(box));
  const steps = Math.round(LOOK_AHEAD_SECONDS / tuning.stepSeconds);
  const movingSteps = moving.length > 0 ? Math.round(MOVING_LOOK_AHEAD_SECONDS / tuning.stepSeconds) : 0;
  for (let k = 0; k < Math.max(steps, movingSteps); k += 1) {
    flightStep(flight, obstacles, state.rings, state.zones, tuning, state.env);
    if (flight.ended) return k < steps ? false : true;
    if (k < movingSteps && moving.some((box) => obstacleGap(flight.body.pos, tuning.heroRadius, box, state.step + k + 1, tuning) <= 0)) return false;
  }
  // Un vol qui file vers le bord du monde (propulseur de côté, par exemple) : on garde la corde.
  const edgeX = state.hero.pos.x + vel.x * EDGE_AHEAD_SECONDS;
  return Math.abs(edgeX) < WORLD_HALF_WIDTH - EDGE_MARGIN;
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
  /**
   * Après un lancer (lanceur, roue), on ne rattrape rien sous le point lâché pendant un moment, même en retombant : on monte. Après un
   * lâcher ordinaire, rien sous le point lâché tant que l'on monte encore (le lâcher n'est parti que parce qu'un vol attrape plus haut,
   * voir `catches`) ; en retombant, on attrape ce qui vient. Sans cela, le robot fait du surplace entre des prises voisines (les deux
   * bandes d'un accordéon, un lanceur sous la prise qu'il a attrapée) au lieu de viser plus haut.
   */
  let launchedStep = -1_000_000;
  let launchedPos: Vec2 | null = null;
  let launched = false;
  const launchWaitSteps = Math.round(1.5 / tuning.stepSeconds);
  /** « Plus haut » et « monter » s'entendent à l'opposé de la gravité du moment : sous un serpentin ou une bascule, le monde penche. */
  const rise = (from: Vec2, to: Vec2): number => {
    const up = upOf(sim.state.env);
    return (to.x - from.x) * up.x + (to.y - from.y) * up.y;
  };
  /** Sur un lanceur, le robot prend le temps de bander la fronde : le personnage doit d'abord être tiré jusqu'au lanceur, et un pouce ne vise pas en moins d'un tiers de seconde. */
  const aimSteps = Math.max(reactionSteps, Math.round(LAUNCH_AIM_SECONDS / tuning.stepSeconds));
  const limit = Math.round(seconds / tuning.stepSeconds);
  while (sim.state.status === 'alive' && sim.state.step < limit) {
    const s = sim.state;
    if (!s.rope) {
      const target = s.targetId === null ? null : s.anchors.find((a) => a.id === s.targetId);
      const launchedRecently = s.step - launchedStep <= launchWaitSteps;
      const aboveLaunch = target !== null && target !== undefined && launchedPos !== null && rise(launchedPos, target.pos) > 1;
      const risingStill = rise({ x: 0, y: 0 }, s.hero.vel) > 0;
      const edgeSoon = Math.abs(s.hero.pos.x + s.hero.vel.x * EDGE_SOON_SECONDS) > WORLD_HALF_WIDTH - EDGE_MARGIN;
      const climbing = launched ? !launchedRecently || aboveLaunch : !(launchedRecently && !aboveLaunch && risingStill && !edgeSoon);
      // Porté vers le haut par une zone (un courant, une fusée), le robot ne rattrape pas un point sous lui : il monte d'abord, comme un
      // joueur. Hors zone, il attrape ce qu'il vise : refuser un point plus bas en plein vol rapide, c'est finir hors du monde.
      const ahead = (seconds: number): boolean => zoneAt(s.zones, { x: s.hero.pos.x + s.hero.vel.x * seconds, y: s.hero.pos.y + s.hero.vel.y * seconds }) !== null;
      const towardsZone = ahead(0) || ahead(ZONE_AHEAD_SECONDS / 2) || ahead(ZONE_AHEAD_SECONDS);
      const rising = towardsZone && s.hero.vel.y > RISING_SPEED && target !== null && target !== undefined && target.pos.y < s.hero.pos.y - RISING_BELOW;
      // Attraper ici mènerait-il dans un mur ? Saisi de loin, corde molle, le vol continue tout droit : le robot regarde le balancement
      // qui suivrait, comme le vérificateur, et attend un meilleur moment si un autre point est à portée ; mais un choc vaut mieux
      // qu'une sortie du monde : s'il tombe, ou si ce point est le dernier à portée, il attrape quand même.
      const others = target ? s.anchors.filter((a) => a.id !== target.id && !a.broken && Math.hypot(a.pos.x - s.hero.pos.x, a.pos.y - s.hero.pos.y) <= tuning.ropeMax).length : 0;
      const safe = target !== null && target !== undefined && (s.hero.vel.y < 0 || others === 0 || (swingIsClear(target, { pos: s.hero.pos, vel: s.hero.vel }, s.anchors, provableObstacles(s.obstacles), tuning, s.env, s.zones) && catchIsClearOfMoving(s, target, CATCH_LOOK_SECONDS, tuning)));
      const slowForElastic = target?.kind === 'elastique' && others > 0 && Math.hypot(s.hero.vel.x, s.hero.vel.y) < ELASTIC_CATCH_SPEED;
      if (target && climbing && !rising && safe && !slowForElastic && plannedPress < 0) plannedPress = s.step + reactionSteps;
      if (plannedPress >= 0 && s.step >= plannedPress) {
        plannedPress = -1;
        if (sim.press()) {
          catches += 1;
          attachStep = s.step;
        }
      }
    } else if (['lanceur', 'rail'].includes(s.anchors.find((a) => a.id === s.rope?.anchorId)?.kind ?? '')) {
      // Sur un lanceur : après son temps de réaction, le robot tire la traction que le vérificateur a prouvée (voir `pilot.ts`) ;
      // sans sortie prouvée, il vise le point le plus proche au-dessus et tire à l'opposé, aux deux tiers. Sur un rail, de même :
      // la position de l'arc prouvée, sinon le milieu.
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
        const proven = launcher.kind === 'rail' ? bestRail(s, tuning) : bestLaunch(s, tuning);
        const pull = proven ?? (launcher.kind === 'rail' ? railPull(0.5) : { x: (-dir.x / len) * PULL_MAX * 0.7, y: (-dir.y / len) * PULL_MAX * 0.7 });
        // Sous un mur dont le trou va et vient, le robot regarde où sera le trou pendant son tir, et attend qu'il passe (jamais trop longtemps).
        // Sur un lanceur qui bouge (une plateforme de convoyeur), il attend de même qu'un tir prouvé existe d'où il est, un pas sur quatre.
        const waited = (s.step - attachStep) * tuning.stepSeconds;
        if (waited < LAUNCH_WAIT_MAX_SECONDS && !launchIsClear(s, pull, tuning)) {
          plannedRelease = s.step + 1;
        } else if (waited < LAUNCH_WAIT_MAX_SECONDS && !proven && launcher.cable) {
          plannedRelease = s.step + RELEASE_EVERY;
        } else {
          sim.release(pull);
          launchedStep = s.step;
          launchedPos = launcher.pos;
          launched = true;
        }
      }
    } else if (s.step - attachStep > 10) {
      const held = (s.step - attachStep) * tuning.stepSeconds;
      const speed = Math.hypot(s.hero.vel.x, s.hero.vel.y);
      // Sur une roue, il faut la vitesse du moteur et partir presque droit vers le haut : le robot fait le tour et lâche à ce moment-là.
      const held_ = s.anchors.find((a) => a.id === s.rope?.anchorId);
      const onWheel = held_?.kind === 'roue';
      const onMagnet = held_?.kind === 'aimant';
      const onElastic = held_?.kind === 'elastique';
      // Sur une prise de carrousel, le robot se laisse porter : il ne lâche que pour une prise hors de la couronne (la sortie), jamais
      // pour une autre prise de la couronne, plus haute un instant, qui le ferait tourner en rond.
      const onOrbit = held_?.orbit !== undefined;
      // Sur une prise interrupteur dont un panneau s'ouvre encore, il tient : on voit la structure se déplier avant de s'y engager.
      const unfolding = held_?.kind === 'interrupteur' && s.obstacles.some((box) => box.switchedBy === held_.id && box.hinge !== undefined && (box.hingeProgress ?? 0) < 1);
      const risingNow = rise({ x: 0, y: 0 }, s.hero.vel) > 0;
      const ready = onWheel ? speed >= tuning.wheelSpeed * WHEEL_READY_RATIO : onMagnet || onElastic ? risingNow : onOrbit ? true : speed >= profile.speedTarget || s.rope.length <= tuning.ropeMin + 1e-9;
      const ax = Math.abs(s.hero.vel.x);
      const slope = ax > 0 ? s.hero.vel.y / ax : Infinity;
      // Sur une roue ou un aimant, le robot lâche au premier instant où le vol qui suivrait attrape un point au-dessus de la prise (ce que le vérificateur a prouvé).
      const exitsOrbit = (id: number): boolean => !onOrbit || s.anchors.find((a) => a.id === id)?.orbit === undefined;
      const catchesAbove = (): boolean => held_ !== undefined && flightCatches(held_, { pos: s.hero.pos, vel: s.hero.vel }, s.anchors, s.obstacles, tuning, s.env, s.zones, s.rings).some((id) => exitsOrbit(id) && (s.anchors.find((a) => a.id === id)?.pos.y ?? -Infinity) > held_.pos.y + 1);
      const inWindow = onWheel
        ? s.hero.vel.y >= tuning.wheelSpeed * WHEEL_UP_RATIO && catchesAbove()
        : onMagnet || onElastic || onOrbit
          ? s.step % RELEASE_EVERY === 0 && catchesAbove()
          : s.hero.vel.y > 1 && slope > profile.minSlope && slope < profile.maxSlope;
      const maxHold = onWheel ? WHEEL_HOLD_MAX_SECONDS : onMagnet ? MAGNET_HOLD_MAX_SECONDS : onElastic ? ELASTIC_HOLD_MAX_SECONDS : onOrbit ? ORBIT_HOLD_MAX_SECONDS : profile.maxHoldSeconds;
      const wants = !unfolding && ((ready && inWindow) || held > maxHold);
      // Un lâcher droit dans un mur n'est pas un lâcher, ni un lâcher dont le vol n'attrape rien au-dessus (ce que le vérificateur regarde,
      // `flightCatches`) : le robot attend le prochain moment, sauf s'il pend depuis trop longtemps.
      // Le vol se regarde tous les `RELEASE_EVERY` pas, comme le vérificateur : il coûte cher.
      // Un vol qui n'attrape rien de plus d'un mètre au-dessus de la prise tenue ne vaut pas un lâcher : lâché, le robot refuse de
      // rattraper plus bas tant qu'il monte (voir `climbing`), et il filait hors du monde faute de point.
      const catches = (): boolean => onWheel || held_ === undefined || flightCatches(held_, { pos: s.hero.pos, vel: releaseVelocity(s, tuning) }, s.anchors, s.obstacles, tuning, s.env, s.zones, s.rings).some((id) => exitsOrbit(id) && (s.anchors.find((a) => a.id === id)?.pos.y ?? -Infinity) > held_.pos.y + 1);
      // Pendu depuis trop longtemps, le robot lâche sans rien attraper, mais jamais droit dans ce qui bouge (la coque d'un carrousel qui
      // passe) tant qu'il reste un peu de patience ; passé le double, il lâche quoi qu'il arrive.
      const overdue = held > 2 * profile.maxHoldSeconds && (held > 4 * profile.maxHoldSeconds || releaseIsClear(s, tuning));
      if (wants && plannedRelease < 0 && (overdue || (s.step % RELEASE_EVERY === 0 && releaseIsClear(s, tuning) && catches()))) plannedRelease = s.step + reactionSteps;
      if (plannedRelease >= 0 && s.step >= plannedRelease) {
        plannedRelease = -1;
        sim.release();
        holdTotal += held;
        // Lancé par une roue ou un aimant, comme par un lanceur, ou simplement lâché : le robot ne rattrape rien sous le point pendant un moment, il monte.
        launchedStep = s.step;
        launchedPos = held_ ? { ...held_.pos } : null;
        launched = onWheel || onMagnet;
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

import { clampLength, distance, type Vec2 } from '../core/math/vec2';
import { STILL, type Environment } from './environment';
import { circleBoxGap } from './geometry';
import { obstacleKind } from './obstacles';
import { integrate, type Body } from './physics';
import type { Obstacle, Ring, Zone } from './state';
import type { Tuning } from './tuning';

/**
 * Le vol libre joué pas à pas avec ce qu'il rencontre : une surface de rebond
 * le renvoie, une paroi cassable cède s'il arrive assez vite (sinon il
 * s'arrête), un anneau traversé au centre l'accélère, une zone le pousse. Les
 * mêmes règles que la simulation (`rules.ts` les partage), pour que le
 * vérificateur puisse EXIGER ces mécaniques : un passage n'est prouvé qu'avec
 * le rebond, le fracas ou l'anneau qu'il demande. Retour du propriétaire
 * (0.12.1) : « les cassables ne servent à rien en l'état, il faut que ça
 * rajoute de la difficulté ». Pur, déterministe, quatre opérations.
 */

/** Surface de rebond : presque toute la vitesse rendue, presque rien de perdu le long de la surface. */
export const BOUNCE_RESTITUTION = 0.9;
export const BOUNCE_FRICTION = 0.95;
/** Part de la vitesse gardée en traversant une paroi cassable. */
export const SMASH_KEEP = 0.8;
/** Un anneau est traversé « au centre » si le passage s'approche à cette part de son rayon. */
export const RING_CENTRE_RATIO = 0.4;

/** La vitesse après un contact de normale `n` : la part vers la surface rendue à `restitution`, la part le long gardée à `friction`. */
export function reflected(vel: Vec2, n: Vec2, restitution: number, friction: number): Vec2 {
  const along = vel.x * n.x + vel.y * n.y;
  const tangent = { x: vel.x - along * n.x, y: vel.y - along * n.y };
  const bounced = along < 0 ? -along * restitution : Math.max(0, along);
  return { x: tangent.x * friction + n.x * bounced, y: tangent.y * friction + n.y * bounced };
}

/**
 * Sort un cercle de la boîte qu'il touche, par le chemin le plus court, et
 * rend sa position corrigée et la normale du contact (de la boîte vers lui).
 */
export function pushOut(pos: Vec2, radius: number, box: Obstacle): { pos: Vec2; n: Vec2 } {
  const nearest = { x: Math.min(box.x1, Math.max(box.x0, pos.x)), y: Math.min(box.y1, Math.max(box.y0, pos.y)) };
  let n = { x: pos.x - nearest.x, y: pos.y - nearest.y };
  const len = Math.hypot(n.x, n.y);
  if (len > 1e-9) n = { x: n.x / len, y: n.y / len };
  else {
    // Le centre est dans la boîte : on sort par la face la plus proche.
    const faces = [
      { d: pos.x - box.x0, n: { x: -1, y: 0 } },
      { d: box.x1 - pos.x, n: { x: 1, y: 0 } },
      { d: pos.y - box.y0, n: { x: 0, y: -1 } },
      { d: box.y1 - pos.y, n: { x: 0, y: 1 } },
    ];
    n = faces.reduce((best, face) => (face.d < best.d ? face : best)).n;
  }
  const depth = radius - len;
  return { pos: { x: pos.x + n.x * (depth + 1e-3), y: pos.y + n.y * (depth + 1e-3) }, n };
}

/** La vitesse après un anneau traversé : un coup d'accélération, sous le plafond de vitesse. */
export function ringBoosted(vel: Vec2, tuning: Tuning): Vec2 {
  return clampLength({ x: vel.x * tuning.ringBoost, y: vel.y * tuning.ringBoost }, tuning.maxSpeed);
}

/** Un vol en cours : le corps, les parois cassées et les anneaux déjà pris pendant ce vol, et où l'on en est de chaque anneau traversé. */
export interface Flight {
  body: Body;
  /** Parois cassées pendant ce vol : traversées, elles ne sont plus là. */
  readonly smashed: Set<number>;
  /** Anneaux pris pendant ce vol. */
  readonly rings: Set<number>;
  /** Pour chaque anneau dont on traverse le disque, la distance la plus courte au centre. */
  readonly closest: Map<number, number>;
  /** Le vol a heurté un obstacle qui l'arrête. */
  ended: boolean;
}

export function startFlight(body: Body): Flight {
  return { body, smashed: new Set(), rings: new Set(), closest: new Map(), ended: false };
}

/** Un pas de vol libre avec ses rencontres ; les portes ne sont pas dans `obstacles` (voir `provableObstacles`). */
export function flightStep(flight: Flight, obstacles: readonly Obstacle[], rings: readonly Ring[], zones: readonly Zone[], tuning: Tuning, env: Environment = STILL): Flight {
  if (flight.ended) return flight;
  let body = integrate(flight.body, null, 0, tuning, env, zones);
  for (const box of obstacles) {
    if (box.broken || flight.smashed.has(box.id)) continue;
    if (circleBoxGap(body.pos, tuning.heroRadius, box) > 0) continue;
    const kind = obstacleKind(box);
    if (kind === 'rebond') {
      const out = pushOut(body.pos, tuning.heroRadius, box);
      body = { pos: out.pos, vel: reflected(body.vel, out.n, BOUNCE_RESTITUTION, BOUNCE_FRICTION) };
      continue;
    }
    if (kind === 'cassable' && Math.hypot(body.vel.x, body.vel.y) >= tuning.smashSpeed) {
      flight.smashed.add(box.id);
      body = { pos: body.pos, vel: { x: body.vel.x * SMASH_KEEP, y: body.vel.y * SMASH_KEEP } };
      continue;
    }
    flight.ended = true;
    flight.body = body;
    return flight;
  }
  for (const ring of rings) {
    if (ring.taken || flight.rings.has(ring.id)) continue;
    const d = distance(ring.pos, body.pos);
    const inside = flight.closest.get(ring.id);
    if (d <= ring.radius) {
      flight.closest.set(ring.id, inside === undefined || d < inside ? d : inside);
      continue;
    }
    if (inside === undefined) continue;
    flight.closest.delete(ring.id);
    flight.rings.add(ring.id);
    // Tout anneau traversé accélère ; le centre, lui, rapporte davantage (voir `rules.ts`).
    body = { pos: body.pos, vel: ringBoosted(body.vel, tuning) };
  }
  flight.body = body;
  return flight;
}

/** Vrai si ce vol doit se jouer pas à pas : des zones, des surfaces de rebond, des parois cassables ou des anneaux sont là. */
export function needsSteps(obstacles: readonly Obstacle[], rings: readonly Ring[], zones: readonly Zone[]): boolean {
  if (zones.length > 0 || rings.some((ring) => !ring.taken)) return true;
  return obstacles.some((box) => !box.broken && obstacleKind(box) !== 'solide');
}


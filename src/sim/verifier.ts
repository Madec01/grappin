import { clampLength, distance, scale } from '../core/math/vec2';
import { bestAnchor } from './aim';
import { STILL, upOf, type Environment } from './environment';
import { circleBoxGap } from './geometry';
import type { Segment } from './generator';
import { constrainVelocity, freeFlightAt, swingStep, type Body } from './physics';
import { kickIfSlow } from './rules';
import type { Anchor, Obstacle, RuleEvent } from './state';
import type { Tuning } from './tuning';

/**
 * Robot vérificateur : avant qu'un segment soit affiché, il joue chaque point
 * avec la vraie physique et s'assure qu'il existe toujours un instant de
 * lâcher qui mène plus haut. Un segment où un point n'a aucune sortie est
 * rejeté et régénéré. Un verdict « franchissable » est une preuve : la tenue
 * et le vol qui réussissent sont ceux que le joueur peut reproduire.
 *
 * Hypothèses, volontairement sévères : le joueur arrive sous le point avec le
 * seul élan de l'impulsion de départ, à trois mètres de corde, un peu à gauche
 * ou un peu à droite ; il tient au plus `verifyHoldSeconds` (moins pour une
 * accroche fragile) ; une accroche compte si elle est à `verifyCatchRatio` de
 * la portée et si c'est bien elle que la visée choisirait. Toucher un
 * obstacle, en vol ou en balancement, invalide la tentative. Les conditions
 * physiques d'un événement, gravité tournée ou vent, sont celles de la
 * vérification : un segment sous la bascule est prouvé avec la gravité de la
 * bascule. Un point sur câble est vérifié à sa position de départ, le milieu
 * du câble.
 */

const ENTRY_ROPE = 3;
const ENTRY_OFFSETS = [-0.5, 0.5] as const;
/**
 * Deux profils d'arrivée. Le pire cas, avec la seule impulsion de départ,
 * garantit qu'il existe toujours un chemin vers le haut. L'arrivée typique,
 * à la vitesse d'un vol ordinaire, sert aux branches exigées d'une fourche :
 * la route haute est un choix optionnel, il suffit qu'elle soit atteignable
 * par un joueur qui arrive avec de l'élan.
 */
const TYPICAL_ENTRY_SPEED = 6;
/** On examine un lâcher tous les `RELEASE_EVERY` pas de tenue, et le vol tous les `FLIGHT_SAMPLE` secondes. */
const RELEASE_EVERY = 4;
const FLIGHT_SAMPLE = 0.05;
/** Un successeur doit être au moins à cette hauteur au-dessus du point quitté. */
const MIN_GAIN = 0.3;
/** Après l'accroche, le balancement est suivi ce temps pour s'assurer qu'il ne heurte rien. */
const AFTER_CATCH_SECONDS = 0.6;

interface Swing {
  body: Body;
  ropeLength: number;
}

/** État d'arrivée : pendu sous le point, décalé d'un côté, lancé à `speed` le long du cercle vers le prochain point. */
function entryState(anchor: Anchor, offset: number, speed: number, anchors: readonly Anchor[], tuning: Tuning, env: Environment): Swing {
  // Pendu « sous » le point au sens de la gravité du moment, décalé perpendiculairement.
  const up = upOf(env);
  const pos = { x: anchor.pos.x - up.x * ENTRY_ROPE - up.y * offset, y: anchor.pos.y - up.y * ENTRY_ROPE + up.x * offset };
  const ropeLength = distance(pos, anchor.pos);
  const context = {
    hero: { pos, vel: { x: 0, y: 0 }, grounded: false },
    rope: { anchorId: anchor.id, length: ropeLength },
    anchors: [...anchors],
  };
  // L'impulsion oriente la vitesse vers le prochain point ; on lui demande la vitesse voulue.
  kickIfSlow(context, { ...tuning, kickSpeed: speed, minSwingSpeed: speed + 1 }, [] as RuleEvent[]);
  return { body: { pos: context.hero.pos, vel: context.hero.vel }, ropeLength };
}

/** Une fois accroché à `anchor` depuis `body`, le balancement qui suit évite-t-il les obstacles ? */
function swingIsClear(anchor: Anchor, body: Body, anchors: readonly Anchor[], obstacles: readonly Obstacle[], tuning: Tuning, env: Environment): boolean {
  const ropeLength = Math.max(tuning.ropeMin, distance(body.pos, anchor.pos));
  const context = {
    hero: { pos: body.pos, vel: constrainVelocity(body.pos, body.vel, anchor.pos, ropeLength), grounded: false },
    rope: { anchorId: anchor.id, length: ropeLength },
    anchors: [...anchors],
  };
  kickIfSlow(context, tuning, [] as RuleEvent[]);
  let swing: Swing = { body: { pos: context.hero.pos, vel: context.hero.vel }, ropeLength };
  const steps = Math.round(AFTER_CATCH_SECONDS / tuning.stepSeconds);
  for (let k = 0; k < steps; k += 1) {
    swing = swingStep(swing.body, anchor.pos, swing.ropeLength, tuning, env);
    if (obstacles.some((box) => circleBoxGap(swing.body.pos, tuning.heroRadius, box) <= 0)) return false;
  }
  return true;
}

/**
 * Quels points plus hauts que `from` le vol libre depuis `body` permet-il
 * d'attraper ? Le point visé change au fil du vol, et le joueur choisit aussi
 * sa branche par le moment où il tape : on relève donc, à chaque instant du
 * vol, le point que la visée choisirait, et l'on garde ceux qui sont à portée,
 * en ligne de vue, et dont le balancement qui suit ne heurte aucun obstacle.
 * Le vol s'arrête au premier obstacle touché.
 */
export function flightCatches(from: Anchor, body: Body, anchors: readonly Anchor[], obstacles: readonly Obstacle[], tuning: Tuning, env: Environment = STILL): number[] {
  const reach = tuning.ropeMax * tuning.verifyCatchRatio;
  const caught: number[] = [];
  const rejected = new Set<number>();
  const a = { x: env.gravityDir.x * tuning.gravity + env.wind.x, y: env.gravityDir.y * tuning.gravity + env.wind.y };
  for (let t = FLIGHT_SAMPLE; t <= tuning.verifyFlightSeconds + 1e-9; t += FLIGHT_SAMPLE) {
    const pos = freeFlightAt(body, t, tuning, env);
    if (obstacles.some((box) => circleBoxGap(pos, tuning.heroRadius, box) <= 0)) break;
    const vel = { x: body.vel.x + a.x * t, y: body.vel.y + a.y * t };
    const best = bestAnchor(anchors, obstacles, { pos, vel }, false, from.id, tuning, env);
    if (!best || caught.includes(best.id) || rejected.has(best.id)) continue;
    if (best.pos.y <= from.pos.y + MIN_GAIN || distance(best.pos, pos) > reach) continue;
    if (swingIsClear(best, { pos, vel }, anchors, obstacles, tuning, env)) caught.push(best.id);
    else rejected.add(best.id);
  }
  return caught;
}

/**
 * Tient la corde depuis l'état d'arrivée et essaie de lâcher régulièrement.
 * Renvoie vrai dès qu'une sortie valable est trouvée (ou toutes les sorties
 * exigées, pour une fourche). `reached` accumule les points atteints.
 */
function holdAndRelease(
  from: Anchor,
  start: Swing,
  anchors: readonly Anchor[],
  obstacles: readonly Obstacle[],
  required: readonly number[] | null,
  reached: Set<number>,
  tuning: Tuning,
  env: Environment,
): boolean {
  const holdSeconds = from.kind === 'fragile' ? Math.min(tuning.verifyHoldSeconds, tuning.fragileSeconds - 2 * tuning.stepSeconds) : tuning.verifyHoldSeconds;
  const maxSteps = Math.round(holdSeconds / tuning.stepSeconds);
  const satisfied = (): boolean => (required ? required.every((id) => reached.has(id)) : reached.size > 0);
  let swing = start;
  for (let k = 0; k <= maxSteps; k += 1) {
    if (k % RELEASE_EVERY === 0) {
      const vel = from.kind === 'booster' ? clampLength(scale(swing.body.vel, tuning.boostFactor), tuning.maxSpeed) : swing.body.vel;
      for (const id of flightCatches(from, { pos: swing.body.pos, vel }, anchors, obstacles, tuning, env)) reached.add(id);
      if (satisfied()) return true;
    }
    if (obstacles.some((box) => circleBoxGap(swing.body.pos, tuning.heroRadius, box) <= 0)) break;
    swing = swingStep(swing.body, from.pos, swing.ropeLength, tuning, env);
  }
  return satisfied();
}

/**
 * Depuis `from`, y a-t-il toujours une sortie vers le haut au pire cas, et,
 * pour une fourche, chaque branche exigée est-elle atteignable avec un élan
 * typique ? Chaque décalage d'arrivée doit réussir.
 */
export function canExit(from: Anchor, anchors: readonly Anchor[], obstacles: readonly Obstacle[], required: readonly number[] | null, tuning: Tuning, env: Environment = STILL): boolean {
  for (const offset of ENTRY_OFFSETS) {
    const worst = entryState(from, offset, tuning.kickSpeed, anchors, tuning, env);
    if (!holdAndRelease(from, worst, anchors, obstacles, null, new Set(), tuning, env)) return false;
  }
  if (!required) return true;
  for (const offset of ENTRY_OFFSETS) {
    const typical = entryState(from, offset, TYPICAL_ENTRY_SPEED, anchors, tuning, env);
    if (!holdAndRelease(from, typical, anchors, obstacles, required, new Set(), tuning, env)) return false;
  }
  return true;
}

/**
 * Vérifie un segment dans son contexte : `context` contient les derniers
 * points du parcours déjà accepté, dont le point d'entrée en dernier, et
 * `contextObstacles` les obstacles encore proches. Le dernier point du
 * segment n'est pas vérifié ici : il le sera comme entrée du segment suivant.
 */
export function verifySegment(
  context: readonly Anchor[],
  contextObstacles: readonly Obstacle[],
  segment: Segment,
  tuning: Tuning,
  env: Environment = STILL,
  entryEnv: Environment = env,
): boolean {
  const anchors = [...context, ...segment.anchors];
  const obstacles = [...contextObstacles, ...segment.obstacles];
  const entry = context.at(-1);
  // Le point d'entrée appartient au segment précédent : il se joue dans ses propres conditions.
  if (entry && !canExit(entry, anchors, obstacles, null, tuning, entryEnv)) return false;
  for (const anchor of segment.anchors.slice(0, -1)) {
    const required = anchor.id === segment.junctionId ? segment.branchIds : null;
    if (!canExit(anchor, anchors, obstacles, required, tuning, env)) return false;
  }
  return true;
}

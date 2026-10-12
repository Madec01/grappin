import { clampLength, distance, scale, type Vec2 } from '../core/math/vec2';
import { isOptional } from './cycles';
import { LANCEUR_CLEARANCE, launchSet, launchVelocity, pulledPosition } from './launcher';
import { ELASTIC_ENTRY_ABOVE, ELASTIC_ENTRY_SPEED, ELASTIC_HOLD_SECONDS, MAGNET_HOLD_SECONDS, RAIL_CLEARANCE, elasticStep, magnetStep, railPoint, railSet, railVelocity } from './holds';
import { bestAnchor } from './aim';
import { STILL, upOf, type Environment } from './environment';
import { circleBoxGap } from './geometry';
import type { Segment } from './generator';
import { provableObstacles } from './obstacles';
import { flightStep, needsSteps, startFlight } from './flight';
import { NO_ZONES, constrainVelocity, flightSamples, swingStep, type Body } from './physics';
import { kickIfSlow } from './rules';
import type { Anchor, Obstacle, Ring, RuleEvent, Zone } from './state';
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
 * du câble. Les obstacles se prouvent par `provableObstacles` : les portes ne
 * comptent pas (on les attend ouvertes) ni les parois cassées, les surfaces de
 * rebond et les parois cassables sont tenues pour solides. Les zones (courants,
 * couloir d'accélération, freinage) sont jouées dans les vols et les
 * balancements : un segment sous un courant est prouvé avec le courant. Et
 * depuis 0.12.1, les vols jouent aussi les rencontres (`flight.ts`) : une
 * surface de rebond renvoie, une paroi cassable cède si l'on va assez vite, un
 * anneau pris au centre accélère ; le générateur peut donc EXIGER une de ces
 * mécaniques, le vérificateur ne prouve le passage qu'avec elle. Lot 5 : un
 * aimant tenu attire (`magnetStep`), un lien élastique rappelle
 * (`elasticStep`, l'arrivée supposée est une chute depuis le côté), un rail se
 * prouve comme un lanceur, par ses positions (`railSet`) ; une porte commandée
 * par un interrupteur ne compte pas, comme une porte à cycle : on la commande.
 */
const NO_RINGS: readonly Ring[] = [];

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

/** Un pas de tenue selon l'espèce de la prise : balancement à la corde, attraction d'un aimant, rappel d'un lien élastique. */
function holdStep(from: Anchor, swing: Swing, tuning: Tuning, env: Environment, zones: readonly Zone[]): Swing {
  if (from.kind === 'aimant') return { body: magnetStep(swing.body, from.pos, tuning, env, zones), ropeLength: swing.ropeLength };
  if (from.kind === 'elastique') return { body: elasticStep(swing.body, from.pos, swing.ropeLength, tuning, env, zones), ropeLength: swing.ropeLength };
  return swingStep(swing.body, from.pos, swing.ropeLength, tuning, env, zones, from.motor ?? null);
}

/** Temps de tenue que le vérificateur examine depuis une prise : moins sur une fragile (elle casse), le sien pour un aimant ou un lien élastique. */
function holdSecondsOf(from: Anchor, tuning: Tuning): number {
  if (from.kind === 'fragile') return Math.min(tuning.verifyHoldSeconds, tuning.fragileSeconds - 2 * tuning.stepSeconds);
  if (from.kind === 'aimant') return MAGNET_HOLD_SECONDS;
  if (from.kind === 'elastique') return ELASTIC_HOLD_SECONDS;
  return tuning.verifyHoldSeconds;
}

/**
 * État d'arrivée : pendu sous le point, décalé d'un côté, lancé à `speed` le
 * long du cercle vers le prochain point. Sur un lien élastique, l'arrivée est
 * une chute : au-dessus de la prise, un peu de côté, la vitesse vers le bas, le
 * lien à sa longueur de repos ; on tombe au-delà, il s'étire et rappelle.
 */
function entryState(anchor: Anchor, offset: number, speed: number, anchors: readonly Anchor[], tuning: Tuning, env: Environment): Swing {
  const up = upOf(env);
  if (anchor.kind === 'elastique') {
    const pos = { x: anchor.pos.x + up.x * ELASTIC_ENTRY_ABOVE - up.y * offset, y: anchor.pos.y + up.y * ELASTIC_ENTRY_ABOVE + up.x * offset };
    return { body: { pos, vel: scale(up, -ELASTIC_ENTRY_SPEED) }, ropeLength: Math.max(tuning.ropeMin, distance(pos, anchor.pos)) };
  }
  // Pendu « sous » le point au sens de la gravité du moment, décalé perpendiculairement.
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

/** Une fois accroché à `anchor` depuis `body`, le balancement qui suit évite-t-il les obstacles ? Le robot s'en sert aussi avant d'attraper. */
export function swingIsClear(anchor: Anchor, body: Body, anchors: readonly Anchor[], obstacles: readonly Obstacle[], tuning: Tuning, env: Environment, zones: readonly Zone[]): boolean {
  // Un lanceur ou un rail ne se balance pas : il suffit que rien ne gêne autour, jusqu'où la traction recule le personnage ou jusqu'aux bouts de l'arc.
  if (anchor.kind === 'lanceur') return obstacles.every((box) => circleBoxGap(anchor.pos, LANCEUR_CLEARANCE, box) > 0);
  if (anchor.kind === 'rail') return obstacles.every((box) => circleBoxGap(anchor.pos, RAIL_CLEARANCE, box) > 0);
  const ropeLength = Math.max(tuning.ropeMin, distance(body.pos, anchor.pos));
  const magnet = anchor.kind === 'aimant';
  const context = {
    hero: { pos: body.pos, vel: magnet ? body.vel : constrainVelocity(body.pos, body.vel, anchor.pos, ropeLength), grounded: false },
    rope: { anchorId: anchor.id, length: ropeLength },
    anchors: [...anchors],
  };
  // Un aimant ne reçoit pas d'impulsion : son champ fait le mouvement.
  if (!magnet) kickIfSlow(context, tuning, [] as RuleEvent[]);
  let swing: Swing = { body: { pos: context.hero.pos, vel: context.hero.vel }, ropeLength };
  const steps = Math.round(AFTER_CATCH_SECONDS / tuning.stepSeconds);
  for (let k = 0; k < steps; k += 1) {
    swing = holdStep(anchor, swing, tuning, env, zones);
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
export function flightCatches(from: Anchor, body: Body, anchors: readonly Anchor[], allObstacles: readonly Obstacle[], tuning: Tuning, env: Environment = STILL, zones: readonly Zone[] = NO_ZONES, rings: readonly Ring[] = NO_RINGS): number[] {
  const obstacles = provableObstacles(allObstacles);
  const reach = tuning.ropeMax * tuning.verifyCatchRatio;
  // Les prises électriques et à éclipse ne comptent jamais comme sortie : le parcours se prouve sans elles.
  const catchable = anchors.filter((a) => !isOptional(a));
  const caught: number[] = [];
  const rejected = new Set<number>();
  const consider = (pos: Vec2, vel: Vec2, standing: readonly Obstacle[]): void => {
    const best = bestAnchor(catchable, standing, { pos, vel }, false, from.id, tuning, env, zones);
    if (!best || caught.includes(best.id) || rejected.has(best.id)) return;
    if (best.pos.y <= from.pos.y + MIN_GAIN || distance(best.pos, pos) > reach) return;
    if (swingIsClear(best, { pos, vel }, anchors, standing, tuning, env, zones)) caught.push(best.id);
    else rejected.add(best.id);
  };
  if (!needsSteps(obstacles, rings, zones)) {
    // Rien que des solides : la formule fermée du vol libre, et le vol s'arrête au premier obstacle touché.
    for (const { pos, vel } of flightSamples(body, tuning.verifyFlightSeconds, FLIGHT_SAMPLE, tuning, env)) {
      if (obstacles.some((box) => circleBoxGap(pos, tuning.heroRadius, box) <= 0)) break;
      consider(pos, vel, obstacles);
    }
    return caught;
  }
  // Des rencontres possibles : le vol se joue pas à pas, rebonds, fracas, anneaux et zones compris.
  const flight = startFlight(body);
  const stepsPerSample = Math.max(1, Math.round(FLIGHT_SAMPLE / tuning.stepSeconds));
  const total = Math.round(tuning.verifyFlightSeconds / tuning.stepSeconds);
  for (let k = 1; k <= total; k += 1) {
    flightStep(flight, obstacles, rings, zones, tuning, env);
    if (flight.ended) break;
    if (k % stepsPerSample !== 0) continue;
    // Une paroi cassée pendant ce vol ne coupe plus la ligne de vue ni le balancement qui suit.
    const standing = flight.smashed.size === 0 ? obstacles : obstacles.filter((box) => !flight.smashed.has(box.id));
    consider(flight.body.pos, flight.body.vel, standing);
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
  zones: readonly Zone[],
  rings: readonly Ring[],
): boolean {
  const maxSteps = Math.round(holdSecondsOf(from, tuning) / tuning.stepSeconds);
  const satisfied = (): boolean => (required ? required.every((id) => reached.has(id)) : reached.size > 0);
  let swing = start;
  for (let k = 0; k <= maxSteps; k += 1) {
    if (k % RELEASE_EVERY === 0) {
      const vel = from.kind === 'booster' ? clampLength(scale(swing.body.vel, tuning.boostFactor), tuning.maxSpeed) : swing.body.vel;
      for (const id of flightCatches(from, { pos: swing.body.pos, vel }, anchors, obstacles, tuning, env, zones, rings)) reached.add(id);
      if (satisfied()) return true;
    }
    if (obstacles.some((box) => circleBoxGap(swing.body.pos, tuning.heroRadius, box) <= 0)) break;
    swing = holdStep(from, swing, tuning, env, zones);
  }
  return satisfied();
}

/**
 * Depuis `from`, y a-t-il toujours une sortie vers le haut au pire cas, et,
 * pour une fourche, chaque branche exigée est-elle atteignable avec un élan
 * typique ? Chaque décalage d'arrivée doit réussir.
 */
export function canExit(from: Anchor, anchors: readonly Anchor[], allObstacles: readonly Obstacle[], required: readonly number[] | null, tuning: Tuning, env: Environment = STILL, zones: readonly Zone[] = NO_ZONES, rings: readonly Ring[] = NO_RINGS): boolean {
  const obstacles = provableObstacles(allObstacles);
  if (from.kind === 'lanceur') return launchExits(from, anchors, obstacles, required, tuning, env, zones, rings);
  if (from.kind === 'rail') return railExits(from, anchors, obstacles, required, tuning, env, zones, rings);
  for (const offset of ENTRY_OFFSETS) {
    const worst = entryState(from, offset, tuning.kickSpeed, anchors, tuning, env);
    if (!holdAndRelease(from, worst, anchors, obstacles, null, new Set(), tuning, env, zones, rings)) return false;
  }
  if (!required) return true;
  for (const offset of ENTRY_OFFSETS) {
    const typical = entryState(from, offset, TYPICAL_ENTRY_SPEED, anchors, tuning, env);
    if (!holdAndRelease(from, typical, anchors, obstacles, required, new Set(), tuning, env, zones, rings)) return false;
  }
  return true;
}

/**
 * Depuis un lanceur, l'arrivée ne compte pas : on y est tenu. Un joueur qui vise
 * peut lancer dans toutes les directions du haut, fort ou doucement ; il suffit
 * qu'un des lancers de l'éventail attrape une sortie (chaque branche exigée,
 * pour une fourche), sans partir d'une position gênée par un obstacle.
 */
function launchExits(from: Anchor, anchors: readonly Anchor[], obstacles: readonly Obstacle[], required: readonly number[] | null, tuning: Tuning, env: Environment, zones: readonly Zone[], rings: readonly Ring[]): boolean {
  const reached = new Set<number>();
  for (const pull of launchSet(env)) {
    const pos = pulledPosition(from.pos, pull);
    if (obstacles.some((box) => circleBoxGap(pos, tuning.heroRadius, box) <= 0)) continue;
    for (const id of flightCatches(from, { pos, vel: launchVelocity(pull, env) }, anchors, obstacles, tuning, env, zones, rings)) reached.add(id);
    if (required ? required.every((id) => reached.has(id)) : reached.size > 0) return true;
  }
  return false;
}

/** Depuis un rail, comme depuis un lanceur : il suffit qu'une des positions de l'arc, par son lancer, attrape une sortie (chaque branche exigée pour une fourche). */
function railExits(from: Anchor, anchors: readonly Anchor[], obstacles: readonly Obstacle[], required: readonly number[] | null, tuning: Tuning, env: Environment, zones: readonly Zone[], rings: readonly Ring[]): boolean {
  if (!from.rail) return false;
  const reached = new Set<number>();
  for (const t of railSet()) {
    const pos = railPoint(from.pos, from.rail, t);
    if (obstacles.some((box) => circleBoxGap(pos, tuning.heroRadius, box) <= 0)) continue;
    for (const id of flightCatches(from, { pos, vel: railVelocity(from.rail, t) }, anchors, obstacles, tuning, env, zones, rings)) reached.add(id);
    if (required ? required.every((id) => reached.has(id)) : reached.size > 0) return true;
  }
  return false;
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
  contextZones: readonly Zone[] = NO_ZONES,
  contextRings: readonly Ring[] = NO_RINGS,
): boolean {
  const anchors = [...context, ...segment.anchors];
  const obstacles = [...contextObstacles, ...segment.obstacles];
  const zones = segment.zones.length === 0 && contextZones.length === 0 ? NO_ZONES : [...contextZones, ...segment.zones];
  const rings = segment.rings.length === 0 && contextRings.length === 0 ? NO_RINGS : [...contextRings, ...segment.rings];
  const entry = context.at(-1);
  // Le point d'entrée appartient au segment précédent : il se joue dans ses propres conditions.
  if (entry && !canExit(entry, anchors, obstacles, null, tuning, entryEnv, zones, rings)) return false;
  for (const anchor of segment.anchors.slice(0, -1)) {
    const required = anchor.id === segment.junctionId ? segment.branchIds : null;
    if (!canExit(anchor, anchors, obstacles, required, tuning, env, zones, rings)) return false;
  }
  return true;
}

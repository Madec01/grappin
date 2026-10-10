import { add, clampLength, distance, dot, length, normalize, perpendicular, scale, sub, type Vec2 } from '../core/math/vec2';
import { grabbable, isCharged, isLit } from './cycles';
import { tierName } from '../data/tiers';
import { STILL, isUpright, upOf, type Environment } from './environment';
import { launchVelocity } from './launcher';
import { circleBoxGap } from './geometry';
import { constrainVelocity } from './physics';
import type { Anchor, RuleEvent, SimState, Obstacle } from './state';
import type { Tuning } from './tuning';

/**
 * Règles de jeu : accroche, lâcher, impulsion « jamais immobile », lâcher
 * parfait, combo, score, sol de départ et brume.
 *
 * Toutes les fonctions modifient l'état en place et journalisent leurs
 * événements dans `events`. Elles ne lisent ni horloge ni aléatoire.
 */

/** Ce dont le balancement a besoin : partagé avec le vérificateur, qui n'a pas d'état complet. */
/** Ce qu'il faut pour raisonner sur une corde tenue ; `env` et `pull` ne servent qu'au lancer depuis un lanceur. */
export type SwingContext = Pick<SimState, 'hero' | 'rope' | 'anchors'> & Partial<Pick<SimState, 'env' | 'pull'>>;

function findAnchor(state: SwingContext, id: number): Anchor | undefined {
  return state.anchors.find((a) => a.id === id);
}

/** Point intact le plus proche au-dessus d'un point donné, vers lequel orienter l'impulsion. */
function nextAnchorAbove(state: SwingContext, from: Anchor): Anchor | null {
  let best: Anchor | null = null;
  let bestDist = Infinity;
  for (const a of state.anchors) {
    if (a.id === from.id || a.broken || a.pos.y <= from.pos.y) continue;
    const d = distance(a.pos, from.pos);
    if (d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Impulsion « jamais immobile » : si la vitesse le long du cercle est trop
 * faible, elle est portée à `kickSpeed` dans la direction du prochain point.
 * Renvoie vrai si une impulsion a été donnée.
 */
export function kickIfSlow(state: SwingContext, tuning: Tuning, events: RuleEvent[]): boolean {
  if (!state.rope) return false;
  const anchor = findAnchor(state, state.rope.anchorId);
  if (!anchor) return false;
  const n = normalize(sub(state.hero.pos, anchor.pos));
  if (n.x === 0 && n.y === 0) return false;
  const tangent = perpendicular(n);
  const along = dot(state.hero.vel, tangent);
  if (along > tuning.minSwingSpeed || along < -tuning.minSwingSpeed) return false;
  const next = nextAnchorAbove(state, anchor);
  const dx = next ? next.pos.x - anchor.pos.x : 1;
  // Au point bas, la tangente pointe vers +x : on pousse du côté du prochain point.
  const sign = (dx >= 0 ? 1 : -1) * (tangent.x >= 0 ? 1 : -1);
  state.hero.vel = add(sub(state.hero.vel, scale(tangent, along)), scale(tangent, sign * tuning.kickSpeed));
  events.push({ type: 'kick' });
  return true;
}

/** Tente l'accroche au point visé. Renvoie vrai si la corde est lancée. */
export function tryAttach(state: SimState, tuning: Tuning, events: RuleEvent[]): boolean {
  if (state.status !== 'alive' || state.rope || state.targetId === null) return false;
  const coyoteSteps = Math.round(tuning.coyoteSeconds / tuning.stepSeconds);
  if (state.step - state.targetValidStep > coyoteSteps) return false;
  // Étourdi par une décharge, on ne rattrape rien pendant un court instant.
  if (state.step < state.stunUntilStep) return false;
  const anchor = findAnchor(state, state.targetId);
  if (!anchor || !grabbable(anchor, state.step, tuning)) return false;
  const reach = tuning.ropeMax * tuning.coyoteReach;
  const d = distance(anchor.pos, state.hero.pos);
  if (d > reach) return false;
  const ropeLength = Math.max(tuning.ropeMin, Math.min(reach, d));
  state.rope = { anchorId: anchor.id, length: ropeLength };
  state.hero.grounded = false;
  state.hero.vel = constrainVelocity(state.hero.pos, state.hero.vel, anchor.pos, ropeLength);
  state.hangSteps = 0;
  state.pressStep = -1;
  state.attachStep = state.step;
  state.grazed = [];
  events.push({ type: 'attach', anchorId: anchor.id });
  if (anchor.kind === 'lanceur') {
    // Tiré jusqu'au lanceur et tenu là : ni balancement ni élan, le lancer viendra du doigt.
    state.hero.pos = { ...anchor.pos };
    state.hero.vel = { x: 0, y: 0 };
    state.pull = { x: 0, y: 0 };
    state.rope.length = tuning.ropeMin;
  } else {
    // La première accroche de la partie peut recevoir un élan de départ plus généreux.
    const first = state.attachCount === 0 && tuning.startKickSpeed > tuning.kickSpeed;
    kickIfSlow(state, first ? { ...tuning, kickSpeed: tuning.startKickSpeed, minSwingSpeed: tuning.startKickSpeed } : tuning, events);
  }
  state.attachCount += 1;
  return true;
}

export type PressOutcome = 'attached' | 'buffered' | 'ignored';

/**
 * Le doigt se pose. Si un point est visé, la corde part tout de suite. Sinon
 * l'appui reste en mémoire pendant `pressBufferSeconds` : un tap un peu en
 * avance sur un point qui arrive à portée accroche quand même, en miroir du
 * coyote time qui pardonne un tap un peu en retard.
 */
export function press(state: SimState, tuning: Tuning, events: RuleEvent[]): PressOutcome {
  if (state.status !== 'alive' || state.rope) return 'ignored';
  if (tryAttach(state, tuning, events)) return 'attached';
  state.pressStep = state.step;
  return 'buffered';
}

/** Consomme l'appui en mémoire : accroche si un point est venu à portée, oublie s'il est trop vieux. */
export function applyBufferedPress(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  if (state.pressStep < 0) return;
  const bufferSteps = Math.round(tuning.pressBufferSeconds / tuning.stepSeconds);
  if (state.rope || state.step - state.pressStep > bufferSteps) {
    state.pressStep = -1;
    return;
  }
  tryAttach(state, tuning, events);
}

/**
 * Le lâcher est parfait si la vitesse part vers le haut, assez vite, avec une
 * pente comprise dans la fenêtre du GDD. Sans trigonométrie : on compare la
 * pente vy / |vx| aux tangentes des angles limites.
 */
export function isPerfectRelease(vx: number, vy: number, tuning: Tuning, env?: Environment): boolean {
  // « Vers le haut » s'entend à l'opposé de la gravité du moment, et « de côté » perpendiculairement.
  const up = env ? upOf(env) : { x: 0, y: 1 };
  const rise = vx * up.x + vy * up.y;
  if (rise <= 0) return false;
  const speed = length({ x: vx, y: vy });
  if (speed < tuning.perfectMinSpeed) return false;
  const sideways = vx * -up.y + vy * up.x;
  const ax = sideways < 0 ? -sideways : sideways;
  if (ax === 0) return false;
  const slope = rise / ax;
  return slope >= tuning.perfectMinSlope && slope <= tuning.perfectMaxSlope;
}

export function multiplier(combo: number, tuning: Tuning): number {
  return Math.min(tuning.comboMaxMultiplier, 1 + tuning.comboStep * combo);
}

/**
 * Vitesse que prendrait le personnage s'il lâchait maintenant : la sienne, ou
 * celle-ci multipliée par `boostFactor` sous le plafond s'il tient un
 * propulseur, sans changer de direction. Le lâcher et l'ombre prédictive
 * l'utilisent tous deux, pour que l'ombre dise vrai.
 */
export function releaseVelocity(state: SwingContext, tuning: Tuning): Vec2 {
  const anchor = state.rope ? findAnchor(state, state.rope.anchorId) : undefined;
  if (anchor?.kind === 'lanceur') return launchVelocity(state.pull ?? { x: 0, y: 0 }, state.env ?? STILL);
  if (anchor?.kind !== 'booster') return state.hero.vel;
  return clampLength(scale(state.hero.vel, tuning.boostFactor), tuning.maxSpeed);
}

/** Libère le personnage avec la vitesse du moment. Renvoie vrai si une corde a été lâchée. `forced` : la casse a lâché le personnage. */
export function release(state: SimState, tuning: Tuning, events: RuleEvent[], forced = false): boolean {
  // Lever le doigt annule un appui encore en mémoire.
  state.pressStep = -1;
  if (!state.rope) return false;
  const kind = findAnchor(state, state.rope.anchorId)?.kind ?? 'normal';
  const held = (state.step - state.attachStep) * tuning.stepSeconds;
  const boosted = releaseVelocity(state, tuning);
  if (boosted !== state.hero.vel) {
    state.hero.vel = boosted;
    // Un lancer n'est pas un coup de propulseur : pas de « Boost ».
    if (kind !== 'lanceur') events.push({ type: 'boost' });
  }
  // Un lancer ne se juge pas : la série de parfaits reste ce qu'elle est.
  const perfect = kind !== 'lanceur' && isPerfectRelease(state.hero.vel.x, state.hero.vel.y, tuning, state.env);
  if (kind !== 'lanceur') state.combo = perfect ? state.combo + 1 : 0;
  state.pull = { x: 0, y: 0 };
  state.lastAnchorId = state.rope.anchorId;
  state.releaseStep = state.step;
  state.rope = null;
  state.hangSteps = 0;
  events.push({ type: 'release', perfect, combo: state.combo, held, kind, forced });
  return true;
}

/** Accroche fragile tenue trop longtemps : elle casse et lâche le personnage avec sa vitesse. */
export function applyFragile(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  if (!state.rope) return;
  const anchor = findAnchor(state, state.rope.anchorId);
  if (!anchor || anchor.kind !== 'fragile') return;
  if ((state.step - state.attachStep) * tuning.stepSeconds < tuning.fragileSeconds) return;
  anchor.broken = true;
  events.push({ type: 'break', anchorId: anchor.id });
  release(state, tuning, events, true);
}

/** La décharge repousse à cette vitesse, et étourdit ce temps-là : ni visée ni prise possible. */
export const SHOCK_PUSH_SPEED = 5;
export const SHOCK_STUN_SECONDS = 0.7;

/**
 * Décharge d'une prise électrique tenue quand elle se charge : la corde lâche,
 * le personnage est repoussé à l'opposé de la prise (vers le haut s'il est
 * dessus), la série de parfaits retombe à zéro et il reste étourdi un court
 * instant. Pas de mort : retour du propriétaire, « trop fort de tuer d'un coup ».
 */
function shock(state: SimState, anchor: Anchor, tuning: Tuning, events: RuleEvent[]): void {
  release(state, tuning, events, true);
  const away = { x: state.hero.pos.x - anchor.pos.x, y: state.hero.pos.y - anchor.pos.y };
  const length = Math.hypot(away.x, away.y);
  const dir = length > 1e-6 ? { x: away.x / length, y: away.y / length } : upOf(state.env);
  state.hero.vel = { x: dir.x * SHOCK_PUSH_SPEED, y: dir.y * SHOCK_PUSH_SPEED };
  state.combo = 0;
  state.stunUntilStep = state.step + Math.round(SHOCK_STUN_SECONDS / tuning.stepSeconds);
  events.push({ type: 'shock', anchorId: anchor.id });
}

/**
 * Prises à cycles tenues : une électrique qui se charge donne une décharge, une
 * éclipse qui s'éteint lâche la corde avec la vitesse du moment, comme une
 * fragile qui casse, mais sans se casser : elle se rallume deux secondes plus tard.
 */
export function applyCycles(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  if (state.status !== 'alive' || !state.rope) return;
  const anchor = findAnchor(state, state.rope.anchorId);
  if (!anchor) return;
  if (anchor.kind === 'electrique' && isCharged(anchor.id, state.step, tuning)) shock(state, anchor, tuning, events);
  else if (anchor.kind === 'eclipse' && !isLit(anchor.id, state.step, tuning)) release(state, tuning, events, true);
}

/** Obstacles fixes : les toucher tue, les frôler rapporte une fois par obstacle et par corde. */
/** Rebond sur un obstacle : part de la vitesse rendue dans la direction du choc, et part gardée le long de la surface. */
export const BUMP_RESTITUTION = 0.35;
export const BUMP_FRICTION = 0.6;
/** Après un choc, on ne vise ni n'attrape rien pendant ce temps. */
export const BUMP_STUN_SECONDS = 0.45;
/** Sous cette vitesse de rebond, le personnage s'arrête contre l'obstacle : il peut s'y poser. */
const BUMP_REST_SPEED = 0.8;

/**
 * Choc contre un obstacle. Retour du propriétaire : mourir d'un coup était trop
 * fort. Le personnage est repoussé hors de la boîte, rebondit en perdant
 * l'essentiel de son élan, lâche sa corde, perd sa série de parfaits et reste
 * étourdi un instant ; sur le dessus d'une corniche, il peut se poser. La
 * brume reste le seul juge.
 */
function bump(state: SimState, box: Obstacle, tuning: Tuning, events: RuleEvent[]): void {
  const { pos } = state.hero;
  // Le point de la boîte le plus proche du centre ; la normale va de ce point vers le personnage.
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
  const depth = tuning.heroRadius - len;
  state.hero.pos = { x: pos.x + n.x * (depth + 1e-3), y: pos.y + n.y * (depth + 1e-3) };
  if (state.rope) release(state, tuning, events, true);
  const { vel } = state.hero;
  const along = vel.x * n.x + vel.y * n.y;
  const tangent = { x: vel.x - along * n.x, y: vel.y - along * n.y };
  const bounced = along < 0 ? -along * BUMP_RESTITUTION : Math.max(0, along);
  let next = { x: tangent.x * BUMP_FRICTION + n.x * bounced, y: tangent.y * BUMP_FRICTION + n.y * bounced };
  if (Math.hypot(next.x, next.y) < BUMP_REST_SPEED) next = { x: 0, y: 0 };
  state.hero.vel = { x: next.x || 0, y: next.y || 0 };
  state.combo = 0;
  state.stunUntilStep = Math.max(state.stunUntilStep, state.step + Math.round(BUMP_STUN_SECONDS / tuning.stepSeconds));
  events.push({ type: 'bump', obstacleId: box.id });
}

export function applyObstacles(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  if (state.status !== 'alive') return;
  for (const box of state.obstacles) {
    const gap = circleBoxGap(state.hero.pos, tuning.heroRadius, box);
    if (gap <= 0) {
      bump(state, box, tuning, events);
      continue;
    }
    if (gap <= tuning.grazeDistance && !state.grazed.includes(box.id)) {
      state.grazed.push(box.id);
      state.score += tuning.grazeScore * multiplier(state.combo, tuning);
      events.push({ type: 'graze', obstacleId: box.id });
    }
  }
}

/** Étoiles de la route haute : ramassées au contact. */
export function applyPickups(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  for (const pickup of state.pickups) {
    if (pickup.taken || distance(pickup.pos, state.hero.pos) > tuning.heroRadius + tuning.pickupRadius) continue;
    pickup.taken = true;
    state.score += tuning.pickupScore * multiplier(state.combo, tuning);
    events.push({ type: 'pickup', pickupId: pickup.id });
  }
}

/** Paliers nommés : un événement quand la hauteur maximale franchit un nouveau palier. */
export function applyTier(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  const tier = Math.floor(state.height / tuning.tierHeight);
  if (tier <= state.tier) return;
  state.tier = tier;
  events.push({ type: 'tier', tier, name: tierName(tier) });
}

/** Le toit de départ, en `groundY` : le personnage s'y pose s'il n'est pas accroché, tant que la gravité tire vers le bas. */
export function applyGround(state: SimState, tuning: Tuning): void {
  if (state.rope || !isUpright(state.env)) return;
  const bottom = state.hero.pos.y - tuning.heroRadius;
  if (bottom <= state.groundY && state.hero.vel.y <= 0) {
    state.hero.pos = { x: state.hero.pos.x, y: state.groundY + tuning.heroRadius };
    state.hero.vel = { x: 0, y: 0 };
    state.hero.grounded = true;
  } else {
    state.hero.grounded = false;
  }
}

/** Hors de la ville : pendant une bascule, tomber de côté au-delà de cette distance est une chute. */
export const WORLD_HALF_WIDTH = 14;

export function applyFall(state: SimState, events: RuleEvent[]): void {
  if (state.status !== 'alive') return;
  if (state.hero.pos.x > -WORLD_HALF_WIDTH && state.hero.pos.x < WORLD_HALF_WIDTH) return;
  state.status = 'dead';
  state.rope = null;
  events.push({ type: 'death', height: state.height, cause: 'fall' });
}

/** Ligne d'arrivée d'un niveau : la franchir termine la partie sur une victoire. */
export function applyFinish(state: SimState, events: RuleEvent[]): void {
  if (state.status !== 'alive' || state.finishY === null || state.hero.pos.y < state.finishY) return;
  state.status = 'won';
  state.rope = null;
  events.push({ type: 'finish', height: state.height });
}

/**
 * Pendu sous la vitesse minimale trop longtemps : nouvelle impulsion.
 *
 * Être lent n'est pas pendre : au bout d'un balancement, le personnage est
 * toujours lent un instant. On ne compte donc que les pas lents passés presque
 * à la verticale sous le point, là où un balancement normal est au contraire le
 * plus rapide.
 */
export function applyHang(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  const anchor = state.rope ? findAnchor(state, state.rope.anchorId) : undefined;
  if (!state.rope || !anchor || anchor.kind === 'lanceur') {
    state.hangSteps = 0;
    return;
  }
  const n = normalize(sub(state.hero.pos, anchor.pos));
  const slow = length(state.hero.vel) < tuning.minSwingSpeed && n.y < -0.95;
  state.hangSteps = slow ? state.hangSteps + 1 : 0;
  if (state.hangSteps * tuning.stepSeconds >= tuning.hangSeconds) {
    state.hangSteps = 0;
    kickIfSlow(state, tuning, events);
  }
}

/** Score et hauteur : chaque mètre gagné rapporte le multiplicateur courant. */
export function applyScore(state: SimState, tuning: Tuning): void {
  const y = state.hero.pos.y;
  if (y > state.height) {
    state.score += (y - state.height) * multiplier(state.combo, tuning);
    state.height = y;
  }
}

export function fogSpeed(height: number, tuning: Tuning): number {
  const steps = Math.floor(height / tuning.fogStepHeight);
  return Math.min(tuning.fogMaxSpeed, tuning.fogBaseSpeed + tuning.fogSpeedGain * steps);
}

/**
 * La brume monte ; passer dessous est la mort, sauf seconde chance : le
 * personnage est alors renvoyé vers le haut depuis la ligne de brume, corde lâchée.
 */
export function applyFog(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  // Le gain de vitesse se compte depuis le toit de départ : un niveau ou une course libre partis haut ne commencent pas avec une brume déjà lancée.
  state.fogY += fogSpeed(state.height - state.groundY, tuning) * state.fogFactor * tuning.stepSeconds;
  if (state.status !== 'alive' || state.hero.pos.y >= state.fogY) return;
  if (state.chancesLeft > 0) {
    state.chancesLeft -= 1;
    state.rope = null;
    state.hero.pos = { x: state.hero.pos.x, y: state.fogY + tuning.heroRadius };
    state.hero.vel = { x: state.hero.vel.x * 0.5, y: tuning.rescueSpeed };
    state.hero.grounded = false;
    events.push({ type: 'rescue', chancesLeft: state.chancesLeft });
    return;
  }
  state.status = 'dead';
  state.rope = null;
  events.push({ type: 'death', height: state.height, cause: 'fog' });
}

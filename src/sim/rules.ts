import { add, clampLength, distance, dot, length, normalize, perpendicular, scale, sub, type Vec2 } from '../core/math/vec2';
import { tierName } from '../data/tiers';
import { circleBoxGap } from './geometry';
import { constrainVelocity } from './physics';
import type { Anchor, RuleEvent, SimState } from './state';
import type { Tuning } from './tuning';

/**
 * Règles de jeu : accroche, lâcher, impulsion « jamais immobile », lâcher
 * parfait, combo, score, sol de départ et brume.
 *
 * Toutes les fonctions modifient l'état en place et journalisent leurs
 * événements dans `events`. Elles ne lisent ni horloge ni aléatoire.
 */

/** Ce dont le balancement a besoin : partagé avec le vérificateur, qui n'a pas d'état complet. */
export type SwingContext = Pick<SimState, 'hero' | 'rope' | 'anchors'>;

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
  const anchor = findAnchor(state, state.targetId);
  if (!anchor || anchor.broken) return false;
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
  kickIfSlow(state, tuning, events);
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
export function isPerfectRelease(vx: number, vy: number, tuning: Tuning): boolean {
  if (vy <= 0) return false;
  const speed = length({ x: vx, y: vy });
  if (speed < tuning.perfectMinSpeed) return false;
  const ax = vx < 0 ? -vx : vx;
  if (ax === 0) return false;
  const slope = vy / ax;
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
  if (anchor?.kind !== 'booster') return state.hero.vel;
  return clampLength(scale(state.hero.vel, tuning.boostFactor), tuning.maxSpeed);
}

/** Libère le personnage avec la vitesse du moment. Renvoie vrai si une corde a été lâchée. */
export function release(state: SimState, tuning: Tuning, events: RuleEvent[]): boolean {
  // Lever le doigt annule un appui encore en mémoire.
  state.pressStep = -1;
  if (!state.rope) return false;
  const boosted = releaseVelocity(state, tuning);
  if (boosted !== state.hero.vel) {
    state.hero.vel = boosted;
    events.push({ type: 'boost' });
  }
  const perfect = isPerfectRelease(state.hero.vel.x, state.hero.vel.y, tuning);
  state.combo = perfect ? state.combo + 1 : 0;
  state.lastAnchorId = state.rope.anchorId;
  state.releaseStep = state.step;
  state.rope = null;
  state.hangSteps = 0;
  events.push({ type: 'release', perfect, combo: state.combo });
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
  release(state, tuning, events);
}

/** Obstacles fixes : les toucher tue, les frôler rapporte une fois par obstacle et par corde. */
export function applyObstacles(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  if (state.status !== 'alive') return;
  for (const box of state.obstacles) {
    const gap = circleBoxGap(state.hero.pos, tuning.heroRadius, box);
    if (gap <= 0) {
      state.status = 'dead';
      state.rope = null;
      events.push({ type: 'death', height: state.height, cause: 'obstacle' });
      return;
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

/** Le toit de départ, en y = 0 : le personnage s'y pose s'il n'est pas accroché. */
export function applyGround(state: SimState, tuning: Tuning): void {
  if (state.rope) return;
  const bottom = state.hero.pos.y - tuning.heroRadius;
  if (bottom <= 0 && state.hero.vel.y <= 0) {
    state.hero.pos = { x: state.hero.pos.x, y: tuning.heroRadius };
    state.hero.vel = { x: 0, y: 0 };
    state.hero.grounded = true;
  } else {
    state.hero.grounded = false;
  }
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
  if (!state.rope || !anchor) {
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

/** La brume monte ; passer dessous est la mort. */
export function applyFog(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  state.fogY += fogSpeed(state.height, tuning) * tuning.stepSeconds;
  if (state.status === 'alive' && state.hero.pos.y < state.fogY) {
    state.status = 'dead';
    state.rope = null;
    events.push({ type: 'death', height: state.height, cause: 'fog' });
  }
}

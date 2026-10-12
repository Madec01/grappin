import { add, clampLength, distance, dot, length, normalize, perpendicular, scale, sub, type Vec2 } from '../core/math/vec2';
import { grabbable, isCharged, isLit } from './cycles';
import { tierName } from '../data/tiers';
import { STILL, isUpright, upOf, type Environment } from './environment';
import { launchVelocity } from './launcher';
import { SWITCH_HOLD_SECONDS, railParam, railPoint, railVelocity } from './holds';
import { obstacleGap, pushOutAt } from './moving';
import { BOUNCE_FRICTION, BOUNCE_RESTITUTION, RING_CENTRE_RATIO, SMASH_KEEP, reflected, ringBoosted } from './flight';
import { isSolidNow, obstacleKind } from './obstacles';
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
  } else if (anchor.kind === 'rail' && anchor.rail) {
    // Posé au milieu du rail : le doigt glisse pour choisir la position, le lancer part de là.
    state.hero.pos = railPoint(anchor.pos, anchor.rail, 0.5);
    state.hero.vel = { x: 0, y: 0 };
    state.pull = { x: 0, y: 0 };
    state.rope.length = tuning.ropeMin;
  } else if (anchor.kind === 'aimant') {
    // L'aimant attire : pas d'impulsion, le mouvement vient du champ.
    state.rope.length = d;
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
  // Un lâcher ne part jamais plus vite que `releaseMaxSpeed` : retour du propriétaire, « la vitesse devient impossible à gérer ».
  if (anchor?.kind === 'lanceur') return clampLength(launchVelocity(state.pull ?? { x: 0, y: 0 }, state.env ?? STILL), tuning.releaseMaxSpeed);
  if (anchor?.kind === 'rail' && anchor.rail) return clampLength(railVelocity(anchor.rail, railParam(state.pull ?? { x: 0, y: 0 })), tuning.releaseMaxSpeed);
  if (anchor?.kind === 'booster') return clampLength(scale(state.hero.vel, tuning.boostFactor), tuning.releaseMaxSpeed);
  return clampLength(state.hero.vel, tuning.releaseMaxSpeed);
}

/** Libère le personnage avec la vitesse du moment. Renvoie vrai si une corde a été lâchée. `forced` : la casse a lâché le personnage. */
export function release(state: SimState, tuning: Tuning, events: RuleEvent[], forced = false): boolean {
  // Lever le doigt annule un appui encore en mémoire.
  state.pressStep = -1;
  if (!state.rope) return false;
  const kind = findAnchor(state, state.rope.anchorId)?.kind ?? 'normal';
  const held = (state.step - state.attachStep) * tuning.stepSeconds;
  state.hero.vel = releaseVelocity(state, tuning);
  if (kind === 'booster') events.push({ type: 'boost' });
  // Un lancer (lanceur, rail) ne se juge pas : la série de parfaits reste ce qu'elle est. Un lâcher parfait monte le combo ; un lâcher
  // correct ne le casse plus, il le fait redescendre de `comboMissPenalty` crans ; seules les erreurs réelles le remettent à zéro.
  const launched = kind === 'lanceur' || kind === 'rail';
  const perfect = !launched && isPerfectRelease(state.hero.vel.x, state.hero.vel.y, tuning, state.env);
  if (!launched) state.combo = perfect ? state.combo + 1 : Math.max(0, state.combo - tuning.comboMissPenalty);
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

/**
 * Prise interrupteur tenue (lot 5, P5) : les portes qu'elle commande restent
 * ouvertes tant qu'on la tient, et `SWITCH_HOLD_SECONDS` après le lâcher ; le
 * délai se renouvelle à chaque pas de tenue.
 */
export function applySwitches(state: SimState, tuning: Tuning): void {
  const anchor = state.rope ? findAnchor(state, state.rope.anchorId) : undefined;
  if (!anchor || anchor.kind !== 'interrupteur') return;
  // Le pas s'incrémente après : compté depuis la fin de ce pas, le délai est entier.
  const until = state.step + 1 + Math.round(SWITCH_HOLD_SECONDS / tuning.stepSeconds);
  for (const box of state.obstacles) if (box.switchedBy === anchor.id) box.openUntilStep = until;
}

/**
 * Passages qui se referment (lot 5, O6) : un panneau se déclenche quand le
 * personnage est dans le couloir, entre sa ligne d'entrée et le panneau lui-même ;
 * il ferme, reste fermé, rouvre, puis se réarme (et se redéclenche si le
 * personnage est toujours dedans ; passé au-dessus, plus jamais). Un événement
 * est émis par passage (le panneau de droite parle pour les deux).
 */
export function applyClosers(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  for (const box of state.obstacles) {
    if (!box.closer) continue;
    if (box.triggeredStep === undefined) {
      if (state.hero.pos.y <= box.closer.triggerY || state.hero.pos.y >= box.y0) continue;
      box.triggeredStep = state.step;
      if (box.closer.side === 1) events.push({ type: 'escape', obstacleId: box.id });
      continue;
    }
    const elapsed = (state.step - box.triggeredStep) * tuning.stepSeconds;
    if (elapsed >= 2 * box.closer.closeSeconds + box.closer.shutSeconds) delete box.triggeredStep;
  }
}

/** Rebond sur un obstacle solide : part de la vitesse rendue dans la direction du choc, et part gardée le long de la surface. */
export const BUMP_RESTITUTION = 0.35;
export const BUMP_FRICTION = 0.6;
/** Après un choc, on ne vise ni n'attrape rien pendant ce temps. */
export const BUMP_STUN_SECONDS = 0.45;
/** Sous cette vitesse de rebond, le personnage s'arrête contre l'obstacle : il peut s'y poser. */
const BUMP_REST_SPEED = 0.8;
export { BOUNCE_FRICTION, BOUNCE_RESTITUTION, RING_CENTRE_RATIO, SMASH_KEEP } from './flight';

/** Sort le personnage de la boîte qu'il touche (voir `flight.ts`) et rend la normale du contact. */
function pushHeroOut(state: SimState, box: Obstacle, tuning: Tuning): Vec2 {
  const out = pushOutAt(state.hero.pos, tuning.heroRadius, box, state.step, tuning);
  state.hero.pos = out.pos;
  return out.n;
}

/**
 * Choc contre un obstacle solide. Retour du propriétaire : mourir d'un coup
 * était trop fort. Le personnage est repoussé hors de la boîte, rebondit en
 * perdant l'essentiel de son élan, lâche sa corde, perd sa série de parfaits
 * et reste étourdi un instant ; sur le dessus d'une corniche, il peut se
 * poser. La brume reste le seul juge.
 */
function bump(state: SimState, box: Obstacle, tuning: Tuning, events: RuleEvent[]): void {
  const n = pushHeroOut(state, box, tuning);
  // Posé sur le dessus d'une corniche, le personnage la touche à chaque pas, à vitesse nulle : ce n'est pas un choc. Il reste
  // posé, garde sa série et peut viser (B-012 : avant, il restait étourdi sans fin, sans pouvoir rien attraper).
  const towards = -(state.hero.vel.x * n.x + state.hero.vel.y * n.y);
  if (!state.rope && towards < BUMP_REST_SPEED && Math.hypot(state.hero.vel.x, state.hero.vel.y) < BUMP_REST_SPEED) {
    state.hero.vel = { x: 0, y: 0 };
    return;
  }
  if (state.rope) release(state, tuning, events, true);
  let next = reflected(state.hero.vel, n, BUMP_RESTITUTION, BUMP_FRICTION);
  if (Math.hypot(next.x, next.y) < BUMP_REST_SPEED) next = { x: 0, y: 0 };
  state.hero.vel = { x: next.x || 0, y: next.y || 0 };
  state.combo = 0;
  state.stunUntilStep = Math.max(state.stunUntilStep, state.step + Math.round(BUMP_STUN_SECONDS / tuning.stepSeconds));
  events.push({ type: 'bump', obstacleId: box.id });
}

/**
 * Surface de rebond (brief, O3) : le personnage est renvoyé selon son angle
 * d'arrivée, presque sans perte, la corde lâchée s'il en tenait une ; ni
 * série perdue, ni étourdi : on peut rattraper un point dans la foulée. Une
 * chute devient une remontée, un tir manqué se récupère.
 */
function bounce(state: SimState, box: Obstacle, tuning: Tuning, events: RuleEvent[]): void {
  const n = pushHeroOut(state, box, tuning);
  if (state.rope) release(state, tuning, events, true);
  const next = reflected(state.hero.vel, n, BOUNCE_RESTITUTION, BOUNCE_FRICTION);
  state.hero.vel = { x: next.x || 0, y: next.y || 0 };
  events.push({ type: 'bounce', obstacleId: box.id });
}

/** Paroi cassable (brief, O4) traversée assez vite : elle vole en éclats, le personnage garde l'essentiel de sa vitesse et marque. */
function smash(state: SimState, box: Obstacle, tuning: Tuning, events: RuleEvent[]): void {
  box.broken = true;
  state.hero.vel = scale(state.hero.vel, SMASH_KEEP);
  state.score += tuning.smashScore * multiplier(state.combo, tuning);
  events.push({ type: 'smash', obstacleId: box.id });
}

/** Vrai si le personnage va assez vite pour traverser une paroi cassable en ce moment. */
export function canSmash(state: Pick<SimState, 'hero'>, tuning: Tuning): boolean {
  return length(state.hero.vel) >= tuning.smashSpeed;
}

/**
 * Obstacles : les frôler rapporte une fois par obstacle et par corde ; les
 * toucher dépend de l'espèce (solide, rebond, cassable, porte). Une porte
 * ouverte se traverse ; une porte qui se ferme pendant que le personnage est
 * dedans reste franchissable pour lui jusqu'à ce qu'il en sorte (brief : « pas
 * d'apparition solide imprévisible directement sur la bille »).
 */
export function applyObstacles(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  if (state.status !== 'alive') return;
  for (const box of state.obstacles) {
    if (box.broken) continue;
    const kind = obstacleKind(box);
    const gap = obstacleGap(state.hero.pos, tuning.heroRadius, box, state.step, tuning);
    if (kind === 'porte') {
      const inside = state.doorsInside.includes(box.id);
      if (gap > 0) {
        if (inside) state.doorsInside = state.doorsInside.filter((id) => id !== box.id);
        continue;
      }
      if (isSolidNow(box, state.step, tuning, state.doorsInside)) bump(state, box, tuning, events);
      else if (!inside) state.doorsInside.push(box.id);
      continue;
    }
    if (gap <= 0) {
      if (kind === 'rebond') bounce(state, box, tuning, events);
      else if (kind === 'cassable' && canSmash(state, tuning)) smash(state, box, tuning, events);
      else bump(state, box, tuning, events);
      continue;
    }
    if (gap <= tuning.grazeDistance && !state.grazed.includes(box.id)) {
      state.grazed.push(box.id);
      state.score += tuning.grazeScore * multiplier(state.combo, tuning);
      events.push({ type: 'graze', obstacleId: box.id });
    }
  }
}

/**
 * Anneaux de précision (brief, O5) : traverser le disque d'un anneau rapporte
 * quand on en ressort, selon le passage le plus proche du centre ; au centre,
 * davantage et un cran de série. Tout anneau traversé donne un coup
 * d'accélération (`ringBoost`) : un anneau porte plus loin, et le générateur
 * peut l'exiger (le cerceau). Un anneau raté ne coûte rien.
 */
export function applyRings(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  if (state.status !== 'alive') return;
  for (const ring of state.rings) {
    if (ring.taken) continue;
    const d = distance(ring.pos, state.hero.pos);
    if (d <= ring.radius) {
      ring.closest = ring.closest === null || d < ring.closest ? d : ring.closest;
      continue;
    }
    if (ring.closest === null) continue;
    const centred = ring.closest <= ring.radius * RING_CENTRE_RATIO;
    ring.taken = true;
    ring.closest = null;
    if (centred) state.combo += 1;
    state.hero.vel = ringBoosted(state.hero.vel, tuning);
    state.score += (centred ? tuning.ringCentreScore : tuning.ringScore) * multiplier(state.combo, tuning);
    events.push({ type: 'ring', ringId: ring.id, centred });
  }
}

/** Étoiles de la route haute : ramassées au contact. */
export function applyPickups(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  for (const pickup of state.pickups) {
    if (pickup.taken || distance(pickup.pos, state.hero.pos) > tuning.heroRadius + tuning.pickupRadius) continue;
    pickup.taken = true;
    state.score += tuning.pickupScore * multiplier(state.combo, tuning);
    events.push({ type: 'pickup', pickupId: pickup.id, bonus: pickup.bonus === true });
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
  // Ni un lanceur ni un rail ne se balancent ; un aimant tire de lui-même.
  if (!state.rope || !anchor || anchor.kind === 'lanceur' || anchor.kind === 'rail' || anchor.kind === 'aimant') {
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

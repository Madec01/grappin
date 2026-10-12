import { createRng } from '../core/math/rng';
import type { Vec2 } from '../core/math/vec2';
import { STILL, turnedGravity, type Environment } from './environment';
import { orbitPosition, riftPosition } from './moving';
import type { Anchor, Pickup, RuleEvent, SimState } from './state';
import type { Tuning } from './tuning';

/**
 * Événements des niveaux : la bascule, le coup de vent, la panne, la pluie
 * d'étoiles, l'alerte, le câble, la traversière, le serpentin et le plafond.
 *
 * Un événement est planifié à une hauteur au-dessus du toit de départ et
 * dure une longueur de progression. Il commence quand la hauteur maximale
 * atteinte franchit `at`, finit quand elle franchit `at + length`. Tout est
 * déterministe : la bascule tourne en un temps fixé de pas, la panne clignote
 * selon le numéro de pas, la pluie tire ses étoiles d'un générateur seedé à
 * part, le câble glisse selon le temps simulé.
 */

export type EventKind = 'bascule' | 'vent' | 'panne' | 'pluie' | 'alerte' | 'cable' | 'traversiere' | 'serpentin' | 'plafond';

export interface ScheduledEvent {
  readonly kind: EventKind;
  /** Hauteur de début, en mètres au-dessus du toit de départ. */
  readonly at: number;
  /** Longueur de progression couverte, en mètres. */
  readonly length: number;
  /** Côté de la bascule ou du vent : -1 vers la gauche, 1 vers la droite. */
  readonly side?: -1 | 1;
  /** Force du vent, en m/s². */
  readonly strength?: number;
}

/** Ce que l'on retient d'un événement pendant la partie. */
export interface EventRuntime {
  startStep: number | null;
  endStep: number | null;
  /** Serpentin : l'inclinaison du moment, de 0 (gravité vers le bas) à 1 (un quart de tour), qui suit son stade en douceur ; plafond : jusqu'à 2 (un demi-tour, la gravité vers le haut). */
  tilt?: number;
}

/** Durée de la rotation de la bascule, aller comme retour, en secondes. */
export const TURN_SECONDS = 2;
/**
 * Serpentin (brief du 11 octobre 2026, T1 : « le parcours s'incline
 * progressivement : vertical, oblique, horizontal, retour vertical », première
 * extension de la bascule). Sur sa longueur, trois stades d'égale hauteur :
 * oblique (un huitième de tour), horizontal (un quart), oblique à nouveau ; puis
 * la gravité revient au bas. D'un stade à l'autre, la gravité tourne en douceur :
 * `SERPENTIN_TURN_SECONDS` pour un quart de tour entier, soit deux secondes par
 * stade, deux fois plus lentement que la bascule. Un serpentin de course libre
 * couvre `SERPENTIN_LENGTH` mètres : chaque stade tient un segment entier.
 */
export const SERPENTIN_STAGES: readonly number[] = [0.5, 1, 0.5];
export const SERPENTIN_TURN_SECONDS = 4;
export const SERPENTIN_LENGTH = 45;
/**
 * Plafond (brief, T2 : « une transition inverse la gravité, la bille se balance
 * au-dessus des prises, une inversion à l'entrée et une à la sortie »). Sur
 * `PLAFOND_LENGTH` mètres la gravité tire vers le haut. Elle ne tourne pas pour
 * s'inverser (un demi-tour passerait par l'horizontale, et jetterait hors du
 * monde qui vole à ce moment-là) : elle faiblit jusqu'à rien, puis repousse
 * vers le haut, en `PLAFOND_TURN_SECONDS` ; un instant d'apesanteur sépare
 * les deux sens, et la fin fait le chemin inverse. La caméra ne tourne pas avec
 * elle (`Environment.inverted`) : on tombe vers le haut de l'écran, on se
 * balance au-dessus des prises, et le générateur pose des plafonds à trou à
 * enfiler (`ceilingRun`). Deux inversions, jamais plus.
 */
export const PLAFOND_LENGTH = 30;
export const PLAFOND_TURN_SECONDS = 3;
/** L'inversion d'un plafond, de 0 (gravité vers le bas) à `PLAFOND_TILT` (vers le haut) ; à mi-chemin, rien ne pèse. */
export const PLAFOND_TILT = 2;

/** La gravité d'un plafond à ce point de son inversion : vers le bas à 0, nulle à 1, vers le haut à 2 ; un vecteur de la longueur de son poids. */
export function invertedGravity(tilt: number): Vec2 {
  const k = tilt < 0 ? 0 : tilt > PLAFOND_TILT ? PLAFOND_TILT : tilt;
  // `|| 0` : jamais de zéro négatif, qui ferait deux empreintes d'un même état.
  return { x: 0, y: k - 1 || 0 };
}

/** L'inclinaison visée par un serpentin à cette part de sa longueur (0 avant, 0 après). */
export function serpentinTilt(progress: number): number {
  if (progress < 0 || progress >= 1) return 0;
  return SERPENTIN_STAGES[Math.min(SERPENTIN_STAGES.length - 1, Math.floor(progress * SERPENTIN_STAGES.length))]!;
}

/** Longueur d'un événement de course libre ou d'atelier : un segment, sauf le serpentin, qui en couvre trois, et le plafond, un et demi. */
export function eventLength(kind: EventKind): number {
  return kind === 'serpentin' ? SERPENTIN_LENGTH : kind === 'plafond' ? PLAFOND_LENGTH : 20;
}

/**
 * Les hauteurs, au-dessus du toit de départ, où les conditions d'un événement
 * changent : son début et sa fin, et pour un serpentin chacun de ses stades. Le
 * générateur coupe ses segments à ces frontières, pour prouver chacun dans un
 * seul jeu de conditions.
 */
export function eventBoundaries(event: ScheduledEvent): number[] {
  const bounds = [event.at, event.at + event.length];
  if (event.kind === 'serpentin') for (let stage = 1; stage < SERPENTIN_STAGES.length; stage += 1) bounds.push(event.at + (event.length * stage) / SERPENTIN_STAGES.length);
  return bounds;
}
/** Montée en puissance du vent, en secondes. */
const WIND_RISE_SECONDS = 1;
/** Alerte : facteur de vitesse de la brume. */
export const ALERT_FOG_FACTOR = 2;
/** Panne : chaque lampadaire s'éteint `LIGHT_OFF_SECONDS` toutes les `LIGHT_PERIOD_SECONDS`, décalé selon son numéro. */
export const LIGHT_PERIOD_SECONDS = 4;
export const LIGHT_OFF_SECONDS = 2;
/** Pluie : une étoile tous les `RAIN_EVERY_SECONDS`, qui tombe à `RAIN_FALL_SPEED`. */
const RAIN_EVERY_SECONDS = 0.6;
const RAIN_FALL_SPEED = 1.6;
const RAIN_ABOVE_HERO = 12;
/** Câble : demi-longueur et période d'un aller-retour. */
export const CABLE_HALF_LENGTH = 1.6;
export const CABLE_PERIOD_SECONDS = 3;
/**
 * Traversière : une prise qui balaie toute la largeur jouable, aller-retour en
 * ce temps à l'écartement 1, plus lentement quand la ville est plus large.
 * Idée du propriétaire, validée le 10 octobre 2026.
 */
export const TRAVERSIERE_PERIOD_SECONDS = 5;

/** Événements du calendrier dont la phase principale couvre la hauteur `y` (hauteur absolue). */
export function eventsAt(schedule: readonly ScheduledEvent[], startY: number, y: number): ScheduledEvent[] {
  return schedule.filter((e) => y >= startY + e.at && y < startY + e.at + e.length);
}

/**
 * Conditions physiques pleines d'un ensemble d'événements, sans rampe : sert au
 * vérificateur. Un serpentin incline selon son stade à la hauteur `y` (absolue,
 * avec `startY` le toit de départ) ; sans hauteur, à plein, comme une bascule.
 */
export function environmentOf(events: readonly ScheduledEvent[], startY = 0, y?: number): Environment {
  let gravityDir = STILL.gravityDir;
  let wind = STILL.wind;
  let inverted = false;
  for (const e of events) {
    if (e.kind === 'bascule') gravityDir = turnedGravity(e.side ?? 1, 1);
    if (e.kind === 'serpentin') {
      const tilt = y === undefined ? 1 : serpentinTilt((y - startY - e.at) / e.length);
      if (tilt > 0) gravityDir = turnedGravity(e.side ?? 1, tilt);
    }
    if (e.kind === 'plafond') {
      gravityDir = invertedGravity(PLAFOND_TILT);
      inverted = true;
    }
    if (e.kind === 'vent') wind = { x: (e.side ?? 1) * (e.strength ?? 3), y: 0 };
  }
  return inverted ? { gravityDir, wind, inverted: true } : { gravityDir, wind };
}

/** Un lampadaire est-il éteint à ce pas, pendant une panne ? Décalé selon son numéro, pour des vagues. */
export function lightIsOff(anchorId: number, step: number, tuning: Tuning): boolean {
  const t = step * tuning.stepSeconds + anchorId * 0.37;
  const phase = t - Math.floor(t / LIGHT_PERIOD_SECONDS) * LIGHT_PERIOD_SECONDS;
  return phase < LIGHT_OFF_SECONDS;
}

/** Position d'un point sur câble à un pas donné : aller-retour en triangle, sans trigonométrie. */
export function cablePosition(anchor: Anchor, step: number, tuning: Tuning): { x: number; y: number } {
  if (!anchor.cable) return anchor.pos;
  const period = anchor.cable.period;
  const t = step * tuning.stepSeconds;
  const phase = (t - Math.floor(t / period) * period) / period;
  const k = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return { x: anchor.cable.from.x + (anchor.cable.to.x - anchor.cable.from.x) * k, y: anchor.cable.from.y + (anchor.cable.to.y - anchor.cable.from.y) * k };
}

/**
 * Fait vivre les événements d'un pas : démarrages et fins selon la hauteur,
 * conditions physiques du moment, câbles qui glissent, pluie d'étoiles.
 * À appeler avant la physique du pas.
 */
export function applyEvents(state: SimState, tuning: Tuning, events: RuleEvent[]): void {
  const dt = tuning.stepSeconds;
  const turnSteps = Math.round(TURN_SECONDS / dt);
  let gravityDir = STILL.gravityDir;
  let wind = STILL.wind;
  let inverted = false;
  let fogFactor = 1;
  let lightsOff = false;
  let raining = false;

  for (let i = 0; i < state.schedule.length; i += 1) {
    const scheduled = state.schedule[i]!;
    const runtime = state.eventRuntimes[i]!;
    const startY = state.groundY + scheduled.at;
    if (runtime.startStep === null && state.height >= startY) {
      runtime.startStep = state.step;
      events.push({ type: 'event', kind: scheduled.kind, phase: 'start' });
    }
    if (runtime.startStep !== null && runtime.endStep === null && state.height >= startY + scheduled.length) {
      runtime.endStep = state.step;
      events.push({ type: 'event', kind: scheduled.kind, phase: 'end' });
    }
    if (runtime.startStep === null) continue;
    const sinceStart = state.step - runtime.startStep;
    const sinceEnd = runtime.endStep === null ? null : state.step - runtime.endStep;
    switch (scheduled.kind) {
      case 'bascule': {
        // Rotation en un temps fixe, aller puis retour ; entre les deux, un quart de tour plein.
        const t = sinceEnd === null ? Math.min(1, sinceStart / turnSteps) : Math.max(0, 1 - sinceEnd / turnSteps);
        if (t > 0) gravityDir = turnedGravity(scheduled.side ?? 1, t);
        break;
      }
      case 'serpentin': {
        // L'inclinaison suit le stade de la hauteur atteinte, en douceur : un quart de tour en `SERPENTIN_TURN_SECONDS`.
        const target = sinceEnd === null ? serpentinTilt((state.height - startY) / scheduled.length) : 0;
        const rate = dt / SERPENTIN_TURN_SECONDS;
        const current = runtime.tilt ?? 0;
        const tilt = current < target ? Math.min(target, current + rate) : Math.max(target, current - rate);
        runtime.tilt = tilt;
        if (tilt > 0) gravityDir = turnedGravity(scheduled.side ?? 1, tilt);
        break;
      }
      case 'plafond': {
        // La gravité faiblit jusqu'à rien puis repousse vers le haut à l'entrée, à plein pendant l'événement, le chemin inverse à la fin ; la caméra ne suit pas.
        const target = sinceEnd === null ? PLAFOND_TILT : 0;
        const rate = (PLAFOND_TILT * dt) / PLAFOND_TURN_SECONDS;
        const current = runtime.tilt ?? 0;
        const tilt = current < target ? Math.min(target, current + rate) : Math.max(target, current - rate);
        runtime.tilt = tilt;
        if (tilt > 0) {
          gravityDir = invertedGravity(tilt);
          inverted = true;
        }
        break;
      }
      case 'vent': {
        if (sinceEnd !== null) break;
        const rise = Math.min(1, (sinceStart * dt) / WIND_RISE_SECONDS);
        wind = { x: (scheduled.side ?? 1) * (scheduled.strength ?? 3) * rise, y: 0 };
        break;
      }
      case 'alerte':
        if (sinceEnd === null) fogFactor = ALERT_FOG_FACTOR;
        break;
      case 'panne':
        if (sinceEnd === null) lightsOff = true;
        break;
      case 'pluie':
        if (sinceEnd === null) raining = true;
        break;
      case 'cable':
      case 'traversiere':
        break;
    }
  }

  state.env = inverted ? { gravityDir, wind, inverted: true } : { gravityDir, wind };
  state.fogFactor = fogFactor;
  state.lightsOff = lightsOff;

  // Les points sur câble glissent ; ceux d'un carrousel tournent, ceux d'une faille s'écartent.
  for (const anchor of state.anchors) {
    if (anchor.cable) anchor.pos = cablePosition(anchor, state.step, tuning);
    else if (anchor.orbit) anchor.pos = orbitPosition(anchor.orbit, state.step, tuning);
    else if (anchor.rift) anchor.pos = riftPosition(anchor, state.step, tuning);
  }

  // La pluie d'étoiles : une étoile tous les `RAIN_EVERY_SECONDS`, au-dessus du personnage, qui tombe.
  if (raining && state.step % Math.round(RAIN_EVERY_SECONDS / dt) === 0) {
    const rng = createRng(state.course.seed);
    rng.setState(state.rainRng);
    const star: Pickup = { id: state.course.ids.pickup, pos: { x: -4 + 8 * rng.next(), y: state.hero.pos.y + RAIN_ABOVE_HERO }, taken: false, vel: { x: 0, y: -RAIN_FALL_SPEED }, bonus: true };
    state.course.ids.pickup += 1;
    state.pickups.push(star);
    state.rainRng = rng.getState();
  }
  for (const pickup of state.pickups) {
    if (pickup.vel) pickup.pos = { x: pickup.pos.x + pickup.vel.x * dt, y: pickup.pos.y + pickup.vel.y * dt };
  }
}

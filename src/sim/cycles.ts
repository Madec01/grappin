import type { Anchor } from './state';
import type { Tuning } from './tuning';

/**
 * Cycles des prises à comportement, idées du propriétaire validées le
 * 10 octobre 2026. La prise électrique se charge par cycles : on ne peut
 * l'attraper que calme, et y pendre quand elle se charge donne une décharge
 * qui lâche la corde, repousse et étourdit un court instant ; un court
 * avertissement précède chaque charge. Retour du propriétaire : mourir d'un
 * coup était trop dur, et la visée ne doit jamais se poser sur une prise
 * dangereuse. La prise à éclipse s'allume deux
 * secondes et s'éteint deux secondes : éteinte, le grappin ne l'attrape pas,
 * et si l'on y pend quand elle s'éteint, la corde lâche. Tout se calcule du
 * numéro de pas et du numéro de point, décalé pour que les prises ne battent
 * pas toutes ensemble : le rendu rejoue la même formule.
 */

export const ELECTRIC_PERIOD_SECONDS = 4;
export const ELECTRIC_CHARGED_SECONDS = 1.5;
export const ELECTRIC_WARNING_SECONDS = 0.6;
export const ECLIPSE_PERIOD_SECONDS = 4;
export const ECLIPSE_LIT_SECONDS = 2;
/** Décalage de phase entre deux prises consécutives, en secondes. */
const PHASE_OFFSET_PER_ID = 0.37;

/** Temps écoulé dans le cycle de la prise, en secondes, de 0 à `period`. */
function cycleTime(anchorId: number, step: number, tuning: Tuning, period: number): number {
  const t = step * tuning.stepSeconds + anchorId * PHASE_OFFSET_PER_ID;
  return t - Math.floor(t / period) * period;
}

export type ElectricState = 'calme' | 'avertit' | 'chargee';

/** Où en est le cycle d'une prise électrique : calme, sur le point de se charger, ou chargée. */
export function electricState(anchorId: number, step: number, tuning: Tuning): ElectricState {
  const t = cycleTime(anchorId, step, tuning, ELECTRIC_PERIOD_SECONDS);
  if (t < ELECTRIC_CHARGED_SECONDS) return 'chargee';
  if (t >= ELECTRIC_PERIOD_SECONDS - ELECTRIC_WARNING_SECONDS) return 'avertit';
  return 'calme';
}

export function isCharged(anchorId: number, step: number, tuning: Tuning): boolean {
  return electricState(anchorId, step, tuning) === 'chargee';
}

/** Une prise à éclipse est-elle allumée à ce pas ? */
export function isLit(anchorId: number, step: number, tuning: Tuning): boolean {
  return cycleTime(anchorId, step, tuning, ECLIPSE_PERIOD_SECONDS) < ECLIPSE_LIT_SECONDS;
}

/**
 * Le grappin peut-il viser et attraper cette prise en ce moment ? Jamais une
 * prise cassée, une éclipse éteinte, ni une électrique qui avertit ou qui est
 * chargée : l'anneau de visée ne se pose que sur ce qui se tient sans danger.
 */
export function grabbable(anchor: Anchor, step: number, tuning: Tuning): boolean {
  if (anchor.broken) return false;
  if (anchor.kind === 'eclipse') return isLit(anchor.id, step, tuning);
  if (anchor.kind === 'electrique') return electricState(anchor.id, step, tuning) === 'calme';
  return true;
}

/** Les prises que le vérificateur n'exige jamais : un parcours se prouve sans elles, elles ne sont qu'un raccourci ou un piège. */
export function isOptional(anchor: Anchor): boolean {
  return anchor.kind === 'electrique' || anchor.kind === 'eclipse';
}

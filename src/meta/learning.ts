import type { Tuning } from '../sim/tuning';
import { showsHint, type Profile } from './profile';

/**
 * L'apprentissage par l'action (brief du 11 octobre 2026) : tant qu'un joueur
 * n'a jamais atteint 30 m (le même seuil que l'indice du titre, voir
 * `showsHint`), la menace est tolérante et l'aide visuelle plus explicite. La
 * brume monte moins vite, et l'ombre prédictive porte deux fois plus loin.
 * Dès 30 m atteints une fois, tout revient au réglage normal : l'aide
 * s'efface quand le geste est compris. Pur : rien ici ne lit l'horloge ni le
 * stockage.
 */

/** Facteur sur la vitesse de la brume, et sur son gain, pendant l'apprentissage. */
export const LEARNING_FOG_FACTOR = 0.6;
/** Portée de l'ombre prédictive pendant l'apprentissage, en secondes de vol. */
export const LEARNING_SHADOW_SECONDS = 0.5;

/** Le joueur apprend encore : il n'a jamais atteint 30 m. */
export function isLearning(profile: Profile): boolean {
  return showsHint(profile);
}

/** Les réglages d'une partie, adoucis pour un joueur qui apprend ; inchangés sinon (le même objet). */
export function learningTuning(tuning: Tuning, profile: Profile): Tuning {
  if (!isLearning(profile)) return tuning;
  return {
    ...tuning,
    fogBaseSpeed: tuning.fogBaseSpeed * LEARNING_FOG_FACTOR,
    fogSpeedGain: tuning.fogSpeedGain * LEARNING_FOG_FACTOR,
    shadowSeconds: Math.max(tuning.shadowSeconds, LEARNING_SHADOW_SECONDS),
  };
}

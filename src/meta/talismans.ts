import { withTuning, type Tuning } from '../sim/tuning';

/**
 * Talismans : des bonus débloqués par niveau et équipés avant la partie. Ils
 * ne font que faciliter : le robot vérificateur joue avec les réglages de la
 * partie, donc sa garantie tient toujours. Un premier emplacement est ouvert
 * d'emblée, un second au niveau 4.
 */

export type TalismanId = 'treuil' | 'corde' | 'elan' | 'chance' | 'aimant' | 'froleur';

export interface Talisman {
  readonly id: TalismanId;
  readonly name: string;
  /** Une phrase, pour l'écran des talismans. */
  readonly description: string;
  /** Niveau qui le débloque. */
  readonly level: number;
  /** Ce qu'il change aux réglages de la partie. */
  readonly apply: (tuning: Tuning) => Tuning;
}

export const TALISMANS: readonly Talisman[] = [
  {
    id: 'treuil',
    name: 'Treuil renforcé',
    description: 'Le grappin tire 15 % plus vite : la vitesse vient plus tôt.',
    level: 1,
    apply: (t) => withTuning(t, { reelSpeed: t.reelSpeed * 1.15 }),
  },
  {
    id: 'corde',
    name: 'Corde longue',
    description: 'Un mètre de portée en plus : des points plus lointains deviennent visables.',
    level: 2,
    apply: (t) => withTuning(t, { ropeMax: t.ropeMax + 1 }),
  },
  {
    id: 'elan',
    name: 'Élan de départ',
    description: 'La première accroche part déjà à 6 m/s.',
    level: 3,
    apply: (t) => withTuning(t, { startKickSpeed: 6 }),
  },
  {
    id: 'chance',
    name: 'Seconde chance',
    description: 'Une fois par partie, la brume te renvoie vers le haut au lieu de te prendre.',
    level: 4,
    apply: (t) => withTuning(t, { secondChances: 1 }),
  },
  {
    id: 'aimant',
    name: 'Aimant à étoiles',
    description: 'Les étoiles se ramassent de deux fois et demie plus loin.',
    level: 5,
    apply: (t) => withTuning(t, { pickupRadius: t.pickupRadius * 2.5 }),
  },
  {
    id: 'froleur',
    name: 'Frôleur',
    description: 'Les frôlés rapportent le double et comptent un peu plus loin.',
    level: 6,
    apply: (t) => withTuning(t, { grazeScore: t.grazeScore * 2, grazeDistance: t.grazeDistance + 0.2 }),
  },
];

/** Nombre de talismans équipables à un niveau donné. */
export function slotsFor(level: number): number {
  return level >= 4 ? 2 : 1;
}

export function talismanById(id: TalismanId): Talisman {
  const found = TALISMANS.find((t) => t.id === id);
  if (!found) throw new Error(`Talisman inconnu : ${id}`);
  return found;
}

/** Réglages de la partie avec les talismans équipés, dans l'ordre du catalogue. */
export function applyTalismans(tuning: Tuning, equipped: readonly TalismanId[]): Tuning {
  return TALISMANS.filter((t) => equipped.includes(t.id)).reduce((acc, t) => t.apply(acc), tuning);
}

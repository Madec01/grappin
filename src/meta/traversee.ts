import { LEVELS, levelById, type LevelDef } from '../data/levels';
import type { CoursePlan } from '../sim/course';
import { withTuning, type Tuning } from '../sim/tuning';
import type { Profile } from './profile';

/**
 * La traversée : les niveaux fixes, leurs étoiles, ce qu'ils débloquent, et
 * le départ avancé de la course libre. Tout est pur ; le profil porte les
 * résultats.
 */

/** Série de lâchers parfaits qui vaut la troisième étoile. */
export const PERFECT_STREAK_STAR = 5;
/** Expérience par étoile nouvellement gagnée, et prime au premier passage d'un niveau. */
export const STAR_XP = 50;
export const FIRST_CLEAR_XP = 100;

export interface LevelResult {
  readonly won: boolean;
  readonly pickupsTaken: number;
  readonly pickupsTotal: number;
  readonly perfectStreak: number;
}

/** Les trois étoiles, dans l'ordre : terminer, toutes les étoiles, cinq parfaits d'affilée. */
export function starChecks(result: LevelResult): readonly [boolean, boolean, boolean] {
  if (!result.won) return [false, false, false];
  return [true, result.pickupsTaken >= result.pickupsTotal, result.perfectStreak >= PERFECT_STREAK_STAR];
}

export function levelStars(result: LevelResult): number {
  return starChecks(result).filter(Boolean).length;
}

export function starsOf(profile: Profile, levelId: number): number {
  return profile.levels[String(levelId)]?.stars ?? 0;
}

/** Numéro du plus haut niveau franchi, 0 si aucun. */
export function highestCleared(profile: Profile): number {
  let highest = 0;
  for (const level of LEVELS) if (starsOf(profile, level.id) >= 1) highest = Math.max(highest, level.id);
  return highest;
}

/** Numéro du niveau le plus avancé jouable : le suivant du plus haut franchi, ou le dernier. */
export function unlockedLevel(profile: Profile): number {
  return Math.min(LEVELS.length, highestCleared(profile) + 1);
}

export function isUnlocked(profile: Profile, levelId: number): boolean {
  return levelId <= unlockedLevel(profile);
}

/** Hauteur de départ de la course libre : la zone la plus haute déjà franchie. */
export function freeRunStartY(profile: Profile): number {
  const cleared = highestCleared(profile);
  if (cleared === 0) return 0;
  return levelById(cleared + 1)?.startY ?? LEVELS[LEVELS.length - 1]!.endY;
}

export function levelPlan(level: LevelDef): CoursePlan {
  return { kind: 'level', levelId: level.id, startY: level.startY, endY: level.endY, profile: level.profile, events: level.events };
}

/** Réglages d'un niveau : ceux de la partie, avec la brume du niveau. */
export function levelTuning(level: LevelDef, tuning: Tuning): Tuning {
  return withTuning(tuning, { fogBaseSpeed: level.fogBaseSpeed });
}

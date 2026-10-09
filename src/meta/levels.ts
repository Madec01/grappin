/**
 * Niveaux de grimpeur. L'expérience est la somme des scores de toutes les
 * parties et des récompenses de missions. Le niveau 1 est le départ ; chaque
 * niveau demande un peu plus que le précédent, pour que les premiers tombent
 * vite et donnent le goût, puis que les suivants se méritent.
 */

/** Expérience par cran : le niveau L demande `XP_STEP × L × (L − 1) / 2` au total. */
const XP_STEP = 120;

/** Expérience totale nécessaire pour atteindre un niveau. */
export function xpToReach(level: number): number {
  if (level <= 1) return 0;
  return (XP_STEP * level * (level - 1)) / 2;
}

/** Niveau atteint avec une expérience donnée. */
export function levelFor(xp: number): number {
  let level = 1;
  while (xpToReach(level + 1) <= xp) level += 1;
  return level;
}

export interface LevelProgress {
  readonly level: number;
  /** Expérience acquise dans le niveau courant, et taille du niveau. */
  readonly current: number;
  readonly span: number;
  /** Part du niveau franchie, de 0 à 1. */
  readonly ratio: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFor(xp);
  const floor = xpToReach(level);
  const span = xpToReach(level + 1) - floor;
  const current = xp - floor;
  return { level, current, span, ratio: span > 0 ? current / span : 1 };
}

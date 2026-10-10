import type { TalismanId } from '../meta/talismans';

/**
 * Les boutons des écrans : leur nom et leur rectangle. Sans PixiJS, pour que
 * le jeu les lise sans charger le rendu.
 */

/** Un niveau de la liste : « niveau-3 ». */
export type LevelButtonId = `niveau-${number}`;

/**
 * Un bouton ou une ligne sur laquelle on peut taper : un bouton nommé, un
 * niveau débloqué de la liste, ou un talisman débloqué.
 */
export type ButtonId = 'talismans' | 'levels' | 'free' | 'next' | 'replay' | 'back' | LevelButtonId | TalismanId;

/** Rectangle d'un bouton, en pixels CSS de l'écran. */
export interface ButtonRect {
  readonly id: ButtonId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const LEVEL_PREFIX = 'niveau-';

/** Nom de la ligne du niveau `id` dans la liste des niveaux. */
export function levelButton(id: number): LevelButtonId {
  return `${LEVEL_PREFIX}${id}`;
}

/** Numéro du niveau qu'une ligne désigne, ou null si le bouton n'est pas une ligne de niveau. */
export function levelOfButton(button: ButtonId | null): number | null {
  if (button === null || !button.startsWith(LEVEL_PREFIX)) return null;
  const id = Number(button.slice(LEVEL_PREFIX.length));
  return Number.isInteger(id) ? id : null;
}

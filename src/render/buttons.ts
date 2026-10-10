import { LEVELS, type LevelDef } from '../data/levels';
import type { TalismanId } from '../meta/talismans';

/**
 * Les boutons des écrans : leur nom et leur rectangle. Sans PixiJS, pour que
 * le jeu les lise sans charger le rendu.
 */

/** Un niveau de la liste : « niveau-3 ». */
export type LevelButtonId = `niveau-${number}`;

/**
 * Un bouton ou une ligne sur laquelle on peut taper : un bouton nommé, un
 * niveau débloqué de la liste, ou un talisman débloqué. « suite » et
 * « precedents » tournent les pages de la liste des niveaux.
 */
export type ButtonId = 'talismans' | 'levels' | 'free' | 'music' | 'next' | 'replay' | 'back' | 'suite' | 'precedents' | LevelButtonId | TalismanId;

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

/** La liste des niveaux tient en pages de dix : vingt lignes ne tiendraient pas dans l'écran d'un téléphone. */
export const LEVELS_PER_PAGE = 10;

/** Nombre de pages de la liste des niveaux, au moins une. */
export function levelPageCount(): number {
  return Math.max(1, Math.ceil(LEVELS.length / LEVELS_PER_PAGE));
}

/** Page, à partir de 0, où se trouve la ligne du niveau `id` ; la première page pour un numéro inconnu. */
export function pageOfLevel(id: number): number {
  const index = LEVELS.findIndex((level) => level.id === id);
  return index < 0 ? 0 : Math.floor(index / LEVELS_PER_PAGE);
}

/** Les niveaux montrés sur la page `page`, dans l'ordre ; vide hors de la liste. */
export function levelsOfPage(page: number): readonly LevelDef[] {
  return LEVELS.slice(page * LEVELS_PER_PAGE, (page + 1) * LEVELS_PER_PAGE);
}

import type { MissionDef } from '../meta/missions';
import { talismanById, type TalismanId } from '../meta/talismans';

/**
 * Textes de l'interface calculés à partir du profil : fonctions pures, sans
 * PixiJS, que les écrans n'ont plus qu'à poser.
 */

/** Avancement d'une mission : « 2 / 3 », avec l'unité pour la hauteur (« 12 / 30 m ») et la survie (« 0 / 60 s »). */
export function missionProgress(def: MissionDef, progress: number): string {
  const unit = def.kind === 'height' ? ' m' : def.kind === 'survive' ? ' s' : '';
  // Arrondi vers le bas : on n'annonce jamais plus que ce qui est fait.
  return `${Math.floor(progress)} / ${def.target}${unit}`;
}

/** La ligne des talismans équipés de l'écran titre. */
export function equippedLine(equipped: readonly TalismanId[]): string {
  if (equipped.length === 0) return 'Aucun talisman';
  return `Talismans : ${equipped.map((id) => talismanById(id).name).join(', ')}`;
}

/** Sous-titre de l'écran des talismans : emplacements ouverts et occupés. */
export function slotsLine(slots: number, used: number): string {
  return `${slots} emplacement${slots > 1 ? 's' : ''}, ${used} utilisé${used > 1 ? 's' : ''}`;
}

/** Une mission accomplie, sur l'écran de fin. L'espace insécable garde « XP » avec son nombre quand la ligne se coupe. */
export function missionDoneLine(def: MissionDef): string {
  return `Mission accomplie : ${def.text}, +${def.reward}\u00A0XP`;
}

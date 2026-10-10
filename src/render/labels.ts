import type { LevelDef } from '../data/levels';
import type { MissionDef } from '../meta/missions';
import { talismanById, type TalismanId } from '../meta/talismans';
import { PERFECT_STREAK_STAR, starChecks, type LevelResult } from '../meta/traversee';
import type { EventKind } from '../sim/events';

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

/** « Niveau 3 · Les enseignes » : sur le titre, la victoire et l'intro du niveau. */
export function levelTitle(level: LevelDef): string {
  return `Niveau ${level.id} · ${level.name}`;
}

/** « 3 · Les enseignes » : une ligne de la liste des niveaux. */
export function levelRowTitle(level: LevelDef): string {
  return `${level.id} · ${level.name}`;
}

/** « 130 → 200 m » : de quelle hauteur à quelle hauteur monte le niveau. */
export function levelRange(level: LevelDef): string {
  return `${level.startY} → ${level.endY} m`;
}

/** Nom court de chaque événement, pour la liste des niveaux du mode test. */
const EVENT_NAMES: Record<EventKind, string> = {
  bascule: 'bascule',
  vent: 'vent',
  panne: 'panne',
  pluie: 'pluie',
  alerte: 'alerte',
  cable: 'câbles',
  traversiere: 'traversières',
};

/** « bascule 25 m · panne 55 m » : les événements du niveau et la hauteur où ils commencent, ou une chaîne vide sans événement. */
export function levelEvents(level: LevelDef): string {
  const shown = level.events.slice(0, 3).map((event) => `${EVENT_NAMES[event.kind]} ${event.at} m`);
  // Les niveaux longs en portent jusqu'à six : la ligne n'en dit que trois, le reste se découvre en jouant.
  if (level.events.length > 3) shown.push('…');
  return shown.join(' · ');
}

/** Une des trois étoiles d'un niveau : ce qu'elle demande, si elle est gagnée, et sinon où l'on en est. */
export interface StarLine {
  readonly label: string;
  readonly done: boolean;
  /** « 2/3 » tant que l'étoile n'est pas gagnée, null quand elle l'est ou qu'il n'y a rien à compter. */
  readonly progress: string | null;
}

/** Les trois étoiles de l'écran de victoire, dans l'ordre de `starChecks`. */
export function starLines(result: LevelResult): readonly StarLine[] {
  const [finished, allPickups, perfects] = starChecks(result);
  return [
    { label: 'Terminer', done: finished, progress: null },
    { label: 'Toutes les étoiles', done: allPickups, progress: allPickups ? null : `${result.pickupsTaken}/${result.pickupsTotal}` },
    { label: "Cinq parfaits d'affilée", done: perfects, progress: perfects ? null : `${result.perfectStreak}/${PERFECT_STREAK_STAR}` },
  ];
}

/** Ce que la bannière dit d'un événement de niveau : un titre et, le plus souvent, une phrase en dessous. */
export interface Announcement {
  readonly title: string;
  readonly detail: string | null;
}

/** Annonce du début des événements, hors le vent, dont la phrase dépend du côté. */
const STARTS: Record<Exclude<EventKind, 'vent'>, Announcement> = {
  bascule: { title: 'La bascule !', detail: 'Le niveau tourne' },
  panne: { title: 'Panne de lampadaires', detail: 'Vise de mémoire' },
  pluie: { title: 'Pluie d\'étoiles', detail: 'Cueille-les au vol' },
  alerte: { title: 'Alerte !', detail: 'La brume accélère' },
  cable: { title: 'Câbles', detail: 'Les accroches glissent' },
  traversiere: { title: 'Traversières !', detail: 'Les prises balaient la ville' },
};

/** Les événements dont la fin se remarque : ceux qui ont changé la façon de jouer. */
const CALM_AFTER: ReadonlySet<EventKind> = new Set(['bascule', 'vent', 'alerte']);

/**
 * Annonce d'un événement de niveau qui commence ou finit, ou null quand sa fin
 * ne mérite pas d'être dite. `windSide` : côté vers lequel pousse le vent, -1
 * pour la gauche et 1 pour la droite.
 */
export function eventAnnouncement(kind: EventKind, phase: 'start' | 'end', windSide: -1 | 1): Announcement | null {
  if (phase === 'end') return CALM_AFTER.has(kind) ? { title: 'Retour au calme', detail: null } : null;
  if (kind === 'vent') return { title: 'Coup de vent !', detail: `Il pousse vers la ${windSide < 0 ? 'gauche' : 'droite'}` };
  return STARTS[kind];
}

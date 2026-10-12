import type { EventKind } from '../sim/events';
import type { Archetype, TierProfile } from '../sim/generator';

/**
 * L'atelier : le mode test où l'on choisit ce que l'on veut affronter.
 * Demande du propriétaire (0.13.0) : « un vrai mode test dans le jeu où je peux
 * choisir à quelles prises ou autres éléments je veux être confronté ». Une
 * sélection d'éléments donne un profil de parcours (`atelierProfile`) : la
 * course libre n'engendre alors que des segments qui portent ces éléments, et
 * les événements choisis se succèdent à chaque segment. Pur, sans PixiJS ; le
 * choix se garde dans le profil du mode test, et `?atelier=roue,tournant`
 * ouvre une partie d'atelier directement.
 */

export type AtelierGroup = 'prises' | 'obstacles' | 'lanceurs' | 'zones' | 'transformations' | 'evenements';

export type AtelierId =
  | 'fragile' | 'propulseur' | 'electrique' | 'eclipse' | 'lanceur' | 'roue'
  | 'dalles' | 'rebond' | 'cassable' | 'porte' | 'anneau' | 'tournant'
  | 'brise' | 'sas' | 'cerceau' | 'ricochet' | 'percee' | 'glissiere'
  | 'courant' | 'derive' | 'fusee'
  | 'serpentin' | 'accordeon' | 'poche'
  | 'bascule' | 'vent' | 'panne' | 'pluie' | 'alerte' | 'cable' | 'traversiere';

export interface AtelierElement {
  readonly id: AtelierId;
  readonly label: string;
  readonly group: AtelierGroup;
}

export const ATELIER_GROUPS: readonly { readonly id: AtelierGroup; readonly label: string }[] = [
  { id: 'prises', label: 'Prises' },
  { id: 'obstacles', label: 'Obstacles' },
  { id: 'lanceurs', label: 'Lanceurs à usage exigé' },
  { id: 'zones', label: 'Zones' },
  { id: 'transformations', label: 'Transformations du terrain' },
  { id: 'evenements', label: 'Événements' },
];

export const ATELIER_ELEMENTS: readonly AtelierElement[] = [
  { id: 'fragile', label: 'Fragiles', group: 'prises' },
  { id: 'propulseur', label: 'Propulseurs', group: 'prises' },
  { id: 'electrique', label: 'Électriques', group: 'prises' },
  { id: 'eclipse', label: 'Éclipses', group: 'prises' },
  { id: 'lanceur', label: 'Lanceurs', group: 'prises' },
  { id: 'roue', label: 'Roues', group: 'prises' },
  { id: 'dalles', label: 'Dalles', group: 'obstacles' },
  { id: 'rebond', label: 'Rebonds', group: 'obstacles' },
  { id: 'cassable', label: 'Cassables', group: 'obstacles' },
  { id: 'porte', label: 'Portes', group: 'obstacles' },
  { id: 'anneau', label: 'Anneaux', group: 'obstacles' },
  { id: 'tournant', label: 'Tournants', group: 'obstacles' },
  { id: 'brise', label: 'Mur à percer', group: 'lanceurs' },
  { id: 'sas', label: 'Sas', group: 'lanceurs' },
  { id: 'cerceau', label: 'Cerceau', group: 'lanceurs' },
  { id: 'ricochet', label: 'Ricochet', group: 'lanceurs' },
  { id: 'percee', label: 'Percée', group: 'lanceurs' },
  { id: 'glissiere', label: 'Glissière', group: 'lanceurs' },
  { id: 'courant', label: 'Courant', group: 'zones' },
  { id: 'derive', label: 'Dérive', group: 'zones' },
  { id: 'fusee', label: 'Fusée', group: 'zones' },
  { id: 'serpentin', label: 'Serpentin', group: 'transformations' },
  { id: 'accordeon', label: 'Accordéon', group: 'transformations' },
  { id: 'poche', label: 'Poche de faible gravité', group: 'transformations' },
  { id: 'bascule', label: 'Bascule', group: 'evenements' },
  { id: 'vent', label: 'Vent', group: 'evenements' },
  { id: 'panne', label: 'Panne', group: 'evenements' },
  { id: 'pluie', label: 'Pluie', group: 'evenements' },
  { id: 'alerte', label: 'Alerte', group: 'evenements' },
  { id: 'cable', label: 'Câbles', group: 'evenements' },
  { id: 'traversiere', label: 'Traversières', group: 'evenements' },
];

const IDS: ReadonlySet<string> = new Set(ATELIER_ELEMENTS.map((element) => element.id));

export function isAtelierId(id: string): id is AtelierId {
  return IDS.has(id);
}

/** Une liste d'identifiants, telle qu'elle vient de l'adresse ou du profil : les inconnus sont ignorés, les doublons aussi, l'ordre est celui du catalogue. */
export function parseAtelier(text: string | null | undefined): AtelierId[] {
  const wanted = new Set((text ?? '').split(',').map((part) => part.trim()).filter(isAtelierId));
  return ATELIER_ELEMENTS.map((element) => element.id).filter((id) => wanted.has(id));
}

/** La sélection avec `id` en plus ou en moins, dans l'ordre du catalogue. */
export function toggleAtelier(selection: readonly AtelierId[], id: AtelierId): AtelierId[] {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return ATELIER_ELEMENTS.map((element) => element.id).filter((candidate) => next.has(candidate));
}

/** Les événements choisis, dans l'ordre du catalogue ; le serpentin, transformation du terrain, en est un. */
export function atelierEvents(selection: readonly AtelierId[]): EventKind[] {
  const events: EventKind[] = ['serpentin', 'bascule', 'vent', 'panne', 'pluie', 'alerte', 'cable', 'traversiere'];
  return events.filter((kind) => selection.includes(kind));
}

/**
 * Le profil de parcours d'une sélection : seulement les motifs qui portent les
 * éléments choisis (une chaîne simple si rien n'en demande), une pièce de
 * chaque obstacle ou prise choisi par segment, un écartement moyen. Les
 * motifs sont tirés au sort à chaque segment parmi ceux de la sélection :
 * choisir une seule chose, c'est la voir à chaque segment.
 */
export function atelierProfile(selection: readonly AtelierId[]): TierProfile {
  const has = (id: AtelierId): boolean => selection.includes(id);
  const archetypes: Archetype[] = [];
  if (has('dalles')) archetypes.push('dalles');
  if (has('fragile')) archetypes.push('fragiles');
  if (has('propulseur')) archetypes.push('rafale', 'saut');
  if (has('lanceur')) archetypes.push('lanceur');
  if (has('roue')) archetypes.push('roue');
  if (has('tournant')) archetypes.push('tournant');
  for (const id of ['brise', 'sas', 'cerceau', 'ricochet', 'percee', 'glissiere', 'courant', 'derive', 'fusee', 'accordeon', 'poche'] as const) if (has(id)) archetypes.push(id);
  if (archetypes.length === 0) archetypes.push('chaine', 'couloir');
  return {
    spacing: 4,
    obstacles: has('dalles') ? 2 : 0,
    split: true,
    fragileChance: has('fragile') ? 0.4 : 0,
    boosters: has('propulseur') ? 1 : 0,
    archetypes,
    spread: 1.2,
    electric: has('electrique') ? 1 : 0,
    eclipse: has('eclipse') ? 1 : 0,
    bouncers: has('rebond') ? 1 : 0,
    breakables: has('cassable') ? 1 : 0,
    doors: has('porte') ? 1 : 0,
    rings: has('anneau') ? 1 : 0,
    rotors: has('tournant') ? 1 : 0,
  };
}

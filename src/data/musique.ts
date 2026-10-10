/**
 * Les musiques, fournies par le propriétaire (dépôt Way, `assets/music/`),
 * une par niveau et une pour le titre. Les fichiers vivent dans
 * `public/musique/` et se chargent au besoin, un à la fois : le jeu ne pèse
 * pas plus lourd au départ. Les douze pistes de jeu tournent sur les vingt
 * niveaux ; la course libre prend la piste du niveau qui couvre sa hauteur.
 */

export type TrackId = 'menu' | 'biome1-1' | 'biome1-2' | 'biome2-1' | 'biome2-2' | 'biome3-1' | 'biome3-2' | 'biome4-1' | 'biome4-2' | 'boss1' | 'boss2' | 'boss3' | 'boss4';

export const TITLE_TRACK: TrackId = 'menu';

/** Piste de chaque niveau, par numéro. */
const LEVEL_TRACKS: readonly TrackId[] = [
  'biome1-1',
  'biome1-2',
  'biome2-1',
  'biome2-2',
  'biome3-1',
  'biome3-2',
  'biome4-1',
  'biome4-2',
  'boss1',
  'boss2',
  'biome1-1',
  'biome1-2',
  'biome2-1',
  'biome2-2',
  'biome3-1',
  'biome3-2',
  'biome4-1',
  'boss3',
  'biome4-2',
  'boss4',
];

/** La piste du niveau `id` ; au-delà du dernier niveau, la dernière piste. */
export function levelTrack(id: number): TrackId {
  return LEVEL_TRACKS[Math.min(LEVEL_TRACKS.length, Math.max(1, Math.floor(id))) - 1]!;
}

/** Chemin du fichier d'une piste, relatif à la racine du site (`import.meta.env.BASE_URL` s'y ajoute). */
export function trackFile(id: TrackId): string {
  return `musique/${id}.mp3`;
}

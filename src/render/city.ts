import { createRng } from '../core/math/rng';
import type { Vec2 } from '../core/math/vec2';

/**
 * Silhouettes de ville : des toits et des antennes en contour très fin, sur les
 * côtés du jeu, qui défilent avec la hauteur.
 *
 * Tout est une fonction de la hauteur et de rien d'autre : le monde est coupé
 * en bandes de 20 m, et chaque bande tire ses immeubles d'un générateur seedé
 * par son numéro (jamais `Math.random`). La même bande donne toujours les mêmes
 * toits, d'une partie, d'un appareil et d'une image à l'autre. Sans PixiJS ni
 * temps réel : le rendu ne fait que les tracer.
 *
 * Les immeubles restent hors de la largeur jouable de base (± 4 m) et en deçà
 * des bords de la ville (± 14 m). Trois rangs de profondeur, du plus proche au
 * plus loin, que le rendu éclaircit ou assombrit : le rang 0 se devine au bord
 * de l'écran, les suivants n'apparaissent que lorsque la caméra dézoome ou que
 * le niveau bascule.
 */

/** Hauteur d'une bande, en mètres. */
export const CITY_BAND_METERS = 20;

/** Distance minimale des immeubles à l'axe : juste hors de la largeur jouable de base. */
export const CITY_INNER = 4.4;
/** Distance maximale : un peu en deçà des bords de la ville, à 14 m. */
export const CITY_OUTER = 13.6;

/** Les trois rangs : de l'axe vers le bord, la plage de distances qu'occupe chacun. */
export const CITY_ROWS: readonly (readonly [number, number])[] = [
  [CITY_INNER, 7.4],
  [7.8, 10.6],
  [11, CITY_OUTER],
];

/** De combien un immeuble descend sous son toit, et de combien un mât dépasse au-dessus, au plus : bornes des calculs de bandes visibles. */
export const CITY_DROP_MAX = 14;
export const CITY_RISE_MAX = 4.2;

/** Un tracé : une ligne brisée en mètres, Y vers le haut. */
export type Polyline = readonly Vec2[];

/** Un immeuble : son rang de profondeur (0 le plus proche) et ses tracés, murs et toit d'un côté, mâts de l'autre. */
export interface Building {
  readonly row: number;
  readonly lines: readonly Polyline[];
}

/** Graine de la ville : change l'ensemble des silhouettes d'un coup si l'on veut un autre horizon. */
const CITY_SEED = 0x7c17ee;

/** Types de toits : plat, à gradins, à pignon, plat avec un mât, plat avec deux mâts. */
const ROOF_STYLES = 5;

/** Graine d'un immeuble : un mélange entier du numéro de bande, du côté et du rang, déterministe et sans collision évidente. */
function buildingSeed(band: number, side: -1 | 1, row: number): number {
  const mixed = Math.imul(band | 0, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b) ^ (side < 0 ? 0x2c1b3c6d : 0x1b873593) ^ CITY_SEED;
  return mixed >>> 0;
}

/** Un immeuble de la bande, du côté et du rang donnés. */
function makeBuilding(band: number, side: -1 | 1, row: number): Building {
  const rng = createRng(buildingSeed(band, side, row));
  const range = CITY_ROWS[row] as readonly [number, number];
  const width = Math.min(range[1] - range[0], 1.4 + 1.4 * rng.next());
  const inner = range[0] + rng.next() * (range[1] - range[0] - width);
  const outer = inner + width;
  const roof = band * CITY_BAND_METERS + rng.next() * CITY_BAND_METERS;
  const bottom = roof - (6 + rng.next() * (CITY_DROP_MAX - 6));
  const style = rng.int(0, ROOF_STYLES - 1);
  const at = (distance: number, y: number): Vec2 => ({ x: side * distance, y });
  const mast = (distance: number, height: number, bar: boolean): Polyline[] => {
    const lines: Polyline[] = [[at(distance, roof), at(distance, roof + height)]];
    if (bar) lines.push([at(distance - 0.25, roof + height * 0.72), at(distance + 0.25, roof + height * 0.72)]);
    return lines;
  };

  let walls: Vec2[];
  let masts: Polyline[] = [];
  if (style === 1) {
    // Gradins : un retrait au milieu du toit.
    const step = 0.8 + rng.next();
    walls = [at(inner, bottom), at(inner, roof), at(inner + width * 0.3, roof), at(inner + width * 0.3, roof + step), at(outer - width * 0.2, roof + step), at(outer - width * 0.2, roof), at(outer, roof), at(outer, bottom)];
  } else if (style === 2) {
    // Pignon : un toit à deux pentes.
    const pitch = 0.8 + 0.8 * rng.next();
    walls = [at(inner, bottom), at(inner, roof), at(inner + width / 2, roof + pitch), at(outer, roof), at(outer, bottom)];
  } else {
    walls = [at(inner, bottom), at(inner, roof), at(outer, roof), at(outer, bottom)];
    if (style === 3) masts = mast(inner + width * (0.3 + 0.4 * rng.next()), 1.5 + 2.7 * rng.next(), true);
    if (style === 4) masts = [...mast(inner + width * 0.25, 1.2 + 1.2 * rng.next(), false), ...mast(inner + width * 0.75, 2 + 2.2 * rng.next(), true)];
  }
  return { row, lines: [walls, ...masts] };
}

/** Mémoire des bandes déjà calculées : la même bande revient à chaque image. Bornée, la ville étant infinie. */
const cache = new Map<number, readonly Building[]>();
const CACHE_LIMIT = 64;

/**
 * Les immeubles d'une bande de 20 m, des deux côtés et des trois rangs : leurs
 * toits tombent dans la bande, leurs murs descendent au plus de `CITY_DROP_MAX`
 * sous le toit, leurs mâts montent au plus de `CITY_RISE_MAX` au-dessus.
 */
export function cityBand(band: number): readonly Building[] {
  const known = cache.get(band);
  if (known) return known;
  const buildings: Building[] = [];
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < CITY_ROWS.length; row += 1) buildings.push(makeBuilding(band, side, row));
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(band, buildings);
  return buildings;
}

/**
 * Les bandes dont un immeuble peut toucher l'intervalle de hauteurs
 * [`bottom`, `top`] : du numéro le plus bas au plus haut, inclus.
 */
export function bandsInView(bottom: number, top: number): { readonly first: number; readonly last: number } {
  return {
    first: Math.ceil((bottom - CITY_RISE_MAX - CITY_BAND_METERS) / CITY_BAND_METERS),
    last: Math.floor((top + CITY_DROP_MAX) / CITY_BAND_METERS),
  };
}

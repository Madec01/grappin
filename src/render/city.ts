import { createRng, type Rng } from '../core/math/rng';
import type { Vec2 } from '../core/math/vec2';

/**
 * Structures abstraites : des colonnes fines, des cadres ouverts et des rails
 * empilés en contour très fin, sur les côtés du jeu, qui défilent avec la
 * hauteur. Ni fenêtre, ni toit, ni antenne, ni bâtiment : des traits droits,
 * horizontaux ou verticaux, jamais refermés sur eux-mêmes. (Les noms de code,
 * « city » et « cityBand », datent du premier décor ; ils ne disent plus rien
 * du dessin.)
 *
 * Tout est une fonction de la hauteur et de rien d'autre : le monde est coupé
 * en bandes de 20 m, et chaque bande tire ses structures d'un générateur seedé
 * par son numéro (jamais `Math.random`). La même bande donne toujours les mêmes
 * traits, d'une partie, d'un appareil et d'une image à l'autre. Sans PixiJS ni
 * temps réel : le rendu ne fait que les tracer.
 *
 * Les structures restent hors de la largeur jouable de base (± 4 m) et en deçà
 * des bords de la zone jouable (± 14 m). Trois rangs de profondeur, du plus
 * proche au plus loin, que le rendu éclaircit ou assombrit : le rang 0 se
 * devine au bord de l'écran, les suivants n'apparaissent que lorsque la
 * caméra dézoome ou que le niveau bascule.
 */

/** Hauteur d'une bande, en mètres. */
export const CITY_BAND_METERS = 20;

/** Distance minimale des structures à l'axe : juste hors de la largeur jouable de base. */
export const CITY_INNER = 4.4;
/** Distance maximale : un peu en deçà des bords de la zone jouable, à 14 m. */
export const CITY_OUTER = 13.6;

/** Les trois rangs : de l'axe vers le bord, la plage de distances qu'occupe chacun. */
export const CITY_ROWS: readonly (readonly [number, number])[] = [
  [CITY_INNER, 7.4],
  [7.8, 10.6],
  [11, CITY_OUTER],
];

/**
 * De combien une structure descend sous le haut de sa bande au plus, et de
 * combien elle le dépasse : rien, aucun trait ne monte au-dessus du sommet que
 * la bande lui donne. Bornes des calculs de bandes visibles.
 */
export const CITY_DROP_MAX = 14;
export const CITY_RISE_MAX = 0;

/** Un tracé : une ligne brisée en mètres, Y vers le haut. */
export type Polyline = readonly Vec2[];

/**
 * Une structure : son rang de profondeur (0 le plus proche) et ses tracés,
 * tous en mètres, tous dans la plage de distances de son rang. Chaque segment
 * est horizontal ou vertical, et aucun tracé ne se referme sur son départ.
 */
export interface Structure {
  readonly row: number;
  readonly lines: readonly Polyline[];
}

/** Graine du décor : change l'ensemble des structures d'un coup si l'on veut un autre horizon. */
const CITY_SEED = 0x7c17ee;

/** Les familles de structures. Les colonnes tirent deux fois : elles font l'essentiel du rythme. */
const FAMILIES = ['colonnes', 'colonnes', 'cadre', 'cadres-emboites', 'rails', 'rails'] as const;
type Family = (typeof FAMILIES)[number];

/** Graine d'une structure : un mélange entier du numéro de bande, du côté et du rang, déterministe et sans collision évidente. */
function structureSeed(band: number, side: -1 | 1, row: number): number {
  const mixed = Math.imul(band | 0, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b) ^ (side < 0 ? 0x2c1b3c6d : 0x1b873593) ^ CITY_SEED;
  return mixed >>> 0;
}

/**
 * Ce que toute structure d'une bande partage : où elle se tient (de `near` à
 * `far`, en distance de l'axe), et de quelle hauteur elle descend sous son
 * sommet `top`. `at` pose un point à une distance de l'axe, du bon côté.
 */
interface Frame {
  readonly near: number;
  readonly far: number;
  readonly top: number;
  readonly depth: number;
  readonly at: (distance: number, y: number) => Vec2;
}

/** Part des paires de colonnes que rien ne relie. */
const TIE_FREE = 0.25;

/**
 * Des colonnes de hauteurs variées, deux à quatre, que la plupart du temps un
 * court trait horizontal relie deux à deux. Un seul trait par paire : deux
 * traits et leurs deux colonnes refermeraient un rectangle, qui se lirait
 * comme une fenêtre.
 */
function columns(rng: Rng, frame: Frame, count: number): Polyline[] {
  const { near, far, top, depth, at } = frame;
  const step = (far - near) / (count - 1);
  const xs: number[] = [];
  const tops: number[] = [];
  const bottoms: number[] = [];
  const lines: Polyline[] = [];
  for (let i = 0; i < count; i += 1) {
    // Les colonnes du milieu se décalent un peu ; celles des bords restent sur les bords de la structure.
    const jitter = i === 0 || i === count - 1 ? 0 : (rng.next() - 0.5) * step * 0.3;
    const x = near + i * step + jitter;
    const columnTop = top - rng.next() * depth * 0.35;
    const columnBottom = top - depth * (0.65 + 0.35 * rng.next());
    xs.push(x);
    tops.push(columnTop);
    bottoms.push(columnBottom);
    lines.push([at(x, columnBottom), at(x, columnTop)]);
  }
  for (let i = 0; i + 1 < count; i += 1) {
    // Le trait ne s'accroche qu'à ce que les deux colonnes ont en commun, à l'écart de leurs extrémités.
    const low = Math.max(bottoms[i] as number, bottoms[i + 1] as number) + 0.5;
    const high = Math.min(tops[i] as number, tops[i + 1] as number) - 0.5;
    const y = low + rng.next() * (high - low);
    // Certaines paires restent libres : des colonnes seules, de hauteurs différentes.
    if (high <= low || rng.next() < TIE_FREE) continue;
    lines.push([at(xs[i] as number, y), at(xs[i + 1] as number, y)]);
  }
  return lines;
}

/** Le côté du cadre que l'on laisse ouvert : jamais le bas, un cadre ouvert par le bas fait une arche, donc une porte. */
const OPENINGS = ['haut', 'proche', 'loin'] as const;
type Opening = (typeof OPENINGS)[number];

/**
 * Un cadre rectangulaire ouvert : trois côtés d'un seul trait, le quatrième
 * manque. `inset` : de combien le cadre est rentré, pour en poser un second à
 * l'intérieur du premier, ouvert du même côté.
 */
function frameOutline(frame: Frame, height: number, opening: Opening, inset: number): Polyline {
  const { near, far, top, at } = frame;
  const a = near + inset;
  const b = far - inset;
  const upper = top - inset;
  const lower = top - height + inset;
  switch (opening) {
    case 'haut':
      return [at(a, upper), at(a, lower), at(b, lower), at(b, upper)];
    case 'proche':
      return [at(a, upper), at(b, upper), at(b, lower), at(a, lower)];
    case 'loin':
      return [at(b, upper), at(a, upper), at(a, lower), at(b, lower)];
  }
}

/**
 * Des rails empilés : trois à cinq traits horizontaux à intervalle régulier,
 * serrés contre un bord, soit de longueurs en escalier, soit de longueurs
 * tirées. Parfois une colonne les relie du côté où ils s'appuient : un peigne,
 * jamais un cadre fermé.
 */
function rails(rng: Rng, frame: Frame): Polyline[] {
  const { near, far, top, depth, at } = frame;
  const count = rng.int(3, 5);
  const spacing = Math.min(0.9 + 0.7 * rng.next(), depth / count);
  const stair = rng.next() < 0.5;
  const fromNear = rng.next() < 0.5;
  const width = far - near;
  const lines: Polyline[] = [];
  for (let i = 0; i < count; i += 1) {
    const length = width * (stair ? 1 - 0.2 * i : 0.5 + 0.5 * rng.next());
    const y = top - i * spacing;
    lines.push(fromNear ? [at(near, y), at(near + length, y)] : [at(far - length, y), at(far, y)]);
  }
  if (rng.next() < 0.4) {
    const edge = fromNear ? near : far;
    lines.push([at(edge, top - (count - 1) * spacing), at(edge, top)]);
  }
  return lines;
}

/** Une structure de la bande, du côté et du rang donnés. */
function makeStructure(band: number, side: -1 | 1, row: number): Structure {
  const rng = createRng(structureSeed(band, side, row));
  const range = CITY_ROWS[row] as readonly [number, number];
  const width = Math.min(range[1] - range[0], 1.2 + 1.6 * rng.next());
  const near = range[0] + rng.next() * (range[1] - range[0] - width);
  const frame: Frame = {
    near,
    far: near + width,
    top: band * CITY_BAND_METERS + rng.next() * CITY_BAND_METERS,
    depth: 6 + rng.next() * (CITY_DROP_MAX - 6),
    at: (distance, y) => ({ x: side * distance, y }),
  };
  const family: Family = rng.pick(FAMILIES);
  const height = frame.depth * (0.5 + 0.4 * rng.next());
  const opening = rng.pick(OPENINGS);
  let lines: Polyline[];
  if (family === 'colonnes') {
    lines = columns(rng, frame, rng.int(2, 4));
  } else if (family === 'rails') {
    lines = rails(rng, frame);
  } else if (family === 'cadre') {
    lines = [frameOutline(frame, height, opening, 0)];
  } else {
    // Deux cadres emboîtés, ouverts du même côté : l'intérieur rentre sans jamais se réduire à rien.
    const inset = Math.min(0.35 + 0.3 * rng.next(), (Math.min(width, height) - 0.4) / 2);
    lines = [frameOutline(frame, height, opening, 0), frameOutline(frame, height, opening, inset)];
  }
  return { row, lines };
}

/** Mémoire des bandes déjà calculées : la même bande revient à chaque image. Bornée, le décor étant infini. */
const cache = new Map<number, readonly Structure[]>();
const CACHE_LIMIT = 64;

/**
 * Les structures d'une bande de 20 m, des deux côtés et des trois rangs : le
 * sommet de chacune tombe dans la bande, ses traits descendent au plus de
 * `CITY_DROP_MAX` sous ce sommet, et rien ne monte au-dessus (`CITY_RISE_MAX`).
 */
export function cityBand(band: number): readonly Structure[] {
  const known = cache.get(band);
  if (known) return known;
  const structures: Structure[] = [];
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < CITY_ROWS.length; row += 1) structures.push(makeStructure(band, side, row));
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(band, structures);
  return structures;
}

/**
 * Les bandes dont une structure peut toucher l'intervalle de hauteurs
 * [`bottom`, `top`] : du numéro le plus bas au plus haut, inclus.
 */
export function bandsInView(bottom: number, top: number): { readonly first: number; readonly last: number } {
  return {
    first: Math.ceil((bottom - CITY_RISE_MAX - CITY_BAND_METERS) / CITY_BAND_METERS),
    last: Math.floor((top + CITY_DROP_MAX) / CITY_BAND_METERS),
  };
}

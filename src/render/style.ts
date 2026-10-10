import { Text } from 'pixi.js';

/**
 * Style commun du rendu : palette grise, police système, fabrique de textes
 * et forme de l'étoile.
 * Le décor (renderer.ts) et les écrans posés dessus (screens.ts) y puisent.
 */

export const COLOR = {
  background: '#0b0f1e',
  altitudeLine: 0x1c2542,
  altitudeLabel: 0x6f7a96,
  roof: 0x58627a,
  obstacle: 0x3a4360,
  obstacleEdge: 0x8a94a6,
  anchor: 0x8a94a6,
  anchorFragile: 0xc9d1e3,
  crack: 0x0b0f1e,
  kindMark: 0xc9d1e3,
  wear: 0xf4f6fb,
  target: 0xe8eefc,
  /** Ligne d'arrivée d'un niveau. */
  finish: 0xe8eefc,
  rope: 0xc9d1e3,
  /** Câble d'une accroche qui glisse : un trait discret sous elle. */
  cable: 0x8a94a6,
  /** Traînées du coup de vent. */
  wind: 0xc9d1e3,
  shadow: 0xc9d1e3,
  star: 0xf4f6fb,
  fog: 0x5b6b9a,
  fogEdge: 0xa9b8e6,
  hero: 0xf4f6fb,
  text: 0xf4f6fb,
  textDim: 0xb4bdd2,
  /** Descriptions des talismans : plus petites et plus grises que leur nom. */
  textFaint: 0x8f99b0,
  /** Ligne de talisman pas encore débloquée. */
  textLocked: 0x6f7a96,
  textOutline: 0x0b0f1e,
  shade: 0x0b0f1e,
  /** Boutons et lignes de l'interface : fond, bord, et fond d'une ligne équipée. */
  panel: 0x1c2542,
  panelEquipped: 0x3a4360,
  panelEdge: 0x3a4360,
  panelEdgeEquipped: 0x8a94a6,
  buttonEdge: 0xc9d1e3,
  /** Barre d'expérience : fond et remplissage. */
  barTrack: 0x2a3350,
  barFill: 0xc9d1e3,
} as const;

/** Étoile à quatre branches : le creux entre deux pointes est à cette part du rayon. */
const STAR_PINCH = 0.28;

/** Étoile du jeu, losange concave à quatre branches, centrée en (`x`, `y`) : points à plat pour `Graphics.poly`. */
export function starPoints(x: number, y: number, outer: number): number[] {
  const inner = outer * STAR_PINCH;
  return [x, y - outer, x + inner, y - inner, x + outer, y, x + inner, y + inner, x, y + outer, x - inner, y + inner, x - outer, y, x - inner, y - inner];
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const OUTLINE_WIDTH = 4;

interface TextOptions {
  readonly bold?: boolean;
  /** Contour sombre : pour les textes qui flottent sur le décor. */
  readonly outlined?: boolean;
  /** Largeur au-delà de laquelle le texte passe à la ligne, en pixels. */
  readonly wrap?: number;
  /** Alignement des lignes entre elles ; centré par défaut. */
  readonly align?: 'left' | 'center' | 'right';
}

export function makeText(text: string, size: number, color: number, options: TextOptions = {}): Text {
  const { bold = false, outlined = false, wrap, align = 'center' } = options;
  return new Text({
    text,
    style: {
      fontFamily: FONT,
      fontSize: size,
      fontWeight: bold ? 'bold' : 'normal',
      fill: color,
      align,
      ...(wrap === undefined ? {} : { wordWrap: true, wordWrapWidth: wrap }),
      // Les textes qui flottent sur le décor gardent un contour sombre : lisibles sur toutes les formes.
      ...(outlined ? { stroke: { color: COLOR.textOutline, width: OUTLINE_WIDTH, join: 'round' as const } } : {}),
    },
  });
}

/** Hauteur de l'encoche ou de la barre du geste, en pixels CSS, exposée par index.html dans `--safe-top` et `--safe-bottom`. */
export function readSafeInset(side: 'top' | 'bottom'): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--safe-${side}`);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

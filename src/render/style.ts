import { Container, Text, type TextStyleOptions } from 'pixi.js';

/**
 * Style commun du rendu : palette néon sur fond nuit, police système, fabrique
 * de textes et forme de l'étoile.
 * Le décor (renderer.ts) et les écrans posés dessus (screens.ts) y puisent.
 *
 * Direction artistique du 10 octobre 2026 : chaque élément de jeu est un tube
 * de néon sur fond nuit. Une couleur de tube vient presque toujours avec la
 * couleur de son halo (voir neon.ts).
 *
 * Deux sortes de couleurs. `COLOR`, ici, est le langage du jeu : ce qui porte
 * un sens (étoiles, espèces de prises, obstacles, bords de la ville, textes) se
 * lit pareil sur toutes les musiques. Ce qui est ambiant (fond, ville, brume,
 * tube et halo des points normaux, accent de l'interface) change avec la
 * famille de la musique et vit dans les palettes (palette.ts).
 */

export { PALETTES, mixPalette, paletteFor, type Palette } from './palette';

export const COLOR = {
  /** Bords de la ville à ± 14 m : néon rouge sombre, la frontière de la chute. */
  cityEdge: 0xb3263f,

  /** Blanc pur : ce que la palette teinte (un dessin blanc, multiplié par une teinte, prend cette teinte). */
  white: 0xffffff,
  /** Blanc froid fixe : le cœur des tubes qui ne suivent pas l'ambiance (élastique tendu du lanceur, coche, « Arrivée »). */
  hot: 0xe6fbff,
  /** Étoiles : jaune néon, halo chaud. */
  star: 0xffe66d,
  starHalo: 0xffb347,
  /** Fragile : tube magenta, fêlure sombre. Même magenta pour le halo. */
  fragile: 0xff5ad1,
  crack: 0x070b16,
  /** Jauge d'usure du fragile tenu : un rose très clair, lisible sur le magenta. */
  wear: 0xffd6f4,
  /** Propulseur : cyan vif, chevrons. */
  booster: 0x3cf0ff,
  /** Lanceur : tube vert d'eau, un cyan qui tire sur le vert pour ne pas passer pour un propulseur. Sa coupe, son élastique et sa jauge de force ont cette couleur. */
  launcher: 0x3dffc0,
  /** Prise électrique : tube orange au calme, rouge vif quand elle est chargée (ne pas toucher). */
  electric: 0xffb547,
  electricCharged: 0xff4d4d,
  /** Prise à éclipse : tube violet, qui s'éteint en laissant une trace très sombre. */
  eclipse: 0xb388ff,
  /** Obstacles (corniches, dalles) : remplissage sombre, contour néon rouge-magenta fin. */
  obstacle: 0x120b1c,
  obstacleEdge: 0xff3b6b,

  /** Interface : textes blancs. */
  text: 0xf4f8ff,
  textDim: 0xb2c0e0,
  /** Descriptions des talismans : plus petites et plus sombres que leur nom. */
  textFaint: 0x8190b8,
  /** Ligne de talisman pas encore débloquée. */
  textLocked: 0x4c5a82,
  /** Contour sombre des textes qui flottent sur le décor. */
  textOutline: 0x070b16,
  /** Boutons et lignes de l'interface : fond, fond d'une ligne équipée, bord au repos. */
  panel: 0x0b1226,
  panelEquipped: 0x0f2038,
  panelEdge: 0x24365c,
  /** Barre d'expérience : le rail sombre (son remplissage prend l'accent de la palette). */
  barTrack: 0x141c36,
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface TextOptions {
  readonly bold?: boolean;
  /** Contour sombre : pour les textes qui flottent sur le décor. */
  readonly outlined?: boolean;
  /** Largeur au-delà de laquelle le texte passe à la ligne, en pixels. */
  readonly wrap?: number;
  /** Alignement des lignes entre elles ; centré par défaut. */
  readonly align?: 'left' | 'center' | 'right';
}

/** Le style d'un texte ; `stroke` : la couleur de son contour s'il en a un. */
function textStyle(size: number, color: number, options: TextOptions, stroke: number): TextStyleOptions {
  const { bold = false, outlined = false, wrap, align = 'center' } = options;
  return {
    fontFamily: FONT,
    fontSize: size,
    fontWeight: bold ? 'bold' : 'normal',
    fill: color,
    align,
    ...(wrap === undefined ? {} : { wordWrap: true, wordWrapWidth: wrap }),
    // Les textes qui flottent sur le décor gardent un contour sombre : lisibles sur toutes les formes.
    ...(outlined ? { stroke: { color: stroke, width: OUTLINE_WIDTH, join: 'round' as const } } : {}),
  };
}

export function makeText(text: string, size: number, color: number, options: TextOptions = {}): Text {
  return new Text({ text, style: textStyle(size, color, options, COLOR.textOutline) });
}

/** Halo d'un texte : flou proportionnel à la taille, entre 4 et 12 pixels, et opacité. */
const GLOW_ALPHA = 0.85;
const GLOW_BLUR_MIN = 4;
const GLOW_BLUR_MAX = 12;

/**
 * Un texte à halo de néon : les lettres nettes, et dessous le même texte en
 * blanc avec son ombre floue, que l'on teinte. La teinte coûte une multiplication
 * de couleur au dessin, jamais un nouveau tracé du texte : le halo suit la
 * palette, même en plein fondu, sans que le texte soit recréé. Pour les titres
 * et les bannières, pas pour un texte qui change à chaque image.
 */
export class GlowText extends Container {
  private readonly face: Text;
  private readonly halo: Text;

  constructor(text: string, size: number, color: number, glow: number, options: TextOptions = {}) {
    super();
    const blur = clamp(size / 6, GLOW_BLUR_MIN, GLOW_BLUR_MAX);
    this.face = makeText(text, size, color, options);
    this.halo = new Text({
      text,
      style: {
        ...textStyle(size, COLOR.white, options, COLOR.white),
        // Le halo déborde du texte : la marge évite qu'il soit coupé, sans changer la taille mesurée du texte.
        dropShadow: { color: COLOR.white, alpha: GLOW_ALPHA, blur, distance: 0, angle: 0 },
        padding: Math.ceil(blur * 1.5),
      },
    });
    this.halo.tint = glow;
    this.addChild(this.halo, this.face);
  }

  get text(): string {
    return this.face.text;
  }

  set text(value: string) {
    this.face.text = value;
    this.halo.text = value;
  }

  /** Couleur du halo. */
  set glow(color: number) {
    this.halo.tint = color;
  }

  /** Point d'ancrage du texte (0 à 1 de sa largeur et de sa hauteur), comme `Text.anchor`. */
  anchorAt(x: number, y: number): void {
    this.face.anchor.set(x, y);
    this.halo.anchor.set(x, y);
  }

  /** Largeur de retour à la ligne, en pixels. */
  set wrapWidth(width: number) {
    this.face.style.wordWrapWidth = width;
    this.halo.style.wordWrapWidth = width;
  }

  /** Taille du texte net, halo non compris. */
  get textWidth(): number {
    return this.face.width;
  }

  get textHeight(): number {
    return this.face.height;
  }
}

/** Hauteur de l'encoche ou de la barre du geste, en pixels CSS, exposée par index.html dans `--safe-top` et `--safe-bottom`. */
export function readSafeInset(side: 'top' | 'bottom'): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--safe-${side}`);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

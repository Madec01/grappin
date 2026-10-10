import { Text } from 'pixi.js';

/**
 * Style commun du rendu : palette néon sur fond nuit, police système, fabrique
 * de textes et forme de l'étoile.
 * Le décor (renderer.ts) et les écrans posés dessus (screens.ts) y puisent.
 *
 * Direction artistique du 10 octobre 2026 : chaque élément de jeu est un tube
 * de néon sur fond nuit. Une couleur de tube vient presque toujours avec la
 * couleur de son halo (voir neon.ts), l'une et l'autre données ici.
 */

export const COLOR = {
  /** Fond nuit, uni : le calme sur lequel tout se détache (pas de dégradé coûteux). */
  background: '#070b16',

  /** Lignes d'altitude : à peine plus claires que le fond, bleu sombre. */
  altitudeLine: 0x111a33,
  altitudeLabel: 0x34416b,
  /** Silhouettes de ville (toits, antennes) : contour très fin, bleu sombre, jamais de concurrence avec les points. */
  city: 0x1a2340,
  /** Bords de la ville à ± 14 m : néon rouge sombre, la frontière de la chute. */
  cityEdge: 0xb3263f,
  /** Toit de départ : remplissage nuit, arête cyan. */
  roofFill: 0x0c1428,

  /** Tube principal : le cœur blanc froid, et son halo cyan. Points normaux, corde, personnage, anneau de visée. */
  tube: 0xe6fbff,
  tubeHalo: 0x38e8ff,
  /** Étoiles : jaune néon, halo chaud. */
  star: 0xffe66d,
  starHalo: 0xffb347,
  /** Fragile : tube magenta, fêlure sombre (la couleur du fond). Même magenta pour le halo. */
  fragile: 0xff5ad1,
  crack: 0x070b16,
  /** Jauge d'usure du fragile tenu : un rose très clair, lisible sur le magenta. */
  wear: 0xffd6f4,
  /** Propulseur : cyan vif, chevrons. */
  booster: 0x3cf0ff,
  /** Prise électrique : tube orange au calme, rouge vif quand elle est chargée (ne pas toucher). */
  electric: 0xffb547,
  electricCharged: 0xff4d4d,
  /** Prise à éclipse : tube violet, qui s'éteint en laissant une trace très sombre. */
  eclipse: 0xb388ff,
  /** Obstacles (corniches, dalles) : remplissage sombre, contour néon rouge-magenta fin. */
  obstacle: 0x120b1c,
  obstacleEdge: 0xff3b6b,
  /** Câbles et traversières : rail tireté cyan discret. */
  cable: 0x38e8ff,
  /** Traînées du coup de vent : cyan pâle. */
  wind: 0xa8f3ff,
  /** Ombre prédictive : points cyan pâle. */
  shadow: 0x9ff4ff,
  /** Ligne d'arrivée d'un niveau : blanc froid, halo cyan. */
  finish: 0xe6fbff,
  /** Brume : nappe bleu-violet, ligne de crête lumineuse. */
  fog: 0x2a2f6b,
  fogEdge: 0x8c9cff,

  /** Interface : textes blancs, multiplicateur en cyan. */
  text: 0xf4f8ff,
  accent: 0x38e8ff,
  textDim: 0xb2c0e0,
  /** Descriptions des talismans : plus petites et plus sombres que leur nom. */
  textFaint: 0x8190b8,
  /** Ligne de talisman pas encore débloquée. */
  textLocked: 0x4c5a82,
  /** Contour sombre des textes qui flottent sur le décor. */
  textOutline: 0x070b16,
  /** Voile posé sur le jeu par les écrans. */
  shade: 0x070b16,
  /** Boutons et lignes de l'interface : fond, fond d'une ligne équipée, bords. */
  panel: 0x0b1226,
  panelEquipped: 0x0f2038,
  panelEdge: 0x24365c,
  panelEdgeEquipped: 0x38e8ff,
  /** Bord néon d'un bouton. */
  buttonEdge: 0x38e8ff,
  /** Barre d'expérience : rail sombre, remplissage cyan. */
  barTrack: 0x141c36,
  barFill: 0x38e8ff,
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
  /** Couleur d'un halo de néon autour des lettres : une ombre floue sans décalage. Pour les titres et les bannières, pas pour un texte qui change à chaque image. */
  readonly glow?: number;
}

/** Halo d'un texte : flou proportionnel à la taille, entre 4 et 12 pixels, et opacité. */
const GLOW_ALPHA = 0.85;
const GLOW_BLUR_MIN = 4;
const GLOW_BLUR_MAX = 12;

export function makeText(text: string, size: number, color: number, options: TextOptions = {}): Text {
  const { bold = false, outlined = false, wrap, align = 'center', glow } = options;
  const blur = clamp(size / 6, GLOW_BLUR_MIN, GLOW_BLUR_MAX);
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
      // Le halo déborde du texte : la marge évite qu'il soit coupé, sans changer la taille mesurée du texte.
      ...(glow === undefined ? {} : { dropShadow: { color: glow, alpha: GLOW_ALPHA, blur, distance: 0, angle: 0 }, padding: Math.ceil(blur * 1.5) }),
    },
  });
}

/** Hauteur de l'encoche ou de la barre du geste, en pixels CSS, exposée par index.html dans `--safe-top` et `--safe-bottom`. */
export function readSafeInset(side: 'top' | 'bottom'): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--safe-${side}`);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

import type { MusicFamily } from '../data/musique';
import { mixColor } from './sling';

/**
 * Les palettes d'ambiance : une par famille de musique (voir `trackFamily`).
 *
 * Une palette ne change que ce qui est ambiant, jamais ce qui porte un sens.
 * Elle donne le fond nuit, les lignes d'altitude, les silhouettes de ville, le
 * tube et le halo des points normaux, de la corde, du personnage et de l'anneau
 * de visée, la brume, l'accent de l'interface, les traînées de vent et les
 * rails des câbles. Le langage du jeu reste, lui, dans `COLOR` (style.ts) et ne
 * bouge jamais : étoiles jaunes, fragile magenta, propulseur cyan vif, prise
 * électrique orange puis rouge, prise à éclipse violette, lanceur vert d'eau,
 * obstacles et bords de la ville rouge-magenta, textes blancs.
 *
 * Pour que l'ambiance ne se confonde jamais avec une espèce de prise, le halo
 * ambiant reste hors des couleurs d'espèce (un test le garde) : les points
 * normaux se lisent par leur cœur presque blanc et leur forme, jamais par la
 * seule teinte du halo. Sans PixiJS : le jeu mène le fondu entre deux palettes.
 */

export interface Palette {
  /** Fond nuit, uni. Le voile des écrans le reprend. */
  readonly background: number;
  /** Lignes d'altitude et leur étiquette : à peine plus claires que le fond. */
  readonly altitudeLine: number;
  readonly altitudeLabel: number;
  /** Silhouettes de ville : contour très fin, jamais de concurrence avec les points. */
  readonly city: number;
  /** Dalle du toit de départ. */
  readonly roofFill: number;
  /** Cœur du tube principal (points normaux, corde, personnage, anneau de visée, arête du toit, ligne d'arrivée) : presque blanc, teinté de la famille. */
  readonly tube: number;
  /** Halo de ce tube, et rail des câbles. */
  readonly halo: number;
  /** Teinte pâle de la famille : traînées du coup de vent et ombre prédictive. */
  readonly pale: number;
  /** Brume : nappe, et ligne de crête lumineuse. */
  readonly fog: number;
  readonly fogEdge: number;
  /** Accent de l'interface : multiplicateur, titres à halo, contour des boutons, barre d'expérience. */
  readonly accent: number;
}

/** « Cyan nuit » : l'ambiance d'origine du jeu, et celle du menu. */
const CYAN_NIGHT: Palette = {
  background: 0x070b16,
  altitudeLine: 0x111a33,
  altitudeLabel: 0x34416b,
  city: 0x1a2340,
  roofFill: 0x0c1428,
  tube: 0xe6fbff,
  halo: 0x38e8ff,
  pale: 0xa8f3ff,
  fog: 0x2a2f6b,
  fogEdge: 0x8c9cff,
  accent: 0x38e8ff,
};

/** Une palette par famille de musique : cinq ambiances distinctes, et le menu qui reprend la première. */
export const PALETTES: Record<MusicFamily, Palette> = {
  biome1: CYAN_NIGHT,
  /** « Indigo ». */
  biome2: {
    background: 0x09071a,
    altitudeLine: 0x17112f,
    altitudeLabel: 0x413b6a,
    city: 0x231a40,
    roofFill: 0x120e27,
    tube: 0xeef0ff,
    halo: 0x7b8cff,
    pale: 0xc5ccff,
    fog: 0x3a2a6b,
    fogEdge: 0xa89cff,
    accent: 0x9aa6ff,
  },
  /** « Glace » : un halo blanc-bleu. */
  biome3: {
    background: 0x06101a,
    altitudeLine: 0x111f2f,
    altitudeLabel: 0x3f566a,
    city: 0x1a2c40,
    roofFill: 0x0d1a27,
    tube: 0xf6fdff,
    halo: 0xb8f0ff,
    pale: 0xe0f8ff,
    fog: 0x2a4a6b,
    fogEdge: 0xa8d8ff,
    accent: 0xdff7ff,
  },
  /** « Lime ». */
  biome4: {
    background: 0x070f0b,
    altitudeLine: 0x11211b,
    altitudeLabel: 0x45633e,
    city: 0x1a3028,
    roofFill: 0x0e1b15,
    tube: 0xf8ffea,
    halo: 0xc8ff5a,
    pale: 0xe7ffb6,
    fog: 0x2f5a4a,
    fogEdge: 0xb8ff9c,
    accent: 0xd9ff7a,
  },
  /** « Braise » : un halo blanc chaud sur un fond rouge sombre. */
  boss: {
    background: 0x120709,
    altitudeLine: 0x2b111a,
    altitudeLabel: 0x65454c,
    city: 0x401a28,
    roofFill: 0x220e14,
    tube: 0xfffdf8,
    halo: 0xfff0c8,
    pale: 0xfff8e7,
    fog: 0x5a2a3a,
    fogEdge: 0xffb8c8,
    accent: 0xffe0b0,
  },
  /** Le menu et les écrans hors partie reprennent l'ambiance d'origine. */
  menu: CYAN_NIGHT,
};

/** La palette de la famille `family`. */
export function paletteFor(family: MusicFamily): Palette {
  return PALETTES[family];
}

/**
 * Le mélange de `a` vers `b`, canal par canal : `t` de 0 (tout `a`) à 1 (tout
 * `b`). Aux extrémités, la palette donnée elle-même : le rendu reconnaît une
 * palette qui n'a pas changé à sa seule identité.
 */
export function mixPalette(a: Palette, b: Palette, t: number): Palette {
  if (!(t > 0)) return a;
  if (t >= 1) return b;
  return {
    background: mixColor(a.background, b.background, t),
    altitudeLine: mixColor(a.altitudeLine, b.altitudeLine, t),
    altitudeLabel: mixColor(a.altitudeLabel, b.altitudeLabel, t),
    city: mixColor(a.city, b.city, t),
    roofFill: mixColor(a.roofFill, b.roofFill, t),
    tube: mixColor(a.tube, b.tube, t),
    halo: mixColor(a.halo, b.halo, t),
    pale: mixColor(a.pale, b.pale, t),
    fog: mixColor(a.fog, b.fog, t),
    fogEdge: mixColor(a.fogEdge, b.fogEdge, t),
    accent: mixColor(a.accent, b.accent, t),
  };
}

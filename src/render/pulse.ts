import { BEAT_DECAY, type Pulse } from '../audio/rhythm';
import { noise } from './effects';
import type { Palette } from './palette';
import { mixColor } from './sling';

/**
 * Ce que le pouls de la musique fait à l'ambiance lumineuse.
 *
 * Le pouls (voir `audio/rhythm.ts`) dit où en est le temps, quelle est sa force
 * et combien il y a de graves, de médiums et d'aigus. Ici, des fonctions pures
 * et sans PixiJS le traduisent en couleurs et en multiplicateurs, que le rendu
 * pose par-dessus la palette de la famille de musique. Rien d'autre que
 * l'intensité et la teinte ne bouge : jamais une forme, une taille ou une
 * position, et jamais la couleur d'une espèce de prise (`COLOR`, style.ts), qui
 * porte un sens.
 *
 * Le propriétaire veut un jeu « hyper dynamique visuellement », aux couleurs
 * qui changent vite : la couleur d'effet change donc à chaque temps, parmi les
 * trois couleurs d'effet de la palette (A sur le temps fort, puis B, C, B), le
 * temps fort frappe plus fort que les trois autres, et le fond, la crête de
 * brume, la dalle du toit et les structures du décor prennent la couleur du moment.
 *
 * Règle absolue : au silence (`SILENT_PULSE`, ou tout pouls sans temps ni graves),
 * rien ne change. Chaque multiplicateur y vaut exactement 1, chaque ajout
 * exactement 0, et `pulsedPalette` rend la palette reçue elle-même : le rendu
 * musique coupée est, pixel pour pixel, celui d'avant le pouls.
 */

/**
 * Tous les réglages du pouls, au même endroit. Les amplitudes sont des parts de
 * 0 à 1 de ce que le pouls donne : un temps franc (`beat` et `strength` à 1) ou
 * des graves à fond. Sur le temps fort de la mesure, le coup est renforcé de
 * `beat.downbeat` ; les multiplicateurs peuvent alors dépasser leur part nominale
 * d'autant.
 */
export const PULSE = {
  /** Le coup : part de renfort sur le temps fort de chaque mesure. */
  beat: { downbeat: 0.3 },
  /** Fond : il monte vers la brume de cette part sur le temps (× force) et avec les graves, sans jamais dépasser `max` ; et il se teinte de la couleur d'effet de `tint` sur le temps. */
  background: { beat: 0.16, bass: 0.06, max: 0.24, tint: 0.08 },
  /** Crête de la brume : part de couleur d'effet prise sur le temps (× force), puis part de blanc ajoutée. */
  fogEdge: { tint: 0.5, beat: 0.6 },
  /** Nappe de la brume : opacité ajoutée avec les graves. */
  fogSheet: { bass: 0.08 },
  /** Dalle du toit de départ et plateformes : part de couleur d'effet prise sur le temps (× force). */
  roof: { beat: 0.15 },
  /** Structures du décor (`city`) : part de la couleur d'effet mélangée aux traits avec les graves, et, sur celles qui dansent, part de la couleur d'effet sur le temps (× force). */
  city: { bass: 0.7, dance: 1 },
  /** Halo des tubes ambiants : de combien la portée et l'intensité grandissent sur le temps (× force). */
  halo: { spread: 0.7, strength: 1 },
  /** Halo des espèces de prises : intensité ajoutée sur le temps (× force). Leurs couleurs ne bougent pas. */
  species: { strength: 0.5 },
  /** Halo du cerne des obstacles : intensité ajoutée, sur le temps (× force) ou avec les graves, le plus fort des deux. */
  rim: { strength: 0.6 },
  /** Étoiles : amplitude du scintillement de la portée de leur halo avec les aigus, et nombre de ses à-coups par seconde. */
  star: { reach: 0.7, hz: 10 },
  /** Interface : de combien le multiplicateur grossit sur le temps (× force). */
  ui: { multiplier: 0.18 },
  /** Couleur d'effet : part du temps pendant laquelle l'ancienne couleur fond vers la nouvelle (le reste du temps, la nouvelle est franche). */
  effect: { blend: 0.3 },
} as const;

/** Les couleurs d'effet de la palette, dans l'ordre des temps de la mesure : A sur le temps fort, puis B, C, B. */
const EFFECT_SEQUENCE = ['effectA', 'effectB', 'effectC', 'effectB'] as const;

/** Le blanc, vers lequel la crête de brume s'éclaire. */
const WHITE = 0xffffff;

/** `value` borné entre 0 et 1 ; tout ce qui n'est pas un nombre positif vaut 0. */
function unit(value: number): number {
  return value > 0 ? Math.min(1, value) : 0;
}

/**
 * Le coup du temps : 1 sur un temps franc, retombe vers 0 jusqu'au suivant,
 * d'autant plus faible que le temps l'est ; renforcé sur le temps fort de la
 * mesure, où il peut dépasser 1 de `PULSE.beat.downbeat`.
 */
function punch(pulse: Pulse): number {
  const hit = unit(pulse.beat) * unit(pulse.strength);
  return pulse.inBar === 0 && pulse.count >= 0 ? hit * (1 + PULSE.beat.downbeat) : hit;
}

/** Le plus fort coup possible : un temps fort franc. */
export const PUNCH_MAX = 1 + PULSE.beat.downbeat;

/** Courbe douce de 0 à 1 : pas d'à-coup au début ni à la fin d'un fondu. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Où en est le temps courant, de 0 (il vient de tomber) à 1 (le suivant arrive) :
 * l'inverse de la décroissance de `beat` (voir `BEAT_DECAY`). Il sert à mener un
 * fondu à partir du seul pouls, sans horloge.
 */
function beatProgress(beat: number): number {
  if (!(beat > 0)) return 1;
  if (beat >= 1) return 0;
  return Math.min(1, -Math.log(beat) / BEAT_DECAY);
}

/** La place dans la mesure, bornée à la séquence des couleurs d'effet. */
function sequenceIndex(inBar: number): number {
  const index = Number.isFinite(inBar) ? Math.floor(inBar) : 0;
  return ((index % EFFECT_SEQUENCE.length) + EFFECT_SEQUENCE.length) % EFFECT_SEQUENCE.length;
}

/**
 * La couleur d'effet : elle change à chaque temps. Sur le temps fort de la
 * mesure, la couleur A de la palette ; puis B, C et B sur les trois temps
 * suivants. Au début de chaque temps, elle fond de la couleur du temps
 * précédent vers la nouvelle pendant la part `PULSE.effect.blend` du temps, puis
 * tient franche. Au silence et avant le premier temps, le halo de la palette.
 * Ce sont toujours des couleurs d'ambiance : jamais celle d'une espèce.
 */
export function effectColor(palette: Palette, pulse: Pulse): number {
  if (pulse.count < 0) return palette.halo;
  const index = sequenceIndex(pulse.inBar);
  const current = palette[EFFECT_SEQUENCE[index]!];
  const previous = palette[EFFECT_SEQUENCE[(index + EFFECT_SEQUENCE.length - 1) % EFFECT_SEQUENCE.length]!];
  if (previous === current) return current;
  const progress = beatProgress(pulse.beat) / PULSE.effect.blend;
  if (progress >= 1) return current;
  return mixColor(previous, current, smooth(progress));
}

/**
 * La palette dans laquelle le pouls la plonge : le fond monte vers la brume sur
 * le temps et avec les graves (jamais de plus de `PULSE.background.max`) et se
 * teinte de la couleur d'effet, la crête de brume prend la couleur d'effet et
 * s'éclaire sur le temps, la dalle du toit se teinte sur le temps, les structures
 * du décor se teintent vers la couleur d'effet avec les graves, et le halo ambiant est la
 * couleur d'effet. Le reste (lignes d'altitude, cœur du tube, accent) ne bouge
 * pas. Au silence, la palette reçue elle-même (`===`), si bien que le rendu la
 * reconnaît à son identité.
 */
export function pulsedPalette(palette: Palette, pulse: Pulse): Palette {
  const hit = punch(pulse);
  const bass = unit(pulse.bass);
  const lift = Math.min(PULSE.background.max, PULSE.background.beat * hit + PULSE.background.bass * bass);
  const edge = Math.min(1, PULSE.fogEdge.beat * hit);
  const tint = Math.min(1, PULSE.city.bass * bass);
  const effect = effectColor(palette, pulse);
  if (lift === 0 && edge === 0 && tint === 0 && effect === palette.halo) return palette;
  const background = mixColor(mixColor(palette.background, palette.fog, lift), effect, Math.min(1, PULSE.background.tint * hit));
  const crest = mixColor(palette.fogEdge, effect, Math.min(1, PULSE.fogEdge.tint * hit));
  return {
    ...palette,
    background,
    roofFill: mixColor(palette.roofFill, effect, Math.min(1, PULSE.roof.beat * hit)),
    fogEdge: mixColor(crest, WHITE, edge),
    city: mixColor(palette.city, effect, tint),
    halo: effect,
  };
}

/** Ce que le pouls ajoute au halo d'un tube : un multiplicateur de portée et un d'intensité, tous deux à 1 au silence. */
export interface HaloBoost {
  readonly spread: number;
  readonly strength: number;
}

/**
 * Le halo des tubes ambiants (points normaux, corde, personnage, arête du toit,
 * ligne d'arrivée, rails des câbles, anneau de visée) gonfle sur le temps : plus
 * large et plus lumineux, d'autant plus que le temps est fort. Le cœur et la
 * forme du tube, eux, ne sont jamais touchés.
 */
export function ambientHalo(pulse: Pulse): HaloBoost {
  const hit = punch(pulse);
  return { spread: 1 + PULSE.halo.spread * hit, strength: 1 + PULSE.halo.strength * hit };
}

/** Multiplicateur d'intensité du halo des espèces de prises (et des étoiles) : plus lumineux sur le temps, 1 au silence. Leur couleur ne change pas. */
export function speciesGlow(pulse: Pulse): number {
  return 1 + PULSE.species.strength * punch(pulse);
}

/** Multiplicateur d'intensité du halo du cerne des obstacles : sur le temps ou avec les graves, le plus fort des deux ; 1 au silence. */
export function rimBoost(pulse: Pulse): number {
  return 1 + PULSE.rim.strength * Math.max(punch(pulse), unit(pulse.bass));
}

/**
 * Scintillement du halo d'une étoile : un multiplicateur de sa portée autour de
 * 1, d'amplitude proportionnelle aux aigus. C'est un bruit doux (interpolé entre
 * deux tirages) de `PULSE.star.hz` à-coups par seconde, que `seed` (le numéro
 * de l'étoile) décale d'une étoile à l'autre ; `seconds` est l'horloge des effets.
 * Sans aigus, exactement 1.
 */
export function starSparkle(pulse: Pulse, seconds: number, seed: number): number {
  const position = seconds * PULSE.star.hz;
  const index = Math.floor(position);
  const k = smooth(position - index);
  const base = seed * 104729;
  const wave = noise(index * 31 + base) * (1 - k) + noise((index + 1) * 31 + base) * k;
  return 1 + PULSE.star.reach * unit(pulse.high) * (2 * wave - 1);
}

/** Taille du multiplicateur (×N) de l'interface : il grossit sur le temps, 1 au silence. */
export function multiplierPop(pulse: Pulse): number {
  return 1 + PULSE.ui.multiplier * punch(pulse);
}

/** Opacité de la nappe de brume : `base`, un peu plus dense avec les graves, jamais au-delà de 1. */
export function fogSheetAlpha(base: number, pulse: Pulse): number {
  return Math.min(1, base + PULSE.fogSheet.bass * unit(pulse.bass));
}

/**
 * Halo des titres et de la bannière : l'accent de la palette tant que rien ne
 * bat (comme avant le pouls), la couleur d'effet dès que la musique marque les temps.
 */
export function uiGlow(palette: Palette, pulse: Pulse): number {
  return pulse.count < 0 ? palette.accent : effectColor(palette, pulse);
}

/**
 * Les deux lots de couleur du décor, pour des structures qui dansent : les
 * structures d'index pair s'allument vers la couleur d'effet sur les temps pairs
 * de la mesure (0 et 2), les impairs sur les temps impairs (1 et 3), puis
 * retombent avec le temps. `palette` est celle que le pouls a déjà teintée : son
 * halo est la couleur d'effet. Rend `[pairs, impairs]`, ou null quand rien ne
 * s'allume (au silence, ou temps retombé) : le rendu garde alors un seul lot,
 * celui de la palette, et ne paie rien de plus. Jamais plus de deux couleurs,
 * donc jamais plus de deux lots par rang.
 */
export function cityLots(palette: Palette, pulse: Pulse): readonly [number, number] | null {
  const lit = mixColor(palette.city, palette.halo, Math.min(1, PULSE.city.dance * punch(pulse)));
  if (lit === palette.city) return null;
  return sequenceIndex(pulse.inBar) % 2 === 0 ? [lit, palette.city] : [palette.city, lit];
}

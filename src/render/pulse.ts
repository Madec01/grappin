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
 * pose par-dessus la palette de la famille de musique. Sur ce qui se joue, rien
 * d'autre que l'intensité et la teinte ne bouge : jamais une forme, une taille
 * ou une position de point, d'obstacle ou de personnage, et jamais la couleur
 * d'une espèce de prise (`COLOR`, style.ts), qui porte un sens. Seul le décor
 * lointain, les traits de la ville, bat aussi en épaisseur et en opacité.
 *
 * Le propriétaire veut un jeu « hyper dynamique visuellement », aux couleurs
 * qui changent vite : la couleur d'effet change donc à chaque temps, parmi les
 * trois couleurs d'effet de la palette (A sur le temps fort, puis B, C, B), le
 * temps fort frappe plus fort que les trois autres, et le fond, la crête de
 * brume, la dalle du toit et les structures du décor prennent la couleur du moment.
 *
 * Retour du propriétaire sur la 0.12.0 : « les éléments de décor ne pulsent pas
 * assez avec la musique, c'est trop faible ; je veux quelque chose de dynamique,
 * de nerveux ». Trois causes, trois réponses. Les amplitudes étaient modestes :
 * elles ont presque doublé. La retombée après un temps était douce : elle est
 * plus sèche (`BEAT_DECAY`, audio/rhythm.ts), et la couleur d'effet claque plus
 * vite. Et surtout, tout ce qui bat sur le temps était multiplié par la force du
 * temps, or sur les pistes du jeu la force médiane d'un temps est entre 0,35 et
 * 0,65, un temps sur deux sous 0,5 : le coup restait à moitié. Le coup vaut
 * désormais `floor + (1 − floor) × √force` (voir `punch`) : un temps moyen frappe
 * presque à plein, un temps deviné dans un passage calme frappe encore à moitié.
 * Deux garde-fous, vus en capture : le halo ambiant ne gagne pas plus qu'avant
 * en intensité (au-delà, il sature en disque plat au lieu de luire), et la teinte
 * du fond reste faible (au-delà, le temps fort grise toute l'image).
 * De même, les graves des pistes ne descendent presque jamais sous 0,2 : ce qui
 * les suit restait allumé en continu ; ils ne comptent qu'au-dessus d'un seuil.
 *
 * Second retour (0.12.2) : « le but de la lumière colorée, c'est que ça change de
 * couleur aussi ». Les trois couleurs d'effet de chaque palette étaient trois
 * bleus voisins : elles sont maintenant trois teintes franchement différentes
 * (palette.ts), et tant que la musique bat, le fond, la nappe de brume, la dalle
 * et le décor en gardent une part (`hold`) pendant tout le temps, pas seulement
 * sur le coup : la lumière est colorée, et change de couleur à chaque temps.
 *
 * Règle absolue : au silence (`SILENT_PULSE`, ou tout pouls sans temps ni graves),
 * rien ne change. Chaque multiplicateur y vaut exactement 1, chaque ajout
 * exactement 0, et `pulsedPalette` rend la palette reçue elle-même : le rendu
 * musique coupée est, pixel pour pixel, celui d'avant le pouls.
 */

/**
 * Tous les réglages du pouls, au même endroit. Les amplitudes sont des parts de
 * ce que le pouls donne : un temps franc (`beat` à 1, force à 1) ou des graves à
 * fond. Sur le temps fort de la mesure, le coup est renforcé de `beat.downbeat` ;
 * les multiplicateurs peuvent alors dépasser leur part nominale d'autant.
 */
export const PULSE = {
  /** Le coup : part de renfort sur le temps fort de chaque mesure, et plancher de la force d'un temps (le coup vaut `floor + (1 − floor) × √force`). */
  beat: { downbeat: 0.5, floor: 0.3 },
  /** Les graves : rien en dessous de `from`, puis de 0 à 1 jusqu'à fond. Sans ce seuil, ce qu'ils mènent resterait allumé en continu. */
  bass: { from: 0.3 },
  /** Fond : il monte vers la brume de cette part sur le temps (× coup) et avec les graves, sans jamais dépasser `max` ; et il se teinte de la couleur d'effet, de `hold` tout le temps que la musique bat et de `tint` en plus sur le temps. */
  background: { beat: 0.3, bass: 0.1, max: 0.4, tint: 0.12, hold: 0.2 },
  /** Crête de la brume : part de couleur d'effet prise sur le temps (× coup), puis part de blanc ajoutée. */
  fogEdge: { tint: 0.8, beat: 0.9 },
  /** Nappe de la brume : opacité ajoutée avec les graves ; et sa couleur prend celle de l'effet, de `hold` tant que la musique bat et de `beat` en plus sur le temps (× coup) : la lumière colorée, qui change à chaque temps. */
  fogSheet: { bass: 0.15, hold: 0.5, beat: 0.2 },
  /** Dalle du toit de départ et plateformes : part de couleur d'effet prise tant que la musique bat (`hold`), et en plus sur le temps (× coup). */
  roof: { beat: 0.35, hold: 0.2 },
  /** Structures du décor (`city`) : part de la couleur d'effet mélangée aux traits tant que la musique bat (`hold`) et avec les graves ; sur celles qui dansent, part de la couleur d'effet sur le temps (× coup) ; et sur le temps (× coup), de combien leurs traits s'épaississent et s'opacifient. */
  city: { hold: 0.3, bass: 0.6, dance: 1, width: 0.8, alpha: 0.6 },
  /** Halo des tubes ambiants : de combien la portée et l'intensité grandissent sur le temps (× coup). */
  halo: { spread: 0.8, strength: 1 },
  /** Halo des espèces de prises : intensité ajoutée sur le temps (× coup). Leurs couleurs ne bougent pas. */
  species: { strength: 0.9 },
  /** Halo du cerne des obstacles : intensité ajoutée, sur le temps (× coup) ou avec les graves, le plus fort des deux. */
  rim: { strength: 1 },
  /** Étoiles : amplitude du scintillement de la portée de leur halo avec les aigus, et nombre de ses à-coups par seconde. */
  star: { reach: 0.9, hz: 12 },
  /** Interface : de combien le multiplicateur grossit sur le temps (× coup). */
  ui: { multiplier: 0.3 },
  /** Couleur d'effet : part du temps pendant laquelle l'ancienne couleur fond vers la nouvelle (le reste du temps, la nouvelle est franche). */
  effect: { blend: 0.15 },
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
 * plus faible quand le temps l'est, mais jamais sous le plancher `PULSE.beat.floor`
 * de sa valeur (la force compte en racine : un temps moyen frappe presque à
 * plein) ; renforcé sur le temps fort de la mesure, où il peut dépasser 1 de
 * `PULSE.beat.downbeat`. Sans temps (`beat` à 0), exactement 0.
 */
function punch(pulse: Pulse): number {
  const { floor } = PULSE.beat;
  const hit = unit(pulse.beat) * (floor + (1 - floor) * Math.sqrt(unit(pulse.strength)));
  return pulse.inBar === 0 && pulse.count >= 0 ? hit * (1 + PULSE.beat.downbeat) : hit;
}

/** Les graves qui comptent : 0 jusqu'au seuil `PULSE.bass.from`, puis de 0 à 1 jusqu'à des graves à fond. */
function bassKick(pulse: Pulse): number {
  return unit((unit(pulse.bass) - PULSE.bass.from) / (1 - PULSE.bass.from));
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
 * La palette dans laquelle le pouls la plonge. Tant que la musique bat, la
 * lumière est colorée : le fond, la nappe de brume, la dalle du toit et les
 * structures du décor prennent une part (`hold`) de la couleur d'effet, qui
 * change à chaque temps ; c'est ce que le propriétaire appelle « la lumière
 * colorée qui change de couleur ». Par-dessus, sur le temps : le fond monte vers
 * la brume (jamais de plus de `PULSE.background.max`) et se teinte davantage, la
 * crête de brume prend la couleur d'effet et s'éclaire, la dalle et la nappe se
 * teintent davantage ; avec les graves, les structures du décor se teintent
 * davantage. Le halo ambiant est la couleur d'effet. Le reste (lignes
 * d'altitude, cœur du tube, accent) ne bouge pas. Au silence, la palette reçue
 * elle-même (`===`), si bien que le rendu la reconnaît à son identité.
 */
export function pulsedPalette(palette: Palette, pulse: Pulse): Palette {
  // La musique marque les temps : la lumière colorée est là, même au creux du temps. Avant le premier temps ou au silence, rien.
  const beating = pulse.count >= 0 ? 1 : 0;
  const hit = punch(pulse);
  const bass = bassKick(pulse);
  const lift = Math.min(PULSE.background.max, PULSE.background.beat * hit + PULSE.background.bass * bass);
  const edge = Math.min(1, PULSE.fogEdge.beat * hit);
  const tint = Math.min(1, PULSE.city.hold * beating + PULSE.city.bass * bass);
  const effect = effectColor(palette, pulse);
  if (beating === 0 && lift === 0 && edge === 0 && tint === 0 && effect === palette.halo) return palette;
  const background = mixColor(mixColor(palette.background, palette.fog, lift), effect, Math.min(1, PULSE.background.hold * beating + PULSE.background.tint * hit));
  const crest = mixColor(palette.fogEdge, effect, Math.min(1, PULSE.fogEdge.tint * hit));
  return {
    ...palette,
    background,
    roofFill: mixColor(palette.roofFill, effect, Math.min(1, PULSE.roof.hold * beating + PULSE.roof.beat * hit)),
    fog: mixColor(palette.fog, effect, Math.min(1, PULSE.fogSheet.hold * beating + PULSE.fogSheet.beat * hit)),
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
  return 1 + PULSE.rim.strength * Math.max(punch(pulse), bassKick(pulse));
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
  return Math.min(1, base + PULSE.fogSheet.bass * bassKick(pulse));
}

/** Ce que le pouls fait aux traits du décor lointain : un multiplicateur d'épaisseur et un d'opacité, tous deux à 1 au silence. */
export interface CityStroke {
  readonly width: number;
  readonly alpha: number;
}

/**
 * Les traits de la ville battent sur le temps : plus épais et plus opaques,
 * d'autant plus que le coup est fort, puis retombent. C'est le seul endroit où
 * le pouls touche une épaisseur : la ville est un décor, jamais une cible.
 */
export function cityStroke(pulse: Pulse): CityStroke {
  const hit = punch(pulse);
  return { width: 1 + PULSE.city.width * hit, alpha: 1 + PULSE.city.alpha * hit };
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

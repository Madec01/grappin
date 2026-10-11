import { createRng } from '../core/math/rng';
import type { Vec2 } from '../core/math/vec2';
import { multiplier } from '../sim/rules';
import type { RuleEvent } from '../sim/state';
import type { Tuning } from '../sim/tuning';
import { formatDecimal } from './format';

/**
 * Effets de temps réel : textes flottants, éclats (rebond, fracas, anneau),
 * traits de vitesse d'un anneau traversé, bannière (palier, intro d'un niveau ou événement), animation du trait du grappin, traînées du vent,
 * horloge du clignotement de l'alerte, et les ondes qui font vivre les tubes
 * de néon (pulsation, grésillement, scintillement).
 *
 * Tout ce qui dure un peu de temps réel à l'écran vit ici, jamais dans la
 * simulation. Le jeu y verse les événements de règles et le temps écoulé ; le
 * rendu relit les textes et la bannière pour les dessiner. Rien ici ne connaît
 * PixiJS.
 */

/** Durée pendant laquelle le trait du grappin se dessine à l'écran, en secondes. L'œil seulement : la physique n'attend pas. */
export const ROPE_DRAW_SECONDS = 0.06;
/** Vie d'un texte flottant, puis de la bannière de palier, en secondes. */
export const FLOAT_SECONDS = 0.7;
export const BANNER_SECONDS = 2;
/** L'intro d'un niveau se lit sur deux lignes : elle reste plus longtemps. */
export const INTRO_SECONDS = 3;
/** L'annonce d'un événement de niveau (bascule, vent, panne...) ou du retour au calme. */
export const EVENT_SECONDS = 2.5;
/** Vie d'un conseil du tutoriel, en secondes : le temps de le lire en jouant. */
export const TIP_SECONDS = 3;

/** Éclat d'un rebond, d'un fracas ou d'un anneau : bref, discret, il ne doit jamais cacher ce qui suit. Durée en secondes, et nombre maximal à la fois. */
export const FLASH_SECONDS = 0.35;
const FLASH_MAX = 6;
/** Rayon final de chaque éclat, en pixels, et part de ce rayon où il naît. */
const FLASH_RADIUS: Record<FlashKind, number> = { bounce: 38, smash: 56, ring: 46, centre: 64 };
const FLASH_START = 0.35;

/**
 * Signe de vitesse d'un anneau traversé (tout anneau accélère le personnage, `ringBoost`) : quelques traits dans l'axe de sa vitesse, derrière
 * lui, dans la teinte de l'anneau, qui reculent en s'effaçant. Discret et bref : `BOOST_SECONDS` de temps réel, `BOOST_AT_ONCE` signes au plus
 * à la fois. Chaque trait : son décalage de côté, sa longueur (pixels) et sa part de l'opacité ; ils s'écartent du bord du personnage de
 * `BOOST_GAP` pixels et reculent encore de `BOOST_DRIFT` pendant leur vie.
 */
export const BOOST_SECONDS = 0.3;
const BOOST_AT_ONCE = 2;
const BOOST_LINES: readonly { readonly side: number; readonly length: number; readonly weight: number }[] = [
  { side: 0, length: 40, weight: 1 },
  { side: -8, length: 28, weight: 0.65 },
  { side: 8, length: 28, weight: 0.65 },
];
const BOOST_GAP = 5;
const BOOST_DRIFT = 20;
/** Opacité du trait le plus vif à la naissance, et part de sa longueur qu'il perd en s'effaçant. */
const BOOST_ALPHA = 0.85;
const BOOST_SHRINK = 0.5;

/** Alerte : la ligne claire de la brume clignote ce nombre de fois par seconde, entre ces deux opacités. */
export const ALERT_BLINK_HZ = 2;
const ALERT_ALPHA_MIN = 0.3;
const ALERT_ALPHA_MAX = 1;

/**
 * Coup de vent : nombre de traînées, graine de leur tirage (des effets, pas du
 * jeu : la même partie les voit toujours pareilles), vitesse en largeurs de vue
 * par seconde et par m/s² de vent, et leurs longueurs en largeurs de vue.
 */
export const WIND_STREAKS = 20;
const WIND_SEED = 0x57ea4;
const WIND_SPEED_PER_STRENGTH = 0.25;
const WIND_LENGTH_MIN = 0.06;
const WIND_LENGTH_MAX = 0.14;
const WIND_PACE_MIN = 0.7;
const WIND_PACE_MAX = 1.3;

/** La bannière apparaît en un quart de seconde et s'efface pendant ses 0,6 dernières secondes. */
const BANNER_FADE_IN_SECONDS = 0.25;
const BANNER_FADE_OUT_SECONDS = 0.6;

/** Un texte naît au-dessus du personnage et monte encore de quelques pixels. */
const FLOAT_START_LIFT = 34;
const FLOAT_RISE = 26;
/**
 * Deux textes qui se recouvriraient s'empilent : à moins de `STACK_WIDTH` pixels
 * à l'horizontale et `STACK_CLASH` pixels à la verticale, le nouveau naît une
 * ligne au-dessus de l'ancien. `STACK_MAX` borne la recherche.
 */
const STACK_WIDTH = 130;
const STACK_CLASH = 20;
const STACK_LINE_HEIGHT = 26;
const STACK_MAX = 4;

export interface FloatingText {
  readonly text: string;
  /** Position de départ à l'écran, en pixels CSS. */
  readonly x: number;
  readonly y: number;
  /** Temps réel écoulé depuis la naissance, en secondes. */
  age: number;
}

export interface Banner {
  readonly text: string;
  /** Seconde ligne, plus petite, ou null. */
  readonly detail: string | null;
  /** Vie de la bannière, en secondes. */
  readonly seconds: number;
  age: number;
  /** Un conseil du tutoriel, plutôt qu'un événement ou un titre : le rendu peut le montrer plus doucement. */
  readonly tone?: 'tip';
}

/** Ce qu'un éclat raconte : un rebond, une paroi qui vole en éclats, un anneau traversé, un anneau traversé au centre. */
export type FlashKind = 'bounce' | 'smash' | 'ring' | 'centre';

/** Un éclat qui naît au personnage : cercle qui s'élargit en s'effaçant, à la position d'écran où il est né. */
export interface Flash {
  readonly kind: FlashKind;
  readonly x: number;
  readonly y: number;
  age: number;
}

/** Un signe de vitesse en cours : l'anneau a été traversé au centre ou non (la teinte), et depuis combien de temps réel. */
export interface RingBoost {
  readonly centred: boolean;
  age: number;
}

/**
 * Un trait de vitesse, en pixels relatifs au centre du personnage (y vers le bas) : de `x0, y0`, le plus près de lui, à `x1, y1`, le plus
 * loin derrière.
 */
export interface BoostStreak {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly alpha: number;
}

/**
 * Une traînée de vent, en fractions de la vue (0 à gauche et en haut, 1 à droite et en bas) :
 * le rendu la pose dans le repère du monde, où le vent souffle horizontalement.
 */
export interface WindStreak {
  /** Centre. */
  x: number;
  y: number;
  /** Longueur, en largeurs de vue, et rapidité relative : elles ne vont pas toutes à la même vitesse. */
  length: number;
  pace: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Opacité d'un texte flottant : pleine au début, puis de plus en plus vite vers zéro. */
export function floatAlpha(age: number): number {
  const t = clamp01(age / FLOAT_SECONDS);
  return 1 - t * t;
}

/** Montée d'un texte flottant en pixels : vive au début, puis qui ralentit. */
export function floatRise(age: number): number {
  const t = clamp01(age / FLOAT_SECONDS);
  return FLOAT_RISE * (1 - (1 - t) * (1 - t));
}

/** L'éclat que ce qui vient de se passer déclenche, ou null s'il n'en a pas. */
export function flashFor(event: RuleEvent): FlashKind | null {
  switch (event.type) {
    case 'bounce':
      return 'bounce';
    case 'smash':
      return 'smash';
    case 'ring':
      return event.centred ? 'centre' : 'ring';
    default:
      return null;
  }
}

/** Opacité d'un éclat : pleine à la naissance, puis de plus en plus vite vers zéro. */
export function flashAlpha(age: number): number {
  const t = clamp01(age / FLASH_SECONDS);
  return (1 - t) * (1 - t);
}

/** Rayon d'un éclat en pixels : il naît à une part de son rayon final et s'élargit en ralentissant. */
export function flashRadius(kind: FlashKind, age: number): number {
  const t = clamp01(age / FLASH_SECONDS);
  return FLASH_RADIUS[kind] * (FLASH_START + (1 - FLASH_START) * (1 - (1 - t) * (1 - t)));
}

/**
 * Les traits de vitesse d'un anneau traversé, à l'âge `age` : parallèles à la vitesse `(dirX, dirY)` (en pixels d'écran, y vers le bas ; seule
 * la direction compte), derrière un personnage de rayon `heroRadius` pixels. Ils partent du bord du personnage, reculent et raccourcissent en
 * s'effaçant ; le trait du milieu est le plus long et le plus vif. Rien si l'âge est hors de la vie du signe ou si le personnage ne bouge pas.
 */
export function boostStreaks(age: number, dirX: number, dirY: number, heroRadius: number): BoostStreak[] {
  const speed = Math.hypot(dirX, dirY);
  if (speed < 1e-9 || age < 0 || age >= BOOST_SECONDS) return [];
  // Vers l'arrière, et de côté.
  const bx = -dirX / speed;
  const by = -dirY / speed;
  const t = clamp01(age / BOOST_SECONDS);
  const drift = BOOST_DRIFT * (1 - (1 - t) * (1 - t));
  const alpha = BOOST_ALPHA * (1 - t) * (1 - t);
  const start = heroRadius + BOOST_GAP + drift;
  return BOOST_LINES.map((line) => {
    const end = start + line.length * (1 - BOOST_SHRINK * t);
    const sideX = -by * line.side;
    const sideY = bx * line.side;
    return { x0: bx * start + sideX, y0: by * start + sideY, x1: bx * end + sideX, y1: by * end + sideY, alpha: alpha * line.weight };
  });
}

/** Opacité de la bannière : fondu d'entrée, plateau, fondu de sortie, pour une bannière qui dure `seconds`. */
export function bannerAlpha(age: number, seconds = BANNER_SECONDS): number {
  const fadeIn = clamp01(age / BANNER_FADE_IN_SECONDS);
  const fadeOut = clamp01((seconds - age) / BANNER_FADE_OUT_SECONDS);
  return Math.min(fadeIn, fadeOut);
}

/** Opacité de la ligne claire de la brume pendant l'alerte, à l'instant `seconds` de l'horloge des effets : elle oscille `ALERT_BLINK_HZ` fois par seconde. */
export function alertAlpha(seconds: number): number {
  const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * ALERT_BLINK_HZ * seconds);
  return ALERT_ALPHA_MIN + (ALERT_ALPHA_MAX - ALERT_ALPHA_MIN) * wave;
}

/** Pulsation douce d'un halo : de `min` à 1, `hz` fois par seconde, à l'instant `seconds` de l'horloge des effets. */
export function pulse(seconds: number, hz: number, min = 0.55): number {
  const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * hz * seconds);
  return min + (1 - min) * wave;
}

/** Bruit déterministe dans [0, 1) d'un entier : une empreinte, la même sur tout moteur, jamais `Math.random`. */
export function noise(n: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Rapidité du grésillement et du scintillement des tubes : à-coups par seconde. */
export const SIZZLE_HZ = 16;
export const FLICKER_HZ = 20;
/** Part du temps où un tube qui grésille est allumé. */
const SIZZLE_ON = 0.6;

/**
 * Grésillement d'un tube qui avertit : allumé ou non, par à-coups irréguliers
 * de 1/16 s. `seed` (le numéro de la prise) décale les prises les unes des autres.
 */
export function sizzle(seconds: number, seed: number): boolean {
  return noise(Math.floor(seconds * SIZZLE_HZ) * 31 + seed * 7919) < SIZZLE_ON;
}

/** Scintillement d'un tube vivant : une opacité entre `min` et 1, qui saute `FLICKER_HZ` fois par seconde, décalée selon `seed`. */
export function flicker(seconds: number, seed: number, min = 0.55): number {
  return min + (1 - min) * noise(Math.floor(seconds * FLICKER_HZ) * 17 + seed * 104729);
}

/** Texte que ce que vient de dire la simulation fait flotter près du personnage, ou null s'il n'y en a pas. */
export function floatingTextFor(event: RuleEvent, tuning: Tuning): string | null {
  switch (event.type) {
    case 'graze':
      return 'Frôlé !';
    case 'pickup':
      return `+${tuning.pickupScore}`;
    case 'release':
      return event.perfect ? `Parfait ×${formatDecimal(multiplier(event.combo, tuning))}` : null;
    case 'boost':
      return 'Boost';
    case 'break':
      return 'Crac';
    case 'rescue':
      return 'Seconde chance !';
    case 'shock':
      return 'Décharge !';
    case 'bump':
      return 'Boum';
    case 'bounce':
      return 'Rebond';
    case 'smash':
      return 'Fracas';
    case 'ring':
      return event.centred ? 'Au centre !' : 'Anneau';
    default:
      return null;
  }
}

export class Effects {
  private readonly tuning: Tuning;
  private floating: FloatingText[] = [];
  private flashing: Flash[] = [];
  private boosting: RingBoost[] = [];
  private current: Banner | null = null;
  private ropeAge = ROPE_DRAW_SECONDS;
  private elapsed = 0;
  private readonly rng = createRng(WIND_SEED);
  private readonly streaks: WindStreak[];

  constructor(tuning: Tuning) {
    this.tuning = tuning;
    this.streaks = Array.from({ length: WIND_STREAKS }, () => ({ x: this.rng.next(), ...this.newStreak() }));
  }

  get texts(): readonly FloatingText[] {
    return this.floating;
  }

  /** Les éclats en cours, du plus ancien au plus récent. */
  get flashes(): readonly Flash[] {
    return this.flashing;
  }

  /** Les signes de vitesse en cours (anneaux traversés il y a moins de `BOOST_SECONDS`), du plus ancien au plus récent. */
  get ringBoosts(): readonly RingBoost[] {
    return this.boosting;
  }

  get banner(): Readonly<Banner> | null {
    return this.current;
  }

  /** Part du trait du grappin déjà dessinée, de 0 à 1. */
  get ropeDrawn(): number {
    return Math.min(1, this.ropeAge / ROPE_DRAW_SECONDS);
  }

  /** Temps réel écoulé depuis la naissance des effets, en secondes : l'horloge du clignotement de l'alerte. */
  get clock(): number {
    return this.elapsed;
  }

  /** Traînées du vent, à dessiner tant que `windX` n'est pas nul. */
  get windStreaks(): readonly WindStreak[] {
    return this.streaks;
  }

  /**
   * Fait vieillir les effets de `dtSeconds` de temps réel et retire ceux qui
   * sont finis. Les traînées filent dans le sens de `windX` (m/s²), d'autant
   * plus vite que le vent est fort, et ne bougent pas sans vent.
   */
  update(dtSeconds: number, windX = 0): void {
    this.elapsed += dtSeconds;
    this.ropeAge += dtSeconds;
    this.blow(dtSeconds, windX);
    for (const item of this.floating) item.age += dtSeconds;
    this.floating = this.floating.filter((item) => item.age < FLOAT_SECONDS);
    if (this.flashing.length > 0) {
      for (const flash of this.flashing) flash.age += dtSeconds;
      this.flashing = this.flashing.filter((flash) => flash.age < FLASH_SECONDS);
    }
    if (this.boosting.length > 0) {
      for (const boost of this.boosting) boost.age += dtSeconds;
      this.boosting = this.boosting.filter((boost) => boost.age < BOOST_SECONDS);
    }
    if (this.current) {
      this.current.age += dtSeconds;
      if (this.current.age >= this.current.seconds) this.current = null;
    }
  }

  /** Prend en compte un événement de règles ; `hero` est le personnage à l'écran, en pixels CSS. */
  handle(event: RuleEvent, hero: Vec2): void {
    if (event.type === 'attach') this.ropeAge = 0;
    if (event.type === 'tier') this.current = { text: `${event.name} · ${event.tier * this.tuning.tierHeight} m`, detail: null, seconds: BANNER_SECONDS, age: 0 };
    const flash = flashFor(event);
    if (flash !== null) {
      this.flashing.push({ kind: flash, x: hero.x, y: hero.y, age: 0 });
      if (this.flashing.length > FLASH_MAX) this.flashing.shift();
    }
    if (event.type === 'ring') {
      this.boosting.push({ centred: event.centred, age: 0 });
      if (this.boosting.length > BOOST_AT_ONCE) this.boosting.shift();
    }
    const text = floatingTextFor(event, this.tuning);
    if (text === null) return;
    this.floating.push({ text, x: hero.x, y: this.freeY(hero.x, hero.y - FLOAT_START_LIFT), age: 0 });
  }

  /** Annonce un niveau au départ : son titre, puis une phrase plus petite. Remplace la bannière en cours. */
  intro(title: string, detail: string): void {
    this.current = { text: title, detail, seconds: INTRO_SECONDS, age: 0 };
  }

  /** Annonce un événement de niveau, ou son retour au calme : un titre et, souvent, une phrase. Remplace la bannière en cours. */
  announce(title: string, detail: string | null): void {
    this.current = { text: title, detail, seconds: EVENT_SECONDS, age: 0 };
  }

  /** Un conseil du tutoriel, au bon moment du geste : un titre court et, souvent, une phrase. Ne remplace pas une bannière de niveau ou d'événement en cours : rend alors faux, le conseil attendra une autre occasion. */
  tip(title: string, detail: string | null): boolean {
    if (this.current && this.current.tone !== 'tip' && this.current.age < this.current.seconds) return false;
    this.current = { text: title, detail, seconds: TIP_SECONDS, age: 0, tone: 'tip' };
    return true;
  }

  /** Hauteur, longueur et rapidité d'une traînée qui naît ; son abscisse dépend d'où elle entre. */
  private newStreak(): Omit<WindStreak, 'x'> {
    return {
      y: this.rng.next(),
      length: WIND_LENGTH_MIN + (WIND_LENGTH_MAX - WIND_LENGTH_MIN) * this.rng.next(),
      pace: WIND_PACE_MIN + (WIND_PACE_MAX - WIND_PACE_MIN) * this.rng.next(),
    };
  }

  /** Pousse les traînées dans le sens du vent ; celle qui sort de la vue renaît du côté d'où il vient. */
  private blow(dtSeconds: number, windX: number): void {
    if (windX === 0) return;
    const sign = windX > 0 ? 1 : -1;
    for (const streak of this.streaks) {
      streak.x += windX * WIND_SPEED_PER_STRENGTH * streak.pace * dtSeconds;
      if (sign * (streak.x - 0.5) - streak.length / 2 <= 0.5) continue;
      Object.assign(streak, this.newStreak());
      streak.x = 0.5 - sign * (0.5 + streak.length / 2);
    }
  }

  /** Ordonnée de naissance d'un texte en `x` : `bornY`, ou plus haut s'il y recouvrirait un texte encore visible. */
  private freeY(x: number, bornY: number): number {
    let y = bornY;
    for (let attempt = 0; attempt < STACK_MAX; attempt += 1) {
      const clash = this.floating.find((item) => Math.abs(item.x - x) < STACK_WIDTH && Math.abs(item.y - floatRise(item.age) - y) < STACK_CLASH);
      if (!clash) break;
      y = clash.y - floatRise(clash.age) - STACK_LINE_HEIGHT;
    }
    return y;
  }
}

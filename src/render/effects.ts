import type { Vec2 } from '../core/math/vec2';
import { multiplier } from '../sim/rules';
import type { RuleEvent } from '../sim/state';
import type { Tuning } from '../sim/tuning';
import { formatDecimal } from './format';

/**
 * Effets de temps réel : textes flottants, bannière (palier ou intro d'un
 * niveau) et animation du trait du grappin.
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

/** Opacité de la bannière : fondu d'entrée, plateau, fondu de sortie, pour une bannière qui dure `seconds`. */
export function bannerAlpha(age: number, seconds = BANNER_SECONDS): number {
  const fadeIn = clamp01(age / BANNER_FADE_IN_SECONDS);
  const fadeOut = clamp01((seconds - age) / BANNER_FADE_OUT_SECONDS);
  return Math.min(fadeIn, fadeOut);
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
    default:
      return null;
  }
}

export class Effects {
  private readonly tuning: Tuning;
  private floating: FloatingText[] = [];
  private current: Banner | null = null;
  private ropeAge = ROPE_DRAW_SECONDS;

  constructor(tuning: Tuning) {
    this.tuning = tuning;
  }

  get texts(): readonly FloatingText[] {
    return this.floating;
  }

  get banner(): Readonly<Banner> | null {
    return this.current;
  }

  /** Part du trait du grappin déjà dessinée, de 0 à 1. */
  get ropeDrawn(): number {
    return Math.min(1, this.ropeAge / ROPE_DRAW_SECONDS);
  }

  /** Fait vieillir les effets de `dtSeconds` de temps réel et retire ceux qui sont finis. */
  update(dtSeconds: number): void {
    this.ropeAge += dtSeconds;
    for (const item of this.floating) item.age += dtSeconds;
    this.floating = this.floating.filter((item) => item.age < FLOAT_SECONDS);
    if (this.current) {
      this.current.age += dtSeconds;
      if (this.current.age >= this.current.seconds) this.current = null;
    }
  }

  /** Prend en compte un événement de règles ; `hero` est le personnage à l'écran, en pixels CSS. */
  handle(event: RuleEvent, hero: Vec2): void {
    if (event.type === 'attach') this.ropeAge = 0;
    if (event.type === 'tier') this.current = { text: `${event.name} · ${event.tier * this.tuning.tierHeight} m`, detail: null, seconds: BANNER_SECONDS, age: 0 };
    const text = floatingTextFor(event, this.tuning);
    if (text === null) return;
    this.floating.push({ text, x: hero.x, y: this.freeY(hero.x, hero.y - FLOAT_START_LIFT), age: 0 });
  }

  /** Annonce un niveau au départ : son titre, puis une phrase plus petite. Remplace la bannière en cours. */
  intro(title: string, detail: string): void {
    this.current = { text: title, detail, seconds: INTRO_SECONDS, age: 0 };
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

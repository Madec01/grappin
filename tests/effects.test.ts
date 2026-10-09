import { describe, expect, it } from 'vitest';
import {
  BANNER_SECONDS,
  Effects,
  FLOAT_SECONDS,
  ROPE_DRAW_SECONDS,
  bannerAlpha,
  floatAlpha,
  floatRise,
  floatingTextFor,
} from '../src/render/effects';
import { formatDecimal } from '../src/render/format';
import type { RuleEvent } from '../src/sim/state';
import { DEFAULT_TUNING } from '../src/sim/tuning';

const HERO = { x: 195, y: 500 };
const tier = (n: number, name: string): RuleEvent => ({ type: 'tier', tier: n, name });
const perfect = (combo: number): RuleEvent => ({ type: 'release', perfect: true, combo, held: 1, kind: 'normal', forced: false });

describe('formatDecimal', () => {
  it('écrit à la française, sans zéros inutiles, deux décimales au plus', () => {
    expect(formatDecimal(1)).toBe('1');
    expect(formatDecimal(1.25)).toBe('1,25');
    expect(formatDecimal(1.5)).toBe('1,5');
    expect(formatDecimal(1.2345)).toBe('1,23');
  });
});

describe('texte d\'un événement', () => {
  it('dit « Frôlé ! », « Boost » et « Crac »', () => {
    expect(floatingTextFor({ type: 'graze', obstacleId: 1 }, DEFAULT_TUNING)).toBe('Frôlé !');
    expect(floatingTextFor({ type: 'boost' }, DEFAULT_TUNING)).toBe('Boost');
    expect(floatingTextFor({ type: 'break', anchorId: 1 }, DEFAULT_TUNING)).toBe('Crac');
  });

  it('annonce une étoile par son réglage de score, pas par une valeur codée', () => {
    expect(floatingTextFor({ type: 'pickup', pickupId: 1 }, DEFAULT_TUNING)).toBe('+10');
    expect(floatingTextFor({ type: 'pickup', pickupId: 1 }, { ...DEFAULT_TUNING, pickupScore: 25 })).toBe('+25');
  });

  it('annonce un lâcher parfait avec le multiplicateur qu\'il vient de gagner, plafond compris', () => {
    expect(floatingTextFor(perfect(1), DEFAULT_TUNING)).toBe('Parfait ×1,25');
    expect(floatingTextFor(perfect(2), DEFAULT_TUNING)).toBe('Parfait ×1,5');
    expect(floatingTextFor(perfect(4), DEFAULT_TUNING)).toBe('Parfait ×2');
    expect(floatingTextFor(perfect(40), DEFAULT_TUNING)).toBe('Parfait ×5');
  });

  it('ne dit rien d\'un lâcher raté, ni des événements sans texte', () => {
    expect(floatingTextFor({ type: 'release', perfect: false, combo: 0, held: 1, kind: 'normal', forced: false }, DEFAULT_TUNING)).toBeNull();
    expect(floatingTextFor({ type: 'attach', anchorId: 1 }, DEFAULT_TUNING)).toBeNull();
    expect(floatingTextFor({ type: 'kick' }, DEFAULT_TUNING)).toBeNull();
    expect(floatingTextFor(tier(1, 'Les gouttières'), DEFAULT_TUNING)).toBeNull();
    expect(floatingTextFor({ type: 'death', height: 10, cause: 'fog' }, DEFAULT_TUNING)).toBeNull();
  });
});

describe('courbes d\'animation', () => {
  it('un texte flottant part opaque, ne bouge pas, puis monte en ralentissant et s\'efface en 0,7 s', () => {
    expect(FLOAT_SECONDS).toBe(0.7);
    expect(floatAlpha(0)).toBe(1);
    expect(floatRise(0)).toBe(0);
    expect(floatAlpha(FLOAT_SECONDS)).toBe(0);
    let alpha = 1;
    let rise = 0;
    for (let age = 0.05; age <= FLOAT_SECONDS; age += 0.05) {
      expect(floatAlpha(age)).toBeLessThan(alpha);
      expect(floatRise(age)).toBeGreaterThan(rise);
      alpha = floatAlpha(age);
      rise = floatRise(age);
    }
    // Hors de sa vie, rien ne dépasse.
    expect(floatAlpha(5)).toBe(0);
    expect(floatRise(5)).toBe(floatRise(FLOAT_SECONDS));
  });

  it('la bannière entre en fondu, reste pleine, puis sort en fondu avant 2 s', () => {
    expect(BANNER_SECONDS).toBe(2);
    expect(bannerAlpha(0)).toBe(0);
    expect(bannerAlpha(0.125)).toBeCloseTo(0.5, 6);
    expect(bannerAlpha(0.25)).toBe(1);
    expect(bannerAlpha(1)).toBe(1);
    expect(bannerAlpha(1.7)).toBeCloseTo(0.5, 6);
    expect(bannerAlpha(BANNER_SECONDS)).toBe(0);
  });
});

describe('textes flottants', () => {
  it('naissent au-dessus du personnage à l\'écran, puis disparaissent après 0,7 s de temps réel', () => {
    const effects = new Effects(DEFAULT_TUNING);
    effects.handle({ type: 'graze', obstacleId: 1 }, HERO);
    expect(effects.texts).toHaveLength(1);
    expect(effects.texts[0]).toMatchObject({ text: 'Frôlé !', x: HERO.x, age: 0 });
    expect(effects.texts[0]!.y).toBeLessThan(HERO.y);

    effects.update(0.69);
    expect(effects.texts).toHaveLength(1);
    expect(effects.texts[0]!.age).toBeCloseTo(0.69, 9);
    effects.update(0.02);
    expect(effects.texts).toHaveLength(0);
  });

  it('s\'empilent d\'une ligne quand ils naissent au même endroit, au lieu de se recouvrir', () => {
    const effects = new Effects(DEFAULT_TUNING);
    effects.handle({ type: 'boost' }, HERO);
    effects.handle(perfect(1), HERO);
    effects.handle({ type: 'pickup', pickupId: 1 }, HERO);
    const [first, second, third] = effects.texts;
    expect(first!.y - second!.y).toBe(26);
    expect(second!.y - third!.y).toBe(26);
  });

  it('enjambent un texte qui monte encore, mais reprennent la place d\'un texte presque arrivé en haut', () => {
    const effects = new Effects(DEFAULT_TUNING);
    effects.handle({ type: 'boost' }, HERO);
    const bornY = effects.texts[0]!.y;

    effects.update(0.3);
    effects.handle(perfect(1), HERO);
    expect(effects.texts[1]!.y).toBeCloseTo(bornY - floatRise(0.3) - 26, 9);

    // Le premier a maintenant 0,6 s : il a presque fini de monter et laisse la hauteur de naissance libre.
    effects.update(0.3);
    effects.handle({ type: 'break', anchorId: 1 }, HERO);
    expect(effects.texts.at(-1)!.y).toBe(bornY);
  });

  it('ne s\'empilent pas quand ils naissent loin les uns des autres', () => {
    const effects = new Effects(DEFAULT_TUNING);
    effects.handle({ type: 'boost' }, { x: 60, y: 500 });
    effects.handle({ type: 'boost' }, { x: 330, y: 500 });
    expect(effects.texts[0]!.y).toBe(effects.texts[1]!.y);
  });

  it('ne naissent que des événements qui en ont un', () => {
    const effects = new Effects(DEFAULT_TUNING);
    for (const event of [{ type: 'kick' }, { type: 'attach', anchorId: 1 }, { type: 'release', perfect: false, combo: 0, held: 1, kind: 'normal', forced: false }] as const) {
      effects.handle(event, HERO);
    }
    expect(effects.texts).toHaveLength(0);
  });
});

describe('bannière de palier', () => {
  it('annonce le nom et la hauteur, 2 s de temps réel, puis disparaît', () => {
    const effects = new Effects(DEFAULT_TUNING);
    expect(effects.banner).toBeNull();
    effects.handle(tier(1, 'Les gouttières'), HERO);
    expect(effects.banner).toMatchObject({ text: 'Les gouttières · 50 m', age: 0 });
    expect(effects.texts).toHaveLength(0);

    effects.update(1.99);
    expect(effects.banner).not.toBeNull();
    effects.update(0.02);
    expect(effects.banner).toBeNull();
  });

  it('calcule la hauteur avec le réglage de hauteur de palier', () => {
    const effects = new Effects({ ...DEFAULT_TUNING, tierHeight: 4 });
    effects.handle(tier(2, 'Les enseignes'), HERO);
    expect(effects.banner?.text).toBe('Les enseignes · 8 m');
  });

  it('un palier neuf remplace la bannière encore à l\'écran', () => {
    const effects = new Effects(DEFAULT_TUNING);
    effects.handle(tier(1, 'Les gouttières'), HERO);
    effects.update(1);
    effects.handle(tier(2, 'Les enseignes'), HERO);
    expect(effects.banner).toMatchObject({ text: 'Les enseignes · 100 m', age: 0 });
  });
});

describe('trait du grappin', () => {
  it('est entièrement dessiné au départ, puis se redessine en 60 ms à chaque accroche', () => {
    const effects = new Effects(DEFAULT_TUNING);
    expect(ROPE_DRAW_SECONDS).toBe(0.06);
    expect(effects.ropeDrawn).toBe(1);
    effects.handle({ type: 'attach', anchorId: 1 }, HERO);
    expect(effects.ropeDrawn).toBe(0);
    effects.update(0.03);
    expect(effects.ropeDrawn).toBeCloseTo(0.5, 9);
    effects.update(0.1);
    expect(effects.ropeDrawn).toBe(1);
  });
});

describe('remise à zéro', () => {
  it('efface textes, bannière et animation du trait', () => {
    const effects = new Effects(DEFAULT_TUNING);
    effects.handle(tier(1, 'Les gouttières'), HERO);
    effects.handle({ type: 'boost' }, HERO);
    effects.handle({ type: 'attach', anchorId: 1 }, HERO);
    effects.clear();
    expect(effects.texts).toHaveLength(0);
    expect(effects.banner).toBeNull();
    expect(effects.ropeDrawn).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ALERT_BLINK_HZ,
  BANNER_SECONDS,
  EVENT_SECONDS,
  Effects,
  FLOAT_SECONDS,
  INTRO_SECONDS,
  ROPE_DRAW_SECONDS,
  WIND_STREAKS,
  alertAlpha,
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

  it('dit « Seconde chance ! » quand la brume renvoie le personnage vers le haut', () => {
    expect(floatingTextFor({ type: 'rescue', chancesLeft: 0 }, DEFAULT_TUNING)).toBe('Seconde chance !');
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

  it('une bannière plus longue garde le même fondu d\'entrée et de sortie, calé sur sa durée', () => {
    expect(bannerAlpha(0.125, INTRO_SECONDS)).toBeCloseTo(0.5, 6);
    expect(bannerAlpha(BANNER_SECONDS, INTRO_SECONDS)).toBe(1);
    expect(bannerAlpha(INTRO_SECONDS - 0.3, INTRO_SECONDS)).toBeCloseTo(0.5, 6);
    expect(bannerAlpha(INTRO_SECONDS, INTRO_SECONDS)).toBe(0);
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

  it('un sauvetage de la brume fait flotter « Seconde chance ! » près du personnage', () => {
    const effects = new Effects(DEFAULT_TUNING);
    effects.handle({ type: 'rescue', chancesLeft: 0 }, HERO);
    expect(effects.texts).toHaveLength(1);
    expect(effects.texts[0]).toMatchObject({ text: 'Seconde chance !', x: HERO.x });
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

describe('intro d\'un niveau', () => {
  it('annonce le titre et une seconde ligne, 3 s de temps réel, puis disparaît', () => {
    expect(INTRO_SECONDS).toBe(3);
    const effects = new Effects(DEFAULT_TUNING);
    effects.intro('Niveau 3 · Les enseignes', 'Des couloirs d\'étoiles.');
    expect(effects.banner).toMatchObject({ text: 'Niveau 3 · Les enseignes', detail: 'Des couloirs d\'étoiles.', seconds: INTRO_SECONDS, age: 0 });

    effects.update(2.99);
    expect(effects.banner).not.toBeNull();
    effects.update(0.02);
    expect(effects.banner).toBeNull();
  });

  it('une bannière de palier n\'a pas de seconde ligne et dure 2 s', () => {
    const effects = new Effects(DEFAULT_TUNING);
    effects.handle(tier(1, 'Les gouttières'), HERO);
    expect(effects.banner).toMatchObject({ detail: null, seconds: BANNER_SECONDS });
  });

  it('remplace la bannière en cours, et un palier neuf la remplace à son tour', () => {
    const effects = new Effects(DEFAULT_TUNING);
    effects.handle(tier(1, 'Les gouttières'), HERO);
    effects.update(1);
    effects.intro('Niveau 1 · Les toits', 'Garde le doigt posé.');
    expect(effects.banner).toMatchObject({ text: 'Niveau 1 · Les toits', age: 0 });

    effects.update(1);
    effects.handle(tier(2, 'Les enseignes'), HERO);
    expect(effects.banner).toMatchObject({ text: 'Les enseignes · 100 m', detail: null, age: 0 });
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

describe('annonce d\'un événement de niveau', () => {
  it('affiche un titre et une phrase, 2,5 s de temps réel, puis disparaît', () => {
    expect(EVENT_SECONDS).toBe(2.5);
    const effects = new Effects(DEFAULT_TUNING);
    effects.announce('La bascule !', 'Le niveau tourne');
    expect(effects.banner).toMatchObject({ text: 'La bascule !', detail: 'Le niveau tourne', seconds: EVENT_SECONDS, age: 0 });

    effects.update(2.49);
    expect(effects.banner).not.toBeNull();
    effects.update(0.02);
    expect(effects.banner).toBeNull();
  });

  it('peut n\'avoir qu\'un titre, et remplace la bannière en cours', () => {
    const effects = new Effects(DEFAULT_TUNING);
    effects.intro('Niveau 5 · Les antennes', 'Attention.');
    effects.update(1);
    effects.announce('Retour au calme', null);
    expect(effects.banner).toMatchObject({ text: 'Retour au calme', detail: null, age: 0 });
  });

  it('les événements de règles, eux, ne font ni texte flottant ni bannière à eux seuls', () => {
    const effects = new Effects(DEFAULT_TUNING);
    effects.handle({ type: 'event', kind: 'vent', phase: 'start' }, HERO);
    expect(effects.banner).toBeNull();
    expect(effects.texts).toHaveLength(0);
  });
});

describe('clignotement de l\'alerte', () => {
  it('oscille deux fois par seconde entre 0,3 et 1', () => {
    expect(ALERT_BLINK_HZ).toBe(2);
    let low = 1;
    let high = 0;
    for (let t = 0; t < 1; t += 0.001) {
      const alpha = alertAlpha(t);
      low = Math.min(low, alpha);
      high = Math.max(high, alpha);
      expect(alertAlpha(t + 0.5)).toBeCloseTo(alpha, 9);
    }
    expect(low).toBeCloseTo(0.3, 3);
    expect(high).toBeCloseTo(1, 3);
    // Deux creux par seconde : au quart et aux trois quarts de seconde.
    expect(alertAlpha(0.125)).toBeCloseTo(1, 9);
    expect(alertAlpha(0.375)).toBeCloseTo(0.3, 9);
    expect(alertAlpha(0.625)).toBeCloseTo(1, 9);
  });

  it('l\'horloge des effets compte le temps réel écoulé', () => {
    const effects = new Effects(DEFAULT_TUNING);
    expect(effects.clock).toBe(0);
    effects.update(0.25);
    effects.update(0.5);
    expect(effects.clock).toBeCloseTo(0.75, 9);
  });
});

describe('traînées du coup de vent', () => {
  const positions = (effects: Effects): number[] => effects.windStreaks.map((streak) => streak.x);

  it('sont une vingtaine, dans la vue, de longueurs et de rapidités variées', () => {
    const effects = new Effects(DEFAULT_TUNING);
    expect(WIND_STREAKS).toBeGreaterThanOrEqual(15);
    expect(WIND_STREAKS).toBeLessThanOrEqual(25);
    expect(effects.windStreaks).toHaveLength(WIND_STREAKS);
    for (const streak of effects.windStreaks) {
      expect(streak.x).toBeGreaterThanOrEqual(0);
      expect(streak.x).toBeLessThan(1);
      expect(streak.y).toBeGreaterThanOrEqual(0);
      expect(streak.y).toBeLessThan(1);
      expect(streak.length).toBeGreaterThan(0);
      expect(streak.length).toBeLessThan(0.2);
    }
    expect(new Set(effects.windStreaks.map((streak) => streak.length)).size).toBeGreaterThan(5);
    expect(new Set(effects.windStreaks.map((streak) => streak.pace)).size).toBeGreaterThan(5);
  });

  it('sont les mêmes à chaque partie, et ne bougent pas sans vent', () => {
    const a = new Effects(DEFAULT_TUNING);
    const b = new Effects(DEFAULT_TUNING);
    expect(positions(a)).toEqual(positions(b));
    const before = positions(a);
    a.update(1);
    a.update(1, 0);
    expect(positions(a)).toEqual(before);
  });

  it('filent dans le sens du vent', () => {
    const toRight = new Effects(DEFAULT_TUNING);
    const toLeft = new Effects(DEFAULT_TUNING);
    const start = positions(toRight);
    toRight.update(0.05, 3);
    toLeft.update(0.05, -3);
    positions(toRight).forEach((x, i) => expect(x).toBeGreaterThan(start[i]!));
    positions(toLeft).forEach((x, i) => expect(x).toBeLessThan(start[i]!));
  });

  it('vont d\'autant plus vite que le vent est fort, à vitesse proportionnelle', () => {
    const weak = new Effects(DEFAULT_TUNING);
    const strong = new Effects(DEFAULT_TUNING);
    const start = positions(weak);
    weak.update(0.05, 2);
    strong.update(0.05, 4);
    positions(weak).forEach((x, i) => {
      const slow = x - start[i]!;
      const fast = positions(strong)[i]! - start[i]!;
      expect(fast).toBeCloseTo(2 * slow, 9);
    });
  });

  it('renaissent du côté d\'où vient le vent quand elles sortent de la vue, sans jamais disparaître du compte', () => {
    for (const wind of [3, -3]) {
      const effects = new Effects(DEFAULT_TUNING);
      const entered = new Set<number>();
      for (let frame = 0; frame < 600; frame += 1) {
        const before = positions(effects);
        effects.update(1 / 60, wind);
        effects.windStreaks.forEach((streak, i) => {
          // Un saut dans le sens opposé au vent est une naissance : elle se fait juste hors de la vue.
          if (Math.sign(streak.x - before[i]!) === -Math.sign(wind)) {
            entered.add(i);
            expect(wind > 0 ? streak.x + streak.length / 2 : 1 - streak.x + streak.length / 2).toBeCloseTo(0, 9);
          }
        });
        expect(effects.windStreaks).toHaveLength(WIND_STREAKS);
      }
      // Dix secondes de vent : toutes ont traversé la vue au moins une fois.
      expect(entered.size).toBe(WIND_STREAKS);
    }
  });

  it('renaissent à une nouvelle hauteur', () => {
    const effects = new Effects(DEFAULT_TUNING);
    const heights = new Set(effects.windStreaks.map((streak) => streak.y));
    // Dix secondes de vent : toutes ont renouvelé leur hauteur.
    for (let frame = 0; frame < 600; frame += 1) effects.update(1 / 60, 3);
    for (const streak of effects.windStreaks) heights.add(streak.y);
    expect(heights.size).toBe(2 * WIND_STREAKS);
  });
});

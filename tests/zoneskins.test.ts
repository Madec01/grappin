import { describe, expect, it } from 'vitest';
import type { Zone, ZoneKind } from '../src/sim/state';
import { COLOR } from '../src/render/style';
import {
  BRAKE_DENSITY,
  BRAKE_DRIFT_HZ,
  BRAKE_LINES_MAX,
  BRAKE_LINES_MIN,
  CHEVRON_SPACING,
  CHEVRON_SPEED,
  STREAK_MAX,
  STREAK_MIN,
  STREAK_TIERS,
  ZONE_CORE,
  ZONE_INSIDE_BOOST,
  ZONE_TONE,
  brakeLine,
  brakeLineCount,
  buildKit,
  buildMotes,
  chevronAlong,
  chevronCount,
  chevronShape,
  clipBox,
  edgeFade,
  flowOf,
  frac,
  frameBox,
  frameBreadth,
  frameLength,
  framePoint,
  levelOf,
  makeFrame,
  placeFrame,
  streakCount,
  streakSpan,
  waveLight,
  type Box,
  type BrakeLine,
  type Point,
  type Span,
} from '../src/render/zones';

const zone = (kind: ZoneKind, patch: Partial<Zone> = {}): Zone => ({
  id: 3,
  x0: -1.6,
  y0: 8,
  x1: 1.6,
  y1: 16,
  kind,
  strength: 10,
  dir: kind === 'freinage' ? { x: 0, y: 0 } : kind === 'lateral' ? { x: 1, y: 0 } : { x: 0, y: 1 },
  ...patch,
});

const point = (): Point => ({ x: 0, y: 0 });

/** Un repère de 100 px sur 200 px, au coin (10, 20). */
function frameOf(zoneKind: ZoneKind, patch: Partial<Zone> = {}) {
  return placeFrame(makeFrame(), 10, 20, 100, 200, flowOf(zone(zoneKind, patch)));
}

describe('flowOf : le sens où pousse la zone, vu de l\'écran', () => {
  it('un courant et un couloir d\'accélération qui montent : axe vertical, vers le haut', () => {
    expect(flowOf(zone('ascendant'))).toEqual({ vertical: true, sign: 1 });
    expect(flowOf(zone('acceleration'))).toEqual({ vertical: true, sign: 1 });
  });

  it('une dérive file de côté : axe horizontal, vers la droite ou vers la gauche selon sa direction', () => {
    expect(flowOf(zone('lateral'))).toEqual({ vertical: false, sign: 1 });
    expect(flowOf(zone('lateral', { dir: { x: -1, y: 0 } }))).toEqual({ vertical: false, sign: -1 });
  });

  it('un courant qui descend se dessine vers le bas', () => {
    expect(flowOf(zone('ascendant', { dir: { x: 0, y: -1 } }))).toEqual({ vertical: true, sign: -1 });
  });

  it('le freinage ne pousse pas : toujours à plat, empilé de bas en haut, quelle que soit sa direction', () => {
    expect(flowOf(zone('freinage'))).toEqual({ vertical: true, sign: 1 });
    expect(flowOf(zone('freinage', { dir: { x: 1, y: 0 } }))).toEqual({ vertical: true, sign: 1 });
  });
});

describe('le repère d\'une zone', () => {
  it('vertical vers le haut : l\'entrée est en bas, la sortie en haut, `across` court de gauche à droite', () => {
    const f = frameOf('ascendant');
    expect(framePoint(f, 0, 0, point())).toEqual({ x: 10, y: 220 });
    expect(framePoint(f, 200, 0, point())).toEqual({ x: 10, y: 20 });
    expect(framePoint(f, 50, 100, point())).toEqual({ x: 110, y: 170 });
    expect([frameLength(f), frameBreadth(f)]).toEqual([200, 100]);
  });

  it('vertical vers le bas : l\'entrée est en haut', () => {
    const f = frameOf('ascendant', { dir: { x: 0, y: -1 } });
    expect(framePoint(f, 0, 0, point())).toEqual({ x: 10, y: 20 });
    expect(framePoint(f, 200, 100, point())).toEqual({ x: 110, y: 220 });
  });

  it('horizontal vers la droite : l\'entrée est à gauche ; vers la gauche : à droite ; `across` court de haut en bas', () => {
    const right = frameOf('lateral');
    expect(framePoint(right, 0, 0, point())).toEqual({ x: 10, y: 20 });
    expect(framePoint(right, 100, 200, point())).toEqual({ x: 110, y: 220 });
    expect([frameLength(right), frameBreadth(right)]).toEqual([100, 200]);
    const left = frameOf('lateral', { dir: { x: -1, y: 0 } });
    expect(framePoint(left, 0, 0, point())).toEqual({ x: 110, y: 20 });
    expect(framePoint(left, 100, 50, point())).toEqual({ x: 10, y: 70 });
  });

  it('une bande se pose sur le bon rectangle, quel que soit le sens', () => {
    const box: Box = { x: 0, y: 0, width: 0, height: 0 };
    expect(frameBox(frameOf('ascendant'), 0, 50, 10, 60, box)).toEqual({ x: 20, y: 170, width: 50, height: 50 });
    expect(frameBox(frameOf('ascendant', { dir: { x: 0, y: -1 } }), 0, 50, 10, 60, box)).toEqual({ x: 20, y: 20, width: 50, height: 50 });
    expect(frameBox(frameOf('lateral', { dir: { x: -1, y: 0 } }), 0, 30, 0, 200, box)).toEqual({ x: 80, y: 20, width: 30, height: 200 });
  });

  it('place le repère sans rien allouer : le même objet est réécrit', () => {
    const f = makeFrame();
    expect(placeFrame(f, 1, 2, 3, 4, flowOf(zone('lateral')))).toBe(f);
    expect(f).toEqual({ left: 1, top: 2, width: 3, height: 4, vertical: false, sign: 1 });
  });
});

describe('clipBox : une zone se rogne à ce que l\'écran montre', () => {
  const view = { left: 0, right: 390, top: 0, bottom: 844 };

  it('rogne un rectangle qui déborde, et ne touche pas ce qui est dedans', () => {
    const out: Box = { x: 0, y: 0, width: 0, height: 0 };
    expect(clipBox({ x: -50, y: 800, width: 100, height: 200 }, view, out)).toBe(true);
    expect(out).toEqual({ x: 0, y: 800, width: 50, height: 44 });
    expect(clipBox({ x: 10, y: 10, width: 20, height: 20 }, view, out)).toBe(true);
    expect(out).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

  it('dit faux quand il n\'en reste rien, bords qui se touchent compris', () => {
    const out: Box = { x: 0, y: 0, width: 0, height: 0 };
    expect(clipBox({ x: 400, y: 10, width: 20, height: 20 }, view, out)).toBe(false);
    expect(clipBox({ x: 390, y: 10, width: 20, height: 20 }, view, out)).toBe(false);
  });

  it('peut s\'écrire dans le rectangle donné', () => {
    const box: Box = { x: -10, y: -10, width: 30, height: 30 };
    expect(clipBox(box, view, box)).toBe(true);
    expect(box).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  });
});

describe('petites fonctions de lumière', () => {
  it('frac est toujours dans [0, 1), même pour un nombre négatif', () => {
    expect(frac(2.25)).toBeCloseTo(0.25, 12);
    expect(frac(-0.25)).toBeCloseTo(0.75, 12);
    expect(frac(-3)).toBe(0);
    for (const value of [-7.3, -0.0001, 0, 0.9999, 12.5]) {
      expect(frac(value)).toBeGreaterThanOrEqual(0);
      expect(frac(value)).toBeLessThan(1);
    }
  });

  it('levelOf range une intensité de 0 à 1 dans un niveau, jamais hors des bornes', () => {
    expect(levelOf(0, 3)).toBe(0);
    expect(levelOf(0.33, 3)).toBe(0);
    expect(levelOf(0.34, 3)).toBe(1);
    expect(levelOf(0.99, 3)).toBe(2);
    expect(levelOf(1, 3)).toBe(2);
    expect(levelOf(-1, 3)).toBe(0);
    expect(levelOf(5, 3)).toBe(2);
  });

  it('edgeFade vaut 0 aux deux bouts, 1 au milieu et passé le fondu, et monte doucement', () => {
    expect(edgeFade(0, 0.2)).toBe(0);
    expect(edgeFade(1, 0.2)).toBe(0);
    expect(edgeFade(0.5, 0.2)).toBe(1);
    expect(edgeFade(0.2, 0.2)).toBe(1);
    expect(edgeFade(0.1, 0.2)).toBeCloseTo(0.5, 12);
    // Symétrique, et croissant sur la première moitié.
    expect(edgeFade(0.07, 0.2)).toBeCloseTo(edgeFade(0.93, 0.2), 12);
    expect(edgeFade(0.15, 0.2)).toBeGreaterThan(edgeFade(0.05, 0.2));
  });

  it('waveLight : de 0 à 1, et la vague court dans le sens des repères (le plus vif est de plus en plus loin quand le temps passe)', () => {
    const count = 8;
    let previous = -1;
    let sweeps = 0;
    for (let tick = 0; tick < 160; tick += 1) {
      const clock = tick * 0.0125;
      const lights = Array.from({ length: count }, (_, i) => waveLight(i, count, clock, 0.5));
      for (const light of lights) {
        expect(light).toBeGreaterThanOrEqual(0);
        expect(light).toBeLessThanOrEqual(1);
      }
      const brightest = lights.indexOf(Math.max(...lights));
      // L'indice du plus vif ne recule jamais, sauf au tour suivant où la vague repart du premier repère.
      if (brightest < previous) sweeps += 1;
      else expect(brightest).toBeGreaterThanOrEqual(previous);
      previous = brightest;
    }
    // Deux secondes à un demi-tour par seconde : un tour, pas plus.
    expect(sweeps).toBeLessThanOrEqual(1);
    // À l'instant 0, la vague est sur le premier repère ; celui qui est juste devant elle est éteint, et la queue s'étire derrière.
    expect(waveLight(0, count, 0, 0.5)).toBe(1);
    expect(waveLight(1, count, 0, 0.5)).toBeLessThan(0.05);
    expect(waveLight(count - 1, count, 0, 0.5)).toBeGreaterThan(waveLight(count - 3, count, 0, 0.5));
  });
});

describe('les traînées d\'un courant', () => {
  it('sont les mêmes à chaque appel, d\'après le numéro et les dimensions seuls', () => {
    expect(buildMotes(zone('ascendant'))).toEqual(buildMotes(zone('ascendant')));
    expect(buildMotes(zone('lateral', { id: 9 }))).toEqual(buildMotes(zone('lateral', { id: 9 })));
  });

  it('changent d\'une zone à l\'autre : deux zones voisines ne battent pas ensemble', () => {
    expect(buildMotes(zone('ascendant', { id: 3 }))).not.toEqual(buildMotes(zone('ascendant', { id: 4 })));
  });

  it('n\'existent que pour un courant ascendant et une dérive', () => {
    expect(buildMotes(zone('acceleration'))).toEqual([]);
    expect(buildMotes(zone('freinage'))).toEqual([]);
    expect(buildMotes(zone('ascendant')).length).toBeGreaterThan(0);
    expect(buildMotes(zone('lateral')).length).toBeGreaterThan(0);
  });

  it('suivent la surface de la zone, entre des bornes : assez pour se lire, peu pour rester léger', () => {
    expect(streakCount('ascendant', 3.2, 8)).toBeGreaterThan(streakCount('ascendant', 3.2, 4));
    expect(streakCount('ascendant', 0.2, 0.2)).toBe(STREAK_MIN);
    expect(streakCount('lateral', 100, 100)).toBe(STREAK_MAX);
    // Les zones du jeu : une colonne de 3,2 m sur 8 m, une bande de 10 m sur 3,5 m.
    expect(buildMotes(zone('ascendant'))).toHaveLength(streakCount('ascendant', 3.2, 8));
    expect(buildMotes(zone('lateral', { x0: -5, x1: 5, y0: 8, y1: 11.5 }))).toHaveLength(streakCount('lateral', 10, 3.5));
  });

  it('restent à l\'écart du contour, ont une phase de départ dans [0, 1) et un rang qui existe', () => {
    for (const kind of ['ascendant', 'lateral'] as const) {
      const motes = buildMotes(zone(kind));
      for (const mote of motes) {
        expect(mote.lane).toBeGreaterThanOrEqual(0.08 - 1e-12);
        expect(mote.lane).toBeLessThanOrEqual(0.92 + 1e-12);
        expect(mote.start).toBeGreaterThanOrEqual(0);
        expect(mote.start).toBeLessThan(1);
        expect(STREAK_TIERS[kind][mote.tier]).toBeDefined();
      }
    }
  });

  it('se répartissent sur toute la largeur, sans paquet : chaque cinquième de la zone en a au moins une', () => {
    for (const kind of ['ascendant', 'lateral'] as const) {
      const motes = buildMotes(zone(kind));
      for (let fifth = 0; fifth < 5; fifth += 1) {
        expect(motes.some((m) => m.lane >= fifth / 5 && m.lane < (fifth + 1) / 5), `${kind} cinquième ${fifth}`).toBe(true);
      }
    }
  });

  it('ont trois rangs, dans la part voulue, qui vont de plus en plus vite : la dérive plus vite et plus long que le vent', () => {
    for (const kind of ['ascendant', 'lateral'] as const) {
      const tiers = STREAK_TIERS[kind];
      expect(tiers).toHaveLength(3);
      expect(tiers.reduce((sum, tier) => sum + tier.share, 0)).toBeCloseTo(1, 12);
      for (let i = 1; i < tiers.length; i += 1) {
        expect(tiers[i]!.speed).toBeGreaterThan(tiers[i - 1]!.speed);
        expect(tiers[i]!.length).toBeGreaterThan(tiers[i - 1]!.length);
        expect(tiers[i]!.alpha).toBeGreaterThanOrEqual(tiers[i - 1]!.alpha);
      }
      // Seul le rang le plus vif a son halo.
      expect(tiers.map((tier) => tier.glow)).toEqual([false, false, true]);
      const motes = buildMotes(zone(kind));
      for (let rank = 0; rank < 3; rank += 1) {
        const share = motes.filter((m) => m.tier === rank).length / motes.length;
        expect(Math.abs(share - tiers[rank]!.share), `${kind} rang ${rank}`).toBeLessThan(0.15);
      }
    }
    expect(STREAK_TIERS.lateral[2]!.speed).toBeGreaterThan(STREAK_TIERS.ascendant[2]!.speed);
  });
});

describe('streakSpan : où est la traînée à cet instant', () => {
  const out: Span = { from: 0, to: 0 };
  const motes = buildMotes(zone('ascendant'));
  const length = 8;

  it('reste dans la zone : de 0 à 1, de l\'arrière vers l\'avant, jamais plus long que la traînée', () => {
    for (const mote of motes) {
      const tier = STREAK_TIERS.ascendant[mote.tier]!;
      for (let tick = 0; tick < 400; tick += 1) {
        if (!streakSpan(mote, tier, tick * 0.037, length, out)) continue;
        expect(out.from).toBeGreaterThanOrEqual(0);
        expect(out.to).toBeLessThanOrEqual(1);
        expect(out.to).toBeGreaterThan(out.from);
        expect((out.to - out.from) * length).toBeLessThanOrEqual(tier.length + 1e-9);
      }
    }
  });

  it('file à la vitesse de son rang : la tête avance de `vitesse` mètres par seconde, sans saut', () => {
    const mote = motes.find((m) => m.tier === 2)!;
    const tier = STREAK_TIERS.ascendant[2]!;
    const dt = 1 / 60;
    let last: number | null = null;
    let wraps = 0;
    for (let tick = 0; tick < 600; tick += 1) {
      if (!streakSpan(mote, tier, tick * dt, length, out)) {
        // Invisible : seulement le tour de sa renaissance, brièvement.
        last = null;
        wraps += 1;
        continue;
      }
      // Tant que la tête avance dans la zone (ni sortie, ni bouclée) : elle fait `vitesse` mètres par seconde.
      if (last !== null && last < 1 - 1e-9 && out.to > last && out.to < 1 - 1e-9) expect((out.to - last) * length).toBeCloseTo(tier.speed * dt, 6);
      last = out.to;
    }
    // Dix secondes à 6,5 m/s sur 8 + 1,7 m : six tours, mais la traînée n'est hors de la zone qu'un instant à chacun.
    expect(wraps).toBeLessThan(10);
  });

  it('entre par l\'entrée en grandissant et sort par l\'autre bout en rétrécissant : jamais d\'apparition au milieu', () => {
    const tier = STREAK_TIERS.ascendant[1]!;
    const mote = motes[0]!;
    const dt = 0.004;
    let was: Span | null = null;
    for (let tick = 0; tick < 8000; tick += 1) {
      const visible = streakSpan(mote, tier, tick * dt, length, out);
      if (visible && was === null && tick > 0) {
        // Une traînée qui apparaît naît à l'entrée : sa queue est sur l'entrée, sa tête à peine entrée.
        expect(out.from).toBe(0);
        expect(out.to * length).toBeLessThan(0.1);
      }
      was = visible ? { ...out } : null;
    }
  });

  it('les traînées d\'une zone ne sont pas toutes au même endroit au même instant', () => {
    const heads = motes
      .map((mote) => (streakSpan(mote, STREAK_TIERS.ascendant[mote.tier]!, 4.2, length, out) ? Math.round(out.to * 20) : -1))
      .filter((head) => head >= 0);
    expect(heads.length).toBeGreaterThan(motes.length / 2);
    expect(new Set(heads).size).toBeGreaterThanOrEqual(8);
  });

  it('dit faux pour une zone sans longueur', () => {
    expect(streakSpan(motes[0]!, STREAK_TIERS.ascendant[0]!, 1, 0, out)).toBe(false);
  });
});

describe('le couloir d\'accélération : des chevrons serrés qui défilent vite', () => {
  it('le motif glisse de `vitesse` mètres par seconde, et se retrouve tel quel d\'un écart à l\'autre', () => {
    const period = CHEVRON_SPACING / CHEVRON_SPEED;
    const dt = 0.002;
    expect(chevronAlong(0, 0)).toBe(0);
    expect(chevronAlong(0, dt) - chevronAlong(0, 0)).toBeCloseTo(CHEVRON_SPEED * dt, 9);
    expect(chevronAlong(3, 0.4) - chevronAlong(2, 0.4)).toBeCloseTo(CHEVRON_SPACING, 12);
    // Au bout d'une période, le chevron 1 est où était le chevron 1 : le motif est périodique.
    expect(chevronAlong(1, 0.3 + period)).toBeCloseTo(chevronAlong(1, 0.3), 9);
  });

  it('les chevrons sont serrés (moins d\'un mètre) et défilent plus vite que les traînées d\'un courant', () => {
    expect(CHEVRON_SPACING).toBeLessThan(1);
    expect(CHEVRON_SPEED).toBeGreaterThan(STREAK_TIERS.ascendant[2]!.speed);
    expect(chevronCount(5)).toBeGreaterThanOrEqual(5 / CHEVRON_SPACING);
    expect(chevronCount(0)).toBe(1);
  });

  it('il y a toujours de quoi couvrir la zone : à tout instant, un chevron à moins d\'un écart de l\'entrée et de la sortie', () => {
    const length = 5;
    for (let tick = 0; tick < 100; tick += 1) {
      const clock = tick * 0.0137;
      const alongs = Array.from({ length: chevronCount(length) }, (_, k) => chevronAlong(k, clock)).filter((meters) => meters < length);
      expect(Math.min(...alongs)).toBeLessThan(CHEVRON_SPACING);
      expect(Math.max(...alongs)).toBeGreaterThan(length - CHEVRON_SPACING);
    }
  });
});

describe('le freinage : une trame calme, plus serrée en haut, qui descend très lentement', () => {
  const line: BrakeLine = { along: 0, light: 0 };

  it('a un nombre de bandes qui suit sa hauteur, entre des bornes', () => {
    expect(brakeLineCount(3)).toBe(9);
    expect(brakeLineCount(0.1)).toBe(BRAKE_LINES_MIN);
    expect(brakeLineCount(100)).toBe(BRAKE_LINES_MAX);
    expect(brakeLineCount(6)).toBeGreaterThan(brakeLineCount(3));
  });

  it('place chaque bande dans la zone (0 en bas, 1 en haut), avec une intensité de 0 à 1', () => {
    const count = brakeLineCount(3);
    for (let tick = 0; tick < 200; tick += 1) {
      for (let k = 0; k < count; k += 1) {
        brakeLine(k, count, tick * 0.11, line);
        expect(line.along).toBeGreaterThanOrEqual(0);
        expect(line.along).toBeLessThanOrEqual(1);
        expect(line.light).toBeGreaterThanOrEqual(0);
        expect(line.light).toBeLessThanOrEqual(1);
      }
    }
  });

  it('se resserre vers le haut : l\'écart entre deux bandes voisines diminue de bas en haut', () => {
    const count = 9;
    const alongs = Array.from({ length: count }, (_, k) => brakeLine(k, count, 0.7, { along: 0, light: 0 }).along);
    const gaps = alongs.slice(1).map((along, i) => along - alongs[i]!);
    expect(BRAKE_DENSITY).toBeGreaterThan(1);
    for (const gap of gaps) expect(gap).toBeGreaterThan(0);
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i]!).toBeLessThan(gaps[i - 1]! + 1e-12);
  });

  it('descend, jamais ne monte : chaque bande va vers le bas, et à chaque tour la trame se retrouve la même', () => {
    const count = 9;
    const dt = 0.05;
    const wrap = 1 / BRAKE_DRIFT_HZ;
    for (let k = 0; k < count; k += 1) {
      for (let tick = 0; tick < 150; tick += 1) {
        // Le tour tombe à un multiple de `wrap` : on ne compare pas les deux instants qui l'encadrent, où la bande prend la place de sa voisine.
        const clock = tick * dt;
        if (Math.ceil(clock / wrap) !== Math.ceil((clock + dt) / wrap)) continue;
        expect(brakeLine(k, count, clock + dt, line).along, `bande ${k}, instant ${clock}`).toBeLessThan(brakeLine(k, count, clock, { along: 0, light: 0 }).along);
      }
    }
    // Au tour : les bandes qu'on voit sont les mêmes de part et d'autre (une bande prend la place de sa voisine, sans saut) ; seules les extrêmes, éteintes, changent.
    const seen = (clock: number): number[] =>
      Array.from({ length: count }, (_, k) => brakeLine(k, count, clock, { along: 0, light: 0 }))
        .filter((l) => l.light > 1e-3)
        .map((l) => l.along)
        .sort((a, b) => a - b);
    const before = seen(wrap - 1e-7);
    const after = seen(wrap + 1e-7);
    expect(before.length).toBeGreaterThanOrEqual(count - 2);
    expect(after).toHaveLength(before.length);
    before.forEach((along, i) => expect(along).toBeCloseTo(after[i]!, 5));
  });

  it('s\'éteint aux deux bouts (elle naît et meurt sans à-coup) et brille plus en haut qu\'en bas', () => {
    const count = 9;
    // Juste avant le tour, la bande du bas est sur le point de disparaître ; juste après, une bande naît tout en haut : toutes deux éteintes.
    expect(brakeLine(0, count, (1 - 1e-4) / BRAKE_DRIFT_HZ, { along: 0, light: 0 }).light).toBeLessThan(0.01);
    expect(brakeLine(count - 1, count, 1e-4 / BRAKE_DRIFT_HZ, { along: 0, light: 0 }).light).toBeLessThan(0.01);
    // Au milieu de la trame, d'autres sont bien allumées, et une bande haute brille plus qu'une bande basse de même fondu.
    const lights = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => brakeLine(k, count, 5, { along: 0, light: 0 }));
    expect(Math.max(...lights.map((l) => l.light))).toBeGreaterThan(0.5);
    const lit = lights.filter((l) => l.light > 0.3);
    expect(Math.max(...lit.map((l) => l.light / (0.4 + 0.6 * l.along)))).toBeLessThanOrEqual(1);
  });
});

describe('chevronShape : un chevron pointe dans le sens de la poussée', () => {
  const pts = (): [Point, Point, Point] => [point(), point(), point()];

  it('vers le haut : la pointe est au-dessus des deux ailes, qui s\'écartent de part et d\'autre', () => {
    const out = pts();
    chevronShape(frameOf('ascendant'), 100, 50, 8, 12, out);
    const [left, apex, right] = out;
    expect(apex.y).toBeLessThan(left.y);
    expect(left.y).toBe(right.y);
    expect(apex.x).toBe(60);
    expect(left.x).toBe(48);
    expect(right.x).toBe(72);
  });

  it('vers le bas, la droite et la gauche : la pointe est toujours en avant, dans le sens voulu', () => {
    const down = pts();
    chevronShape(frameOf('ascendant', { dir: { x: 0, y: -1 } }), 100, 50, 8, 12, down);
    expect(down[1].y).toBeGreaterThan(down[0].y);
    const right = pts();
    chevronShape(frameOf('lateral'), 50, 100, 8, 12, right);
    expect(right[1].x).toBeGreaterThan(right[0].x);
    expect(right[0].x).toBe(right[2].x);
    const left = pts();
    chevronShape(frameOf('lateral', { dir: { x: -1, y: 0 } }), 50, 100, 8, 12, left);
    expect(left[1].x).toBeLessThan(left[0].x);
  });
});

describe('teintes des zones', () => {
  it('chaque espèce a sa teinte, et un cœur plus clair (vers le blanc) pour ses traits les plus vifs', () => {
    expect(ZONE_TONE).toEqual({ ascendant: COLOR.updraft, lateral: COLOR.drift, acceleration: COLOR.rocket, freinage: COLOR.brake, poche: COLOR.pocket });
    const light = (color: number): number => ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
    for (const kind of ['ascendant', 'lateral', 'acceleration', 'freinage', 'poche'] as const) expect(light(ZONE_CORE[kind]), kind).toBeGreaterThan(light(ZONE_TONE[kind]));
  });

  it('dans une zone, les traits sont d\'un cran plus vifs, sans passer du simple au double', () => {
    expect(ZONE_INSIDE_BOOST).toBeGreaterThan(1);
    expect(ZONE_INSIDE_BOOST).toBeLessThan(2);
  });
});

describe('buildKit : ce que le rendu retient d\'une zone', () => {
  it('sens, dimensions en mètres (le long de la poussée, en travers) et traînées', () => {
    const column = buildKit(zone('ascendant'));
    expect(column.flow).toEqual({ vertical: true, sign: 1 });
    expect(column.lengthMeters).toBeCloseTo(8, 12);
    expect(column.breadthMeters).toBeCloseTo(3.2, 12);
    expect(column.motes.length).toBeGreaterThan(0);
    const band = buildKit(zone('lateral', { x0: -5, x1: 5, y0: 8, y1: 11.5 }));
    expect(band.flow).toEqual({ vertical: false, sign: 1 });
    expect(band.lengthMeters).toBeCloseTo(10, 12);
    expect(band.breadthMeters).toBeCloseTo(3.5, 12);
    expect(buildKit(zone('acceleration')).motes).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { CITY_BAND_METERS, CITY_DROP_MAX, CITY_INNER, CITY_OUTER, CITY_RISE_MAX, CITY_ROWS, bandsInView, cityBand, type Structure } from '../src/render/city';
import { WORLD_HALF_WIDTH } from '../src/sim/rules';

/** Tous les points d'une bande, à plat. */
function points(structures: readonly Structure[]): { x: number; y: number }[] {
  return structures.flatMap((structure) => structure.lines.flatMap((line) => [...line]));
}

/** Tous les segments d'une bande : chaque paire de points consécutifs d'un tracé. */
function segments(structures: readonly Structure[]): [{ x: number; y: number }, { x: number; y: number }][] {
  return structures.flatMap((structure) => structure.lines.flatMap((line) => line.slice(1).map((point, index): [{ x: number; y: number }, { x: number; y: number }] => [line[index]!, point])));
}

describe('structures abstraites', () => {
  it('sont les mêmes pour une même bande, appel après appel', () => {
    expect(cityBand(7)).toEqual(cityBand(7));
    expect(JSON.stringify(cityBand(-3))).toBe(JSON.stringify(cityBand(-3)));
  });

  it('ne dépendent pas de l\'ordre dans lequel on parcourt les bandes', () => {
    const forward = [0, 1, 2, 3].map((band) => JSON.stringify(cityBand(band)));
    const backward = [3, 2, 1, 0].map((band) => JSON.stringify(cityBand(band))).reverse();
    expect(backward).toEqual(forward);
  });

  it('diffèrent d\'une bande à l\'autre, mais gardent la même forme générale', () => {
    expect(JSON.stringify(cityBand(4))).not.toBe(JSON.stringify(cityBand(5)));
    // Deux côtés et trois rangs : six structures par bande, toujours (le rendu en fait six lots de couleur au plus).
    expect(cityBand(4)).toHaveLength(2 * CITY_ROWS.length);
    expect(cityBand(-40)).toHaveLength(2 * CITY_ROWS.length);
  });

  it('ne tirent jamais au hasard : aucun appel à Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    // Des bandes jamais vues, pour que le cache ne cache rien.
    for (let band = 1000; band < 1040; band += 1) cityBand(band);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('restent hors de la largeur jouable de base et en deçà des bords de la zone jouable', () => {
    expect(CITY_INNER).toBeGreaterThan(4);
    expect(CITY_OUTER).toBeLessThan(WORLD_HALF_WIDTH);
    for (let band = -5; band < 40; band += 1) {
      for (const point of points(cityBand(band))) {
        expect(Math.abs(point.x)).toBeGreaterThanOrEqual(CITY_INNER - 1e-9);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(CITY_OUTER + 1e-9);
      }
    }
  });

  it('occupent chaque côté, chaque rang dans sa plage', () => {
    const band = cityBand(9);
    for (const side of [-1, 1]) {
      for (let row = 0; row < CITY_ROWS.length; row += 1) {
        const structures = band.filter((structure) => structure.row === row && structure.lines.every((line) => line.every((point) => Math.sign(point.x) === side)));
        expect(structures).toHaveLength(1);
        const [near, far] = CITY_ROWS[row]!;
        for (const point of points(structures)) {
          expect(Math.abs(point.x)).toBeGreaterThanOrEqual(near - 1e-9);
          expect(Math.abs(point.x)).toBeLessThanOrEqual(far + 1e-9);
        }
      }
    }
  });

  it('tiennent dans leur bande : rien au-dessus des 20 m de la bande, rien à plus de CITY_DROP_MAX sous son pied', () => {
    for (let band = -3; band < 30; band += 1) {
      const floor = band * CITY_BAND_METERS;
      for (const structure of cityBand(band)) {
        const ys = structure.lines.flatMap((line) => line.map((point) => point.y));
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(floor - CITY_DROP_MAX - 1e-9);
        expect(Math.max(...ys)).toBeLessThanOrEqual(floor + CITY_BAND_METERS + CITY_RISE_MAX + 1e-9);
      }
    }
  });

  it('sont faites de traits droits, horizontaux ou verticaux : ni pente, ni pignon, ni antenne penchée', () => {
    for (let band = -3; band < 40; band += 1) {
      for (const [from, to] of segments(cityBand(band))) {
        expect(from.x === to.x || from.y === to.y, `(${from.x}, ${from.y}) → (${to.x}, ${to.y})`).toBe(true);
        // Un trait qui ne va nulle part n'est pas un trait.
        expect(from.x !== to.x || from.y !== to.y).toBe(true);
      }
    }
  });

  it('ne se referment jamais : aucun tracé ne revient à son départ, donc ni toit, ni fenêtre, ni bâtiment', () => {
    for (let band = -3; band < 60; band += 1) {
      for (const structure of cityBand(band)) {
        for (const line of structure.lines) {
          const first = line[0]!;
          const last = line[line.length - 1]!;
          expect(first.x !== last.x || first.y !== last.y).toBe(true);
        }
      }
    }
  });

  it('ne dessinent aucun rectangle clos : deux traits horizontaux ne bouclent jamais sur deux colonnes', () => {
    // Une fenêtre, c'est quatre côtés. On cherche, dans chaque structure, deux verticales et deux horizontales qui se rejoignent aux quatre coins.
    const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
    for (let band = -3; band < 60; band += 1) {
      for (const structure of cityBand(band)) {
        const all = segments([structure]);
        const verticals = all.filter(([from, to]) => from.x === to.x);
        const horizontals = all.filter(([from, to]) => from.y === to.y);
        for (const left of verticals) {
          for (const right of verticals) {
            if (left[0].x >= right[0].x) continue;
            const bridges = horizontals.filter(([from, to]) => {
              const [low, high] = from.x < to.x ? [from.x, to.x] : [to.x, from.x];
              const spans = near(low, left[0].x) && near(high, right[0].x);
              const y = from.y;
              const inLeft = y >= Math.min(left[0].y, left[1].y) - 1e-9 && y <= Math.max(left[0].y, left[1].y) + 1e-9;
              const inRight = y >= Math.min(right[0].y, right[1].y) - 1e-9 && y <= Math.max(right[0].y, right[1].y) + 1e-9;
              return spans && inLeft && inRight;
            });
            expect(bridges.length).toBeLessThan(2);
          }
        }
      }
    }
  });

  it('varient : colonnes, cadres et rails se rencontrent tous, sur des bandes différentes', () => {
    // Une famille se reconnaît à ses tracés : un tracé de quatre points est un cadre, des traits horizontaux sans colonne des rails.
    let frames = 0;
    let columns = 0;
    let rails = 0;
    for (let band = 0; band < 60; band += 1) {
      for (const structure of cityBand(band)) {
        if (structure.lines.some((line) => line.length === 4)) frames += 1;
        else if (structure.lines.every((line) => line[0]!.y === line[1]!.y || line[0]!.x === line[1]!.x) && structure.lines.filter((line) => line[0]!.x === line[1]!.x).length >= 2) columns += 1;
        else rails += 1;
      }
    }
    expect(frames).toBeGreaterThan(20);
    expect(columns).toBeGreaterThan(20);
    expect(rails).toBeGreaterThan(20);
  });

  it('ne contiennent que des nombres, et au moins deux points par tracé', () => {
    for (let band = -2; band < 20; band += 1) {
      for (const structure of cityBand(band)) {
        for (const line of structure.lines) {
          expect(line.length).toBeGreaterThanOrEqual(2);
          for (const point of line) {
            expect(Number.isFinite(point.x)).toBe(true);
            expect(Number.isFinite(point.y)).toBe(true);
          }
        }
      }
    }
  });
});

describe('bandes visibles', () => {
  it('couvrent toute structure qui touche l\'intervalle de hauteurs', () => {
    for (const [bottom, top] of [
      [0, 34],
      [117, 150],
      [-12, 20],
      [403.5, 439],
    ] as const) {
      const { first, last } = bandsInView(bottom, top);
      // Toute bande qui a un point dans l'intervalle est comprise dans [first, last].
      for (let band = Math.floor(bottom / CITY_BAND_METERS) - 4; band <= Math.floor(top / CITY_BAND_METERS) + 4; band += 1) {
        const touches = points(cityBand(band)).some((point) => point.y >= bottom && point.y <= top);
        if (touches) {
          expect(band).toBeGreaterThanOrEqual(first);
          expect(band).toBeLessThanOrEqual(last);
        }
      }
    }
  });

  it('ne demandent pas trop de bandes : de l\'ordre de la vue', () => {
    const { first, last } = bandsInView(100, 136);
    expect(last - first + 1).toBeLessThanOrEqual(6);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { CITY_BAND_METERS, CITY_DROP_MAX, CITY_INNER, CITY_OUTER, CITY_RISE_MAX, CITY_ROWS, bandsInView, cityBand, type Building } from '../src/render/city';
import { WORLD_HALF_WIDTH } from '../src/sim/rules';

/** Tous les points d'une bande, à plat. */
function points(buildings: readonly Building[]): { x: number; y: number }[] {
  return buildings.flatMap((building) => building.lines.flatMap((line) => [...line]));
}

describe('silhouettes de ville', () => {
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
    // Deux côtés et trois rangs : six immeubles par bande, toujours.
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

  it('restent hors de la largeur jouable de base et en deçà des bords de la ville', () => {
    expect(CITY_INNER).toBeGreaterThan(4);
    expect(CITY_OUTER).toBeLessThan(WORLD_HALF_WIDTH);
    for (let band = -5; band < 40; band += 1) {
      for (const point of points(cityBand(band))) {
        // Les mâts barrent un peu de chaque côté de leur axe : on tolère leur demi-barre.
        expect(Math.abs(point.x)).toBeGreaterThanOrEqual(CITY_INNER - 0.25 - 1e-9);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(CITY_OUTER + 0.25 + 1e-9);
      }
    }
  });

  it('occupent chaque côté, chaque rang dans sa plage', () => {
    const band = cityBand(9);
    for (const side of [-1, 1]) {
      for (let row = 0; row < CITY_ROWS.length; row += 1) {
        const buildings = band.filter((building) => building.row === row && building.lines[0]!.every((point) => Math.sign(point.x) === side));
        expect(buildings).toHaveLength(1);
        const [near, far] = CITY_ROWS[row]!;
        for (const point of buildings[0]!.lines[0]!) {
          expect(Math.abs(point.x)).toBeGreaterThanOrEqual(near - 1e-9);
          expect(Math.abs(point.x)).toBeLessThanOrEqual(far + 1e-9);
        }
      }
    }
  });

  it('tiennent dans leur bande : toit dans les 20 m, mur sous le toit, mât au-dessus', () => {
    for (let band = -3; band < 30; band += 1) {
      const floor = band * CITY_BAND_METERS;
      for (const building of cityBand(band)) {
        const ys = building.lines.flatMap((line) => line.map((point) => point.y));
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(floor - CITY_DROP_MAX - 1e-9);
        expect(Math.max(...ys)).toBeLessThanOrEqual(floor + CITY_BAND_METERS + CITY_RISE_MAX + 1e-9);
      }
    }
  });

  it('ne contiennent que des nombres, et au moins deux points par tracé', () => {
    for (let band = -2; band < 20; band += 1) {
      for (const building of cityBand(band)) {
        for (const line of building.lines) {
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
  it('couvrent tout immeuble qui touche l\'intervalle de hauteurs', () => {
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

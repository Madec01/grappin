import { describe, expect, it } from 'vitest';
import { flowRows } from '../src/render/screens';

/** Les cases de l'atelier (41 sur un seul écran) vont en flux : peu de rangées, réparties également, aucune case seule quand on peut l'éviter. */
describe('la répartition en rangées d\'un flux de boutons', () => {
  const span = (widths: readonly number[], gap: number, rows: readonly number[]): number[] => {
    let first = 0;
    return rows.map((count) => {
      const row = widths.slice(first, first + count);
      first += count;
      return row.reduce((sum, w) => sum + w, 0) + gap * (count - 1);
    });
  };

  it('ne fait rien de rien, une rangée de ce qui tient, et respecte le nombre de boutons par rangée', () => {
    expect(flowRows([], 5, 350, 4)).toEqual([]);
    expect(flowRows([100], 5, 350, 4)).toEqual([1]);
    expect(flowRows([80, 80, 80], 5, 350, 4)).toEqual([3]);
    // Cinq petits boutons qui tiendraient sur une rangée : au plus quatre par rangée, répartis en deux.
    const rows = flowRows([40, 40, 40, 40, 40], 5, 350, 4);
    expect(rows).toHaveLength(2);
    expect(Math.max(...rows)).toBeLessThanOrEqual(4);
    expect(rows.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('prend le moins de rangées possible, jamais au-delà de la largeur permise, et les répartit également', () => {
    const widths = [100, 100, 100, 100, 100, 100, 100, 100];
    const rows = flowRows(widths, 5, 350, 4);
    // Trois cent dix pixels pour trois boutons, quatre cent quinze pour quatre : trois rangées, de trois, trois et deux.
    expect(rows).toHaveLength(3);
    expect([...rows].sort()).toEqual([2, 3, 3]);
    for (const wide of span(widths, 5, rows)) expect(wide).toBeLessThanOrEqual(350);
    // Un bouton seul au bout d'un remplissage glouton (4 + 4 + 1) est évité : la plus large rangée est la plus courte possible.
    const greedyTail = flowRows([90, 90, 90, 90, 90, 90, 90, 90, 90], 5, 380, 4);
    expect(greedyTail).toHaveLength(3);
    expect(Math.min(...greedyTail)).toBeGreaterThan(1);
  });

  it('la plus large rangée est la plus courte que le nombre de rangées permette, et chaque bouton est dans une rangée, dans l\'ordre', () => {
    const widths = [120, 60, 50, 70, 130, 55, 65, 110, 40];
    const gap = 5;
    const limit = 360;
    const rows = flowRows(widths, gap, limit, 4);
    expect(rows.reduce((a, b) => a + b, 0)).toBe(widths.length);
    const widest = Math.max(...span(widths, gap, rows));
    expect(widest).toBeLessThanOrEqual(limit);
    // Aucune autre répartition en autant de rangées n'a de rangée plus courte que la sienne la plus large (essai exhaustif).
    let best = Infinity;
    const search = (from: number, left: number, widestSoFar: number): void => {
      if (from === widths.length) {
        if (left === 0) best = Math.min(best, widestSoFar);
        return;
      }
      if (left === 0) return;
      for (let count = 1; count <= 4 && from + count <= widths.length; count += 1) {
        const wide = widths.slice(from, from + count).reduce((sum, w) => sum + w, 0) + gap * (count - 1);
        if (count > 1 && wide > limit) break;
        search(from + count, left - 1, Math.max(widestSoFar, wide));
      }
    };
    search(0, rows.length, 0);
    expect(widest).toBe(best);
  });

  it('donne sa rangée à un bouton plus large que le bloc, et garde tous les autres autour', () => {
    const rows = flowRows([500, 60, 60], 5, 350, 4);
    expect(rows[0]).toBe(1);
    expect(rows.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

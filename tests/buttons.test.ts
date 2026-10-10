import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/data/levels';
import { LEVELS_PER_PAGE, levelButton, levelOfButton, levelPageCount, levelsOfPage, pageOfLevel } from '../src/render/buttons';

describe('boutons des niveaux', () => {
  it('une ligne de la liste porte le numéro de son niveau et le rend', () => {
    expect(levelButton(3)).toBe('niveau-3');
    expect(levelOfButton('niveau-3')).toBe(3);
    expect(levelOfButton(levelButton(10))).toBe(10);
  });

  it('les autres boutons, et l\'absence de bouton, ne désignent aucun niveau', () => {
    for (const id of ['talismans', 'levels', 'free', 'next', 'replay', 'back', 'suite', 'precedents', 'treuil'] as const) expect(levelOfButton(id)).toBeNull();
    expect(levelOfButton(null)).toBeNull();
  });
});

describe('pages de la liste des niveaux', () => {
  it('dix niveaux par page : les vingt niveaux font deux pages', () => {
    expect(LEVELS_PER_PAGE).toBe(10);
    expect(levelPageCount()).toBe(Math.ceil(LEVELS.length / 10));
    expect(levelPageCount()).toBe(2);
  });

  it('chaque niveau tombe sur une page et une seule, dans l\'ordre, sans en oublier', () => {
    const all = Array.from({ length: levelPageCount() }, (_, page) => levelsOfPage(page)).flat();
    expect(all.map((level) => level.id)).toEqual(LEVELS.map((level) => level.id));
    for (let page = 0; page < levelPageCount(); page += 1) expect(levelsOfPage(page).length).toBeLessThanOrEqual(LEVELS_PER_PAGE);
  });

  it('dit la page d\'un niveau : 1 à 10 sur la première, 11 à 20 sur la seconde', () => {
    expect([1, 5, 10].map(pageOfLevel)).toEqual([0, 0, 0]);
    expect([11, 14, 20].map(pageOfLevel)).toEqual([1, 1, 1]);
    expect(levelsOfPage(0).map((level) => level.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(levelsOfPage(1).map((level) => level.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('une page hors de la liste est vide, et un numéro inconnu tombe sur la première page', () => {
    expect(levelsOfPage(2)).toEqual([]);
    expect(levelsOfPage(-1)).toEqual([]);
    expect(pageOfLevel(0)).toBe(0);
    expect(pageOfLevel(99)).toBe(0);
  });
});

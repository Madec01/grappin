import { describe, expect, it } from 'vitest';
import { levelById } from '../src/data/levels';
import { MISSIONS, missionById } from '../src/meta/missions';
import { PERFECT_STREAK_STAR } from '../src/meta/traversee';
import { equippedLine, levelRange, levelRowTitle, levelTitle, missionDoneLine, missionProgress, slotsLine, starLines } from '../src/render/labels';

const mission = (id: string) => {
  const def = missionById(id);
  if (!def) throw new Error(`Mission inconnue : ${id}`);
  return def;
};

describe('avancement d\'une mission', () => {
  it('compte « fait / cible », en mètres pour la hauteur et en secondes pour la survie', () => {
    expect(missionProgress(mission('tenir-3'), 2)).toBe('2 / 3');
    expect(missionProgress(mission('hauteur-30'), 12)).toBe('12 / 30 m');
    expect(missionProgress(mission('survie-60'), 0)).toBe('0 / 60 s');
  });

  it('arrondit vers le bas : on n\'annonce jamais plus que ce qui est fait', () => {
    expect(missionProgress(mission('hauteur-30'), 29.9)).toBe('29 / 30 m');
    expect(missionProgress(mission('survie-60'), 0.99)).toBe('0 / 60 s');
  });

  it('donne deux nombres, avec une unité seulement pour la hauteur et la survie, pour toutes les missions du catalogue', () => {
    for (const def of MISSIONS) {
      const unit = def.kind === 'height' ? ' m' : def.kind === 'survive' ? ' s' : '';
      expect(missionProgress(def, 1)).toBe(`1 / ${def.target}${unit}`);
    }
  });
});

describe('talismans équipés', () => {
  it('liste les noms dans l\'ordre d\'équipement, ou dit qu\'il n\'y en a aucun', () => {
    expect(equippedLine([])).toBe('Aucun talisman');
    expect(equippedLine(['treuil', 'corde'])).toBe('Talismans : Treuil renforcé, Corde longue');
    expect(equippedLine(['corde'])).toBe('Talismans : Corde longue');
  });

  it('dit les emplacements ouverts et occupés, au pluriel quand il le faut', () => {
    expect(slotsLine(1, 0)).toBe('1 emplacement, 0 utilisé');
    expect(slotsLine(1, 1)).toBe('1 emplacement, 1 utilisé');
    expect(slotsLine(2, 2)).toBe('2 emplacements, 2 utilisés');
  });
});

describe('fin de partie', () => {
  it('annonce la mission accomplie et sa récompense', () => {
    expect(missionDoneLine(mission('hauteur-30'))).toBe('Mission accomplie : Grimpe 30 m en une partie, +40\u00A0XP');
  });
});

describe('niveaux', () => {
  const level = levelById(3);
  if (!level) throw new Error('Niveau 3 absent');

  it('écrit le titre, la ligne de la liste et l\'intervalle de hauteur', () => {
    expect(levelTitle(level)).toBe('Niveau 3 · Les enseignes');
    expect(levelRowTitle(level)).toBe('3 · Les enseignes');
    expect(levelRange(level)).toBe('130 → 200 m');
  });
});

describe('étoiles d\'un niveau', () => {
  it('dit « cinq » dans son libellé : la série demandée est de cinq lâchers parfaits', () => {
    expect(PERFECT_STREAK_STAR).toBe(5);
    expect(starLines({ won: true, pickupsTaken: 0, pickupsTotal: 0, perfectStreak: 0 })[2]?.label).toBe('Cinq parfaits d\'affilée');
  });

  it('donne les trois étoiles dans l\'ordre, toutes gagnées sans rien à compter', () => {
    expect(starLines({ won: true, pickupsTaken: 3, pickupsTotal: 3, perfectStreak: 5 })).toEqual([
      { label: 'Terminer', done: true, progress: null },
      { label: 'Toutes les étoiles', done: true, progress: null },
      { label: 'Cinq parfaits d\'affilée', done: true, progress: null },
    ]);
  });

  it('compte ce qui manque : « 2/3 » étoiles prises, « 3/5 » parfaits d\'affilée', () => {
    const lines = starLines({ won: true, pickupsTaken: 2, pickupsTotal: 3, perfectStreak: 3 });
    expect(lines.map((line) => line.done)).toEqual([true, false, false]);
    expect(lines[1]?.progress).toBe('2/3');
    expect(lines[2]?.progress).toBe('3/5');
  });

  it('un niveau sans étoile à ramasser donne la deuxième étoile d\'office, sans rien à compter', () => {
    const [, all] = starLines({ won: true, pickupsTaken: 0, pickupsTotal: 0, perfectStreak: 0 });
    expect(all).toEqual({ label: 'Toutes les étoiles', done: true, progress: null });
  });
});

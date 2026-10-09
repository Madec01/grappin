import { describe, expect, it } from 'vitest';
import { MISSIONS, missionById } from '../src/meta/missions';
import { equippedLine, missionDoneLine, missionProgress, slotsLine } from '../src/render/labels';

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
    expect(missionDoneLine(mission('hauteur-30'))).toBe('Mission accomplie : Atteins 30 m, +40\u00A0XP');
  });
});

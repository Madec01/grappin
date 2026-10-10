import { describe, expect, it } from 'vitest';
import { levelButton, levelOfButton } from '../src/render/buttons';

describe('boutons des niveaux', () => {
  it('une ligne de la liste porte le numéro de son niveau et le rend', () => {
    expect(levelButton(3)).toBe('niveau-3');
    expect(levelOfButton('niveau-3')).toBe(3);
    expect(levelOfButton(levelButton(10))).toBe(10);
  });

  it('les autres boutons, et l\'absence de bouton, ne désignent aucun niveau', () => {
    for (const id of ['talismans', 'levels', 'free', 'next', 'replay', 'back', 'treuil'] as const) expect(levelOfButton(id)).toBeNull();
    expect(levelOfButton(null)).toBeNull();
  });
});

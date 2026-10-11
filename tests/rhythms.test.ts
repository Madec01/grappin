import { describe, expect, it } from 'vitest';
import { encodeRhythm, syntheticRhythm } from '../src/audio/rhythm';
import { browserRhythms, fixedRhythms, silentRhythms } from '../src/audio/rhythms';

/** Laisse passer les promesses en attente. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('les rythmes du navigateur', () => {
  it('charge le fichier de la piste une seule fois, répond null en attendant, puis le rythme', async () => {
    const asked: string[] = [];
    const text = encodeRhythm(syntheticRhythm(130, 3));
    const source = browserRhythms('/base/', async (url) => {
      asked.push(url);
      return text;
    });
    expect(source.get('boss1')).toBeNull();
    expect(source.get('boss1')).toBeNull();
    await settle();
    expect(source.get('boss1')?.bpm).toBe(130);
    expect(source.get('boss1')).toBe(source.get('boss1'));
    expect(asked).toEqual(['/base/musique/boss1.rythme.json']);
  });

  it('note absente une piste dont le fichier manque ou est illisible, sans réessayer', async () => {
    let asked = 0;
    const source = browserRhythms('', async (url) => {
      asked += 1;
      if (url.includes('menu')) throw new Error('404');
      return 'pas du json';
    });
    source.get('menu');
    source.get('biome1-1');
    await settle();
    expect(source.get('menu')).toBeNull();
    expect(source.get('biome1-1')).toBeNull();
    expect(source.get('menu')).toBeNull();
    expect(asked).toBe(2);
  });

  it('le silence ne sait rien, le rythme fixé répond à toute piste', () => {
    expect(silentRhythms().get('boss2')).toBeNull();
    const rhythm = syntheticRhythm(100, 2);
    expect(fixedRhythms(rhythm).get('boss2')).toBe(rhythm);
    expect(fixedRhythms(rhythm).get('menu')).toBe(rhythm);
  });
});

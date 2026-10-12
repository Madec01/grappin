import { describe, expect, it, vi } from 'vitest';
import { FADE_SECONDS, MUSIC_VOLUME, Music, browserAudio, type AudioFactory, type AudioPlayer } from '../src/audio/music';
import { LEVELS } from '../src/data/levels';
import { TITLE_TRACK, levelTrack, trackFamily, trackFile, type MusicFamily, type TrackId } from '../src/data/musique';

/** Un faux lecteur qui note ce qu'on lui fait ; `refuse` imite Safari, qui refuse de jouer hors d'un geste. */
function fakeFactory(refuse = false): { factory: AudioFactory & { unlocked: number }; players: (AudioPlayer & { src: string; played: number; released: boolean })[] } {
  const players: (AudioPlayer & { src: string; played: number; released: boolean })[] = [];
  const factory = ((src: string): AudioPlayer => {
    const player = {
      src,
      loop: false,
      volume: 1,
      paused: true,
      currentTime: 0,
      played: 0,
      released: false,
      play() {
        this.played += 1;
        if (!refuse || this.played > 1) this.paused = false;
      },
      pause() {
        this.paused = true;
      },
      release() {
        this.released = true;
        this.paused = true;
      },
    };
    players.push(player);
    return player;
  }) as AudioFactory & { unlocked: number };
  factory.unlocked = 0;
  Object.assign(factory, {
    unlock: () => {
      factory.unlocked += 1;
    },
  });
  return { factory, players };
}

describe('musiques', () => {
  it('chaque niveau a sa piste, le titre la sienne, et les fichiers sont dans musique/', () => {
    for (const level of LEVELS) expect(trackFile(levelTrack(level.id))).toMatch(/^musique\/[a-z0-9-]+\.mp3$/);
    expect(levelTrack(1)).toBe('biome1-1');
    expect(levelTrack(10)).toBe('boss2');
    expect(levelTrack(20)).toBe('boss4');
    expect(levelTrack(99)).toBe('boss4');
    expect(TITLE_TRACK).toBe('menu');
    // Deux niveaux qui se suivent n'ont jamais la même piste.
    for (let id = 2; id <= LEVELS.length; id += 1) expect(levelTrack(id)).not.toBe(levelTrack(id - 1));
  });

  it('chaque piste a sa famille, et les niveaux vont par familles de biome : quatre biomes, les boss, le menu', () => {
    const families: Record<TrackId, MusicFamily> = {
      menu: 'menu',
      'biome1-1': 'biome1',
      'biome1-2': 'biome1',
      'biome2-1': 'biome2',
      'biome2-2': 'biome2',
      'biome3-1': 'biome3',
      'biome3-2': 'biome3',
      'biome4-1': 'biome4',
      'biome4-2': 'biome4',
      boss1: 'boss',
      boss2: 'boss',
      boss3: 'boss',
      boss4: 'boss',
    };
    for (const [track, family] of Object.entries(families)) expect(trackFamily(track as TrackId)).toBe(family);

    const levelsOf: Record<MusicFamily, number[]> = {
      biome1: [1, 2, 11, 12],
      biome2: [3, 4, 13, 14],
      biome3: [5, 6, 15, 16],
      biome4: [7, 8, 17, 19],
      boss: [9, 10, 18, 20],
      menu: [],
    };
    for (const [family, ids] of Object.entries(levelsOf)) {
      for (const id of ids) expect(trackFamily(levelTrack(id))).toBe(family);
    }
    // Tous les niveaux sont couverts, une fois chacun.
    expect(Object.values(levelsOf).flat().sort((a, b) => a - b)).toEqual(LEVELS.map((level) => level.id));
    expect(trackFamily(TITLE_TRACK)).toBe('menu');
  });

  it('rien ne joue avant le premier geste ; ensuite la piste voulue part en boucle, et un changement fond l\'ancienne', () => {
    const { factory, players } = fakeFactory();
    const music = new Music(factory);
    music.play('biome1-1');
    expect(players).toHaveLength(0);
    music.unlock();
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ src: 'musique/biome1-1.mp3', loop: true, volume: MUSIC_VOLUME, played: 1 });
    expect(music.playing).toBe('biome1-1');

    music.play('biome1-1');
    expect(players).toHaveLength(1);
    music.play('menu');
    expect(players).toHaveLength(2);
    expect(music.playing).toBe('menu');
    music.update(FADE_SECONDS / 2);
    expect(players[0]!.volume).toBeCloseTo(MUSIC_VOLUME / 2, 6);
    expect(players[0]!.released).toBe(false);
    music.update(FADE_SECONDS);
    expect(players[0]!.released).toBe(true);
    expect(players[1]!.paused).toBe(false);
  });

  it('le premier geste bénit les lecteurs du navigateur, une fois ; un appui relance une piste que le navigateur a refusée hors geste (B-014)', () => {
    const { factory, players } = fakeFactory(true);
    const music = new Music(factory);
    music.play('menu');
    expect(factory.unlocked).toBe(0);
    music.nudge();
    expect(factory.unlocked).toBe(1);
    // Le titre a joué dans le geste ; le niveau, demandé hors geste, est refusé : il reste en pause.
    expect(players[0]!.paused).toBe(false);
    music.play('biome1-1');
    expect(players[1]).toMatchObject({ src: 'musique/biome1-1.mp3', played: 1, paused: true });
    // L'appui suivant la relance dans le geste, sans rebénir les lecteurs ni créer de lecteur.
    music.nudge();
    expect(factory.unlocked).toBe(1);
    expect(players).toHaveLength(2);
    expect(players[1]).toMatchObject({ played: 2, paused: false });
    // Une piste qui joue déjà n'est pas relancée.
    music.nudge();
    expect(players[1]!.played).toBe(2);
    // Une fabrique sans `unlock` (les tests, un navigateur sans rien à bénir) va aussi.
    const plain = new Music((src) => fakeFactory().factory(src));
    plain.play('menu');
    plain.nudge();
    expect(plain.playing).toBe('menu');
  });

  it('les lecteurs du navigateur : une réserve de trois, bénis sur un silence dans le premier geste, réutilisés piste après piste', async () => {
    const elements: FakeAudio[] = [];
    class FakeAudio {
      src = '';
      preload = '';
      loop = false;
      volume = 1;
      paused = true;
      currentTime = 0;
      readonly played: string[] = [];
      constructor() {
        elements.push(this);
      }
      play(): Promise<void> {
        this.played.push(this.src);
        this.paused = false;
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
      load(): void {
        this.currentTime = 0;
      }
      removeAttribute(): void {
        this.src = '';
      }
    }
    vi.stubGlobal('Audio', FakeAudio);
    try {
      const factory = browserAudio('/jeu/');
      expect(elements).toHaveLength(0);
      // Le premier geste : trois éléments, tous joués sur le silence, puis rendus au repos.
      factory.unlock!();
      expect(elements).toHaveLength(3);
      for (const element of elements) expect(element.played).toEqual([expect.stringMatching(/^data:audio\/wav/)]);
      await Promise.resolve();
      expect(elements.every((element) => element.paused)).toBe(true);
      // Un second geste n'en crée pas d'autres.
      factory.unlock!();
      expect(elements).toHaveLength(3);
      // Les pistes prennent les éléments de la réserve, et les rendent à l'arrêt ; une quatrième piste à la fois en crée un.
      const a = factory('musique/menu.mp3');
      const b = factory('musique/biome1-1.mp3');
      expect(elements[0]!.src).toBe('/jeu/musique/menu.mp3');
      expect(elements[1]!.src).toBe('/jeu/musique/biome1-1.mp3');
      a.release();
      expect(elements[0]!.src).toBe('');
      const c = factory('musique/boss1.mp3');
      expect(elements[0]!.src).toBe('/jeu/musique/boss1.mp3');
      const d = factory('musique/biome2-1.mp3');
      expect(elements[2]!.src).toBe('/jeu/musique/biome2-1.mp3');
      factory('musique/biome3-1.mp3');
      expect(elements).toHaveLength(4);
      void b.play();
      expect(elements[1]!.played.at(-1)).toBe('/jeu/musique/biome1-1.mp3');
      c.release();
      d.release();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('couper la musique arrête la piste en fondu et la remettre la rejoue ; le silence demandé est respecté', () => {
    const { factory, players } = fakeFactory();
    const music = new Music(factory);
    music.unlock();
    music.play('boss1');
    music.setEnabled(false);
    expect(music.playing).toBeNull();
    music.update(FADE_SECONDS * 2);
    expect(players[0]!.released).toBe(true);
    music.setEnabled(true);
    expect(music.playing).toBe('boss1');
    expect(players).toHaveLength(2);
    music.play(null);
    expect(music.playing).toBeNull();
  });
});

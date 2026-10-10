import { describe, expect, it } from 'vitest';
import { FADE_SECONDS, MUSIC_VOLUME, Music, type AudioPlayer } from '../src/audio/music';
import { LEVELS } from '../src/data/levels';
import { TITLE_TRACK, levelTrack, trackFamily, trackFile, type MusicFamily, type TrackId } from '../src/data/musique';

/** Un faux lecteur qui note ce qu'on lui fait. */
function fakeFactory(): { factory: (src: string) => AudioPlayer; players: (AudioPlayer & { src: string; played: number; released: boolean })[] } {
  const players: (AudioPlayer & { src: string; played: number; released: boolean })[] = [];
  const factory = (src: string): AudioPlayer => {
    const player = {
      src,
      loop: false,
      volume: 1,
      paused: true,
      played: 0,
      released: false,
      play() {
        this.paused = false;
        this.played += 1;
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
  };
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

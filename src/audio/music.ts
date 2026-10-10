import { type TrackId, trackFile } from '../data/musique';

/**
 * La musique : une piste à la fois, en boucle, chargée au besoin. Les
 * navigateurs refusent tout son avant un premier geste du joueur ; le jeu
 * appelle `unlock()` au premier appui, et toute piste demandée avant cela
 * part à ce moment-là. Rien ici ne touche la simulation : couper la musique ne
 * change pas une partie. Le réglage « musique » est gardé dans le profil par le
 * jeu, pas ici.
 */

/** Ce qu'il faut du navigateur : de quoi fabriquer un lecteur. Injecté, pour les tests. */
export interface AudioFactory {
  (src: string): AudioPlayer;
}

export interface AudioPlayer {
  loop: boolean;
  volume: number;
  readonly paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  /** Libère le fichier. */
  release(): void;
}

/** Fondu à l'arrêt d'une piste, en secondes de temps réel. */
export const FADE_SECONDS = 0.6;
export const MUSIC_VOLUME = 0.55;

export function browserAudio(base: string): AudioFactory {
  return (src) => {
    const element = new Audio(base + src);
    element.preload = 'auto';
    return {
      get loop() {
        return element.loop;
      },
      set loop(value: boolean) {
        element.loop = value;
      },
      get volume() {
        return element.volume;
      },
      set volume(value: number) {
        element.volume = value;
      },
      get paused() {
        return element.paused;
      },
      play: () => element.play().catch(() => undefined),
      pause: () => element.pause(),
      release: () => {
        element.pause();
        element.removeAttribute('src');
        element.load();
      },
    };
  };
}

/** Un lecteur muet : les tests, et le jeu quand aucun son n'est branché. */
export function silentAudio(): AudioFactory {
  return () => ({ loop: false, volume: 1, paused: true, play: () => undefined, pause: () => undefined, release: () => undefined });
}

export class Music {
  private readonly factory: AudioFactory;
  private current: { readonly id: TrackId; readonly player: AudioPlayer } | null = null;
  /** Pistes qui s'éteignent en fondu. */
  private fading: { player: AudioPlayer; remaining: number }[] = [];
  private wanted: TrackId | null = null;
  private unlocked = false;
  private enabled = true;

  constructor(factory: AudioFactory) {
    this.factory = factory;
  }

  /** Le premier geste du joueur : à partir de là, le son est permis. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.apply();
  }

  /** La piste à jouer en ce moment, ou null pour le silence. Sans effet tant que le son n'est pas permis. */
  play(id: TrackId | null): void {
    this.wanted = id;
    this.apply();
  }

  /** Coupe ou remet la musique, sans oublier quelle piste est voulue. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.apply();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** La piste en cours de lecture, ou null. */
  get playing(): TrackId | null {
    return this.current?.id ?? null;
  }

  /** Avance les fondus de `dt` secondes. */
  update(dt: number): void {
    for (const fade of this.fading) {
      fade.remaining -= dt;
      fade.player.volume = Math.max(0, (fade.remaining / FADE_SECONDS) * MUSIC_VOLUME);
      if (fade.remaining <= 0) fade.player.release();
    }
    this.fading = this.fading.filter((fade) => fade.remaining > 0);
  }

  private apply(): void {
    const target = this.unlocked && this.enabled ? this.wanted : null;
    if (this.current?.id === target) return;
    if (this.current) {
      this.fading.push({ player: this.current.player, remaining: FADE_SECONDS });
      this.current = null;
    }
    if (target === null) return;
    const player = this.factory(trackFile(target));
    player.loop = true;
    player.volume = MUSIC_VOLUME;
    void player.play();
    this.current = { id: target, player };
  }
}

import { type TrackId, trackFile } from '../data/musique';

/**
 * La musique : une piste à la fois, en boucle, chargée au besoin. Les
 * navigateurs refusent tout son avant un premier geste du joueur ; le jeu
 * appelle `unlock()` au premier appui, et toute piste demandée avant cela
 * part à ce moment-là. Rien ici ne touche la simulation : couper la musique ne
 * change pas une partie. Le réglage « musique » est gardé dans le profil par le
 * jeu, pas ici.
 */

/**
 * Ce qu'il faut du navigateur : de quoi fabriquer un lecteur. Injecté, pour
 * les tests. `unlock`, facultatif, est appelé dans le premier geste du joueur :
 * de quoi permettre aux lecteurs de jouer plus tard hors d'un geste (voir
 * `browserAudio`).
 */
export interface AudioFactory {
  (src: string): AudioPlayer;
  readonly unlock?: () => void;
}

export interface AudioPlayer {
  loop: boolean;
  volume: number;
  readonly paused: boolean;
  /** Position de lecture, en secondes depuis le début de la piste. */
  readonly currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
  /** Libère le fichier. */
  release(): void;
}

/** Fondu à l'arrêt d'une piste, en secondes de temps réel. */
export const FADE_SECONDS = 0.6;
export const MUSIC_VOLUME = 0.55;

/** Lecteurs tenus prêts et bénis au premier geste : une piste qui joue, une qui s'éteint en fondu, une de réserve. */
const PLAYER_POOL = 3;
/** Un fichier WAV vide (quelques octets) : de quoi « jouer » un lecteur dans le geste sans rien faire entendre. */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

/**
 * Les lecteurs du navigateur. Safari, sur iPhone, n'accepte `play()` que dans
 * un geste du joueur, sauf sur un élément audio qui a déjà joué dans un geste :
 * celui-là peut ensuite changer de piste et rejouer n'importe quand. Le jeu
 * change de piste hors de tout geste (le titre lance un niveau, la course
 * libre monte d'un biome) : avant la 0.12.5, la piste du niveau restait muette
 * jusqu'à ce qu'un geste la relance, la pause par exemple (B-014). D'où une
 * petite réserve d'éléments, tous « joués » sur un silence dans le premier
 * geste (`unlock`), puis réutilisés piste après piste.
 */
export function browserAudio(base: string): AudioFactory {
  const pool: HTMLAudioElement[] = [];
  const busy = new Set<HTMLAudioElement>();
  const create = (): HTMLAudioElement => {
    const element = new Audio();
    element.preload = 'auto';
    pool.push(element);
    return element;
  };
  /** Un lecteur libre de la réserve, ou un neuf. */
  const spare = (): HTMLAudioElement => pool.find((element) => !busy.has(element)) ?? create();
  const factory = ((src: string): AudioPlayer => {
    const element = spare();
    busy.add(element);
    element.loop = false;
    element.volume = 1;
    element.src = base + src;
    element.load();
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
      get currentTime() {
        return element.currentTime;
      },
      play: () => element.play().catch(() => undefined),
      pause: () => element.pause(),
      release: () => {
        element.pause();
        element.removeAttribute('src');
        element.load();
        busy.delete(element);
      },
    };
  }) as AudioFactory & { unlock: () => void };
  factory.unlock = () => {
    while (pool.length < PLAYER_POOL) create();
    for (const element of pool) {
      if (busy.has(element)) continue;
      element.src = SILENT_WAV;
      const started = element.play();
      // Joué dans le geste, l'élément est béni ; on le rend aussitôt au repos, prêt pour une vraie piste.
      if (started) started.then(() => element.pause()).catch(() => undefined);
    }
  };
  return factory;
}

/** Un lecteur muet : les tests, et le jeu quand aucun son n'est branché. */
export function silentAudio(): AudioFactory {
  return () => ({ loop: false, volume: 1, paused: true, currentTime: 0, play: () => undefined, pause: () => undefined, release: () => undefined });
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

  /** Le premier geste du joueur : à partir de là, le son est permis ; les lecteurs du navigateur sont bénis dans ce geste. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.factory.unlock?.();
    this.apply();
  }

  /**
   * Un geste du joueur, n'importe lequel : si la piste voulue est là sans jouer
   * (le navigateur a refusé un `play()` hors geste), on la relance dans ce
   * geste. Un filet sous `browserAudio` : au pire, la musique part au premier
   * appui qui suit, pas à la première pause.
   */
  nudge(): void {
    this.unlock();
    if (this.current?.player.paused) void this.current.player.play();
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

  /** La piste en cours et sa position de lecture en secondes, ou null : de quoi lire son rythme. */
  position(): { readonly id: TrackId; readonly time: number } | null {
    return this.current ? { id: this.current.id, time: this.current.player.currentTime } : null;
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

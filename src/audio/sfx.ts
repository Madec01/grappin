import type { RuleEvent } from '../sim/state';

/**
 * Les bruitages du geste : accroche, lâcher, parfait, lancer, propulsion,
 * étoile, frôlement, choc, décharge, casse, mort, arrivée, palier.
 *
 * Aucun fichier : chaque son est une petite recette de synthèse (oscillateurs
 * et souffle filtré) jouée par Web Audio, donc libre de droits, léger et net.
 * Comme la musique, rien ne sonne avant le premier geste du joueur (`unlock()`,
 * appelé par le jeu au premier appui), et le réglage « Sons » du profil coupe
 * tout. Rien ici ne touche la simulation : `cueFor` ne fait que traduire ses
 * événements en notes, et les tests le vérifient sans son.
 */

export type SoundId = 'attach' | 'release' | 'perfect' | 'launch' | 'boost' | 'pickup' | 'graze' | 'bump' | 'shock' | 'break' | 'fog' | 'fall' | 'finish' | 'tier';

/** Une note à jouer : le son, et sa hauteur relative (1 : telle quelle ; 2 : l'octave au-dessus). */
export interface Cue {
  readonly id: SoundId;
  readonly pitch: number;
}

/** Ce qui joue les notes. Injecté : muet dans les tests, Web Audio dans le navigateur. */
export interface SoundPlayer {
  /** Le premier geste du joueur : à partir de là, le son est permis. */
  unlock(): void;
  play(cue: Cue): void;
  setEnabled(enabled: boolean): void;
}

/** Jusqu'où la série monte le son du parfait : un demi-ton par parfait d'affilée, huit au plus. */
export const PERFECT_PITCH_STEPS = 8;

/** La hauteur du son du parfait pour un multiplicateur `combo` : la série fait monter la note, discrètement. */
export function perfectPitch(combo: number): number {
  const steps = Math.min(PERFECT_PITCH_STEPS, Math.max(0, Math.floor(combo) - 1));
  return Math.pow(2, steps / 12);
}

/**
 * La note d'un événement de règles, ou null s'il ne sonne pas. Un lâcher forcé
 * ne sonne pas lui-même : la casse, la décharge ou le choc qui l'a provoqué
 * sonne à sa place. Une étoile de pluie sonne un peu plus haut qu'une étoile du
 * parcours.
 */
export function cueFor(event: RuleEvent): Cue | null {
  switch (event.type) {
    case 'attach':
      return { id: 'attach', pitch: 1 };
    case 'release':
      if (event.kind === 'lanceur') return { id: 'launch', pitch: 1 };
      if (event.forced) return null;
      return event.perfect ? { id: 'perfect', pitch: perfectPitch(event.combo) } : { id: 'release', pitch: 1 };
    case 'boost':
      return { id: 'boost', pitch: 1 };
    case 'pickup':
      return { id: 'pickup', pitch: event.bonus ? 1.25 : 1 };
    case 'graze':
      return { id: 'graze', pitch: 1 };
    case 'bump':
      return { id: 'bump', pitch: 1 };
    case 'shock':
      return { id: 'shock', pitch: 1 };
    case 'break':
      return { id: 'break', pitch: 1 };
    case 'death':
      return { id: event.cause === 'fog' ? 'fog' : 'fall', pitch: 1 };
    case 'finish':
      return { id: 'finish', pitch: 1 };
    case 'tier':
      return { id: 'tier', pitch: 1 };
    default:
      return null;
  }
}

/* ---- Les recettes ---- */

/** Un oscillateur : forme, fréquence de départ et d'arrivée (hertz), durée, volume, et départ différé (secondes). */
interface Tone {
  readonly type: OscillatorType;
  readonly from: number;
  readonly to: number;
  readonly seconds: number;
  readonly gain: number;
  readonly at?: number;
}

/** Un souffle : bruit blanc passé dans un filtre passe-bas dont la coupure glisse de `from` à `to` hertz. */
interface Breath {
  readonly from: number;
  readonly to: number;
  readonly seconds: number;
  readonly gain: number;
  readonly at?: number;
}

export interface Recipe {
  readonly tones: readonly Tone[];
  readonly breaths?: readonly Breath[];
}

/** Chaque son, en une ou deux lignes. Les fréquences sont multipliées par la hauteur de la note. */
export const RECIPES: Record<SoundId, Recipe> = {
  attach: { tones: [{ type: 'square', from: 880, to: 620, seconds: 0.05, gain: 0.18 }] },
  release: { tones: [], breaths: [{ from: 2600, to: 700, seconds: 0.16, gain: 0.16 }] },
  perfect: {
    tones: [
      { type: 'sine', from: 659.25, to: 659.25, seconds: 0.1, gain: 0.26 },
      { type: 'sine', from: 987.77, to: 987.77, seconds: 0.2, gain: 0.26, at: 0.08 },
    ],
  },
  launch: { tones: [{ type: 'sawtooth', from: 180, to: 720, seconds: 0.24, gain: 0.12 }], breaths: [{ from: 500, to: 3200, seconds: 0.3, gain: 0.18 }] },
  boost: { tones: [{ type: 'sawtooth', from: 300, to: 1200, seconds: 0.28, gain: 0.16 }] },
  pickup: { tones: [{ type: 'triangle', from: 1318.5, to: 1760, seconds: 0.11, gain: 0.22 }] },
  graze: { tones: [{ type: 'sine', from: 2200, to: 2600, seconds: 0.04, gain: 0.1 }] },
  bump: { tones: [{ type: 'sine', from: 150, to: 55, seconds: 0.2, gain: 0.36 }], breaths: [{ from: 1200, to: 250, seconds: 0.08, gain: 0.24 }] },
  shock: { tones: [{ type: 'square', from: 140, to: 85, seconds: 0.3, gain: 0.2 }, { type: 'square', from: 143, to: 88, seconds: 0.3, gain: 0.12 }] },
  break: { tones: [{ type: 'square', from: 520, to: 180, seconds: 0.09, gain: 0.16 }], breaths: [{ from: 4000, to: 1400, seconds: 0.12, gain: 0.3 }] },
  fog: { tones: [{ type: 'sine', from: 440, to: 110, seconds: 0.9, gain: 0.26 }] },
  fall: { tones: [{ type: 'sine', from: 660, to: 220, seconds: 0.6, gain: 0.26 }] },
  finish: {
    tones: [
      { type: 'sine', from: 523.25, to: 523.25, seconds: 0.16, gain: 0.24 },
      { type: 'sine', from: 659.25, to: 659.25, seconds: 0.16, gain: 0.24, at: 0.1 },
      { type: 'sine', from: 783.99, to: 783.99, seconds: 0.16, gain: 0.24, at: 0.2 },
      { type: 'sine', from: 1046.5, to: 1046.5, seconds: 0.36, gain: 0.26, at: 0.3 },
    ],
  },
  tier: {
    tones: [
      { type: 'sine', from: 783.99, to: 783.99, seconds: 0.18, gain: 0.16 },
      { type: 'sine', from: 1046.5, to: 1046.5, seconds: 0.26, gain: 0.16, at: 0.12 },
    ],
  },
};

/** Volume général des bruitages, sous la musique. */
export const SFX_VOLUME = 0.5;
/** Attaque et extinction d'une note, en secondes : pas de claquement. */
const ATTACK = 0.004;
const RELEASE = 0.03;
/** Durée du bruit blanc gardé en mémoire, en secondes ; les souffles en lisent un morceau. */
const NOISE_SECONDS = 1;

/** Un lecteur muet : les tests, et le jeu quand rien n'est branché. */
export function silentSfx(): SoundPlayer {
  return { unlock: () => undefined, play: () => undefined, setEnabled: () => undefined };
}

/**
 * Le lecteur du navigateur. Le contexte audio naît et reprend au premier geste
 * (`unlock`), comme les navigateurs l'exigent ; une note demandée avant, ou
 * sons coupés, est ignorée.
 */
export function browserSfx(): SoundPlayer {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let enabled = true;

  const ensure = (): AudioContext | null => {
    if (context) return context;
    if (typeof AudioContext === 'undefined') return null;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = SFX_VOLUME;
    master.connect(context.destination);
    const frames = Math.round(NOISE_SECONDS * context.sampleRate);
    noise = context.createBuffer(1, frames, context.sampleRate);
    const data = noise.getChannelData(0);
    // Un bruit blanc simple ; le hasard ici ne touche pas la simulation.
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    return context;
  };

  const envelope = (ctx: AudioContext, start: number, seconds: number, gain: number): GainNode => {
    const node = ctx.createGain();
    node.gain.setValueAtTime(0, start);
    node.gain.linearRampToValueAtTime(gain, start + ATTACK);
    node.gain.setValueAtTime(gain, Math.max(start + ATTACK, start + seconds - RELEASE));
    node.gain.linearRampToValueAtTime(0, start + seconds);
    return node;
  };

  return {
    unlock() {
      const ctx = ensure();
      if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    },
    setEnabled(value) {
      enabled = value;
    },
    play(cue) {
      if (!enabled || !context || !master || !noise || context.state !== 'running') return;
      const ctx = context;
      const now = ctx.currentTime;
      const recipe = RECIPES[cue.id];
      for (const tone of recipe.tones) {
        const start = now + (tone.at ?? 0);
        const osc = ctx.createOscillator();
        osc.type = tone.type;
        osc.frequency.setValueAtTime(tone.from * cue.pitch, start);
        osc.frequency.exponentialRampToValueAtTime(tone.to * cue.pitch, start + tone.seconds);
        const gain = envelope(ctx, start, tone.seconds, tone.gain);
        osc.connect(gain).connect(master);
        osc.start(start);
        osc.stop(start + tone.seconds + RELEASE);
      }
      for (const breath of recipe.breaths ?? []) {
        const start = now + (breath.at ?? 0);
        const source = ctx.createBufferSource();
        source.buffer = noise;
        source.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(breath.from * cue.pitch, start);
        filter.frequency.exponentialRampToValueAtTime(breath.to * cue.pitch, start + breath.seconds);
        const gain = envelope(ctx, start, breath.seconds, breath.gain);
        source.connect(filter).connect(gain).connect(master);
        source.start(start);
        source.stop(start + breath.seconds + RELEASE);
      }
    },
  };
}

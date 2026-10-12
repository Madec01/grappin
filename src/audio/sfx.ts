import type { RuleEvent } from '../sim/state';

/**
 * Les bruitages du geste : accroche, lâcher, parfait, lancer, propulsion,
 * étoile, frôlement, choc, rebond, fracas, anneau, décharge, casse, mort,
 * arrivée, palier.
 *
 * Des échantillons (`public/sons/`, MP3 courts, un par son), joués par Web
 * Audio avec leur hauteur (`pitch`) et leur volume. Ils viennent des packs
 * sonores de Kenney (www.kenney.nl), placés dans le domaine public (CC0) :
 * libres, coupés et normalisés par nos soins (voir `SAMPLES`). Jusqu'à la
 * 0.12.4, chaque son était une recette de synthèse (oscillateurs et souffle
 * filtré) ; retour du propriétaire : « les sons sont horribles, je n'aime pas
 * les sons générés par oscillateur ». Comme la musique, rien ne sonne avant le
 * premier geste du joueur (`unlock()`, appelé par le jeu au premier appui), et
 * le réglage « Sons » du profil coupe tout. Rien ici ne touche la simulation :
 * `cueFor` ne fait que traduire ses événements en notes, et les tests le
 * vérifient sans son.
 */

export type SoundId = 'attach' | 'release' | 'perfect' | 'launch' | 'boost' | 'pickup' | 'graze' | 'bump' | 'bounce' | 'smash' | 'ring' | 'shock' | 'break' | 'fog' | 'fall' | 'finish' | 'tier';

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

/** Le son du passage qui se referme est celui du rebond, environ neuf demi-tons plus bas : grave, il dure près d'une seconde. */
export const ESCAPE_PITCH = 0.6;

/** Le son d'une faille qui s'ouvre est celui de la casse, environ une octave plus bas : le craquement grave de la roche qui se fend. */
export const FAULT_PITCH = 0.55;

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
      if (event.kind === 'lanceur' || event.kind === 'rail') return { id: 'launch', pitch: 1 };
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
    case 'bounce':
      return { id: 'bounce', pitch: 1 };
    case 'smash':
      return { id: 'smash', pitch: 1 };
    case 'ring':
      // Au centre, l'anneau sonne une quinte plus haut.
      return { id: 'ring', pitch: event.centred ? 1.5 : 1 };
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
    case 'escape':
      // Le champ de force du rebond, grave et plus long : un passage dont la porte d'énergie se met en marche.
      return { id: 'bounce', pitch: ESCAPE_PITCH };
    case 'faille':
      // La roche qui se fend : le craquement de la casse, une octave plus bas.
      return { id: 'break', pitch: FAULT_PITCH };
    default:
      return null;
  }
}

/* ---- Les recettes ---- */

/** Un échantillon : son fichier sous `public/`, son volume (part du volume général), et d'où il vient. */
export interface Sample {
  readonly file: string;
  readonly gain: number;
  /** Le pack Kenney et le son d'origine, pour les crédits et pour le retrouver ; entre parenthèses, la durée gardée s'il a été coupé. */
  readonly source: string;
}

/** Les échantillons de chaque son. Les fichiers sont dans `public/sons/`, mono, 44,1 kHz, MP3 96 kbit/s, crête à -3 dB. */
export const SAMPLES: Record<SoundId, Sample> = {
  attach: { file: 'sons/accroche.mp3', gain: 0.7, source: 'RPG Audio, metalClick (0,35 s)' },
  release: { file: 'sons/lacher.mp3', gain: 0.45, source: 'RPG Audio, cloth2' },
  perfect: { file: 'sons/parfait.mp3', gain: 0.8, source: 'Interface Sounds, pluck_002' },
  launch: { file: 'sons/lancer.mp3', gain: 0.6, source: 'Sci-fi Sounds, thrusterFire_003 (0,6 s)' },
  boost: { file: 'sons/propulsion.mp3', gain: 0.55, source: 'Sci-fi Sounds, thrusterFire_001 (0,45 s)' },
  pickup: { file: 'sons/etoile.mp3', gain: 0.6, source: 'Interface Sounds, glass_001' },
  graze: { file: 'sons/frole.mp3', gain: 0.5, source: 'Interface Sounds, tick_004' },
  bump: { file: 'sons/choc.mp3', gain: 0.8, source: 'Impact Sounds, impactPunch_heavy_000 (0,5 s)' },
  bounce: { file: 'sons/rebond.mp3', gain: 0.6, source: 'Sci-fi Sounds, forceField_001 (0,5 s)' },
  smash: { file: 'sons/fracas.mp3', gain: 0.8, source: 'Impact Sounds, impactGlass_heavy_000' },
  ring: { file: 'sons/anneau.mp3', gain: 0.5, source: 'Impact Sounds, impactBell_heavy_000 (0,8 s)' },
  shock: { file: 'sons/decharge.mp3', gain: 0.6, source: 'Interface Sounds, error_001' },
  break: { file: 'sons/casse.mp3', gain: 0.7, source: 'Impact Sounds, impactPlank_medium_002 (0,45 s)' },
  fog: { file: 'sons/brume.mp3', gain: 0.6, source: 'Sci-fi Sounds, lowFrequency_explosion_000 (1,1 s)' },
  fall: { file: 'sons/chute.mp3', gain: 0.6, source: 'Interface Sounds, minimize_002' },
  finish: { file: 'sons/arrivee.mp3', gain: 0.7, source: 'Interface Sounds, confirmation_002' },
  tier: { file: 'sons/palier.mp3', gain: 0.6, source: 'Interface Sounds, maximize_003' },
};

/** Volume général des bruitages, sous la musique. */
export const SFX_VOLUME = 0.6;

/** Un lecteur muet : les tests, et le jeu quand rien n'est branché. */
export function silentSfx(): SoundPlayer {
  return { unlock: () => undefined, play: () => undefined, setEnabled: () => undefined };
}

/** De quoi aller chercher un fichier : `fetch`, injecté pour les tests. */
export type Fetcher = (url: string) => Promise<{ readonly ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Le `fetch` du navigateur, ou null quand il n'y en a pas (les tests). */
function browserFetcher(): Fetcher | null {
  return typeof fetch === 'function' ? (url) => fetch(url) : null;
}

/**
 * Le lecteur du navigateur. Le contexte audio naît dès la construction, au
 * chargement : sa création coûte des dizaines de millisecondes (bien plus sur
 * un petit téléphone ou une machine chargée), et la faire au premier toucher,
 * comme avant, bloquait la page au moment même où le joueur pose le doigt. Il
 * reste suspendu tant que le joueur n'a rien touché ; `unlock`, appelé dans le
 * geste comme les navigateurs l'exigent, le reprend. Les échantillons se
 * chargent et se décodent dès la construction, un à un, sans bloquer ; un son
 * demandé avant qu'il soit prêt, ou sons coupés, est ignoré. `base` est la
 * racine du site, où vit `sons/`.
 */
export function browserSfx(base: string, fetcher: Fetcher | null = browserFetcher()): SoundPlayer {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let enabled = true;
  const buffers = new Map<SoundId, AudioBuffer>();

  const ensure = (): AudioContext | null => {
    if (context) return context;
    if (typeof AudioContext === 'undefined') return null;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = SFX_VOLUME;
    master.connect(context.destination);
    return context;
  };
  const ctx = ensure();
  if (ctx && fetcher) {
    for (const [id, sample] of Object.entries(SAMPLES) as [SoundId, Sample][]) {
      fetcher(base + sample.file)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(sample.file))))
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => {
          buffers.set(id, buffer);
        })
        .catch((error: unknown) => console.warn('bruitage :', sample.file, error));
    }
  }

  return {
    unlock() {
      const running = ensure();
      if (running && running.state !== 'running') void running.resume().catch(() => undefined);
    },
    setEnabled(value) {
      enabled = value;
    },
    play(cue) {
      const buffer = buffers.get(cue.id);
      if (!enabled || !context || !master || !buffer || context.state !== 'running') return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = cue.pitch;
      const gain = context.createGain();
      gain.gain.value = SAMPLES[cue.id].gain;
      source.connect(gain).connect(master);
      source.start();
    },
  };
}

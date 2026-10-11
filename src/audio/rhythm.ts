/**
 * Le rythme d'une piste, et le pouls qu'il donne à un instant.
 *
 * Rien ici n'écoute le son en direct : le rythme d'une piste est analysé une
 * fois pour toutes, hors-ligne (`scripts/rythme.ts`, à partir de
 * `audio/analysis.ts`), et rangé dans un petit fichier à côté de la musique.
 * Au jeu, il suffit de la position de lecture de la piste pour connaître le
 * pouls du moment : où en est le temps fort, quelle est la force de ce temps,
 * combien il y a de graves, de médiums et d'aigus. Un téléphone n'a donc ni
 * analyse de spectre ni Web Audio à faire tourner, le pouls est le même d'un
 * appareil à l'autre, et les tests le rejouent sans son.
 *
 * Rien ici ne touche la simulation : le pouls n'est lu que par le rendu.
 */

/** Les trois bandes d'énergie d'une piste, échantillonnées `rate` fois par seconde, chacune entre 0 et 1. */
export interface RhythmEnvelope {
  readonly rate: number;
  readonly bass: readonly number[];
  readonly mid: readonly number[];
  readonly high: readonly number[];
}

export interface Rhythm {
  /** Tempo, en battements par minute. */
  readonly bpm: number;
  /** Durée de la piste, en secondes. */
  readonly duration: number;
  /** Temps par mesure, 4 en pratique. */
  readonly beatsPerBar: number;
  /** Indice, dans `beats`, du premier temps d'une mesure : les suivants sont tous les `beatsPerBar` temps. */
  readonly downbeat: number;
  /** Instants des temps, en secondes, croissants. */
  readonly beats: readonly number[];
  /** Force de chaque temps, entre 0 et 1 : un coup franc vaut 1, un temps deviné dans un passage calme reste bas. */
  readonly strength: readonly number[];
  readonly envelope: RhythmEnvelope;
}

/** Le pouls à un instant de la piste. */
export interface Pulse {
  /** 1 sur le temps, puis une décroissance vers 0 jusqu'au temps suivant. */
  readonly beat: number;
  /** Force du dernier temps, entre 0 et 1. */
  readonly strength: number;
  /** Numéro du dernier temps passé, à partir de 0 ; -1 avant le premier. */
  readonly count: number;
  /** Place de ce temps dans sa mesure, de 0 (temps fort) à `beatsPerBar - 1`. */
  readonly inBar: number;
  /** Mesures entières écoulées depuis le premier temps fort. */
  readonly bars: number;
  /** Graves, médiums, aigus du moment, entre 0 et 1. */
  readonly bass: number;
  readonly mid: number;
  readonly high: number;
  readonly bpm: number;
}

/** Le pouls du silence : musique coupée, piste sans rythme connu, ou tests. Tout y vaut zéro, le rendu ne bouge pas. */
export const SILENT_PULSE: Pulse = { beat: 0, strength: 0, count: -1, inBar: 0, bars: 0, bass: 0, mid: 0, high: 0, bpm: 0 };

/**
 * Vitesse de la décroissance du pouls après un temps : `beat` tombe à e^-BEAT_DECAY,
 * soit 5 %, à l'instant du temps suivant. Un coup net, une retombée douce.
 */
export const BEAT_DECAY = 3;

/** Le dernier indice de `sorted` dont la valeur est au plus `t`, ou -1. */
function lastAtOrBefore(sorted: readonly number[], t: number): number {
  let low = 0;
  let high = sorted.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! <= t) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** La valeur d'une bande à l'instant `t`, interpolée entre ses deux échantillons voisins ; 0 hors de la piste ou sans échantillon. */
function sampleBand(band: readonly number[], rate: number, t: number): number {
  if (band.length === 0 || rate <= 0) return 0;
  const position = Math.max(0, t * rate);
  const index = Math.floor(position);
  const a = band[Math.min(index, band.length - 1)]!;
  const b = band[Math.min(index + 1, band.length - 1)]!;
  return a + (b - a) * (position - index);
}

/** Le reste positif de `n` modulo `m` ; une valeur déjà dans [0, m) est rendue telle quelle, sans arrondi flottant. */
function wrap(n: number, m: number): number {
  if (n >= 0 && n < m) return n;
  return n - Math.floor(n / m) * m;
}

/**
 * Le pouls de `rhythm` à `t` secondes de lecture. Au-delà de la durée, le temps
 * reboucle, comme la piste. Sans aucun temps connu, seul le contenu des bandes
 * est rendu.
 */
export function pulseAt(rhythm: Rhythm, t: number): Pulse {
  const time = rhythm.duration > 0 ? wrap(t, rhythm.duration) : Math.max(0, t);
  const { envelope } = rhythm;
  const bass = sampleBand(envelope.bass, envelope.rate, time);
  const mid = sampleBand(envelope.mid, envelope.rate, time);
  const high = sampleBand(envelope.high, envelope.rate, time);
  const count = lastAtOrBefore(rhythm.beats, time);
  if (count < 0) return { ...SILENT_PULSE, bass, mid, high, bpm: rhythm.bpm };
  const period = rhythm.bpm > 0 ? 60 / rhythm.bpm : 1;
  const beat = Math.exp((-BEAT_DECAY * (time - rhythm.beats[count]!)) / period);
  const perBar = Math.max(1, rhythm.beatsPerBar);
  const sinceDownbeat = count - rhythm.downbeat;
  return {
    beat,
    strength: rhythm.strength[count] ?? 1,
    count,
    inBar: wrap(sinceDownbeat, perBar),
    bars: Math.floor(sinceDownbeat / perBar),
    bass,
    mid,
    high,
    bpm: rhythm.bpm,
  };
}

/** Cadence des bandes d'un rythme synthétique, par seconde. */
const SYNTHETIC_RATE = 20;

/**
 * Un rythme de métronome à `bpm`, pour le mode test (`?pouls=`) et les tests :
 * le temps fort de chaque mesure vaut 1, les autres 0.7 ; les graves suivent
 * le pouls, les médiums et les aigus ondulent lentement pour que tout ce qui
 * les lit bouge aussi.
 */
export function syntheticRhythm(bpm: number, duration = 3600, beatsPerBar = 4): Rhythm {
  const period = 60 / bpm;
  const beats: number[] = [];
  const strength: number[] = [];
  for (let t = 0; t < duration; t += period) {
    beats.push(Math.round(t * 1000) / 1000);
    strength.push(beats.length % beatsPerBar === 1 ? 1 : 0.7);
  }
  const samples = Math.ceil(duration * SYNTHETIC_RATE);
  const bass: number[] = [];
  const mid: number[] = [];
  const high: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / SYNTHETIC_RATE;
    const sinceBeat = t - Math.floor(t / period) * period;
    bass.push(Math.exp((-BEAT_DECAY * sinceBeat) / period));
    // Une ondulation de huit secondes, et une autre de cinq, décalées : jamais plates, jamais égales.
    mid.push(0.5 + 0.4 * Math.sin((t * Math.PI * 2) / 8));
    high.push(0.5 + 0.4 * Math.sin((t * Math.PI * 2) / 5 + 1));
  }
  return { bpm, duration, beatsPerBar, downbeat: 0, beats, strength, envelope: { rate: SYNTHETIC_RATE, bass, mid, high } };
}

/* ---- Le fichier de rythme : un JSON compact, les bandes en octets base64. ---- */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode des valeurs entre 0 et 1 en octets base64 (256 niveaux). */
export function encodeBytes(values: readonly number[]): string {
  const bytes = values.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]!;
    out += b === undefined ? '=' : BASE64[(n >> 6) & 63]!;
    out += c === undefined ? '=' : BASE64[n & 63]!;
  }
  return out;
}

/** L'inverse d'`encodeBytes` : des valeurs entre 0 et 1. Une chaîne mal formée lève. */
export function decodeBytes(text: string): number[] {
  if (text.length % 4 !== 0) throw new Error('base64 : longueur invalide');
  const values: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const chars = [text[i]!, text[i + 1]!, text[i + 2]!, text[i + 3]!];
    const digits = chars.map((char) => (char === '=' ? 0 : BASE64.indexOf(char)));
    if (digits.some((digit) => digit < 0)) throw new Error('base64 : caractère invalide');
    const n = (digits[0]! << 18) | (digits[1]! << 12) | (digits[2]! << 6) | digits[3]!;
    values.push(((n >> 16) & 255) / 255);
    if (chars[2] !== '=') values.push(((n >> 8) & 255) / 255);
    if (chars[3] !== '=') values.push((n & 255) / 255);
  }
  return values;
}

/** Le texte d'un fichier de rythme. */
export function encodeRhythm(rhythm: Rhythm): string {
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return JSON.stringify({
    bpm: round(rhythm.bpm),
    duration: round(rhythm.duration),
    beatsPerBar: rhythm.beatsPerBar,
    downbeat: rhythm.downbeat,
    beats: rhythm.beats.map(round),
    strength: encodeBytes(rhythm.strength),
    envelope: {
      rate: rhythm.envelope.rate,
      bass: encodeBytes(rhythm.envelope.bass),
      mid: encodeBytes(rhythm.envelope.mid),
      high: encodeBytes(rhythm.envelope.high),
    },
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Lit un fichier de rythme ; lève si le texte n'en est pas un. */
export function decodeRhythm(text: string): Rhythm {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) throw new Error('rythme : pas un objet');
  const data = raw as Record<string, unknown>;
  const { bpm, duration, beatsPerBar, downbeat, beats, strength, envelope } = data;
  if (!isFiniteNumber(bpm) || !isFiniteNumber(duration) || !isFiniteNumber(beatsPerBar) || !isFiniteNumber(downbeat)) {
    throw new Error('rythme : en-tête invalide');
  }
  if (!Array.isArray(beats) || !beats.every(isFiniteNumber)) throw new Error('rythme : temps invalides');
  if (typeof strength !== 'string') throw new Error('rythme : forces invalides');
  if (typeof envelope !== 'object' || envelope === null) throw new Error('rythme : bandes invalides');
  const bands = envelope as Record<string, unknown>;
  const rate = bands['rate'];
  const bass = bands['bass'];
  const mid = bands['mid'];
  const high = bands['high'];
  if (!isFiniteNumber(rate) || typeof bass !== 'string' || typeof mid !== 'string' || typeof high !== 'string') {
    throw new Error('rythme : bandes invalides');
  }
  const strengths = decodeBytes(strength);
  if (strengths.length !== beats.length) throw new Error('rythme : une force par temps');
  return {
    bpm,
    duration,
    beatsPerBar,
    downbeat,
    beats,
    strength: strengths,
    envelope: { rate, bass: decodeBytes(bass), mid: decodeBytes(mid), high: decodeBytes(high) },
  };
}

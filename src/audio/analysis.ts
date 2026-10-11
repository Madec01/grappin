import type { Rhythm } from './rhythm';

/**
 * L'analyse du rythme d'une piste, hors-ligne, à partir de ses échantillons
 * mono. Elle produit le `Rhythm` que le jeu lit (voir `rhythm.ts`) ; le script
 * `scripts/rythme.ts` la lance sur chaque musique de `public/musique/`.
 *
 * La méthode est classique :
 * 1. un spectrogramme (fenêtre de Hann, transformée de Fourier rapide) ;
 * 2. une courbe d'attaque : la montée d'énergie d'une trame à la suivante,
 *    sommée sur des bandes de fréquence logarithmiques, débarrassée de sa
 *    moyenne lente, puis normalisée ;
 * 3. le tempo : l'autocorrélation de cette courbe, pondérée par un a priori
 *    autour de 120 battements par minute (un octave d'écart-type) ;
 * 4. les temps : une programmation dynamique qui place chaque temps sur une
 *    attaque, à peu près une période après le précédent (Ellis, 2007) ;
 * 5. la force de chaque temps, le temps fort de la mesure (deviné : la phase
 *    où les attaques et les graves sont les plus marqués), et trois bandes
 *    d'énergie (graves, médiums, aigus) ramenées à vingt échantillons par
 *    seconde.
 *
 * Tout est déterministe : la même piste donne le même fichier.
 */

export interface AnalysisOptions {
  /** Largeur de trame et pas entre trames, en échantillons ; la largeur est une puissance de deux. */
  readonly frame?: number;
  readonly hop?: number;
  /** Cadence des bandes d'énergie du résultat, par seconde. */
  readonly envelopeRate?: number;
  readonly beatsPerBar?: number;
  /** Centre de l'a priori de tempo, en battements par minute. */
  readonly startBpm?: number;
  /** Tempos admis. */
  readonly minBpm?: number;
  readonly maxBpm?: number;
  /** Raideur du suivi : plus elle est haute, plus les temps restent réguliers au lieu de suivre chaque attaque. */
  readonly tightness?: number;
}

const DEFAULTS: Required<AnalysisOptions> = { frame: 1024, hop: 512, envelopeRate: 20, beatsPerBar: 4, startBpm: 120, minBpm: 60, maxBpm: 200, tightness: 100 };

/** Bornes des trois bandes d'énergie du jeu, en hertz. */
const BASS_BAND: readonly [number, number] = [40, 150];
const MID_BAND: readonly [number, number] = [150, 2000];
const HIGH_BAND: readonly [number, number] = [2000, 10000];
/** Bandes logarithmiques de la courbe d'attaque. */
const FLUX_BANDS = 40;
const FLUX_LOW_HZ = 30;
const FLUX_HIGH_HZ = 10000;
/** Fenêtre de la moyenne lente retirée de la courbe d'attaque, en secondes. */
const FLUX_MEAN_SECONDS = 1;

/* ---- Transformée de Fourier ---- */

/** Transformée de Fourier rapide en place, radix 2 ; `re` et `im` ont une longueur puissance de deux. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k += 1) {
        const a = start + k;
        const b = a + size / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Les spectres de puissance de chaque trame (`frame / 2 + 1` cases chacun). */
export function spectrogram(samples: Float32Array, frame: number, hop: number): Float64Array[] {
  const window = new Float64Array(frame);
  for (let i = 0; i < frame; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);
  const re = new Float64Array(frame);
  const im = new Float64Array(frame);
  const bins = frame / 2 + 1;
  const frames: Float64Array[] = [];
  for (let start = 0; start + frame <= samples.length; start += hop) {
    for (let i = 0; i < frame; i += 1) {
      re[i] = samples[start + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const power = new Float64Array(bins);
    for (let k = 0; k < bins; k += 1) power[k] = re[k]! * re[k]! + im[k]! * im[k]!;
    frames.push(power);
  }
  return frames;
}

/* ---- Outils ---- */

/** L'énergie d'une bande de fréquences d'un spectre de puissance. */
function bandEnergy(power: Float64Array, binHz: number, low: number, high: number): number {
  const first = Math.max(1, Math.ceil(low / binHz));
  const last = Math.min(power.length - 1, Math.floor(high / binHz));
  let energy = 0;
  for (let k = first; k <= last; k += 1) energy += power[k]!;
  return energy;
}

/** La valeur sous laquelle se trouve la fraction `q` des `values`. */
function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

/** Les valeurs ramenées entre 0 et 1 : 0 sous le 5e centile, 1 au-dessus du 98e. */
function normalise(values: readonly number[]): number[] {
  const low = percentile(values, 0.05);
  const high = percentile(values, 0.98);
  const span = high - low;
  if (span <= 0) return values.map(() => 0);
  return values.map((value) => Math.min(1, Math.max(0, (value - low) / span)));
}

/** Moyenne glissante centrée, sur `width` valeurs. */
function movingAverage(values: readonly number[], width: number): number[] {
  const half = Math.max(1, Math.floor(width / 2));
  const out: number[] = [];
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const enter = i + half;
    const leave = i - half - 1;
    if (enter < values.length) {
      sum += values[enter]!;
      count += 1;
    }
    if (leave >= 0) {
      sum -= values[leave]!;
      count -= 1;
    }
    // Au départ, les `half` premières valeurs ne sont pas encore comptées : on les ajoute d'un coup.
    if (i === 0) {
      for (let j = 0; j < Math.min(half, values.length); j += 1) {
        sum += values[j]!;
        count += 1;
      }
    }
    out.push(count > 0 ? sum / count : 0);
  }
  return out;
}

/** Lissage gaussien d'écart-type `sigma` (en indices). */
function gaussianSmooth(values: readonly number[], sigma: number): number[] {
  if (sigma <= 0) return [...values];
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let total = 0;
  for (let k = -radius; k <= radius; k += 1) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(w);
    total += w;
  }
  return values.map((_, i) => {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const j = i + k;
      if (j >= 0 && j < values.length) sum += values[j]! * kernel[k + radius]!;
    }
    return sum / total;
  });
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/* ---- Les étapes ---- */

/** Bornes des bandes logarithmiques de la courbe d'attaque, en hertz. */
function fluxEdges(): number[] {
  const edges: number[] = [];
  const ratio = Math.log(FLUX_HIGH_HZ / FLUX_LOW_HZ) / FLUX_BANDS;
  for (let b = 0; b <= FLUX_BANDS; b += 1) edges.push(FLUX_LOW_HZ * Math.exp(ratio * b));
  return edges;
}

/**
 * La courbe d'attaque : par trame, la somme des montées du logarithme de
 * l'énergie de chaque bande depuis la trame précédente, moins sa moyenne lente,
 * jamais négative, normalisée à un écart-type de 1.
 */
export function onsetStrength(frames: readonly Float64Array[], binHz: number, frameRate: number): number[] {
  const edges = fluxEdges();
  let previous: number[] | null = null;
  const flux: number[] = [];
  for (const power of frames) {
    const bands: number[] = [];
    for (let b = 0; b < FLUX_BANDS; b += 1) bands.push(Math.log1p(bandEnergy(power, binHz, edges[b]!, edges[b + 1]!)));
    let rise = 0;
    if (previous) for (let b = 0; b < FLUX_BANDS; b += 1) rise += Math.max(0, bands[b]! - previous[b]!);
    flux.push(rise);
    previous = bands;
  }
  const slow = movingAverage(flux, Math.round(FLUX_MEAN_SECONDS * frameRate));
  const centred = flux.map((value, i) => Math.max(0, value - slow[i]!));
  const deviation = standardDeviation(centred);
  return deviation > 0 ? centred.map((value) => value / deviation) : centred;
}

/** Le tempo le plus plausible de la courbe d'attaque, en battements par minute, et la hauteur normalisée de son pic (0 à 1 : la confiance). */
export function estimateTempo(onsets: readonly number[], frameRate: number, options: Required<AnalysisOptions>): { bpm: number; confidence: number } {
  const minLag = Math.max(1, Math.floor((60 * frameRate) / options.maxBpm));
  const maxLag = Math.min(onsets.length - 1, Math.ceil((60 * frameRate) / options.minBpm));
  if (maxLag <= minLag) return { bpm: options.startBpm, confidence: 0 };
  const mean = onsets.reduce((sum, value) => sum + value, 0) / onsets.length;
  const centred = onsets.map((value) => value - mean);
  const correlation = (lag: number): number => {
    let sum = 0;
    for (let i = 0; i + lag < centred.length; i += 1) sum += centred[i]! * centred[i + lag]!;
    return sum / Math.max(1, centred.length - lag);
  };
  const zero = correlation(0);
  const prior = (lag: number): number => {
    const bpm = (60 * frameRate) / lag;
    const octaves = Math.log2(bpm / options.startBpm);
    return Math.exp(-0.5 * octaves * octaves);
  };
  const scores: number[] = [];
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const score = correlation(lag) * prior(lag);
    scores[lag] = score;
    if (score > scores[best]!) best = lag;
  }
  // Interpolation parabolique autour du pic : le tempo n'est pas limité à la grille des trames.
  let lag = best;
  const left = scores[best - 1];
  const right = scores[best + 1];
  if (left !== undefined && right !== undefined) {
    const denominator = left - 2 * scores[best]! + right;
    if (denominator < 0) lag = best + (0.5 * (left - right)) / denominator;
  }
  const confidence = zero > 0 ? Math.min(1, Math.max(0, correlation(best) / zero)) : 0;
  return { bpm: (60 * frameRate) / lag, confidence };
}

/**
 * Les trames des temps, par programmation dynamique : chaque temps se pose sur
 * une attaque, à une distance du précédent proche de la période, et la chaîne
 * retenue est celle qui cumule le plus d'attaques.
 */
export function trackBeats(onsets: readonly number[], period: number, tightness: number): number[] {
  if (onsets.length === 0 || period <= 0) return [];
  const localscore = gaussianSmooth(onsets, period / 32);
  const maxScore = localscore.reduce((best, value) => Math.max(best, value), 0);
  const nearest = -Math.round(period / 2);
  const farthest = -Math.round(2 * period);
  const transition: number[] = [];
  for (let offset = farthest; offset <= nearest; offset += 1) {
    const ratio = Math.log(-offset / period);
    transition.push(-tightness * ratio * ratio);
  }
  const cumulative = new Float64Array(localscore.length);
  const backlink = new Int32Array(localscore.length).fill(-1);
  let firstBeat = true;
  for (let i = 0; i < localscore.length; i += 1) {
    let best = Number.NEGATIVE_INFINITY;
    let from = -1;
    for (let j = 0; j < transition.length; j += 1) {
      const z = i + farthest + j;
      if (z < 0) continue;
      const candidate = transition[j]! + cumulative[z]!;
      if (candidate > best) {
        best = candidate;
        from = z;
      }
    }
    // Avant la première attaque nette, aucune chaîne ne commence.
    if (firstBeat && localscore[i]! < 0.01 * maxScore) {
      cumulative[i] = localscore[i]!;
      backlink[i] = -1;
      continue;
    }
    firstBeat = false;
    cumulative[i] = localscore[i]! + (from >= 0 ? best : 0);
    backlink[i] = from;
  }
  // Le dernier temps : un maximum local du score cumulé qui vaille au moins la moitié de la médiane des maximums.
  const maxima: number[] = [];
  for (let i = 1; i < cumulative.length - 1; i += 1) {
    if (cumulative[i]! > cumulative[i - 1]! && cumulative[i]! >= cumulative[i + 1]!) maxima.push(i);
  }
  if (maxima.length === 0) return [];
  const median = percentile(
    maxima.map((i) => cumulative[i]!),
    0.5,
  );
  let last = -1;
  for (const i of maxima) if (cumulative[i]! > 0.5 * median) last = i;
  if (last < 0) return [];
  const beats: number[] = [];
  for (let i = last; i >= 0; i = backlink[i]!) beats.push(i);
  return beats.reverse();
}

/**
 * Le temps fort : parmi les `beatsPerBar` phases possibles, celle où les temps
 * sont les plus forts et les plus graves.
 */
export function guessDownbeat(strength: readonly number[], bassAtBeat: readonly number[], beatsPerBar: number): number {
  let best = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let phase = 0; phase < beatsPerBar; phase += 1) {
    let score = 0;
    for (let k = phase; k < strength.length; k += beatsPerBar) score += strength[k]! * (1 + (bassAtBeat[k] ?? 0));
    if (score > bestScore) {
      bestScore = score;
      best = phase;
    }
  }
  return best;
}

/** Ramène des valeurs par trame à `rate` échantillons par seconde, par moyenne des trames de chaque créneau. */
function resample(values: readonly number[], frameTimes: readonly number[], rate: number, duration: number): number[] {
  const slots = Math.max(1, Math.ceil(duration * rate));
  const sums = new Float64Array(slots);
  const counts = new Int32Array(slots);
  values.forEach((value, i) => {
    const slot = Math.min(slots - 1, Math.max(0, Math.floor(frameTimes[i]! * rate)));
    sums[slot] = sums[slot]! + value;
    counts[slot] = counts[slot]! + 1;
  });
  const out: number[] = [];
  let previous = 0;
  for (let s = 0; s < slots; s += 1) {
    if (counts[s]! > 0) previous = sums[s]! / counts[s]!;
    out.push(previous);
  }
  return out;
}

/** Le rythme d'une piste mono échantillonnée à `sampleRate` hertz. */
export function analyseRhythm(samples: Float32Array, sampleRate: number, options: AnalysisOptions = {}): Rhythm {
  const settings: Required<AnalysisOptions> = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof AnalysisOptions)[]) {
    const value = options[key];
    if (value !== undefined) (settings as Record<keyof AnalysisOptions, number>)[key] = value;
  }
  const { frame, hop, envelopeRate, beatsPerBar } = settings;
  const duration = samples.length / sampleRate;
  const frameRate = sampleRate / hop;
  const binHz = sampleRate / frame;
  const frames = spectrogram(samples, frame, hop);
  const frameTimes = frames.map((_, i) => (i * hop + frame / 2) / sampleRate);

  const bass = normalise(frames.map((power) => Math.log1p(bandEnergy(power, binHz, BASS_BAND[0], BASS_BAND[1]))));
  const mid = normalise(frames.map((power) => Math.log1p(bandEnergy(power, binHz, MID_BAND[0], MID_BAND[1]))));
  const high = normalise(frames.map((power) => Math.log1p(bandEnergy(power, binHz, HIGH_BAND[0], Math.min(HIGH_BAND[1], sampleRate / 2)))));

  const onsets = onsetStrength(frames, binHz, frameRate);
  const tempo = estimateTempo(onsets, frameRate, settings);
  const period = (60 * frameRate) / tempo.bpm;
  const beatFrames = trackBeats(onsets, period, settings.tightness);
  const localscore = gaussianSmooth(onsets, period / 32);
  // Chaque temps est affiné entre deux trames : le sommet de la parabole qui passe par l'attaque et ses deux voisines.
  const beats = beatFrames.map((i) => {
    const left = localscore[i - 1];
    const right = localscore[i + 1];
    let shift = 0;
    if (left !== undefined && right !== undefined) {
      const denominator = left - 2 * localscore[i]! + right;
      if (denominator < 0) shift = Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denominator));
    }
    return Math.round((frameTimes[i]! + (shift * hop) / sampleRate) * 1000) / 1000;
  });

  // Le tempo réel est celui des temps posés, pris sur toute la piste : bien plus fin que la grille des trames.
  let bpm = tempo.bpm;
  if (beats.length > 2) bpm = (60 * (beats.length - 1)) / (beats[beats.length - 1]! - beats[0]!);

  const rawStrength = beatFrames.map((i) => Math.max(localscore[i - 1] ?? 0, localscore[i]!, localscore[i + 1] ?? 0));
  const reference = percentile(rawStrength, 0.9);
  const strength = rawStrength.map((value) => (reference > 0 ? Math.min(1, value / reference) : 0));
  const downbeat = guessDownbeat(
    strength,
    beatFrames.map((i) => bass[i]!),
    beatsPerBar,
  );

  return {
    bpm,
    duration,
    beatsPerBar,
    downbeat,
    beats,
    strength,
    envelope: {
      rate: envelopeRate,
      bass: resample(bass, frameTimes, envelopeRate, duration),
      mid: resample(mid, frameTimes, envelopeRate, duration),
      high: resample(high, frameTimes, envelopeRate, duration),
    },
  };
}

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseRhythm, estimateTempo, onsetStrength, spectrogram } from '../src/audio/analysis';
import { decodeRhythm, encodeRhythm } from '../src/audio/rhythm';
import { TRACK_IDS, rhythmFile, trackFile, type TrackId } from '../src/data/musique';

/**
 * Analyse le rythme de chaque musique de `public/musique/` et écrit, à côté,
 * son fichier de rythme (`<piste>.rythme.json`, voir `src/audio/rhythm.ts`).
 * À relancer quand une piste change : `npm run rythme`, ou `npm run rythme --
 * boss1 menu` pour quelques pistes seulement. Demande ffmpeg, qui décode le
 * MP3 en mono 22 050 Hz ; l'analyse elle-même est en TypeScript pur.
 */

const SAMPLE_RATE = 22050;
const PUBLIC = join(import.meta.dirname, '..', 'public');

/** Les échantillons mono d'une piste, entre -1 et 1. */
function decode(path: string): Float32Array {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-acodec', 'pcm_s16le', '-'], {
    maxBuffer: 1 << 30,
  });
  if (result.status !== 0) throw new Error(`ffmpeg a échoué sur ${path} : ${result.stderr.toString()}`);
  const pcm = result.stdout;
  const samples = new Float32Array(pcm.length >> 1);
  for (let i = 0; i < samples.length; i += 1) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  return samples;
}

function isTrackId(text: string): text is TrackId {
  return (TRACK_IDS as readonly string[]).includes(text);
}

const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !isTrackId(id));
if (unknown.length > 0) {
  console.error(`Pistes inconnues : ${unknown.join(', ')}. Pistes : ${TRACK_IDS.join(', ')}.`);
  process.exit(1);
}
const ids = wanted.length > 0 ? wanted.filter(isTrackId) : TRACK_IDS;

/** Le tempo retenu et sa confiance, avec la confiance des tempos moitié et double, pour juger un doute d'octave à l'œil. */
function tempoDiagnostic(samples: Float32Array): string {
  const frame = 1024;
  const hop = 512;
  const frames = spectrogram(samples, frame, hop);
  const onsets = onsetStrength(frames, SAMPLE_RATE / frame, SAMPLE_RATE / hop);
  const base = { frame, hop, envelopeRate: 20, beatsPerBar: 4, startBpm: 120, minBpm: 60, maxBpm: 200, tightness: 100 };
  const chosen = estimateTempo(onsets, SAMPLE_RATE / hop, base);
  const half = estimateTempo(onsets, SAMPLE_RATE / hop, { ...base, startBpm: chosen.bpm / 2, minBpm: chosen.bpm / 2.2, maxBpm: chosen.bpm / 1.8 });
  const double = estimateTempo(onsets, SAMPLE_RATE / hop, { ...base, startBpm: chosen.bpm * 2, minBpm: chosen.bpm * 1.8, maxBpm: Math.min(400, chosen.bpm * 2.2) });
  return `confiance ${chosen.confidence.toFixed(2)} (moitié ${half.confidence.toFixed(2)}, double ${double.confidence.toFixed(2)})`;
}

console.log('piste        durée    bpm   temps  mesure  force moy.  fichier');
for (const id of ids) {
  const source = join(PUBLIC, trackFile(id));
  if (!existsSync(source)) {
    console.log(`${id.padEnd(12)} absente`);
    continue;
  }
  const started = Date.now();
  const samples = decode(source);
  const rhythm = analyseRhythm(samples, SAMPLE_RATE);
  const tempo = tempoDiagnostic(samples);
  const text = encodeRhythm(rhythm);
  // Le fichier doit se relire tel quel : on le vérifie avant de l'écrire.
  decodeRhythm(text);
  const target = join(PUBLIC, rhythmFile(id));
  const previous = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (previous !== text) writeFileSync(target, text);
  const meanStrength = rhythm.strength.reduce((sum, value) => sum + value, 0) / Math.max(1, rhythm.strength.length);
  console.log(
    `${id.padEnd(12)} ${rhythm.duration.toFixed(1).padStart(6)} s ${rhythm.bpm.toFixed(1).padStart(6)} ${String(rhythm.beats.length).padStart(6)} ${String(rhythm.downbeat).padStart(7)} ${meanStrength.toFixed(2).padStart(10)}  ${(text.length / 1024).toFixed(1)} Ko, ${((Date.now() - started) / 1000).toFixed(1)} s${previous === text ? ' (inchangé)' : ''} ; ${tempo}`,
  );
}

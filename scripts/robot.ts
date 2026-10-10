import { BEGINNER, REASONABLE, playRobot, type RobotReport } from '../src/sim/robot';
import { DEFAULT_TUNING, withTuning, type Tuning } from '../src/sim/tuning';

/**
 * Mesure d'un réglage par les robots joueurs, en Node, sans navigateur.
 *
 * Usage : `npm run robot -- [clé=valeur ...] [profil=débutant]`, par exemple
 * `npm run robot -- reelSpeed=4 gravity=9`. Dix graines, soixante secondes.
 */

function parseOverrides(args: readonly string[]): Partial<Record<keyof Tuning, number>> {
  const out: Record<string, number> = {};
  for (const arg of args) {
    const [key, value] = arg.split('=');
    if (key && value !== undefined && key in DEFAULT_TUNING) out[key] = Number(value);
  }
  return out as Partial<Record<keyof Tuning, number>>;
}

const args = process.argv.slice(2);
const profile = args.some((a) => a === 'profil=débutant' || a === 'profil=debutant') ? BEGINNER : REASONABLE;
const tuning = withTuning(DEFAULT_TUNING, parseOverrides(args));
const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const reports = seeds.map((seed) => playRobot(seed, tuning, 60, profile));
console.log(`profil ${profile.name}`);
for (const [i, r] of reports.entries()) {
  const end = r.alive ? 'vivant' : r.cause === 'fall' ? 'chute' : 'brume';
  console.log(
    `graine ${String(seeds[i]).padStart(2)} : ${r.height.toFixed(1).padStart(6)} m en ${r.seconds.toFixed(1).padStart(5)} s, ${String(r.catches).padStart(3)} accroches, ${String(r.perfect).padStart(3)} parfaits, vitesse max ${r.maxSpeed.toFixed(1)} m/s, tenue ${r.hold.toFixed(2)} s, ${end}`,
  );
}
const mean = (pick: (r: RobotReport) => number): number => reports.reduce((a, r) => a + pick(r), 0) / reports.length;
console.log(
  `moyenne : ${mean((r) => r.height).toFixed(1)} m, ${mean((r) => r.height / r.seconds).toFixed(2)} m/s de montée, tenue ${mean((r) => r.hold).toFixed(2)} s, ${reports.filter((r) => r.alive).length}/${reports.length} vivants, survie moyenne ${mean((r) => r.seconds).toFixed(1)} s`,
);

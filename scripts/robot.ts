import { Simulation } from '../src/sim/simulation';
import { DEFAULT_TUNING, withTuning, type Tuning } from '../src/sim/tuning';

/**
 * Robot joueur de mesure : joue des parties en Node, sans navigateur, et
 * rapporte la hauteur atteinte, le rythme et les vitesses. Il sert à comparer
 * des réglages avant de les sentir sur téléphone, et préfigure le robot de
 * difficulté de la phase 2.
 *
 * Usage : `npm run robot -- [clé=valeur ...]`, par exemple
 * `npm run robot -- reelSpeed=4 gravity=9`. Cinq graines, soixante secondes.
 *
 * Stratégie « raisonnable » : accroche dès qu'un point est visé, garde le doigt
 * posé jusqu'à une vitesse cible ou une corde au plus court, puis lâche dans la
 * fenêtre du lâcher parfait ; jamais plus de deux secondes et demie pendu.
 */

interface Report {
  height: number;
  seconds: number;
  catches: number;
  perfect: number;
  maxSpeed: number;
  hold: number;
  alive: boolean;
}

const SPEED_TARGET = 8;
const MAX_HOLD_SECONDS = 2.5;

export function playRobot(seed: number, tuning: Tuning, seconds: number): Report {
  const sim = new Simulation(seed, tuning);
  let catches = 0;
  let perfect = 0;
  let maxSpeed = 0;
  let attachStep = 0;
  let holdTotal = 0;
  const limit = Math.round(seconds / tuning.stepSeconds);
  while (sim.state.status === 'alive' && sim.state.step < limit) {
    const s = sim.state;
    if (!s.rope && s.targetId !== null) {
      if (sim.press()) {
        catches += 1;
        attachStep = s.step;
      }
    } else if (s.rope && s.step - attachStep > 10) {
      const held = (s.step - attachStep) * tuning.stepSeconds;
      const speed = Math.hypot(s.hero.vel.x, s.hero.vel.y);
      const ready = speed >= SPEED_TARGET || s.rope.length <= tuning.ropeMin + 1e-9;
      const ax = Math.abs(s.hero.vel.x);
      const slope = ax > 0 ? s.hero.vel.y / ax : Infinity;
      if ((ready && s.hero.vel.y > 1 && slope > 0.6 && slope < 1.8) || held > MAX_HOLD_SECONDS) {
        sim.release();
        holdTotal += held;
      }
    }
    sim.step();
    maxSpeed = Math.max(maxSpeed, Math.hypot(sim.state.hero.vel.x, sim.state.hero.vel.y));
    for (const e of sim.drain()) if (e.type === 'release' && e.perfect) perfect += 1;
  }
  const t = sim.state.step * tuning.stepSeconds;
  return { height: sim.state.height, seconds: t, catches, perfect, maxSpeed, hold: catches ? holdTotal / catches : 0, alive: sim.state.status === 'alive' };
}

function parseOverrides(args: readonly string[]): Partial<Record<keyof Tuning, number>> {
  const out: Record<string, number> = {};
  for (const arg of args) {
    const [key, value] = arg.split('=');
    if (key && value !== undefined && key in DEFAULT_TUNING) out[key] = Number(value);
  }
  return out as Partial<Record<keyof Tuning, number>>;
}

const tuning = withTuning(DEFAULT_TUNING, parseOverrides(process.argv.slice(2)));
const seeds = [1, 2, 3, 4, 5];
const reports = seeds.map((seed) => playRobot(seed, tuning, 60));
for (const [i, r] of reports.entries()) {
  console.log(
    `graine ${seeds[i]} : ${r.height.toFixed(1).padStart(6)} m en ${r.seconds.toFixed(1).padStart(5)} s, ${String(r.catches).padStart(3)} accroches, ${String(r.perfect).padStart(3)} parfaits, vitesse max ${r.maxSpeed.toFixed(1)} m/s, tenue ${r.hold.toFixed(2)} s, ${r.alive ? 'vivant' : 'mort'}`,
  );
}
const mean = (pick: (r: Report) => number): number => reports.reduce((a, r) => a + pick(r), 0) / reports.length;
console.log(`moyenne : ${mean((r) => r.height).toFixed(1)} m, ${mean((r) => r.height / r.seconds).toFixed(2)} m/s de montée, tenue ${mean((r) => r.hold).toFixed(2)} s, ${reports.filter((r) => r.alive).length}/${reports.length} vivants`);

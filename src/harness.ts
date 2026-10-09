// TEMPORAIRE : banc de captures, à supprimer avant de rendre.
import { Camera } from './render/camera';
import { fragileGauge } from './render/cues';
import { Effects } from './render/effects';
import { Renderer } from './render/renderer';
import { Simulation } from './sim/simulation';
import { DEFAULT_TUNING, withTuning } from './sim/tuning';
import type { RuleEvent } from './sim/state';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('graine') ?? '1');
const want = params.get('want') ?? 'dead';
const tuning = withTuning(DEFAULT_TUNING, { tierHeight: Number(params.get('tierHeight') ?? '4') });
const renderer = await Renderer.create(tuning);
const sim = new Simulation(seed, tuning);
const camera = new Camera(tuning.heroRadius, renderer.width, renderer.height);
const effects = new Effects(tuning);
camera.snap(sim.state.hero.pos, sim.state.hero.vel);

const out = window as unknown as { __scene: { done: boolean; reason: string; time: number } };
out.__scene = { done: false, reason: '', time: 0 };
let screen: 'title' | 'playing' | 'dead' = 'playing';
let cause: 'fog' | 'obstacle' | null = null;
let holdSince = 0;
let time = 0;
let countdown = -1;
const dt = 1 / 60;

function pilot(): void {
  const s = sim.state;
  if (!s.rope && s.targetId !== null) {
    sim.press();
    holdSince = time;
  } else if (s.rope && time - holdSince > 0.08) {
    const speed = Math.hypot(s.hero.vel.x, s.hero.vel.y);
    const ready = speed >= 8 || s.rope.length <= 1.5 + 1e-9;
    const ax = Math.abs(s.hero.vel.x);
    const slope = ax > 0 ? s.hero.vel.y / ax : Infinity;
    if ((ready && s.hero.vel.y > 1 && slope > 0.6 && slope < 1.8) || time - holdSince > 2.5) sim.release();
  }
}

function matches(event: RuleEvent): boolean {
  return (want === 'crack' && event.type === 'break') || (want === 'boost' && event.type === 'boost') || (want === 'graze' && event.type === 'graze') || (want === 'pickup' && event.type === 'pickup') || (want === 'banner' && event.type === 'tier');
}

function holdingBooster(): boolean {
  const rope = sim.state.rope;
  return !!rope && sim.state.anchors.find((a) => a.id === rope.anchorId)?.kind === 'booster';
}

function frame(): void {
  if (out.__scene.done) return;
  if (screen === 'playing') {
    pilot();
    sim.step();
    sim.step();
    time += dt;
  }
  const { hero } = sim.state;
  camera.update(dt, hero.pos, hero.vel);
  effects.update(dt);
  const at = camera.worldToScreen(hero.pos);
  for (const event of sim.drain()) {
    if (event.type === 'death') {
      screen = 'dead';
      cause = event.cause;
    }
    effects.handle(event, at);
    if (countdown < 0 && matches(event)) countdown = want === 'banner' ? 40 : 6;
  }
  renderer.draw(sim.state, camera, { screen, deathCause: cause, effects });
  if (want === 'dead' && screen === 'dead' && countdown < 0) countdown = 20;
  if (countdown > 0) countdown -= 1;
  const gauge = want === 'gauge' && (fragileGauge(sim.state, tuning)?.wear ?? 0) > 0.45;
  const boosterHeld = want === 'booster' && holdingBooster() && time - holdSince > 0.3;
  if (countdown === 0 || gauge || boosterHeld || time > 90) {
    out.__scene = { done: true, reason: countdown === 0 ? 'event' : gauge ? 'gauge' : boosterHeld ? 'booster' : screen, time };
    return;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

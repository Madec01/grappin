import { describe, expect, it } from 'vitest';
import { Simulation, replay } from '../src/sim/simulation';

/** Joue une partie scénarisée : tap, balancement, lâcher, tap suivant, etc. */
function play(sim: Simulation, steps: number): void {
  for (let i = 0; i < steps && sim.state.status === 'alive'; i += 1) {
    const s = sim.state;
    if (!s.rope && s.targetId !== null && i % 7 === 0) sim.press();
    else if (s.rope && s.hero.vel.y > 2 && s.hero.vel.x !== 0 && s.hero.vel.y / Math.abs(s.hero.vel.x) > 0.7) sim.release();
    sim.step();
  }
}

describe('déterminisme', () => {
  it('deux exécutions des mêmes gestes donnent le même état, à l\'octet près', () => {
    const a = new Simulation(42);
    const b = new Simulation(42);
    play(a, 2400);
    play(b, 2400);
    expect(a.state.inputs.length).toBeGreaterThan(4);
    expect(a.snapshot()).toBe(b.snapshot());
  });

  it('un clone en plein vol poursuit à l\'identique', () => {
    const a = new Simulation(7);
    play(a, 600);
    const b = a.clone();
    play(a, 600);
    play(b, 600);
    expect(a.snapshot()).toBe(b.snapshot());
  });

  it('le rejeu du journal des gestes reproduit la partie', () => {
    const a = new Simulation(99);
    play(a, 3000);
    const b = replay(99, a.state.inputs, a.state.step);
    expect(b.snapshot()).toBe(a.snapshot());
  });

  it('deux graines différentes donnent des parcours différents', () => {
    expect(new Simulation(1).snapshot()).not.toBe(new Simulation(2).snapshot());
  });
});

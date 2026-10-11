import { describe, expect, it } from 'vitest';
import { Coach, TIPS, WINDOW_TIP_AFTER_SECONDS, isTipId } from '../src/app/coach';
import { Simulation } from '../src/sim/simulation';
import type { RuleEvent, SimState } from '../src/sim/state';

const attach: RuleEvent = { type: 'attach', anchorId: 1 };
const release = (perfect: boolean, kind: 'normal' | 'lanceur' = 'normal'): RuleEvent => ({ type: 'release', perfect, combo: perfect ? 1 : 0, held: 0.5, kind, forced: false });

/** Un état de simulation à la main : corde tenue sur le point `anchorId`, ou libre avec une cible. */
function stateWith(parts: { rope?: number | null; target?: number | null; launcher?: boolean }): SimState {
  const sim = new Simulation(1);
  const state = sim.state;
  const first = state.anchors[0]!;
  if (parts.launcher) state.anchors[0] = { ...first, kind: 'lanceur' };
  state.rope = parts.rope === undefined || parts.rope === null ? null : { anchorId: parts.rope, length: 3 };
  state.targetId = parts.target ?? null;
  return state;
}

describe('le tutoriel par l\'action', () => {
  it('conseille de garder le doigt posé à la première accroche, une seule fois', () => {
    const coach = new Coach();
    const state = stateWith({ rope: 1 });
    expect(coach.observe(state, [attach], false, 0)).toBe(TIPS.grab);
    expect(coach.observe(state, [attach], false, 0)).toBeNull();
    expect(coach.ids).toEqual(['grab']);
  });

  it('conseille de lâcher quand la fenêtre est ouverte, après une courte tenue, et seulement après le premier conseil', () => {
    const coach = new Coach();
    const held = stateWith({ rope: 1 });
    // Sans avoir encore appris à tenir, pas de conseil de lâcher.
    expect(coach.observe(held, [], true, 1)).toBeNull();
    coach.observe(held, [attach], false, 0);
    expect(coach.observe(held, [], true, WINDOW_TIP_AFTER_SECONDS / 2)).toBeNull();
    expect(coach.observe(held, [], false, 1)).toBeNull();
    expect(coach.observe(held, [], true, WINDOW_TIP_AFTER_SECONDS)).toBe(TIPS.window);
    expect(coach.observe(held, [], true, 2)).toBeNull();
  });

  it('conseille d\'appuyer pour rattraper au premier vol avec une cible, après un lâcher', () => {
    const coach = new Coach(['grab', 'window']);
    const flying = stateWith({ rope: null, target: 2 });
    // Avant tout lâcher (le départ du toit), rien.
    expect(coach.observe(flying, [], false, 0)).toBeNull();
    expect(coach.observe(stateWith({ rope: 1 }), [release(false)], false, 0.5)).toBeNull();
    expect(coach.observe(flying, [], false, 0)).toBe(TIPS.catch);
    expect(coach.observe(flying, [], false, 0)).toBeNull();
    // Sans cible, pas de conseil.
    expect(new Coach(['grab']).observe(stateWith({ rope: null, target: null }), [release(false)], false, 0)).toBeNull();
  });

  it('explique le lanceur la première fois qu\'on le tient, et salue le premier parfait', () => {
    const coach = new Coach(['grab', 'window', 'catch']);
    const onLauncher = stateWith({ rope: 1, launcher: true });
    expect(coach.observe(onLauncher, [attach], false, 0)).toBe(TIPS.launcher);
    expect(coach.observe(onLauncher, [], false, 1)).toBeNull();
    expect(coach.observe(stateWith({ rope: null }), [release(true)], false, 0)).toBe(TIPS.perfect);
    expect(coach.observe(stateWith({ rope: null }), [release(true)], false, 0)).toBeNull();
    // Un lancer n'est pas un parfait.
    expect(new Coach().observe(stateWith({ rope: null }), [release(false, 'lanceur')], false, 0)).toBeNull();
  });

  it('les conseils déjà vus ne reviennent pas, et un identifiant inconnu est ignoré', () => {
    const coach = new Coach(['grab', 'inconnu']);
    expect(coach.ids).toEqual(['grab']);
    expect(coach.observe(stateWith({ rope: 1 }), [attach], false, 0)).toBeNull();
    expect(isTipId('grab')).toBe(true);
    expect(isTipId('inconnu')).toBe(false);
  });

  it('chaque conseil a un titre court', () => {
    for (const tip of Object.values(TIPS)) {
      expect(tip.title.length).toBeGreaterThan(3);
      expect(tip.title.length).toBeLessThanOrEqual(28);
      if (tip.detail) expect(tip.detail.length).toBeLessThanOrEqual(44);
    }
  });
});

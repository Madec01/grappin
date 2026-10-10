import { describe, expect, it } from 'vitest';
import { length } from '../src/core/math/vec2';
import { fogSpeed, isPerfectRelease, multiplier } from '../src/sim/rules';
import { Simulation } from '../src/sim/simulation';
import { DEFAULT_TUNING, withTuning } from '../src/sim/tuning';

const T = DEFAULT_TUNING;
const SECOND = Math.round(1 / T.stepSeconds);

describe('accroche et lâcher', () => {
  it('au départ, un point est visé et le tap accroche immédiatement', () => {
    const sim = new Simulation(1);
    expect(sim.state.targetId).not.toBeNull();
    expect(sim.state.hero.grounded).toBe(true);
    expect(sim.press()).toBe(true);
    expect(sim.state.rope).not.toBeNull();
    expect(sim.state.hero.grounded).toBe(false);
    expect(sim.drain().map((e) => e.type)).toEqual(['attach', 'kick']);
  });

  it('sans élan à l\'accroche, l\'impulsion « jamais immobile » relance le personnage', () => {
    const sim = new Simulation(1);
    sim.press();
    expect(length(sim.state.hero.vel)).toBeCloseTo(T.kickSpeed, 6);
    sim.run(SECOND);
    expect(sim.state.hero.pos.y).toBeGreaterThan(0.3);
  });

  it('un second tap pendant l\'accroche est ignoré, un lâcher sans corde aussi', () => {
    const sim = new Simulation(1);
    expect(sim.release()).toBe(false);
    sim.press();
    expect(sim.press()).toBe(false);
    expect(sim.state.inputs).toHaveLength(1);
  });

  it('le lâcher conserve exactement la vitesse du moment', () => {
    const sim = new Simulation(1);
    sim.press();
    sim.run(40);
    const before = { ...sim.state.hero.vel };
    expect(sim.release()).toBe(true);
    expect(sim.state.rope).toBeNull();
    expect(sim.state.hero.vel).toEqual(before);
    sim.step();
    expect(sim.state.hero.vel.x).toBe(before.x);
    expect(sim.state.hero.vel.y).toBeCloseTo(before.y - T.gravity * T.stepSeconds, 12);
  });

  it('le point qui vient d\'être lâché n\'est pas revisé dans la foulée', () => {
    const sim = new Simulation(1);
    sim.press();
    const held = sim.state.rope!.anchorId;
    sim.run(40);
    sim.release();
    sim.step();
    expect(sim.state.targetId).not.toBe(held);
  });
});

describe('lâcher parfait et combo', () => {
  it('reconnaît la fenêtre de 30° à 60° vers le haut, à vitesse suffisante', () => {
    expect(isPerfectRelease(4, 4, T)).toBe(true);
    expect(isPerfectRelease(-4, 4, T)).toBe(true);
    expect(isPerfectRelease(4, 1, T)).toBe(false);
    expect(isPerfectRelease(1, 4, T)).toBe(false);
    expect(isPerfectRelease(4, -4, T)).toBe(false);
    expect(isPerfectRelease(0, 4, T)).toBe(false);
    expect(isPerfectRelease(1.5, 1.5, T)).toBe(false);
  });

  it('un lâcher parfait monte le combo, un lâcher raté le remet à zéro', () => {
    const sim = new Simulation(1);
    sim.press();
    sim.state.hero.vel = { x: 5, y: 5 };
    sim.release();
    expect(sim.state.combo).toBe(1);
    expect(sim.drain().at(-1)).toMatchObject({ type: 'release', perfect: true, combo: 1, forced: false });
    sim.step();
    sim.state.rope = { anchorId: sim.state.anchors[0]!.id, length: 3 };
    sim.state.hero.vel = { x: 5, y: -5 };
    sim.release();
    expect(sim.state.combo).toBe(0);
  });

  it('le multiplicateur est plafonné', () => {
    expect(multiplier(0, T)).toBe(1);
    expect(multiplier(2, T)).toBe(1.5);
    expect(multiplier(100, T)).toBe(T.comboMaxMultiplier);
  });
});

describe('score, sol et brume', () => {
  it('le score ne compte que les mètres gagnés, pondérés par le multiplicateur', () => {
    const sim = new Simulation(1);
    sim.state.combo = 4;
    sim.state.hero.pos = { x: 0, y: 10 };
    sim.state.hero.vel = { x: 0, y: 0 };
    sim.state.hero.grounded = false;
    // Aucune étoile ne doit fausser la mesure.
    sim.state.pickups = [];
    sim.step();
    // La gravité a déjà tiré le personnage d'un pas : on lit la hauteur réellement atteinte.
    expect(sim.state.height).toBeCloseTo(10, 2);
    expect(sim.state.score).toBeCloseTo((sim.state.height - T.heroRadius) * multiplier(4, T), 9);
    // Descendre ne retire rien et ne rapporte rien.
    const score = sim.state.score;
    sim.run(SECOND);
    expect(sim.state.score).toBe(score);
  });

  it('la brume accélère par paliers de hauteur et tue en passant au-dessus du personnage', () => {
    expect(fogSpeed(0, T)).toBe(T.fogBaseSpeed);
    expect(fogSpeed(120, T)).toBeCloseTo(T.fogBaseSpeed + 2 * T.fogSpeedGain, 9);
    // Dans un niveau, la brume garde sa vitesse : aucun gain.
    expect(fogSpeed(10_000, { ...T, fogSpeedGain: 0 })).toBe(T.fogBaseSpeed);
    expect(fogSpeed(10_000, T)).toBe(T.fogMaxSpeed);
    const sim = new Simulation(1);
    // Personne ne tape : posé sur le toit, le personnage attend la brume.
    sim.run(10 * SECOND);
    expect(sim.state.status).toBe('dead');
    expect(sim.state.hero.grounded).toBe(true);
    expect(sim.drain().some((e) => e.type === 'death')).toBe(true);
    const stepAtDeath = sim.state.step;
    sim.run(10);
    expect(sim.state.step).toBe(stepAtDeath);
  });

  it('les réglages se surchargent sans erreur et ignorent les valeurs invalides', () => {
    const tuned = withTuning(T, { gravity: 9, ropeMax: Number.NaN, fogBaseSpeed: undefined });
    expect(tuned.gravity).toBe(9);
    expect(tuned.ropeMax).toBe(T.ropeMax);
    expect(tuned.fogBaseSpeed).toBe(T.fogBaseSpeed);
  });
});

describe('pendaison', () => {
  it('un balancement lent n\'est pas une pendaison : aucune impulsion hors du point bas', () => {
    const sim = new Simulation(1, withTuning(T, { reelSpeed: 0 }));
    sim.press();
    sim.drain();
    sim.run(4 * SECOND);
    expect(sim.drain().filter((e) => e.type === 'kick')).toHaveLength(0);
  });

  it('pendu immobile sous le point, le personnage reçoit une impulsion après le délai', () => {
    const sim = new Simulation(1, withTuning(T, { reelSpeed: 0 }));
    sim.press();
    sim.drain();
    const anchor = sim.state.anchors.find((a) => a.id === sim.state.rope!.anchorId)!;
    sim.state.hero.pos = { x: anchor.pos.x, y: anchor.pos.y - sim.state.rope!.length };
    sim.state.hero.vel = { x: 0, y: 0 };
    sim.run(Math.round(T.hangSeconds / T.stepSeconds) + 2);
    expect(sim.drain().some((e) => e.type === 'kick')).toBe(true);
    expect(length(sim.state.hero.vel)).toBeGreaterThan(T.kickSpeed * 0.9);
  });
});

describe('treuil en partie', () => {
  it('la corde raccourcit jusqu\'au minimum tant que le doigt reste posé, et le personnage gagne de l\'énergie', () => {
    const sim = new Simulation(1);
    sim.press();
    const start = sim.state.rope!.length;
    const energy = (): number => {
      const { pos, vel } = sim.state.hero;
      return 0.5 * (vel.x * vel.x + vel.y * vel.y) + T.gravity * pos.y;
    };
    const e0 = energy();
    sim.run(SECOND);
    expect(sim.state.rope!.length).toBeCloseTo(Math.max(T.ropeMin, start - T.reelSpeed), 6);
    expect(energy()).toBeGreaterThan(e0 + 5);
    sim.run(3 * SECOND);
    expect(sim.state.rope!.length).toBe(T.ropeMin);
  });

  it('sans treuil ni pompage, le pendule conserve son énergie', () => {
    const sim = new Simulation(1, withTuning(T, { reelSpeed: 0, swingAssistAccel: 0 }));
    sim.press();
    const energy = (): number => {
      const { pos, vel } = sim.state.hero;
      return 0.5 * (vel.x * vel.x + vel.y * vel.y) + T.gravity * pos.y;
    };
    const e0 = energy();
    sim.run(2 * SECOND);
    expect(Math.abs(energy() - e0) / e0).toBeLessThan(0.02);
  });
});

describe('mémoire d\'appui', () => {
  it('un tap sans point visé reste en mémoire et accroche dès qu\'un point arrive à portée', () => {
    const sim = new Simulation(1);
    sim.state.anchors = [{ id: 50, pos: { x: 0, y: 0.3 + T.ropeMax + 0.4 }, kind: 'normal', broken: false }];
    sim.state.targetId = null;
    sim.state.hero = { pos: { x: 0, y: 0.3 }, vel: { x: 0, y: 6 }, grounded: false };
    expect(sim.press()).toBe(false);
    expect(sim.state.pressStep).toBe(0);
    expect(sim.state.inputs).toHaveLength(1);
    // Le personnage monte à 6 m/s : le point entre à portée en moins de 0,1 s.
    sim.run(Math.round(0.1 / T.stepSeconds));
    expect(sim.state.rope?.anchorId).toBe(50);
    expect(sim.state.pressStep).toBe(-1);
  });

  it('un tap trop vieux est oublié, et lever le doigt annule la mémoire', () => {
    const sim = new Simulation(1);
    sim.state.anchors = [{ id: 50, pos: { x: 0, y: 0.3 + T.ropeMax + 2 }, kind: 'normal', broken: false }];
    sim.state.targetId = null;
    sim.state.hero = { pos: { x: 0, y: 0.3 }, vel: { x: 0, y: 6 }, grounded: false };
    sim.press();
    sim.run(Math.round(T.pressBufferSeconds / T.stepSeconds) + 2);
    expect(sim.state.pressStep).toBe(-1);
    expect(sim.state.rope).toBeNull();
    sim.press();
    expect(sim.state.pressStep).toBeGreaterThanOrEqual(0);
    sim.release();
    expect(sim.state.pressStep).toBe(-1);
  });

  it('un pas de simulation nul ou négatif est refusé par la surcharge des réglages', () => {
    expect(withTuning(T, { stepSeconds: 0 }).stepSeconds).toBe(T.stepSeconds);
    expect(withTuning(T, { stepSeconds: -1 }).stepSeconds).toBe(T.stepSeconds);
    expect(withTuning(T, { stepSeconds: 1 / 60 }).stepSeconds).toBe(1 / 60);
  });
});

describe('plafond du lâcher', () => {
  it('un lâcher ne part jamais plus vite que releaseMaxSpeed, propulseur compris, et le propulseur dit « Boost »', () => {
    const sim = new Simulation(3, withTuning(T, { fogBaseSpeed: 0 }));
    sim.state.anchors = [{ id: 1, pos: { x: 0, y: 10 }, kind: 'normal', broken: false }, { id: 2, pos: { x: 3, y: 30 }, kind: 'booster', broken: false }];
    sim.state.hero = { pos: { x: 0, y: 6 }, vel: { x: 19, y: 0 }, grounded: false };
    sim.state.rope = { anchorId: 1, length: 4 };
    sim.release();
    expect(Math.hypot(sim.state.hero.vel.x, sim.state.hero.vel.y)).toBeLessThanOrEqual(T.releaseMaxSpeed + 1e-9);
    expect(sim.drain().some((e) => e.type === 'boost')).toBe(false);

    sim.state.hero = { pos: { x: 3, y: 26 }, vel: { x: 14, y: 0 }, grounded: false };
    sim.state.rope = { anchorId: 2, length: 4 };
    sim.release();
    expect(Math.hypot(sim.state.hero.vel.x, sim.state.hero.vel.y)).toBeCloseTo(T.releaseMaxSpeed, 6);
    expect(sim.drain().some((e) => e.type === 'boost')).toBe(true);
  });
});

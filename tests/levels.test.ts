import { describe, expect, it } from 'vitest';
import { LEVELS, levelById } from '../src/data/levels';
import { createProfile, endLevel } from '../src/meta/profile';
import { freeRunStartY, highestCleared, isUnlocked, levelPlan, levelStars, levelTuning, starChecks, unlockedLevel } from '../src/meta/traversee';
import { BEGINNER, REASONABLE, playRobot } from '../src/sim/robot';
import { Simulation, replay } from '../src/sim/simulation';
import { DEFAULT_TUNING } from '../src/sim/tuning';
import type { RunStats } from '../src/meta/missions';

const T = DEFAULT_TUNING;
const quietRun: RunStats = { holds: 0, perfectStreak: 0, grazes: 0, height: 0, pickups: 0, combo: 0, fragileReleases: 0, boosters: 0, seconds: 0 };

describe('les vingt niveaux', () => {
  it('se suivent sans trou, avec des graines distinctes et des profils complets', () => {
    expect(LEVELS).toHaveLength(20);
    expect(LEVELS[0]!.startY).toBe(0);
    for (let i = 1; i < LEVELS.length; i += 1) expect(LEVELS[i]!.startY).toBe(LEVELS[i - 1]!.endY);
    expect(new Set(LEVELS.map((l) => l.seed)).size).toBe(LEVELS.length);
    for (const level of LEVELS) {
      expect(level.endY - level.startY).toBeGreaterThanOrEqual(90);
      expect(level.endY - level.startY).toBeLessThanOrEqual(260);
      expect(level.profile.archetypes.length).toBeGreaterThan(0);
    }
    expect(levelById(3)?.name).toBe('Les enseignes');
  });

  it('chaque niveau s\'engendre en entier à sa création, vérifié, avec une ligne d\'arrivée et un toit de départ', () => {
    for (const level of LEVELS) {
      const sim = new Simulation(level.seed, levelTuning(level, T), levelPlan(level));
      const { state } = sim;
      expect(state.course.unverified, level.name).toBe(0);
      expect(state.course.lastY).toBeGreaterThanOrEqual(level.endY);
      expect(state.finishY).toBe(level.endY);
      expect(state.groundY).toBe(level.startY);
      expect(state.hero.pos.y).toBeCloseTo(level.startY + T.heroRadius, 9);
      expect(state.fogY).toBeCloseTo(level.startY + T.fogStart, 9);
      expect(state.anchors[0]!.pos.y).toBeCloseTo(level.startY + 4, 9);
      // Aucun obstacle dans les premiers mètres : on prend son élan tranquille.
      expect(state.obstacles.every((o) => o.y0 >= level.startY + 6)).toBe(true);
      if (level.id >= 3) expect(state.course.pickupsTotal).toBeGreaterThan(0);
    }
  });

  it('le même niveau est identique à chaque essai, et son rejeu aussi', () => {
    const level = LEVELS[1]!;
    const a = new Simulation(level.seed, levelTuning(level, T), levelPlan(level));
    const b = new Simulation(level.seed, levelTuning(level, T), levelPlan(level));
    expect(a.snapshot()).toBe(b.snapshot());
    a.press();
    a.run(200);
    a.release();
    a.run(400);
    const again = replay(level.seed, a.state.inputs, a.state.step, levelTuning(level, T), levelPlan(level));
    expect(again.snapshot()).toBe(a.snapshot());
  });

  it('franchir la ligne d\'arrivée gagne la partie et la fige', () => {
    const level = LEVELS[0]!;
    const sim = new Simulation(level.seed, levelTuning(level, T), levelPlan(level));
    sim.state.hero = { pos: { x: 0, y: level.endY - 0.5 }, vel: { x: 0, y: 8 }, grounded: false };
    sim.state.fogY = level.endY - 30;
    sim.run(20);
    expect(sim.state.status).toBe('won');
    expect(sim.drain().some((e) => e.type === 'finish')).toBe(true);
    const frozen = sim.snapshot();
    sim.run(50);
    expect(sim.snapshot()).toBe(frozen);
  });

  it('un joueur raisonnable gagne le premier niveau, et un débutant aussi', () => {
    const level = LEVELS[0]!;
    expect(playRobot(level.seed, levelTuning(level, T), 90, REASONABLE, levelPlan(level)).won).toBe(true);
    expect(playRobot(level.seed, levelTuning(level, T), 90, BEGINNER, levelPlan(level)).won).toBe(true);
  });
});

describe('étoiles et déblocages', () => {
  it('trois étoiles : terminer, toutes les étoiles, cinq parfaits d\'affilée', () => {
    expect(starChecks({ won: false, pickupsTaken: 3, pickupsTotal: 3, perfectStreak: 9 })).toEqual([false, false, false]);
    expect(starChecks({ won: true, pickupsTaken: 2, pickupsTotal: 3, perfectStreak: 2 })).toEqual([true, false, false]);
    expect(levelStars({ won: true, pickupsTaken: 3, pickupsTotal: 3, perfectStreak: 5 })).toBe(3);
    // Un niveau sans étoile à ramasser donne la deuxième étoile en le finissant.
    expect(levelStars({ won: true, pickupsTaken: 0, pickupsTotal: 0, perfectStreak: 0 })).toBe(2);
  });

  it('finir un niveau l\'enregistre, débloque le suivant, avance le départ de la course libre et rapporte des primes', () => {
    const profile = createProfile();
    expect(unlockedLevel(profile)).toBe(1);
    expect(isUnlocked(profile, 2)).toBe(false);
    expect(freeRunStartY(profile)).toBe(0);
    const level = LEVELS[0]!;
    const won = endLevel(profile, level, { ...quietRun, height: 60, perfectStreak: 5 }, 80, { won: true, pickupsTaken: 0, pickupsTotal: 0, perfectStreak: 5 });
    expect(won.won).toBe(true);
    expect(won.stars).toBe(3);
    expect(won.newStars).toBe(3);
    expect(won.firstClear).toBe(true);
    // 80 de score + missions (hauteur 30 : 40, parfait 2 : 50) + 3 étoiles × 50 + 100 de premier passage.
    expect(won.xpGained).toBe(80 + 40 + 50 + 150 + 100);
    expect(highestCleared(won.profile)).toBe(1);
    expect(unlockedLevel(won.profile)).toBe(2);
    expect(freeRunStartY(won.profile)).toBe(LEVELS[1]!.startY);
    // Rejouer sans faire mieux ne rapporte ni étoile ni prime : le score, plus la mission « Grimpe 60 m »
    // arrivée entre-temps dans les missions actives.
    const again = endLevel(won.profile, level, { ...quietRun, height: 60 }, 30, { won: true, pickupsTaken: 0, pickupsTotal: 0, perfectStreak: 0 });
    expect(again.newStars).toBe(0);
    expect(again.firstClear).toBe(false);
    expect(again.totalStars).toBe(3);
    expect(again.missionsCompleted.map((m) => m.id)).toEqual(['hauteur-60']);
    expect(again.xpGained).toBe(30 + 60);
    // Perdre enregistre le score mais ne débloque rien.
    const lost = endLevel(createProfile(), LEVELS[1]!, { ...quietRun, height: 70 }, 12, { won: false, pickupsTaken: 1, pickupsTotal: 2, perfectStreak: 1 });
    expect(lost.stars).toBe(0);
    expect(unlockedLevel(lost.profile)).toBe(1);
    expect(lost.profile.levels['2']?.bestScore).toBe(12);
  });
});

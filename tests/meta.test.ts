import { describe, expect, it } from 'vitest';
import { levelFor, levelProgress, xpToReach } from '../src/meta/levels';
import { MISSIONS, nextMissions, settleMissions, type RunStats } from '../src/meta/missions';
import { ACTIVE_MISSIONS, createProfile, endRun, loadProfile, memoryStorage, saveProfile, showsHint, toggleTalisman } from '../src/meta/profile';
import { RunTracker } from '../src/meta/runTracker';
import { TALISMANS, applyTalismans, slotsFor } from '../src/meta/talismans';
import { Simulation } from '../src/sim/simulation';
import { DEFAULT_TUNING, withTuning } from '../src/sim/tuning';

const T = DEFAULT_TUNING;

const quietRun: RunStats = { holds: 0, perfectStreak: 0, grazes: 0, height: 0, pickups: 0, combo: 0, fragileReleases: 0, boosters: 0, seconds: 0 };

describe('niveaux', () => {
  it('le niveau 1 est gratuit, les suivants se méritent de plus en plus', () => {
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(2)).toBe(120);
    expect(xpToReach(3)).toBe(360);
    expect(levelFor(0)).toBe(1);
    expect(levelFor(119)).toBe(1);
    expect(levelFor(120)).toBe(2);
    expect(levelFor(1000)).toBe(4);
    const progress = levelProgress(180);
    expect(progress.level).toBe(2);
    expect(progress.current).toBe(60);
    expect(progress.span).toBe(240);
    expect(progress.ratio).toBeCloseTo(0.25, 9);
  });
});

describe('talismans', () => {
  it('ne font que faciliter, et s\'appliquent dans l\'ordre du catalogue', () => {
    const tuned = applyTalismans(T, ['corde', 'treuil']);
    expect(tuned.ropeMax).toBe(T.ropeMax + 1);
    expect(tuned.reelSpeed).toBeCloseTo(T.reelSpeed * 1.15, 9);
    expect(applyTalismans(T, []).reelSpeed).toBe(T.reelSpeed);
    for (const t of TALISMANS) {
      const after = t.apply(T);
      expect(after.gravity).toBe(T.gravity);
      expect(after.ropeMax).toBeGreaterThanOrEqual(T.ropeMax);
      expect(after.reelSpeed).toBeGreaterThanOrEqual(T.reelSpeed);
    }
    expect(slotsFor(1)).toBe(1);
    expect(slotsFor(4)).toBe(2);
  });

  it('élan de départ : la première accroche part à 6 m/s, les suivantes non', () => {
    const sim = new Simulation(1, withTuning(T, { startKickSpeed: 6 }));
    sim.press();
    expect(Math.hypot(sim.state.hero.vel.x, sim.state.hero.vel.y)).toBeCloseTo(6, 6);
    sim.run(30);
    sim.release();
    sim.state.hero.vel = { x: 0, y: 0 };
    sim.state.hero.pos = { x: 0.8, y: 1 };
    sim.state.targetId = sim.state.anchors[0]!.id;
    sim.state.targetValidStep = sim.state.step;
    sim.state.lastAnchorId = null;
    expect(sim.press()).toBe(true);
    expect(Math.hypot(sim.state.hero.vel.x, sim.state.hero.vel.y)).toBeCloseTo(T.kickSpeed, 6);
  });

  it('seconde chance : la brume renvoie une fois vers le haut, puis tue', () => {
    const sim = new Simulation(1, withTuning(T, { secondChances: 1, fogBaseSpeed: 6 }));
    sim.run(Math.round(3 / T.stepSeconds));
    expect(sim.state.status).toBe('alive');
    const events = sim.drain();
    expect(events.some((e) => e.type === 'rescue')).toBe(true);
    expect(sim.state.chancesLeft).toBe(0);
    sim.run(Math.round(6 / T.stepSeconds));
    expect(sim.state.status).toBe('dead');
  });
});

describe('missions', () => {
  it('le catalogue a des identifiants uniques et trois missions de départ', () => {
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(MISSIONS.length);
    expect(nextMissions([], [], ACTIVE_MISSIONS)).toEqual(MISSIONS.slice(0, 3).map((m) => m.id));
  });

  it('les missions de comptage s\'accumulent, celles de record gardent le meilleur, les finies sont remplacées', () => {
    const active = [
      { id: 'tenir-3', progress: 1 },
      { id: 'hauteur-30', progress: 12 },
      { id: 'parfait-2', progress: 0 },
    ];
    const run: RunStats = { ...quietRun, holds: 1, height: 10, perfectStreak: 2 };
    const outcome = settleMissions(active, [], run);
    expect(outcome.completed.map((m) => m.id)).toEqual(['parfait-2']);
    expect(outcome.xp).toBe(50);
    expect(outcome.active.find((m) => m.id === 'tenir-3')?.progress).toBe(2);
    expect(outcome.active.find((m) => m.id === 'hauteur-30')?.progress).toBe(12);
    expect(outcome.active).toHaveLength(3);
    expect(outcome.active.some((m) => m.id === 'hauteur-60')).toBe(true);
    expect(outcome.allCompleted).toEqual(['parfait-2']);
  });
});

describe('profil', () => {
  it('une fin de partie ajoute le score et les missions à l\'expérience, monte de niveau et débloque', () => {
    const profile = createProfile();
    const run: RunStats = { ...quietRun, height: 45, holds: 3, seconds: 30 };
    const outcome = endRun(profile, run, 100);
    // 100 de score + 40 (tenir-3) + 40 (hauteur-30) = 180 : niveau 2.
    expect(outcome.xpGained).toBe(180);
    expect(outcome.levelBefore).toBe(1);
    expect(outcome.levelAfter).toBe(2);
    expect(outcome.unlocked.map((t) => t.id)).toEqual(['corde']);
    expect(outcome.missionsCompleted.map((m) => m.id).sort()).toEqual(['hauteur-30', 'tenir-3']);
    expect(outcome.profile.runs).toBe(1);
    expect(outcome.profile.bestHeight).toBe(45);
    expect(outcome.profile.bestScore).toBe(100);
    expect(outcome.newBestHeight).toBe(true);
    expect(outcome.profile.missions).toHaveLength(3);
  });

  it('une partie quittée sur le toit rapporte quand même un point', () => {
    expect(endRun(createProfile(), quietRun, 0.02).xpGained).toBe(1);
  });

  it('équipe dans la limite des déblocages et des emplacements', () => {
    let profile = createProfile();
    profile = toggleTalisman(profile, 'treuil');
    expect(profile.equipped).toEqual(['treuil']);
    expect(toggleTalisman(profile, 'corde').equipped).toEqual(['treuil']);
    expect(toggleTalisman(profile, 'treuil').equipped).toEqual([]);
    const rich = { ...profile, xp: xpToReach(4) };
    const two = toggleTalisman(rich, 'corde');
    expect(two.equipped).toEqual(['treuil', 'corde']);
    expect(toggleTalisman(two, 'elan').equipped).toEqual(['treuil', 'corde']);
  });

  it('se sauvegarde et se relit, et toute donnée douteuse ramène au profil neuf', () => {
    const storage = memoryStorage();
    const profile = endRun(toggleTalisman(createProfile(), 'treuil'), { ...quietRun, height: 20 }, 50).profile;
    saveProfile(storage, profile);
    expect(loadProfile(storage)).toEqual(profile);
    expect(loadProfile(memoryStorage('{"version":1,"xp":"beaucoup"}'))).toEqual(createProfile());
    expect(loadProfile(memoryStorage('pas du json'))).toEqual(createProfile());
    expect(loadProfile(memoryStorage(null))).toEqual(createProfile());
    // Un talisman inconnu ou non débloqué est écarté à la relecture.
    expect(loadProfile(memoryStorage(JSON.stringify({ ...createProfile(), equipped: ['inconnu', 'treuil', 'corde'] }))).equipped).toEqual(['treuil']);
  });

  it('l\'indice de départ disparaît une fois 30 m atteints', () => {
    const profile = createProfile();
    expect(showsHint(profile)).toBe(true);
    expect(showsHint(endRun(profile, { ...quietRun, height: 31 }, 10).profile)).toBe(false);
  });
});

describe('suiveur de partie', () => {
  it('relève tenues, séries de parfaits, frôlés, étoiles, fragiles et propulseurs', () => {
    const tracker = new RunTracker();
    const release = (perfect: boolean, held: number, kind: 'normal' | 'fragile' | 'booster' = 'normal', forced = false) =>
      tracker.handle({ type: 'release', perfect, combo: perfect ? 1 : 0, held, kind, forced });
    release(true, 1.2);
    release(true, 0.4, 'booster');
    release(false, 1.5, 'fragile');
    release(true, 1.1, 'fragile', true);
    tracker.handle({ type: 'graze', obstacleId: 1 });
    tracker.handle({ type: 'pickup', pickupId: 1 });
    tracker.handle({ type: 'pickup', pickupId: 2 });
    const sim = new Simulation(1);
    sim.state.height = 42;
    sim.state.step = 1200;
    const stats = tracker.stats(sim.state, T);
    expect(stats.holds).toBe(2);
    expect(stats.perfectStreak).toBe(2);
    expect(stats.grazes).toBe(1);
    expect(stats.pickups).toBe(2);
    expect(stats.fragileReleases).toBe(1);
    expect(stats.boosters).toBe(1);
    expect(stats.height).toBe(42);
    expect(stats.seconds).toBeCloseTo(10, 9);
  });
});

import { describe, expect, it } from 'vitest';
import { Game, readSettings } from '../src/app/game';
import { levelById } from '../src/data/levels';
import { createProfile, loadProfile, memoryStorage, saveProfile, type LevelOutcome, type Profile, type ProfileStorage, type RunOutcome } from '../src/meta/profile';
import type { TalismanId } from '../src/meta/talismans';
import { FIRST_CLEAR_XP, STAR_XP, freeRunStartY, unlockedLevel, type LevelResult } from '../src/meta/traversee';
import type { ButtonId } from '../src/render/buttons';
import type { Camera } from '../src/render/camera';
import type { DeathCause, GameFrame, GameScreen } from '../src/render/renderer';
import type { SimState } from '../src/sim/state';
import { DEFAULT_TUNING, type Tuning } from '../src/sim/tuning';

/** Ce que le faux rendu a reçu à la dernière image, et tout ce qu'il a vu passer au fil de la partie. */
interface Seen {
  /** Mode test tel que la dernière image l'a reçu. */
  lastTestMode: boolean;
  /** Écran demandé à chaque image. */
  readonly screens: GameScreen[];
  lastCause: DeathCause | null;
  /** Textes flottants et bannière de la dernière image. */
  lastTexts: string[];
  lastBanner: string | null;
  lastBannerDetail: string | null;
  /** Textes flottants distincts vus à l'écran, et bannières de palier distinctes. */
  readonly texts: Set<string>;
  readonly banners: Set<string>;
  /** Réglages, profil et bilan de la dernière image. */
  lastTuning: Tuning | null;
  lastProfile: Profile | null;
  lastOutcome: RunOutcome | LevelOutcome | null;
  lastResult: LevelResult | null;
  /** L'état vivant de la simulation, tel que le rendu le reçoit : de quoi téléporter le personnage. */
  state: SimState | null;
  /** Caméra de la dernière image, et ce que les effets montrent : traînées de vent et position écran des textes flottants. */
  camera: Camera | null;
  lastStreaksX: number[];
  lastTextAt: { x: number; y: number }[];
  /** Le bouton que le faux rendu trouve sous un point : aucun tant que le test n'en pose pas. */
  hit: (x: number, y: number) => ButtonId | null;
}

/** Profil d'un joueur déjà avancé : de l'expérience et des talismans équipés. */
function profileWith(xp: number, equipped: TalismanId[] = []): Profile {
  return { ...createProfile(), xp, equipped };
}

/** Jeu relié à un faux rendu qui note ce qu'on lui demande de dessiner, et à un stockage mémoire, vide ou garni d'un profil. */
function makeGame(search = '', saved?: Profile): { game: Game; seen: Seen; storage: ProfileStorage } {
  const seen: Seen = {
    screens: [],
    lastCause: null,
    lastTexts: [],
    lastBanner: null,
    lastBannerDetail: null,
    texts: new Set(),
    banners: new Set(),
    lastTuning: null,
    lastTestMode: false,
    lastProfile: null,
    lastOutcome: null,
    lastResult: null,
    state: null,
    camera: null,
    lastStreaksX: [],
    lastTextAt: [],
    hit: () => null,
  };
  const view = {
    width: 390,
    height: 844,
    draw: (state: SimState, camera: Camera, frame: GameFrame) => {
      seen.state = state;
      seen.camera = camera;
      seen.lastStreaksX = frame.effects.windStreaks.map((streak) => streak.x);
      seen.lastTextAt = frame.effects.texts.map((item) => ({ x: item.x, y: item.y }));
      seen.screens.push(frame.screen);
      seen.lastCause = frame.deathCause;
      seen.lastTexts = frame.effects.texts.map((item) => item.text);
      seen.lastBanner = frame.effects.banner?.text ?? null;
      seen.lastBannerDetail = frame.effects.banner?.detail ?? null;
      seen.lastTuning = frame.tuning;
      seen.lastTestMode = frame.testMode;
      seen.lastProfile = frame.profile;
      seen.lastOutcome = frame.outcome;
      seen.lastResult = frame.result;
      for (const text of seen.lastTexts) seen.texts.add(text);
      if (seen.lastBanner) seen.banners.add(seen.lastBanner);
    },
    hitTest: (x: number, y: number) => seen.hit(x, y),
  };
  const storage = memoryStorage();
  if (saved) saveProfile(storage, saved);
  return { game: new Game(view, readSettings(search), storage), seen, storage };
}

/** Comme `makeGame`, mais la course libre est déjà lancée, sans appui d'accroche : l'URL (brume, hauteur des paliers, graine) y règne, ce qu'un niveau ne permet pas. */
function makeFreeGame(search = '', saved?: Profile): ReturnType<typeof makeGame> {
  const made = makeGame(search, saved);
  made.game.playFree();
  return made;
}

/** Joue des images de 50 ms jusqu'à l'écran de fin ; renvoie le nombre d'images, ou -1 si la mort ne vient pas. */
function frameUntilDead(game: Game): number {
  for (let frames = 1; frames <= 400; frames += 1) {
    game.frame(0.05);
    if (game.debugState().screen === 'dead') {
      // L'écran de fin ignore les appuis pendant six dixièmes de seconde : on laisse ce temps passer.
      for (let settle = 0; settle < 8; settle += 1) game.frame(0.1);
      return frames;
    }
  }
  return -1;
}

describe('verrou de l\'écran de fin', () => {
  it('un appui juste après la mort est ignoré, puis accepté', () => {
    const { game } = makeFreeGame('?graine=1&fogBaseSpeed=6');
    game.press();
    game.release();
    for (let frames = 0; frames < 400 && game.debugState().screen !== 'dead'; frames += 1) game.frame(0.05);
    expect(game.debugState().screen).toBe('dead');
    game.press();
    expect(game.debugState().screen).toBe('dead');
    for (let settle = 0; settle < 8; settle += 1) game.frame(0.1);
    game.press();
    expect(game.debugState().screen).toBe('playing');
  });
});

/**
 * Pilote de test, même stratégie que `scripts/capture.ts` : accroche dès qu'un
 * point est visé, lâche dans la fenêtre du lâcher parfait, jamais plus de
 * 2,5 s tenu. Renvoie une fonction qui joue une image de 1/60 s.
 */
function makePilot(game: Game): () => void {
  const dt = 1 / 60;
  let time = 0;
  let holdSince = 0;
  return () => {
    game.frame(dt);
    time += dt;
    const s = game.debugState();
    if (s.screen === 'dead') return;
    if (!s.attached && s.targetId !== null) {
      game.press();
      holdSince = time;
    } else if (s.attached && time - holdSince > 0.08) {
      const speed = Math.hypot(s.vel.x, s.vel.y);
      const ready = speed >= 8 || (s.ropeLength !== null && s.ropeLength <= 1.5 + 1e-9);
      const ax = Math.abs(s.vel.x);
      const slope = ax > 0 ? s.vel.y / ax : Infinity;
      if ((ready && s.vel.y > 1 && slope > 0.6 && slope < 1.8) || time - holdSince > 2.5) game.release();
    }
  };
}

/** Joue le pilote jusqu'à la mort ou `seconds` de jeu ; dit si le compte d'étoiles a un jour baissé, et son maximum. */
function playPilot(game: Game, seconds: number): { maxPickups: number; decreased: boolean } {
  const play = makePilot(game);
  let maxPickups = 0;
  let decreased = false;
  for (let frames = 0; frames < seconds * 60 && game.debugState().screen !== 'dead'; frames += 1) {
    play();
    const { pickups } = game.debugState();
    if (pickups < maxPickups) decreased = true;
    maxPickups = Math.max(maxPickups, pickups);
  }
  return { maxPickups, decreased };
}

describe('réglages d\'URL', () => {
  it('lit la graine et surcharge les réglages nommés comme une clé de Tuning', () => {
    const settings = readSettings('?graine=123&gravity=9&ropeMax=6');
    expect(settings.seed).toBe(123);
    expect(settings.tuning.gravity).toBe(9);
    expect(settings.tuning.ropeMax).toBe(6);
    expect(settings.tuning.heroRadius).toBe(DEFAULT_TUNING.heroRadius);
  });

  it('ignore les valeurs illisibles, vides ou inconnues', () => {
    const settings = readSettings('?graine=1.5&gravity=abc&ropeMax=&inconnu=3');
    expect(settings.seed).toBeNull();
    expect(settings.tuning).toEqual(DEFAULT_TUNING);
    expect(readSettings('').seed).toBeNull();
  });

  it('?test=1 ouvre le mode test ; absent, vide, à 0 ou à non, il reste fermé', () => {
    expect(readSettings('?test=1').testMode).toBe(true);
    expect(readSettings('?test').testMode).toBe(true);
    expect(readSettings('?graine=3&test=oui').testMode).toBe(true);
    expect(readSettings('').testMode).toBe(false);
    expect(readSettings('?test=0').testMode).toBe(false);
    expect(readSettings('?test=non').testMode).toBe(false);
  });
});

describe('mode test', () => {
  const BUTTON = { x: 195, y: 500 };

  it('tous les niveaux se lancent sans les avoir débloqués, depuis la liste comme par playLevel(), et le jeu le dit', () => {
    const { game, seen } = makeGame('?test=1');
    expect(game.debugState()).toMatchObject({ testMode: true, unlockedLevel: 1 });
    expect(game.playLevel(10)).toBe(true);
    expect(game.debugState()).toMatchObject({ screen: 'playing', mode: 'level', levelId: 10, testMode: true });

    game.restart();
    seen.hit = (x, y) => (x === BUTTON.x && y === BUTTON.y ? 'levels' : null);
    game.press(BUTTON.x, BUTTON.y);
    seen.hit = (x, y) => (x === BUTTON.x && y === BUTTON.y ? 'niveau-7' : null);
    game.press(BUTTON.x, BUTTON.y);
    expect(game.debugState()).toMatchObject({ screen: 'playing', mode: 'level', levelId: 7 });
    game.frame(0.016);
    expect(seen.lastTestMode).toBe(true);
  });

  it('hors mode test, rien ne change : un niveau verrouillé reste fermé et le rendu ne signale rien', () => {
    const { game, seen } = makeGame('?graine=3');
    expect(game.playLevel(7)).toBe(false);
    expect(game.debugState()).toMatchObject({ screen: 'title', testMode: false });
    game.frame(0.016);
    expect(seen.lastTestMode).toBe(false);
  });
});

describe('jeu', () => {
  it('attend un appui sur l\'écran titre : le temps ne passe pas', () => {
    const { game, seen } = makeGame('?graine=3');
    game.frame(1);
    expect(game.debugState()).toMatchObject({ screen: 'title', step: 0, attached: false, seed: 3 });
    expect(seen.screens).toEqual(['title']);
  });

  it('démarre au premier appui, qui compte aussi comme l\'appui d\'accroche', () => {
    const { game } = makeGame('?graine=3');
    game.press();
    expect(game.debugState()).toMatchObject({ screen: 'playing', attached: true, mode: 'level', levelId: 1 });
    game.release();
    expect(game.debugState().attached).toBe(false);
  });

  it('convertit le temps réel en pas fixes de 1/120 s', () => {
    const { game } = makeGame('?graine=3');
    game.press();
    game.frame(0.05);
    expect(game.debugState().step).toBeGreaterThanOrEqual(5);
    expect(game.debugState().step).toBeLessThanOrEqual(6);
  });

  it('plafonne une image longue à 100 ms de temps de jeu', () => {
    const { game } = makeGame('?graine=3');
    game.press();
    game.frame(30);
    expect(game.debugState().step).toBeGreaterThanOrEqual(11);
    expect(game.debugState().step).toBeLessThanOrEqual(12);
  });

  it('passe à l\'écran de fin à la mort, puis relance sur la même graine si elle est imposée', () => {
    const { game } = makeFreeGame('?graine=3');
    game.press();
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    const dead = game.debugState();
    expect(dead.screen).toBe('dead');

    game.frame(1);
    expect(game.debugState().step).toBe(dead.step);

    game.press();
    expect(game.debugState()).toMatchObject({ screen: 'playing', seed: 3, attached: true, cause: null });
    expect(game.debugState().step).toBeLessThan(dead.step);
  });

  it('prend une graine neuve à chaque partie quand l\'URL n\'en impose pas', () => {
    const { game } = makeGame();
    const first = game.debugState().seed;
    game.restart();
    expect(game.debugState().seed).not.toBe(first);
  });

  it('restart() revient à l\'écran titre, avec la graine imposée ou celle qu\'on donne', () => {
    const { game } = makeGame('?graine=7');
    game.press();
    game.frame(0.05);
    game.restart();
    expect(game.debugState()).toMatchObject({ screen: 'title', step: 0, seed: 7 });
    game.restart(9);
    expect(game.debugState().seed).toBe(9);
  });

  it('expose exactement les champs de debugState()', () => {
    const { game } = makeGame();
    expect(Object.keys(game.debugState()).sort()).toEqual(
      [
        'attached',
        'cause',
        'combo',
        'equipped',
        'events',
        'fogFactor',
        'fogY',
        'freeRunStartY',
        'goal',
        'gravityX',
        'gravityY',
        'height',
        'level',
        'levelHeight',
        'levelId',
        'lightsOff',
        'missions',
        'mode',
        'obstacles',
        'pickups',
        'pos',
        'ropeLength',
        'runs',
        'score',
        'screen',
        'seed',
        'stars',
        'step',
        'targetId',
        'tier',
        'testMode',
        'unlockedLevel',
        'vel',
        'windX',
        'xp',
        'xpGained',
      ].sort(),
    );
  });
});

describe('mort et cause', () => {
  it('la brume tue un personnage laissé au sol : cause « fog », transmise au rendu', () => {
    const { game, seen } = makeFreeGame('?graine=3');
    expect(game.debugState().cause).toBeNull();
    game.press();
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    expect(game.debugState().cause).toBe('fog');
    expect(seen.lastCause).toBe('fog');
  });

  it('un obstacle tue : cause « obstacle », sur l\'état et sur ce que reçoit le rendu', () => {
    // Paliers de 4 m : obstacles, fragiles et propulseurs apparaissent tout près du toit.
    for (let seed = 1; seed <= 10; seed += 1) {
      const { game, seen } = makeFreeGame(`?graine=${seed}&tierHeight=4`);
      playPilot(game, 60);
      if (game.debugState().cause !== 'obstacle') continue;
      expect(game.debugState().screen).toBe('dead');
      expect(seen.lastCause).toBe('obstacle');
      return;
    }
    expect.unreachable('aucune des dix graines n\'a fini sur un obstacle');
  });

  it('une nouvelle partie efface le palier, la cause et les effets en cours', () => {
    const { game, seen } = makeFreeGame('?graine=3&tierHeight=4');
    const play = makePilot(game);
    // Joue jusqu'à la première bannière de palier : des effets sont alors en cours.
    for (let frames = 0; frames < 600 && seen.lastBanner === null; frames += 1) play();
    expect(seen.lastBanner).not.toBeNull();
    expect(game.debugState().tier).toBeGreaterThan(0);

    game.restart();
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ screen: 'title', cause: null, pickups: 0, tier: 0 });
    expect(seen).toMatchObject({ lastCause: null, lastBanner: null, lastTexts: [] });
  });
});

describe('ce que le jeu sait de la route haute', () => {
  it('expose le palier, le nombre d\'obstacles chargés et les étoiles prises', () => {
    const { game } = makeFreeGame('?graine=3');
    expect(game.debugState()).toMatchObject({ tier: 0, obstacles: 0, pickups: 0 });

    const hard = makeFreeGame('?graine=3&tierHeight=4').game;
    playPilot(hard, 60);
    expect(hard.debugState().tier).toBeGreaterThan(0);
    expect(hard.debugState().obstacles).toBeGreaterThan(0);
  });

  it('compte les étoiles prises sans jamais les perdre, même quand la simulation les oublie sous la brume', () => {
    let best = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const { game } = makeFreeGame(`?graine=${seed}&tierHeight=4`);
      const run = playPilot(game, 60);
      expect(run.decreased).toBe(false);
      best = Math.max(best, run.maxPickups);
      expect(game.debugState().pickups).toBe(run.maxPickups);
    }
    expect(best).toBeGreaterThan(0);
  });

  it('transmet les événements de règles au rendu : textes flottants et bannière de palier', () => {
    const { game, seen } = makeFreeGame('?graine=3&tierHeight=4');
    playPilot(game, 60);
    expect([...seen.texts].some((text) => text.startsWith('Parfait ×'))).toBe(true);
    expect(seen.banners.has('Les gouttières · 4 m')).toBe(true);
    expect(seen.banners.has('Les enseignes · 8 m')).toBe(true);
  });
});

/** Le pilote joue `seconds` de jeu, puis lâche tout et laisse la brume ou la chute finir la partie. */
function playThenFall(game: Game, seconds: number): void {
  playPilot(game, seconds);
  game.release();
  expect(frameUntilDead(game)).toBeGreaterThan(0);
}

describe('profil et progression', () => {
  it('part d\'un profil neuf quand rien n\'est sauvegardé', () => {
    const { game } = makeGame();
    expect(game.debugState()).toMatchObject({ level: 1, xp: 0, runs: 0, xpGained: 0, equipped: [] });
    expect(game.debugState().missions.map((mission) => mission.id)).toEqual(createProfile().missions.map((mission) => mission.id));
  });

  it('charge le profil sauvegardé au départ et le donne au rendu', () => {
    const saved = { ...profileWith(500, ['treuil']), runs: 3 };
    const { game, seen } = makeGame('', saved);
    expect(game.debugState()).toMatchObject({ level: 3, xp: 500, runs: 3, equipped: ['treuil'], xpGained: 0 });
    game.frame(0.016);
    expect(seen.lastProfile).toEqual(saved);
    expect(seen.lastOutcome).toBeNull();
  });

  it('joue avec les réglages des talismans équipés : un treuil renforcé raccourcit la corde plus vite', () => {
    const plain = makeGame('?graine=3');
    const winch = makeGame('?graine=3', profileWith(0, ['treuil']));
    for (const { game } of [plain, winch]) {
      game.press();
      for (let frames = 0; frames < 5; frames += 1) game.frame(0.1);
    }
    expect(plain.seen.lastTuning?.reelSpeed).toBe(DEFAULT_TUNING.reelSpeed);
    expect(winch.seen.lastTuning?.reelSpeed).toBeCloseTo(DEFAULT_TUNING.reelSpeed * 1.15, 9);
    expect(winch.game.debugState().ropeLength).toBeLessThan(plain.game.debugState().ropeLength ?? 0);
  });

  it('recalcule les réglages à chaque nouvelle partie, depuis l\'écran titre comme depuis l\'écran de fin', () => {
    const { game, seen } = makeGame('?graine=3');
    game.frame(0.016);
    expect(seen.lastTuning?.reelSpeed).toBe(DEFAULT_TUNING.reelSpeed);

    game.equip('treuil');
    game.press();
    game.frame(0.016);
    expect(seen.lastTuning?.reelSpeed).toBeCloseTo(DEFAULT_TUNING.reelSpeed * 1.15, 9);
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);

    game.equip('treuil');
    expect(game.currentProfile().equipped).toEqual([]);
    game.press();
    game.frame(0.016);
    expect(seen.lastTuning?.reelSpeed).toBe(DEFAULT_TUNING.reelSpeed);
  });

  it('garde la graine annoncée par l\'écran titre quand les talismans changent avant le départ de la course libre', () => {
    const { game } = makeGame();
    game.restart(41);
    game.equip('treuil');
    game.playFree();
    expect(game.debugState()).toMatchObject({ screen: 'playing', mode: 'free', seed: 41 });
  });

  it('une partie finie ajoute son expérience et ses parties au profil, le sauvegarde, et donne le bilan au rendu', () => {
    const { game, seen, storage } = makeFreeGame('?graine=3&fogBaseSpeed=4');
    game.press();
    for (let frames = 0; frames < 2; frames += 1) game.frame(0.05);
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);

    const dead = game.debugState();
    expect(dead).toMatchObject({ screen: 'dead', runs: 1 });
    expect(dead.xp).toBeGreaterThan(0);
    expect(dead.xpGained).toBe(dead.xp);
    expect(dead.xpGained).toBe(Math.floor(dead.score));
    expect(seen.lastOutcome?.xpGained).toBe(dead.xpGained);
    expect(seen.lastOutcome?.newBestHeight).toBe(true);
    expect(seen.lastProfile).toBe(seen.lastOutcome?.profile);
    expect(loadProfile(storage)).toEqual(game.currentProfile());
    expect(loadProfile(storage).bestHeight).toBeCloseTo(dead.height, 9);
  });

  it('ne compte une partie qu\'une fois, même si l\'écran de fin dure', () => {
    const { game, storage } = makeFreeGame('?graine=3&fogBaseSpeed=4');
    game.press();
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    for (let frames = 0; frames < 20; frames += 1) game.frame(0.05);
    expect(game.debugState().runs).toBe(1);
    expect(loadProfile(storage).runs).toBe(1);
  });

  it('nourrit les missions des événements de la partie : le pilote en accomplit, avec leur récompense', () => {
    const { game, seen, storage } = makeFreeGame('?graine=3');
    playThenFall(game, 10);
    const outcome = seen.lastOutcome;
    expect(outcome).not.toBeNull();
    const done = outcome?.missionsCompleted ?? [];
    expect(done.map((mission) => mission.id)).toContain('hauteur-30');
    expect(outcome?.xpGained).toBe(Math.floor(game.debugState().score) + done.reduce((sum, mission) => sum + mission.reward, 0));
    for (const mission of done) {
      expect(game.debugState().missions.map((m) => m.id)).not.toContain(mission.id);
      expect(game.currentProfile().completedMissions).toContain(mission.id);
    }
    expect(game.debugState().missions).toHaveLength(3);
    expect(loadProfile(storage)).toEqual(game.currentProfile());
    expect(game.debugState().level).toBeGreaterThan(1);
  });

  it('xpGained repart de zéro avec la partie suivante', () => {
    const { game } = makeFreeGame('?graine=3&fogBaseSpeed=4');
    game.press();
    game.frame(0.1);
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    expect(game.debugState().xpGained).toBeGreaterThan(0);
    game.press();
    expect(game.debugState()).toMatchObject({ screen: 'playing', xpGained: 0 });
  });

  it('restart() relit le profil depuis le stockage', () => {
    const { game, storage } = makeGame();
    expect(game.debugState().xp).toBe(0);
    saveProfile(storage, profileWith(1000, ['treuil']));
    game.restart();
    expect(game.debugState()).toMatchObject({ screen: 'title', xp: 1000, level: 4, equipped: ['treuil'] });
  });

  it('resetProfile() sauvegarde un profil neuf et revient à l\'écran titre', () => {
    const { game, storage } = makeFreeGame('?graine=3&fogBaseSpeed=4');
    game.press();
    game.frame(0.1);
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    game.equip('treuil');

    game.resetProfile();
    expect(game.debugState()).toMatchObject({ screen: 'title', level: 1, xp: 0, runs: 0, equipped: [], xpGained: 0 });
    expect(loadProfile(storage)).toEqual(createProfile());
  });

  it('equip() équipe, retire et sauvegarde ; il respecte les déblocages et les emplacements', () => {
    const { game, storage } = makeGame('', profileWith(130));
    expect(game.equip('treuil').equipped).toEqual(['treuil']);
    expect(loadProfile(storage).equipped).toEqual(['treuil']);
    // Niveau 2 : un seul emplacement, déjà pris.
    expect(game.equip('corde').equipped).toEqual(['treuil']);
    expect(game.equip('treuil').equipped).toEqual([]);
    expect(game.equip('corde').equipped).toEqual(['corde']);
    // Pas encore débloquée au niveau 2.
    game.equip('corde');
    expect(game.equip('chance').equipped).toEqual([]);
    expect(loadProfile(storage).equipped).toEqual([]);
  });

  it('la seconde chance renvoie le personnage vers le haut et le dit à l\'écran', () => {
    const { game, seen } = makeFreeGame('?graine=3&fogBaseSpeed=4', profileWith(720, ['chance']));
    expect(game.debugState().level).toBe(4);
    game.press();
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    expect(seen.texts.has('Seconde chance !')).toBe(true);

    const plain = makeFreeGame('?graine=3&fogBaseSpeed=4');
    plain.game.press();
    plain.game.release();
    expect(frameUntilDead(plain.game)).toBeGreaterThan(0);
    expect(plain.seen.texts.has('Seconde chance !')).toBe(false);
  });
});

describe('boutons et écran des talismans', () => {
  /** De faux boutons à trois ordonnées : « Talismans », une ligne de talisman et « Retour ». Tout autre point ne touche rien. */
  const BUTTON = { x: 195, y: 760 };
  const ROW = { x: 195, y: 300 };
  const BACK = { x: 195, y: 800 };
  const OUTSIDE = { x: 195, y: 100 };

  function withButtons(seen: Seen, row: ButtonId = 'treuil'): void {
    seen.hit = (_x, y) => (y === BUTTON.y ? 'talismans' : y === ROW.y ? row : y === BACK.y ? 'back' : null);
  }

  it('un appui sur le bouton Talismans ouvre l\'écran, sans lancer la partie ni faire passer le temps', () => {
    const { game, seen } = makeGame('?graine=3');
    withButtons(seen);
    game.press(BUTTON.x, BUTTON.y);
    game.frame(1);
    expect(game.debugState()).toMatchObject({ screen: 'talismans', step: 0, attached: false });
    expect(seen.screens.at(-1)).toBe('talismans');
  });

  it('un appui ailleurs sur l\'écran titre lance la partie, comme avant', () => {
    const { game, seen } = makeGame('?graine=3');
    withButtons(seen);
    game.press(OUTSIDE.x, OUTSIDE.y);
    expect(game.debugState()).toMatchObject({ screen: 'playing', attached: true });
  });

  it('sur l\'écran des talismans, une ligne équipe, une deuxième fois la retire, et chaque changement est sauvegardé', () => {
    const { game, seen, storage } = makeGame('?graine=3');
    withButtons(seen);
    game.press(BUTTON.x, BUTTON.y);

    game.press(ROW.x, ROW.y);
    expect(game.debugState().equipped).toEqual(['treuil']);
    expect(loadProfile(storage).equipped).toEqual(['treuil']);
    game.frame(0.016);
    expect(seen.lastProfile?.equipped).toEqual(['treuil']);

    game.press(ROW.x, ROW.y);
    expect(game.debugState().equipped).toEqual([]);
    expect(loadProfile(storage).equipped).toEqual([]);
    expect(game.debugState().screen).toBe('talismans');
  });

  it('un appui ailleurs, ou sans position, ne fait rien sur l\'écran des talismans', () => {
    const { game, seen } = makeGame('?graine=3');
    withButtons(seen);
    game.press(BUTTON.x, BUTTON.y);
    game.press(OUTSIDE.x, OUTSIDE.y);
    game.press();
    // Le bouton « Talismans » n'existe pas sur cet écran : un reste de l'écran précédent est ignoré.
    game.press(BUTTON.x, BUTTON.y);
    expect(game.debugState()).toMatchObject({ screen: 'talismans', step: 0, equipped: [] });
    game.release();
    expect(game.debugState().screen).toBe('talismans');
  });

  it('une ligne verrouillée ne s\'équipe pas, même si le rendu la signalait', () => {
    const { game, seen } = makeGame('?graine=3');
    withButtons(seen, 'aimant');
    game.press(BUTTON.x, BUTTON.y);
    game.press(ROW.x, ROW.y);
    expect(game.debugState().equipped).toEqual([]);
  });

  it('« Retour » ramène à l\'écran titre, qui garde sa graine', () => {
    const { game, seen } = makeGame('?graine=3');
    withButtons(seen);
    game.press(BUTTON.x, BUTTON.y);
    game.press(BACK.x, BACK.y);
    expect(game.debugState()).toMatchObject({ screen: 'title', seed: 3 });
  });

  it('depuis l\'écran de fin, « Retour » ramène à l\'écran de fin avec le même bilan', () => {
    const { game, seen } = makeGame('?graine=3&fogBaseSpeed=4');
    withButtons(seen);
    game.press();
    game.frame(0.1);
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    const outcome = seen.lastOutcome;
    const gained = game.debugState().xpGained;
    expect(outcome).not.toBeNull();

    game.press(BUTTON.x, BUTTON.y);
    expect(game.debugState().screen).toBe('talismans');
    game.press(ROW.x, ROW.y);
    game.press(BACK.x, BACK.y);
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ screen: 'dead', xpGained: gained, cause: 'fog' });
    expect(seen.lastOutcome).toBe(outcome);
    expect(game.debugState().equipped).toEqual(['treuil']);

    // Un appui ailleurs rejoue, avec le talisman choisi pendant l'écran de fin.
    game.press(OUTSIDE.x, OUTSIDE.y);
    game.frame(0.016);
    expect(game.debugState().screen).toBe('playing');
    expect(seen.lastTuning?.reelSpeed).toBeCloseTo(DEFAULT_TUNING.reelSpeed * 1.15, 9);
  });

  it('en partie, un appui lance le grappin sans interroger les boutons', () => {
    const { game, seen } = makeGame('?graine=3');
    game.press();
    game.release();
    // Le faux rendu dirait « Talismans » partout : en partie, cela ne compte pas.
    seen.hit = () => 'talismans';
    game.press(BUTTON.x, BUTTON.y);
    expect(game.debugState()).toMatchObject({ screen: 'playing' });
  });
});

/** Profil d'un joueur qui a franchi les `cleared` premiers niveaux, une étoile chacun. */
function clearedProfile(cleared: number): Profile {
  const levels: Profile['levels'] = {};
  for (let id = 1; id <= cleared; id += 1) levels[String(id)] = { stars: 1, bestScore: 100 };
  return { ...createProfile(), levels };
}

/** Le niveau d'un numéro, que les tests savent exister. */
function levelOf(id: number): NonNullable<ReturnType<typeof levelById>> {
  const level = levelById(id);
  if (!level) throw new Error(`Niveau inconnu : ${id}`);
  return level;
}

/**
 * Téléporte le personnage sous la ligne d'arrivée, lancé vers le haut, et joue
 * jusqu'à l'écran de victoire. Le faux rendu reçoit l'état vivant de la
 * simulation : c'est par lui qu'on y accède.
 */
function winByTeleport(game: Game, seen: Seen): void {
  game.frame(0.016);
  const state = seen.state;
  if (!state || state.finishY === null) throw new Error('Pas de niveau en cours');
  state.hero = { pos: { x: 0, y: state.finishY - 0.5 }, vel: { x: 0, y: 8 }, grounded: false };
  for (let frames = 0; frames < 20 && game.debugState().screen === 'playing'; frames += 1) game.frame(0.05);
}

/** Laisse passer le verrou d'entrée des écrans de fin. */
function settle(game: Game): void {
  for (let frames = 0; frames < 8; frames += 1) game.frame(0.1);
}

describe('niveaux : lancer une partie', () => {
  const BUTTON = { x: 195, y: 500 };

  /** Un faux rendu qui répond « ce bouton » sous le point ci-dessus, et rien ailleurs. */
  function tapping(seen: Seen, id: ButtonId): void {
    seen.hit = (x, y) => (x === BUTTON.x && y === BUTTON.y ? id : null);
  }

  it('un appui hors bouton sur le titre joue le niveau le plus avancé, avec la graine du niveau et non celle de l\'URL', () => {
    const fresh = makeGame('?graine=5');
    fresh.game.press();
    expect(fresh.game.debugState()).toMatchObject({ screen: 'playing', mode: 'level', levelId: 1, seed: levelOf(1).seed, attached: true });

    const advanced = makeGame('?graine=5', clearedProfile(2));
    advanced.game.press();
    expect(advanced.game.debugState()).toMatchObject({ mode: 'level', levelId: 3, seed: levelOf(3).seed });
  });

  it('un niveau ignore la brume de l\'URL pour la sienne, et garde les talismans équipés', () => {
    const { game, seen } = makeGame('?fogBaseSpeed=9', profileWith(0, ['treuil']));
    expect(game.playLevel(1)).toBe(true);
    game.frame(0.016);
    expect(seen.lastTuning?.fogBaseSpeed).toBe(levelOf(1).fogBaseSpeed);
    expect(seen.lastTuning?.reelSpeed).toBeCloseTo(DEFAULT_TUNING.reelSpeed * 1.15, 9);
  });

  it('playLevel() refuse un niveau verrouillé ou inconnu sans rien changer, et ne lance pas le grappin', () => {
    const { game } = makeGame('?graine=3');
    for (const id of [2, 10, 0, 11, 1.5]) expect(game.playLevel(id)).toBe(false);
    expect(game.debugState()).toMatchObject({ screen: 'title', step: 0, mode: 'free', seed: 3 });

    expect(game.playLevel(1)).toBe(true);
    expect(game.debugState()).toMatchObject({ screen: 'playing', mode: 'level', levelId: 1, attached: false });
  });

  it('expose la hauteur depuis le toit, l\'objectif, le niveau jouable, les étoiles et le départ de la course libre', () => {
    const { game } = makeGame('', clearedProfile(2));
    expect(game.debugState()).toMatchObject({ mode: 'free', levelId: null, goal: null, unlockedLevel: 3, stars: 0, freeRunStartY: levelOf(3).startY });

    game.playLevel(3);
    const state = game.debugState();
    expect(state).toMatchObject({ mode: 'level', levelId: 3, goal: 70 });
    expect(state.height).toBeCloseTo(130 + DEFAULT_TUNING.heroRadius, 9);
    expect(state.levelHeight).toBeCloseTo(DEFAULT_TUNING.heroRadius, 9);
    expect(state.fogY).toBeCloseTo(130 + DEFAULT_TUNING.fogStart, 9);
  });

  it('la course libre part de la zone la plus haute franchie, avec la graine annoncée par le titre', () => {
    const { game } = makeGame('?graine=9', clearedProfile(2));
    game.playFree();
    const state = game.debugState();
    expect(state).toMatchObject({ screen: 'playing', mode: 'free', levelId: null, goal: null, seed: 9, attached: false });
    expect(state.height).toBeCloseTo(freeRunStartY(clearedProfile(2)) + DEFAULT_TUNING.heroRadius, 9);
    expect(state.levelHeight).toBeCloseTo(DEFAULT_TUNING.heroRadius, 9);

    const fresh = makeGame();
    fresh.game.playFree();
    expect(fresh.game.debugState().height).toBeCloseTo(DEFAULT_TUNING.heroRadius, 9);
  });

  it('le bouton « Course libre » lance la course libre sans appui d\'accroche ; « Niveaux » ouvre la liste sans faire passer le temps', () => {
    const { game, seen } = makeGame('?graine=3');
    tapping(seen, 'levels');
    game.press(BUTTON.x, BUTTON.y);
    game.frame(1);
    expect(game.debugState()).toMatchObject({ screen: 'levels', step: 0 });
    expect(seen.screens.at(-1)).toBe('levels');

    game.restart();
    tapping(seen, 'free');
    game.press(BUTTON.x, BUTTON.y);
    expect(game.debugState()).toMatchObject({ screen: 'playing', mode: 'free', seed: 3, attached: false });
  });

  it('sur la liste, un niveau débloqué se lance, un niveau verrouillé ne réagit pas, « Retour » ramène au titre', () => {
    const { game, seen } = makeGame('?graine=3', clearedProfile(1));
    tapping(seen, 'levels');
    game.press(BUTTON.x, BUTTON.y);

    tapping(seen, 'niveau-3');
    game.press(BUTTON.x, BUTTON.y);
    expect(game.debugState().screen).toBe('levels');
    // Un appui ailleurs ou sans position ne fait rien non plus.
    game.press(10, 10);
    game.press();
    expect(game.debugState()).toMatchObject({ screen: 'levels', step: 0 });

    tapping(seen, 'back');
    game.press(BUTTON.x, BUTTON.y);
    expect(game.debugState()).toMatchObject({ screen: 'title', seed: 3 });

    tapping(seen, 'levels');
    game.press(BUTTON.x, BUTTON.y);
    tapping(seen, 'niveau-1');
    game.press(BUTTON.x, BUTTON.y);
    expect(game.debugState()).toMatchObject({ screen: 'playing', mode: 'level', levelId: 1, attached: false });

    game.restart();
    tapping(seen, 'levels');
    game.press(BUTTON.x, BUTTON.y);
    tapping(seen, 'niveau-2');
    game.press(BUTTON.x, BUTTON.y);
    expect(game.debugState()).toMatchObject({ screen: 'playing', levelId: 2, seed: levelOf(2).seed });
  });
});

describe('niveaux : annonce', () => {
  it('un niveau s\'annonce par son titre et sa phrase d\'intro, 3 s de temps réel, puis la bannière s\'efface', () => {
    const { game, seen } = makeGame('', clearedProfile(2));
    game.playLevel(3);
    game.frame(0.05);
    expect(seen.lastBanner).toBe('Niveau 3 · Les enseignes');
    expect(seen.lastBannerDetail).toBe(levelOf(3).intro);

    for (let frames = 0; frames < 28; frames += 1) game.frame(0.1);
    expect(seen.lastBanner).not.toBeNull();
    for (let frames = 0; frames < 3; frames += 1) game.frame(0.1);
    expect(seen.lastBanner).toBeNull();
  });

  it('un niveau ne montre aucune bannière de palier, la course libre de même départ en montre une', () => {
    // Au départ du niveau 3, la hauteur est déjà au palier 2 : l'événement de palier part dès le premier pas.
    const level = makeGame('', clearedProfile(2));
    level.game.playLevel(3);
    for (let frames = 0; frames < 20; frames += 1) level.game.frame(0.1);
    expect(level.game.debugState().tier).toBeGreaterThan(0);
    expect([...level.seen.banners]).toEqual(['Niveau 3 · Les enseignes']);

    const free = makeGame('', clearedProfile(2));
    free.game.playFree();
    free.game.frame(0.05);
    expect(free.game.debugState().tier).toBeGreaterThan(0);
    expect(free.seen.lastBanner).toMatch(/ · 100 m$/);
  });

  it('la course libre ne s\'annonce pas comme un niveau', () => {
    const { game, seen } = makeFreeGame();
    game.frame(0.05);
    expect(seen.lastBanner).toBeNull();
  });
});

describe('niveaux : victoire', () => {
  it('franchir la ligne d\'arrivée gagne : étoiles, déblocage du suivant, bilan et profil sauvegardé', () => {
    const { game, seen, storage } = makeGame('?graine=3');
    game.playLevel(1);
    expect(game.debugState().stars).toBe(0);
    winByTeleport(game, seen);

    const won = game.debugState();
    expect(won).toMatchObject({ screen: 'won', cause: null, runs: 1, unlockedLevel: 2, mode: 'level', levelId: 1 });
    expect(won.stars).toBeGreaterThanOrEqual(1);
    expect(seen.screens.at(-1)).toBe('won');

    const outcome = seen.lastOutcome as LevelOutcome;
    expect(outcome).toMatchObject({ won: true, firstClear: true, stars: won.stars, totalStars: won.stars });
    expect(outcome.level.id).toBe(1);
    expect(outcome.xpGained).toBeGreaterThanOrEqual(FIRST_CLEAR_XP + outcome.newStars * STAR_XP);
    expect(seen.lastResult).toMatchObject({ won: true, pickupsTotal: 0 });
    expect(seen.lastProfile).toBe(outcome.profile);

    const saved = loadProfile(storage);
    expect(saved).toEqual(game.currentProfile());
    expect(saved.levels['1']?.stars).toBe(won.stars);
    expect(unlockedLevel(saved)).toBe(2);
  });

  it('une victoire ne se compte qu\'une fois, et l\'écran de victoire fige le temps', () => {
    const { game, seen } = makeGame();
    game.playLevel(1);
    winByTeleport(game, seen);
    const step = game.debugState().step;
    for (let frames = 0; frames < 20; frames += 1) game.frame(0.05);
    expect(game.debugState()).toMatchObject({ step, runs: 1 });
  });

  it('le verrou de six dixièmes de seconde vaut aussi après une victoire', () => {
    const { game, seen } = makeGame();
    game.playLevel(1);
    winByTeleport(game, seen);
    game.press();
    expect(game.debugState().screen).toBe('won');
    settle(game);
    game.press();
    expect(game.debugState()).toMatchObject({ screen: 'playing', levelId: 1, attached: true });
  });

  it('« Niveau suivant » lance le niveau 2, « Rejouer » le même niveau, « Niveaux » la liste ; un appui ailleurs relance le même niveau en accrochant', () => {
    const { game, seen } = makeGame();
    const tap = (id: ButtonId | null): void => {
      seen.hit = () => id;
      game.press(100, 100);
    };
    const winFirst = (): void => {
      game.restart();
      game.playLevel(1);
      winByTeleport(game, seen);
      settle(game);
    };

    winFirst();
    tap('next');
    expect(game.debugState()).toMatchObject({ screen: 'playing', mode: 'level', levelId: 2, seed: levelOf(2).seed, attached: false, stars: 0 });
    expect(seen.lastOutcome).not.toBeNull();

    winFirst();
    tap('replay');
    expect(game.debugState()).toMatchObject({ screen: 'playing', levelId: 1, attached: false, step: 0 });

    winFirst();
    tap('levels');
    expect(game.debugState()).toMatchObject({ screen: 'levels', unlockedLevel: 2 });
    tap('back');
    expect(game.debugState()).toMatchObject({ screen: 'title', mode: 'free', step: 0 });

    winFirst();
    tap(null);
    expect(game.debugState()).toMatchObject({ screen: 'playing', levelId: 1, attached: true });
  });

  it('au dernier niveau, il n\'y a pas de niveau suivant : « Niveau suivant » ne fait rien', () => {
    const { game, seen } = makeGame('', clearedProfile(9));
    expect(game.playLevel(10)).toBe(true);
    winByTeleport(game, seen);
    settle(game);
    seen.hit = () => 'next';
    game.press(100, 100);
    expect(game.debugState()).toMatchObject({ screen: 'won', levelId: 10, unlockedLevel: 10 });
  });

  it('le pilote de test gagne le niveau 1 : les étoiles comptées sont celles de la partie', () => {
    const { game, seen, storage } = makeGame();
    game.playLevel(1);
    const play = makePilot(game);
    for (let frames = 0; frames < 90 * 60 && game.debugState().screen === 'playing'; frames += 1) play();
    expect(game.debugState()).toMatchObject({ screen: 'won', unlockedLevel: 2 });
    expect(game.debugState().levelHeight).toBeGreaterThanOrEqual(60);
    expect(seen.lastResult?.perfectStreak).toBeGreaterThan(0);
    expect(loadProfile(storage).levels['1']?.stars).toBe(game.debugState().stars);
  });
});

describe('niveaux : défaite', () => {
  it('la brume tue : écran de fin du niveau, aucune étoile, le niveau suivant reste verrouillé', () => {
    const { game, seen, storage } = makeGame();
    game.playLevel(1);
    game.press();
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);

    expect(game.debugState()).toMatchObject({ screen: 'dead', mode: 'level', levelId: 1, cause: 'fog', stars: 0, unlockedLevel: 1, runs: 1 });
    expect(seen.lastOutcome).toMatchObject({ won: false, stars: 0, firstClear: false });
    expect(seen.lastResult).toMatchObject({ won: false });
    expect(loadProfile(storage)).toEqual(game.currentProfile());
    expect(game.currentProfile().levels['1']?.stars).toBe(0);
  });

  it('un appui ailleurs rejoue le même niveau en accrochant ; « Niveaux » ouvre la liste ; « Talismans » et « Retour » reviennent à l\'écran de fin', () => {
    const { game, seen } = makeGame();
    game.playLevel(1);
    game.press();
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    const outcome = seen.lastOutcome;

    seen.hit = (_x, y) => (y === 1 ? 'talismans' : y === 2 ? 'back' : null);
    game.press(100, 1);
    expect(game.debugState().screen).toBe('talismans');
    game.press(100, 2);
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ screen: 'dead', levelId: 1 });
    expect(seen.lastOutcome).toBe(outcome);

    seen.hit = () => 'levels';
    game.press(100, 100);
    expect(game.debugState()).toMatchObject({ screen: 'levels', mode: 'free', step: 0 });

    game.playLevel(1);
    game.press();
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    seen.hit = () => null;
    game.press(100, 100);
    expect(game.debugState()).toMatchObject({ screen: 'playing', levelId: 1, seed: levelOf(1).seed, attached: true, step: 0 });
  });

  it('la course libre garde sa fin de partie : un appui rejoue une course libre, « Niveaux » ouvre la liste', () => {
    const { game, seen } = makeFreeGame('?graine=3&fogBaseSpeed=4');
    game.press();
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    expect(game.debugState()).toMatchObject({ screen: 'dead', mode: 'free', stars: 0 });

    seen.hit = () => 'levels';
    game.press(100, 100);
    expect(game.debugState().screen).toBe('levels');

    game.playFree();
    game.press();
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    seen.hit = () => null;
    game.press(100, 100);
    expect(game.debugState()).toMatchObject({ screen: 'playing', mode: 'free', seed: 3, attached: true });
  });
});

/**
 * Joue `seconds` de temps réel par images de 50 ms en gardant le personnage
 * suspendu en l'air, immobile : on regarde ici le décor et les annonces, pas
 * le vol, et un personnage qui tomberait finirait dans la brume ou sur un obstacle.
 */
function hover(game: Game, seen: Seen, seconds: number): void {
  for (let frames = 0; frames < Math.round(seconds / 0.05); frames += 1) {
    const state = seen.state;
    if (!state) throw new Error('Pas de partie en cours');
    state.hero.vel = { x: 0, y: 0 };
    state.rope = null;
    game.frame(0.05);
  }
}

/** Téléporte le personnage à `meters` mètres au-dessus du toit de départ et le garde suspendu 0,1 s : de quoi franchir les seuils des événements. */
function climbTo(game: Game, seen: Seen, meters: number): void {
  game.frame(0.016);
  const state = seen.state;
  if (!state) throw new Error('Pas de partie en cours');
  state.hero = { pos: { x: 0, y: state.groundY + meters }, vel: { x: 0, y: 0 }, grounded: false };
  hover(game, seen, 0.1);
}

describe('niveaux : événements', () => {
  /** Niveau `id` en cours, avec tous les niveaux d'avant franchis. */
  function inLevel(id: number): ReturnType<typeof makeGame> {
    const made = makeGame('', clearedProfile(id - 1));
    made.game.playLevel(id);
    return made;
  }

  it('annonce la bascule au départ, deux lignes, 2,5 s de temps réel, puis la bannière s\'efface', () => {
    const { game, seen } = inLevel(5);
    game.frame(0.05);
    expect(game.debugState().events).toEqual([{ kind: 'bascule', started: false, ended: false }]);

    climbTo(game, seen, 26);
    expect(seen.lastBanner).toBe('La bascule !');
    expect(seen.lastBannerDetail).toBe('Le niveau tourne');
    expect(game.debugState().events).toEqual([{ kind: 'bascule', started: true, ended: false }]);

    hover(game, seen, 2.2);
    expect(seen.lastBanner).toBe('La bascule !');
    hover(game, seen, 0.5);
    expect(seen.lastBanner).toBeNull();
  });

  it('pendant la bascule la gravité tourne, la caméra tourne avec elle et dézoome à 0,7 au plus', () => {
    const { game, seen } = inLevel(5);
    climbTo(game, seen, 26);
    expect(game.debugState()).toMatchObject({ gravityY: expect.closeTo(-1, 1) as unknown as number });
    expect(seen.camera!.angle).toBeLessThan(0.3);

    hover(game, seen, 1);
    const half = game.debugState();
    expect(half.gravityX).toBeGreaterThan(0.5);
    expect(half.gravityX).toBeLessThan(0.95);
    expect(seen.camera!.angle).toBeGreaterThan(0.4);
    expect(seen.camera!.angle).toBeLessThan(1.4);

    hover(game, seen, 1.5);
    const turned = game.debugState();
    expect(turned.screen).toBe('playing');
    expect(turned.gravityX).toBeCloseTo(1, 6);
    expect(turned.gravityY).toBeCloseTo(0, 6);
    expect(seen.camera!.angle).toBeCloseTo(Math.PI / 2, 6);
    expect(seen.camera!.zoom).toBeLessThan(0.701);
  });

  it('une bascule vers la gauche tourne le monde dans l\'autre sens', () => {
    const { game, seen } = inLevel(8);
    climbTo(game, seen, 21);
    hover(game, seen, 2.5);
    expect(game.debugState().gravityX).toBeCloseTo(-1, 6);
    expect(seen.camera!.angle).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('à la fin de la bascule : « Retour au calme », et le monde se redresse', () => {
    const { game, seen } = inLevel(5);
    climbTo(game, seen, 26);
    hover(game, seen, 3);
    climbTo(game, seen, 56);
    expect(seen.lastBanner).toBe('Retour au calme');
    expect(seen.lastBannerDetail).toBeNull();
    expect(game.debugState().events).toEqual([{ kind: 'bascule', started: true, ended: true }]);
    hover(game, seen, 2.5);
    expect(game.debugState().gravityY).toBeCloseTo(-1, 6);
    expect(seen.camera!.angle).toBeCloseTo(0, 6);
    // Le personnage suspendu garde une vitesse de quelques dixièmes de m/s : le zoom revient près de 1, sans y arriver tout à fait.
    expect(seen.camera!.zoom).toBeGreaterThan(0.95);
  });

  it('les textes flottants naissent là où le personnage est affiché, monde tourné', () => {
    const { game, seen } = inLevel(5);
    climbTo(game, seen, 26);
    hover(game, seen, 2.5);
    const state = seen.state!;
    state.hero.vel = { x: 0, y: 0 };
    state.pickups.push({ id: 9999, pos: { ...state.hero.pos }, taken: false });
    game.frame(0.016);
    expect(seen.lastTexts).toContain('+10');
    const shown = seen.camera!.worldToDisplay(state.hero.pos);
    const text = seen.lastTextAt[seen.lastTexts.indexOf('+10')]!;
    expect(text.x).toBeCloseTo(shown.x, 6);
    // Monde tourné, le personnage est à gauche du centre de l'écran, de l'avance de la caméra, et non au-dessous du centre.
    expect(Math.abs(shown.x - (195 - 2.5 * seen.camera!.scale))).toBeLessThan(10);
    expect(Math.abs(shown.y - 422)).toBeLessThan(40);
    expect(Math.abs(text.y - seen.camera!.worldToScreen(state.hero.pos).y)).toBeGreaterThan(50);
  });

  it('annonce le vent avec son côté, lu dans le calendrier du niveau, et le fait souffler', () => {
    const left = inLevel(6);
    climbTo(left.game, left.seen, 21);
    expect(left.seen.lastBanner).toBe('Coup de vent !');
    expect(left.seen.lastBannerDetail).toBe('Il pousse vers la gauche');
    hover(left.game, left.seen, 1.5);
    expect(left.game.debugState().windX).toBeCloseTo(-3, 6);

    const right = inLevel(9);
    climbTo(right.game, right.seen, 11);
    expect(right.seen.lastBanner).toBe('Coup de vent !');
    expect(right.seen.lastBannerDetail).toBe('Il pousse vers la droite');
    hover(right.game, right.seen, 1.5);
    expect(right.game.debugState().windX).toBeCloseTo(3.5, 6);
  });

  it('les traînées du vent filent dans son sens ; sans vent, elles ne bougent pas', () => {
    const { game, seen } = inLevel(6);
    game.frame(0.05);
    const still = [...seen.lastStreaksX];
    game.frame(0.05);
    expect(seen.lastStreaksX).toEqual(still);

    climbTo(game, seen, 21);
    hover(game, seen, 1);
    const before = [...seen.lastStreaksX];
    game.frame(0.05);
    // Vent vers la gauche : aucune traînée ne va vers la droite, sauf celle qui renaît à droite.
    const moved = seen.lastStreaksX.map((x, i) => x - before[i]!);
    expect(moved.filter((dx) => dx < 0).length).toBeGreaterThan(10);
    expect(moved.filter((dx) => dx > 0.5).length).toBeLessThan(3);

    climbTo(game, seen, 51);
    expect(seen.lastBanner).toBe('Retour au calme');
    expect(game.debugState().windX).toBe(0);
    const calm = [...seen.lastStreaksX];
    game.frame(0.05);
    expect(seen.lastStreaksX).toEqual(calm);
  });

  it('annonce la panne, éteint les lampadaires pendant elle, et ne dit rien à sa fin', () => {
    const { game, seen } = inLevel(4);
    game.frame(0.05);
    expect(game.debugState().lightsOff).toBe(false);
    climbTo(game, seen, 26);
    expect(seen.lastBanner).toBe('Panne de lampadaires');
    expect(seen.lastBannerDetail).toBe('Vise de mémoire');
    expect(game.debugState().lightsOff).toBe(true);

    hover(game, seen, 2.6);
    expect(seen.lastBanner).toBeNull();
    climbTo(game, seen, 56);
    expect(game.debugState().lightsOff).toBe(false);
    expect(seen.lastBanner).toBeNull();
  });

  it('annonce la pluie d\'étoiles, qui fait tomber des étoiles, et ne dit rien à sa fin', () => {
    const { game, seen } = inLevel(3);
    const before = seen.state === null ? 0 : seen.state.pickups.length;
    climbTo(game, seen, 21);
    expect(seen.lastBanner).toBe('Pluie d\'étoiles');
    expect(seen.lastBannerDetail).toBe('Cueille-les au vol');
    hover(game, seen, 1.5);
    expect(seen.state!.pickups.some((pickup) => pickup.vel !== undefined)).toBe(true);
    expect(seen.state!.pickups.length).toBeGreaterThan(before);

    hover(game, seen, 2.6);
    climbTo(game, seen, 51);
    expect(seen.lastBanner).toBeNull();
  });

  it('annonce l\'alerte, qui double la vitesse de la brume, puis le retour au calme', () => {
    const { game, seen } = inLevel(7);
    expect(game.debugState().fogFactor).toBe(1);
    climbTo(game, seen, 16);
    expect(seen.lastBanner).toBe('Alerte !');
    expect(seen.lastBannerDetail).toBe('La brume accélère');
    expect(game.debugState().fogFactor).toBe(2);

    hover(game, seen, 2.6);
    climbTo(game, seen, 41);
    expect(seen.lastBanner).toBe('Retour au calme');
    expect(game.debugState().fogFactor).toBe(1);
  });

  it('annonce les câbles', () => {
    const { game, seen } = inLevel(7);
    climbTo(game, seen, 46);
    expect(game.debugState().events.map((event) => event.kind)).toEqual(['alerte', 'cable']);
    expect(seen.lastBanner).toBe('Câbles');
    expect(seen.lastBannerDetail).toBe('Les accroches glissent');
  });

  it('chaque niveau expose son calendrier d\'événements, la course libre aucun', () => {
    const { game } = inLevel(10);
    expect(game.debugState().events).toEqual([
      { kind: 'bascule', started: false, ended: false },
      { kind: 'alerte', started: false, ended: false },
      { kind: 'panne', started: false, ended: false },
    ]);
    expect(game.debugState()).toMatchObject({ gravityX: 0, gravityY: -1, windX: 0, lightsOff: false, fogFactor: 1 });

    const free = makeFreeGame();
    free.game.frame(0.05);
    expect(free.game.debugState().events).toEqual([]);
  });

  it('une partie neuve repart d\'un monde droit, sans bannière d\'événement', () => {
    const { game, seen } = inLevel(5);
    climbTo(game, seen, 26);
    hover(game, seen, 2.5);
    expect(seen.camera!.angle).toBeGreaterThan(1);
    game.playLevel(5);
    game.frame(0.05);
    expect(seen.camera!.angle).toBe(0);
    expect(seen.lastBanner).toBe('Niveau 5 · Les antennes');
  });
});

describe('ouvrir tous les niveaux', () => {
  it('donne une étoile à chaque niveau, sauvegarde, et garde les étoiles et records déjà gagnés', () => {
    const saved: Profile = { ...createProfile(), levels: { '1': { stars: 3, bestScore: 777 } } };
    const { game, storage } = makeGame('', saved);
    expect(game.debugState().unlockedLevel).toBe(2);
    expect(game.playLevel(10)).toBe(false);

    game.unlockAll();
    expect(game.debugState()).toMatchObject({ unlockedLevel: 10, screen: 'title' });
    const { levels } = game.currentProfile();
    expect(Object.keys(levels).sort((a, b) => Number(a) - Number(b))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(levels['1']).toEqual({ stars: 3, bestScore: 777 });
    for (let id = 2; id <= 10; id += 1) expect(levels[String(id)]).toEqual({ stars: 1, bestScore: 0 });
    expect(loadProfile(storage)).toEqual(game.currentProfile());
    expect(game.playLevel(10)).toBe(true);
  });

  it('relève aussi un niveau perdu, enregistré avec zéro étoile', () => {
    const saved: Profile = { ...createProfile(), levels: { '2': { stars: 0, bestScore: 40 } } };
    const { game } = makeGame('', saved);
    game.unlockAll();
    expect(game.currentProfile().levels['2']).toEqual({ stars: 1, bestScore: 40 });
  });
});

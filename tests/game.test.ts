import type { InstallState, Installer } from '../src/app/install';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PULSE_BPM, Game, PALETTE_FADE_SECONDS, readSettings, visibleExtent } from '../src/app/game';
import { Music, type AudioPlayer } from '../src/audio/music';
import { BEAT_DECAY, SILENT_PULSE, pulseAt, syntheticRhythm, type Pulse } from '../src/audio/rhythm';
import { fixedRhythms, type RhythmSource } from '../src/audio/rhythms';
import { ESCAPE_PITCH, type Cue, type SoundPlayer } from '../src/audio/sfx';
import { loadProfile as loadSavedProfile } from '../src/meta/profile';
import { LEVELS, levelById } from '../src/data/levels';
import { createProfile, loadProfile, memoryStorage, saveProfile, type LevelOutcome, type Profile, type ProfileStorage, type RunOutcome } from '../src/meta/profile';
import type { TalismanId } from '../src/meta/talismans';
import { FIRST_CLEAR_XP, STAR_XP, freeRunStartY, unlockedLevel, type LevelResult } from '../src/meta/traversee';
import type { ButtonId } from '../src/render/buttons';
import { ESCAPE_ANNOUNCEMENT } from '../src/render/labels';
import type { Camera } from '../src/render/camera';
import { PALETTES, mixPalette, type Palette } from '../src/render/palette';
import type { DeathCause, GameFrame, GameScreen } from '../src/render/renderer';
import { PULL_MAX } from '../src/sim/launcher';
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
  /** Page de la liste des niveaux telle que la dernière image l'a reçue. */
  lastLevelsPage: number;
  /** L'ambiance que la dernière image a reçue. */
  lastPalette: Palette | null;
  lastPulse: Pulse | null;
  lastInstall: InstallState;
}

/** Profil d'un joueur déjà avancé : de l'expérience et des talismans équipés. */
function profileWith(xp: number, equipped: TalismanId[] = []): Profile {
  return { ...createProfile(), xp, equipped };
}

/** Jeu relié à un faux rendu qui note ce qu'on lui demande de dessiner, et à un stockage mémoire, vide ou garni d'un profil. */
function makeGame(search = '', saved?: Profile, music?: Music, rhythms?: RhythmSource, sfx?: SoundPlayer, installer?: Installer): { game: Game; seen: Seen; storage: ProfileStorage } {
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
    lastLevelsPage: 0,
    lastPalette: null,
    lastPulse: null,
    lastInstall: null,
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
      seen.lastLevelsPage = frame.levelsPage;
      seen.lastPalette = frame.palette;
      seen.lastPulse = frame.pulse;
      seen.lastInstall = frame.install;
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
  return { game: new Game(view, readSettings(search), storage, music, rhythms, sfx, installer), seen, storage };
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
    expect(readSettings('?pouls=90').pulseBpm).toBe(90);
    expect(readSettings('?pouls').pulseBpm).toBe(DEFAULT_PULSE_BPM);
    expect(readSettings('?pouls=abc').pulseBpm).toBeNull();
    expect(readSettings('?pouls=-5').pulseBpm).toBeNull();
    expect(readSettings('').pulseBpm).toBeNull();
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
        'bpm',
        'cause',
        'combo',
        'equipped',
        'events',
        'fogFactor',
        'fogY',
        'freeRunStartY',
        'freeStart', 'install', 'atelier', 'atelierChoice',
        'goal',
        'gravityX',
        'gravityY',
        'heldKind',
        'height',
        'level',
        'levelHeight',
        'levelId',
        'lightsOff',
        'missions',
        'mode',
        'obstacles',
        'palette',
        'pickups',
        'pos',
        'pullX',
        'pullY',
        'pulse',
        'releaseWindow',
        'switchOpen',
        'closing',
        'triggered',
        'rings',
        'ropeLength',
        'runs',
        'scene',
        'score',
        'screen',
        'seed',
        'sfxOn',
        'smashed',
        'stars',
        'step',
        'targetId',
        'tier',
        'testMode',
        'tip',
        'musicOn',
        'track',
        'unlockedLevel',
        'vel',
        'windX',
        'xp',
        'xpGained',
        'zone',
        'zones',
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

  it('un obstacle ne tue pas : on rebondit avec « Boum », et seule la brume finit la partie', () => {
    // Une dalle solide posée sur le chemin, et le personnage lâché dessus de haut : un vrai choc (depuis 0.12.1, se poser
    // doucement sur une corniche n'en est plus un, B-012), qui ne tue pas.
    const { game, seen } = makeFreeGame('?graine=1');
    game.playFree();
    const { state } = (game as unknown as { run: { sim: { state: SimState } } }).run.sim;
    state.obstacles.push({ id: 9999, x0: -2, y0: 6, x1: 2, y1: 6.4 });
    state.hero = { pos: { x: 0, y: 9 }, vel: { x: 0, y: -6 }, grounded: false };
    state.rope = null;
    for (let frames = 0; frames < 120 && !seen.texts.has('Boum'); frames += 1) game.frame(1 / 60);
    expect(seen.texts.has('Boum')).toBe(true);
    expect(game.debugState()).toMatchObject({ screen: 'playing', cause: null });
  });

  it('une nouvelle partie efface le palier, la cause et les effets en cours', () => {
    const { game, seen } = makeFreeGame('?graine=3&tierHeight=4');
    const play = makePilot(game);
    // Joue jusqu'à la première bannière de palier (« nom · hauteur ») : des effets sont alors en cours. Un conseil du tutoriel peut passer avant.
    for (let frames = 0; frames < 600 && !(seen.lastBanner ?? '').includes(' · '); frames += 1) play();
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
    expect(seen.banners.has('La chaîne · 4 m')).toBe(true);
    expect(seen.banners.has('Les lueurs · 8 m')).toBe(true);
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
    // Un profil aguerri (30 m atteints) : pas d'adoucissement d'apprentissage sur la brume.
    const { game, seen } = makeGame('?fogBaseSpeed=9', { ...profileWith(0, ['treuil']), bestHeight: 80 });
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
    expect(state).toMatchObject({ mode: 'level', levelId: 3, goal: levelOf(3).endY - levelOf(3).startY });
    expect(state.height).toBeCloseTo(levelOf(3).startY + DEFAULT_TUNING.heroRadius, 9);
    expect(state.levelHeight).toBeCloseTo(DEFAULT_TUNING.heroRadius, 9);
    expect(state.fogY).toBeCloseTo(levelOf(3).startY + DEFAULT_TUNING.fogStart, 9);
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
    expect(seen.lastBanner).toBe('Niveau 3 · Les lueurs');
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
    expect([...level.seen.banners]).toEqual(['Niveau 3 · Les lueurs']);

    const free = makeGame('', clearedProfile(2));
    free.game.playFree();
    free.game.frame(0.05);
    expect(free.game.debugState().tier).toBeGreaterThan(0);
    // La course libre part du départ du niveau 3, sur une frontière de palier : la bannière du palier dit cette hauteur.
    expect(free.seen.lastBanner).toMatch(new RegExp(` · ${levelOf(3).startY} m$`));
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
    expect(seen.lastResult).toMatchObject({ won: true, pickupsTotal: seen.state?.course.pickupsTotal ?? 0 });
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
    const last = LEVELS.length;
    const { game, seen } = makeGame('', clearedProfile(last - 1));
    expect(game.playLevel(last)).toBe(true);
    winByTeleport(game, seen);
    settle(game);
    seen.hit = () => 'next';
    game.press(100, 100);
    expect(game.debugState()).toMatchObject({ screen: 'won', levelId: last, unlockedLevel: last });
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
    expect(game.debugState().events[0]).toEqual({ kind: 'bascule', started: false, ended: false });

    climbTo(game, seen, 26);
    expect(seen.lastBanner).toBe('La bascule !');
    expect(seen.lastBannerDetail).toBe('Le niveau tourne');
    expect(game.debugState().events[0]).toEqual({ kind: 'bascule', started: true, ended: false });

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
    expect(game.debugState().events[0]).toEqual({ kind: 'bascule', started: true, ended: true });
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
    expect(seen.lastBanner).toBe('Panne de lumière');
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
    expect(game.debugState().events.map((event) => event.kind).slice(0, 2)).toEqual(['alerte', 'cable']);
    expect(seen.lastBanner).toBe('Câbles');
    expect(seen.lastBannerDetail).toBe('Les accroches glissent');
  });

  it('chaque niveau expose son calendrier d\'événements, la course libre aucun', () => {
    const { game } = inLevel(10);
    expect(game.debugState().events).toEqual(levelOf(10).events.map((event) => ({ kind: event.kind, started: false, ended: false })));
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
    expect(seen.lastBanner).toBe('Niveau 5 · Les flèches');
  });
});

describe('ouvrir tous les niveaux', () => {
  it('donne une étoile à chaque niveau, sauvegarde, et garde les étoiles et records déjà gagnés', () => {
    const saved: Profile = { ...createProfile(), levels: { '1': { stars: 3, bestScore: 777 } } };
    const { game, storage } = makeGame('', saved);
    expect(game.debugState().unlockedLevel).toBe(2);
    expect(game.playLevel(10)).toBe(false);

    game.unlockAll();
    expect(game.debugState()).toMatchObject({ unlockedLevel: LEVELS.length, screen: 'title' });
    const { levels } = game.currentProfile();
    expect(Object.keys(levels).sort((a, b) => Number(a) - Number(b))).toEqual(LEVELS.map((level) => String(level.id)));
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

/** Le niveau 14, en mode test : son premier point est un lanceur à 4 m du toit, accroché dès l'appui. */
function launcherGame(): ReturnType<typeof makeGame> {
  const made = makeGame('?test=1');
  expect(made.game.playLevel(14)).toBe(true);
  made.game.frame(0.001);
  // Le personnage est posé juste sous le premier lanceur du niveau, où que le générateur l'ait mis : c'est lui que l'appui
  // accroche. Le parcours se génère devant le personnage : on le monte par bonds jusqu'à ce qu'un lanceur apparaisse.
  const state = made.seen.state!;
  for (let bound = 0; bound < 24; bound += 1) {
    const launcher = state.anchors.filter((anchor) => anchor.kind === 'lanceur').sort((a, b) => a.pos.y - b.pos.y)[0];
    if (launcher) {
      // Tout près du lanceur : le tirage jusqu'à lui est fini dès les premiers pas, comme pour une vraie accroche.
      state.fogY = launcher.pos.y - 40;
      // Le personnage est tenu sous le lanceur, la caméra posée d'un coup sur lui (comme au départ d'une partie) : plus aucun
      // glissement de zoom, et la visée se fixe sur le lanceur, le plus proche.
      for (let i = 0; i < 6; i += 1) {
        state.hero = { pos: { x: launcher.pos.x, y: launcher.pos.y - 0.6 }, vel: { x: 0, y: 0 }, grounded: false };
        state.fogY = launcher.pos.y - 40;
        made.seen.camera!.snap(state.hero.pos, state.hero.vel, state.env, visibleExtent(state));
        made.game.frame(1 / 60);
      }
      return made;
    }
    state.hero = { pos: { x: 0, y: state.hero.pos.y + 10 }, vel: { x: 0, y: 0 }, grounded: false };
    state.fogY = state.hero.pos.y - 40;
    made.game.frame(0.05);
  }
  throw new Error('Pas de lanceur dans le niveau 14');
}

/** Pose le doigt en (100, 300) : accroche le lanceur. */
const FINGER = { x: 100, y: 300 };
function grabLauncher(made: ReturnType<typeof makeGame>): void {
  made.game.press(FINGER.x, FINGER.y);
  expect(made.game.debugState()).toMatchObject({ attached: true, heldKind: 'lanceur', pullX: 0, pullY: 0 });
}

describe('lanceur : le doigt tire', () => {
  it('le doigt qui descend tire le personnage vers le bas du monde : mètres de monde, y inversé, à l\'échelle de la caméra', () => {
    const made = launcherGame();
    const { game, seen } = made;
    grabLauncher(made);
    const scale = seen.camera!.scale;
    game.move(FINGER.x + 1 * scale, FINGER.y + 2 * scale);
    game.frame(0.001);
    const state = game.debugState();
    expect(state.pullX).toBeCloseTo(1, 9);
    expect(state.pullY).toBeCloseTo(-2, 9);
    // Une fois les pas passés, le personnage est affiché reculé de la traction, sous le lanceur. La traction se relit dans
    // l'état : le zoom de la caméra glisse d'un millionième entre deux images, et la traction avec lui.
    game.frame(0.05);
    const held = game.debugState();
    const launcher = seen.state!.anchors.find((anchor) => anchor.kind === 'lanceur')!;
    expect(held.pullX).toBeCloseTo(1, 4);
    expect(held.pullY).toBeCloseTo(-2, 4);
    expect(seen.state!.hero.pos.x).toBeCloseTo(launcher.pos.x + held.pullX, 9);
    expect(seen.state!.hero.pos.y).toBeCloseTo(launcher.pos.y + held.pullY, 9);
  });

  it('un doigt qui monte pousse le personnage au-dessus du lanceur, un doigt à gauche à gauche', () => {
    const made = launcherGame();
    const { game, seen } = made;
    grabLauncher(made);
    const scale = seen.camera!.scale;
    game.move(FINGER.x - 0.5 * scale, FINGER.y - 1 * scale);
    game.frame(0.001);
    expect(game.debugState().pullX).toBeCloseTo(-0.5, 9);
    expect(game.debugState().pullY).toBeCloseTo(1, 9);
  });

  it('la traction est plafonnée à 2,5 m, et un doigt qui revient à l\'appui détend tout', () => {
    const made = launcherGame();
    const { game } = made;
    grabLauncher(made);
    game.move(FINGER.x + 900, FINGER.y);
    game.frame(0.001);
    expect(game.debugState().pullX).toBeCloseTo(PULL_MAX, 9);
    expect(game.debugState().pullY).toBeCloseTo(0, 9);
    game.move(FINGER.x, FINGER.y);
    game.frame(0.001);
    expect(game.debugState()).toMatchObject({ pullX: 0, pullY: 0 });
  });

  it('relâcher lance à l\'opposé de la traction, avec la même traction que l\'image, et le journal la garde', () => {
    const made = launcherGame();
    const { game, seen } = made;
    grabLauncher(made);
    const scale = seen.camera!.scale;
    game.move(FINGER.x + 1 * scale, FINGER.y + 2 * scale);
    game.frame(0.05);
    // La traction de l'image, telle que l'état la lit (le zoom glisse d'un millionième entre deux images).
    const held = game.debugState();
    expect(held.pullX).toBeCloseTo(1, 4);
    expect(held.pullY).toBeCloseTo(-2, 4);
    game.release();
    const state = game.debugState();
    expect(state.attached).toBe(false);
    expect(state.heldKind).toBeNull();
    expect(state.pullX).toBe(0);
    // À l'opposé de la traction : vers la gauche et vers le haut, à la vitesse de sa longueur (2,24 m).
    const len = Math.hypot(held.pullX, held.pullY);
    const speed = 6 + 9 * (len / PULL_MAX);
    expect(state.vel.x).toBeCloseTo((-held.pullX / len) * speed, 6);
    expect(state.vel.y).toBeCloseTo((-held.pullY / len) * speed, 6);
    const last = seen.state!.inputs.at(-1)!;
    expect(last.kind).toBe('release');
    expect(last.pull!.x).toBeCloseTo(held.pullX, 9);
    expect(last.pull!.y).toBeCloseTo(held.pullY, 9);
  });

  it('relâcher sans glisser lance tout droit vers le haut, doucement', () => {
    const made = launcherGame();
    const { game } = made;
    grabLauncher(made);
    game.frame(0.05);
    game.release();
    const { vel } = game.debugState();
    expect(vel.x).toBe(0);
    expect(vel.y).toBeCloseTo(6, 9);
  });

  it('release(pull) donne la traction en mètres de monde, sans doigt', () => {
    const made = launcherGame();
    const { game, seen } = made;
    made.game.press();
    expect(game.debugState().heldKind).toBe('lanceur');
    game.frame(0.05);
    game.release({ x: 0, y: -2.5 });
    expect(game.debugState().vel.y).toBeCloseTo(15, 9);
    expect(seen.state!.inputs.at(-1)).toMatchObject({ kind: 'release', pull: { x: 0, y: -2.5 } });
  });

  it('sans position de doigt, relâcher reprend la dernière visée', () => {
    const made = launcherGame();
    const { game, seen } = made;
    made.game.press();
    seen.state!.pull = { x: 0, y: -1 };
    game.release();
    expect(game.debugState().vel.y).toBeCloseTo(6 + 9 * (1 / PULL_MAX), 9);
  });

  it('monde basculé, tirer vers le bas de l\'écran tire dans le sens de la gravité du monde', () => {
    const made = launcherGame();
    const { game, seen } = made;
    grabLauncher(made);
    seen.state!.env = { gravityDir: { x: 1, y: 0 }, wind: { x: 0, y: 0 } };
    // Une image sans pas de simulation : la caméra prend l'angle de la gravité.
    game.frame(0.001);
    expect(seen.camera!.angle).toBeCloseTo(Math.PI / 2, 9);
    const scale = seen.camera!.scale;
    game.move(FINGER.x, FINGER.y + 1.5 * scale);
    game.frame(0.001);
    expect(game.debugState().pullX).toBeCloseTo(1.5, 9);
    expect(game.debugState().pullY).toBeCloseTo(0, 9);
  });

  it('hors lanceur, rien ne change : le doigt qui glisse ne tire rien et le journal n\'a pas de traction', () => {
    const { game, seen } = makeGame('?graine=3');
    game.press(FINGER.x, FINGER.y);
    expect(game.debugState()).toMatchObject({ attached: true, heldKind: 'normal' });
    game.move(FINGER.x + 80, FINGER.y + 120);
    game.frame(0.05);
    expect(game.debugState()).toMatchObject({ pullX: 0, pullY: 0 });
    game.release({ x: 1, y: -1 });
    expect(game.debugState().heldKind).toBeNull();
    const last = seen.state!.inputs.at(-1)!;
    expect(last).toEqual({ step: last.step, kind: 'release' });
    expect(seen.state!.pull).toEqual({ x: 0, y: 0 });
  });

  it('un mouvement sans doigt posé, ou après le relâché, n\'a aucun effet', () => {
    const made = launcherGame();
    const { game } = made;
    game.move(500, 500);
    grabLauncher(made);
    game.frame(0.05);
    game.release();
    game.move(400, 400);
    game.frame(0.05);
    expect(game.debugState()).toMatchObject({ pullX: 0, pullY: 0 });
  });

  it('un appui sur l\'écran titre qui accroche un lanceur mesure la traction depuis cet appui', () => {
    // Le niveau 14 débloqué : l'appui du titre joue le niveau le plus avancé, premier point : le lanceur.
    const { game, seen } = makeGame('', clearedProfile(13));
    expect(game.debugState().unlockedLevel).toBe(14);
    game.press(FINGER.x, FINGER.y);
    expect(game.debugState()).toMatchObject({ screen: 'playing', levelId: 14, heldKind: 'lanceur' });
    const scale = seen.camera?.scale ?? 39;
    game.move(FINGER.x, FINGER.y + 1 * scale);
    game.frame(0.001);
    expect(game.debugState().pullY).toBeCloseTo(-1, 6);
  });
});

describe('lanceur : un pilote franchit un mur à trou', () => {
  /**
   * Un pilote qui sait lancer : sur un lanceur, il vise le point normal le plus
   * proche au-dessus et tire à l'opposé, aux sept dixièmes de la force ; dans la
   * seconde et demie qui suit, il n'attrape que ce qui est au-dessus de lui et
   * à moins de quatre mètres, c'est-à-dire une fois le mur passé. Le reste est le
   * pilote ordinaire. Renvoie une fonction qui joue une image de 1/60 s.
   */
  function launcherPilot(game: Game): { frame: () => void; launches: () => number } {
    const dt = 1 / 60;
    let time = 0;
    let holdSince = 0;
    let launchedAt = -Infinity;
    let launches = 0;
    const frame = (): void => {
      game.frame(dt);
      time += dt;
      const s = game.debugState();
      if (s.screen !== 'playing') return;
      if (!s.attached && s.targetId !== null) {
        const target = time - launchedAt < 1.5 ? game.anchors().find((anchor) => anchor.id === s.targetId) : undefined;
        if (target && (Math.hypot(target.x - s.pos.x, target.y - s.pos.y) > 4 || target.y < s.pos.y)) return;
        game.press();
        holdSince = time;
      } else if (s.heldKind === 'lanceur') {
        if (time - holdSince > 0.15 && aimAtNextAnchor(game)) {
          launchedAt = time;
          launches += 1;
        }
      } else if (s.attached && time - holdSince > 0.08) {
        const speed = Math.hypot(s.vel.x, s.vel.y);
        const ready = speed >= 8 || (s.ropeLength !== null && s.ropeLength <= 1.5 + 1e-9);
        const ax = Math.abs(s.vel.x);
        const slope = ax > 0 ? s.vel.y / ax : Infinity;
        if ((ready && s.vel.y > 1 && slope > 0.6 && slope < 1.8) || time - holdSince > 2.5) game.release();
      }
    };
    return { frame, launches: () => launches };
  }

  it('vise le point au-dessus en tirant à l\'opposé, passe le trou du mur et reprend la chaîne', () => {
    const { game, seen } = makeGame('?test=1');
    expect(game.playLevel(14)).toBe(true);
    // Le mur du niveau 14 est à 9,8 m au-dessus du toit de départ, son trou décalé du lanceur : tout droit, le lancer le heurterait.
    const pilot = launcherPilot(game);
    for (let frames = 0; frames < 60 * 20 && game.debugState().screen === 'playing' && game.debugState().levelHeight < 16; frames += 1) pilot.frame();
    expect(pilot.launches()).toBe(1);
    expect(game.debugState().screen).toBe('playing');
    expect(game.debugState().levelHeight).toBeGreaterThanOrEqual(16);
    // Le journal garde la traction du lancer : tirée vers le bas, et un peu à gauche pour passer à droite.
    const release = seen.state!.inputs.find((input) => input.kind === 'release' && input.pull);
    expect(release!.pull!.y).toBeLessThan(0);
    // Le trou est décalé : le tir qui passe n'est jamais vertical.
    expect(Math.abs(release!.pull!.x)).toBeGreaterThan(0.1);
  });

  it('tout droit, le même lancer heurte le mur et rebondit : la visée compte', () => {
    const { game, seen } = makeGame('?test=1');
    game.playLevel(14);
    game.frame(0.001);
    game.press();
    game.frame(0.05);
    game.release({ x: 0, y: -1.8 });
    for (let frames = 0; frames < 120 && !seen.texts.has('Boum'); frames += 1) game.frame(1 / 60);
    expect(seen.texts.has('Boum')).toBe(true);
    expect(game.debugState().screen).toBe('playing');
  });
});

/** Relâche le lanceur tenu en visant le point normal le plus proche au-dessus, aux sept dixièmes de la force. Faux sans lanceur tenu. */
function aimAtNextAnchor(game: Game): boolean {
  const s = game.debugState();
  if (s.heldKind !== 'lanceur') return false;
  let best: { x: number; y: number; d: number } | null = null;
  for (const anchor of game.anchors()) {
    if (anchor.kind !== 'normal' || anchor.y < s.pos.y + 1) continue;
    const d = Math.hypot(anchor.x - s.pos.x, anchor.y - s.pos.y);
    if (!best || d < best.d) best = { x: anchor.x - s.pos.x, y: anchor.y - s.pos.y, d };
  }
  const dir = best ?? { x: 0, y: 1, d: 1 };
  // La traction que le vérificateur a prouvée (le trou est décalé : viser au jugé ne suffit plus) ; au jugé sinon.
  game.release(game.launchAim() ?? { x: (-dir.x / dir.d) * PULL_MAX * 0.7, y: (-dir.y / dir.d) * PULL_MAX * 0.7 });
  return true;
}

describe('liste des niveaux : deux pages de dix', () => {
  const BUTTON = { x: 195, y: 500 };

  function tapping(seen: Seen, id: ButtonId): void {
    seen.hit = (x, y) => (x === BUTTON.x && y === BUTTON.y ? id : null);
  }
  function tap(game: Game, seen: Seen, id: ButtonId): void {
    tapping(seen, id);
    game.press(BUTTON.x, BUTTON.y);
    game.release();
  }

  it('s\'ouvre sur la page du niveau à jouer : la première pour un nouveau joueur, la seconde dès le niveau 11', () => {
    const fresh = makeGame('?graine=3');
    tap(fresh.game, fresh.seen, 'levels');
    fresh.game.frame(0.016);
    expect(fresh.seen.lastLevelsPage).toBe(0);

    const advanced = makeGame('?graine=3', clearedProfile(10));
    expect(advanced.game.debugState().unlockedLevel).toBe(11);
    tap(advanced.game, advanced.seen, 'levels');
    advanced.game.frame(0.016);
    expect(advanced.seen.lastLevelsPage).toBe(1);

    const middle = makeGame('?graine=3', clearedProfile(9));
    tap(middle.game, middle.seen, 'levels');
    middle.game.frame(0.016);
    expect(middle.seen.lastLevelsPage).toBe(0);
  });

  it('« suite » et « precedents » tournent les pages sans jamais sortir de la liste', () => {
    const { game, seen } = makeGame('?graine=3');
    tap(game, seen, 'levels');
    tap(game, seen, 'precedents');
    game.frame(0.016);
    expect(seen.lastLevelsPage).toBe(0);
    tap(game, seen, 'suite');
    game.frame(0.016);
    expect(seen.lastLevelsPage).toBe(1);
    tap(game, seen, 'suite');
    game.frame(0.016);
    expect(seen.lastLevelsPage).toBe(2);
    tap(game, seen, 'suite');
    game.frame(0.016);
    expect(seen.lastLevelsPage).toBe(2);
    tap(game, seen, 'precedents');
    game.frame(0.016);
    expect(seen.lastLevelsPage).toBe(1);
    expect(game.debugState()).toMatchObject({ screen: 'levels', step: 0 });
  });

  it('un niveau de la seconde page se lance depuis elle, « Retour » ramène au titre, et la liste rouvre sur la page du niveau à jouer', () => {
    const { game, seen } = makeGame('?graine=3', clearedProfile(10));
    tap(game, seen, 'levels');
    tap(game, seen, 'precedents');
    tap(game, seen, 'back');
    expect(game.debugState().screen).toBe('title');
    tap(game, seen, 'levels');
    game.frame(0.016);
    expect(seen.lastLevelsPage).toBe(1);
    tap(game, seen, 'niveau-11');
    expect(game.debugState()).toMatchObject({ screen: 'playing', mode: 'level', levelId: 11 });
    // Un niveau verrouillé de la même page ne réagit pas.
    game.restart();
    tap(game, seen, 'levels');
    tap(game, seen, 'niveau-12');
    expect(game.debugState().screen).toBe('levels');
  });

  it('depuis l\'écran de fin, la liste s\'ouvre aussi sur la page du niveau à jouer', () => {
    const { game, seen } = makeGame('?graine=3&test=1', clearedProfile(10));
    game.playLevel(11);
    game.frame(0.001);
    seen.state!.hero = { pos: { x: 0, y: seen.state!.finishY! - 0.5 }, vel: { x: 0, y: 8 }, grounded: false };
    for (let frames = 0; frames < 20 && game.debugState().screen === 'playing'; frames += 1) game.frame(0.05);
    expect(game.debugState().screen).toBe('won');
    settle(game);
    tap(game, seen, 'levels');
    game.frame(0.016);
    expect(game.debugState().screen).toBe('levels');
    expect(seen.lastLevelsPage).toBe(1);
  });
});

describe('musique', () => {
  /** Un faux lecteur : il suffit de savoir ce qui joue. */
  function fakeAudio(): (src: string) => AudioPlayer {
    return () => ({ loop: false, volume: 1, paused: true, currentTime: 0, play: () => undefined, pause: () => undefined, release: () => undefined });
  }

  it('rien avant le premier appui ; puis la piste du niveau, celle du menu sur le titre, et en course libre celle du niveau qui couvre la hauteur', () => {
    const music = new Music(fakeAudio());
    const { game, seen } = makeGame('', clearedProfile(2), music);
    game.frame(0.016);
    expect(music.playing).toBeNull();
    expect(game.debugState()).toMatchObject({ musicOn: true, track: null });
    // L'appui du titre joue le niveau 3 : c'est aussi le premier geste, le son est permis.
    game.press(10, 10);
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ screen: 'playing', levelId: 3, track: 'biome2-1' });
    game.restart();
    game.frame(0.016);
    expect(game.debugState().track).toBe('menu');
    game.playFree();
    game.frame(0.016);
    // La course libre part du départ du niveau 3 : sa piste.
    expect(game.debugState().track).toBe('biome2-1');
    expect(seen.state?.hero.pos.y).toBeGreaterThanOrEqual(levelOf(3).startY);
  });

  it('le bouton « Musique » du titre coupe et remet la musique, et le réglage survit dans le profil', () => {
    const music = new Music(fakeAudio());
    const { game, seen, storage } = makeGame('', undefined, music);
    seen.hit = () => 'music';
    game.press(1, 1);
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ screen: 'title', musicOn: false, track: null });
    expect(loadSavedProfile(storage).music).toBe(false);
    game.press(1, 1);
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ musicOn: true, track: 'menu' });
    expect(loadSavedProfile(storage).music).toBe(true);
  });
});

describe('ambiance', () => {
  /** Un faux lecteur : il suffit de savoir ce qui joue. */
  function fakeAudio(): (src: string) => AudioPlayer {
    return () => ({ loop: false, volume: 1, paused: true, currentTime: 0, play: () => undefined, pause: () => undefined, release: () => undefined });
  }

  /** Joue `seconds` de temps réel en images de 50 ms. */
  function run(game: Game, seconds: number): void {
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 0.05) game.frame(0.05);
  }

  /** Le canal `shift` de la couleur est-il entre ceux de `a` et de `b` ? */
  function between(value: number, a: number, b: number, shift: number): boolean {
    const channel = (color: number): number => (color >> shift) & 0xff;
    return channel(value) >= Math.min(channel(a), channel(b)) && channel(value) <= Math.max(channel(a), channel(b));
  }

  it('le titre est dans l\'ambiance du menu, sans fondu, et le rendu reçoit la palette de la famille', () => {
    const { game, seen } = makeGame('?graine=3');
    expect(game.debugState().palette).toBe('menu');
    game.frame(0.016);
    expect(seen.lastPalette).toBe(PALETTES.menu);
    expect(seen.lastPalette).toBe(PALETTES.biome1);
  });

  it('une partie d\'une autre famille fond de l\'ancienne palette à la nouvelle en une seconde : à mi-chemin, entre les deux ; puis la nouvelle', () => {
    const { game, seen } = makeGame('?graine=3', clearedProfile(2));
    game.frame(0.016);
    expect(game.playLevel(3)).toBe(true);
    // La famille visée change tout de suite.
    expect(game.debugState().palette).toBe('biome2');
    game.frame(0.05);
    const first = seen.lastPalette!;
    expect(first).not.toBe(PALETTES.biome2);

    run(game, PALETTE_FADE_SECONDS / 2 - 0.05);
    const mid = seen.lastPalette!;
    expect(mid).toEqual(mixPalette(PALETTES.menu, PALETTES.biome2, 0.5));
    for (const field of Object.keys(mid) as (keyof Palette)[]) {
      for (const shift of [16, 8, 0]) expect(between(mid[field], PALETTES.menu[field], PALETTES.biome2[field], shift), field).toBe(true);
    }
    expect(mid.background).not.toBe(PALETTES.menu.background);
    expect(mid.background).not.toBe(PALETTES.biome2.background);

    run(game, PALETTE_FADE_SECONDS / 2);
    expect(seen.lastPalette).toBe(PALETTES.biome2);
    // Le fondu est fini : la palette ne bouge plus, c'est le même objet à chaque image.
    game.frame(0.05);
    expect(seen.lastPalette).toBe(PALETTES.biome2);
  });

  it('des images de 0,1 s font aussi une seconde, flottants compris ; et le fondu compte le temps réel, sans le plafond des images de la simulation', () => {
    const { game, seen } = makeGame('?graine=3&test=1');
    game.playLevel(3);
    for (let frames = 0; frames < 10; frames += 1) game.frame(0.1);
    expect(seen.lastPalette).toBe(PALETTES.biome2);

    // Une image longue (appareil lent, onglet endormi) : la simulation ne rattrape que 0,1 s, mais l'ambiance a bien vu passer sa demi-seconde.
    game.playLevel(5);
    game.frame(0.5);
    expect(seen.lastPalette).toEqual(mixPalette(PALETTES.biome2, PALETTES.biome3, 0.5));
    game.frame(0.5);
    expect(seen.lastPalette).toBe(PALETTES.biome3);
  });

  it('un fondu interrompu repart de la palette montrée, sans saut ; et deux niveaux de la même famille n\'en lancent aucun', () => {
    const { game, seen } = makeGame('?graine=3&test=1');
    game.unlockAll();
    game.playLevel(3);
    run(game, 0.4);
    const shown = seen.lastPalette!;
    game.playLevel(9);
    expect(game.debugState().palette).toBe('boss');
    game.frame(0.0001);
    // L'image qui change de cap part de ce qui était montré.
    for (const field of Object.keys(shown) as (keyof Palette)[]) expect(between(seen.lastPalette![field], shown[field], PALETTES.boss[field], 16)).toBe(true);
    expect(distanceOfBackground(seen.lastPalette!, shown)).toBeLessThan(2);
    run(game, PALETTE_FADE_SECONDS + 0.1);
    expect(seen.lastPalette).toBe(PALETTES.boss);

    // Niveau 9 puis 10 : deux pistes de boss, une seule palette.
    game.playLevel(10);
    game.frame(0.05);
    expect(seen.lastPalette).toBe(PALETTES.boss);
  });

  it('chaque famille arrive à sa palette : niveaux 1, 3, 5, 7 et 9', () => {
    const expected = { 1: 'biome1', 3: 'biome2', 5: 'biome3', 7: 'biome4', 9: 'boss' } as const;
    const { game, seen } = makeGame('?graine=3&test=1');
    game.unlockAll();
    for (const [id, family] of Object.entries(expected)) {
      game.playLevel(Number(id));
      run(game, PALETTE_FADE_SECONDS + 0.1);
      expect(game.debugState().palette, `niveau ${id}`).toBe(family);
      expect(seen.lastPalette, `niveau ${id}`).toBe(PALETTES[family]);
    }
  });

  it('le retour au titre refond vers le menu, et la liste des niveaux est dans l\'ambiance du menu', () => {
    const { game, seen } = makeGame('?graine=3&test=1');
    game.unlockAll();
    game.playLevel(9);
    run(game, PALETTE_FADE_SECONDS + 0.1);
    expect(seen.lastPalette).toBe(PALETTES.boss);
    game.restart();
    game.frame(0.05);
    expect(game.debugState()).toMatchObject({ screen: 'title', palette: 'menu' });
    expect(seen.lastPalette).not.toBe(PALETTES.boss);
    expect(seen.lastPalette).not.toBe(PALETTES.menu);
    run(game, PALETTE_FADE_SECONDS);
    expect(seen.lastPalette).toBe(PALETTES.menu);
  });

  it('la palette suit la piste voulue même quand la musique est coupée', () => {
    const music = new Music(fakeAudio());
    const { game, seen } = makeGame('', { ...clearedProfile(2), music: false }, music);
    game.press(10, 10);
    run(game, PALETTE_FADE_SECONDS + 0.1);
    expect(game.debugState()).toMatchObject({ screen: 'playing', levelId: 3, musicOn: false, track: null, palette: 'biome2' });
    expect(music.playing).toBeNull();
    expect(seen.lastPalette).toBe(PALETTES.biome2);
  });

  it('en course libre, franchir la zone d\'un autre biome lance le fondu', () => {
    const { game, seen } = makeGame('?graine=3');
    game.playFree();
    game.frame(0.016);
    expect(game.debugState().palette).toBe('biome1');
    expect(seen.lastPalette).toBe(PALETTES.biome1);
    // Le niveau 3 couvre de 200 à 320 m : on y entre.
    seen.state!.hero = { pos: { x: 0, y: levelOf(3).startY + 5 }, vel: { x: 0, y: 0 }, grounded: false };
    game.frame(0.05);
    expect(game.debugState().palette).toBe('biome2');
    expect(seen.lastPalette).not.toBe(PALETTES.biome1);
    expect(seen.lastPalette).not.toBe(PALETTES.biome2);
    run(game, PALETTE_FADE_SECONDS);
    expect(seen.lastPalette).toBe(PALETTES.biome2);
  });

  it('un écran de fin garde l\'ambiance de la partie qui vient de finir', () => {
    const { game, seen } = makeGame('?graine=3&test=1');
    game.unlockAll();
    game.playLevel(5);
    run(game, PALETTE_FADE_SECONDS + 0.1);
    expect(game.debugState().palette).toBe('biome3');
    winByTeleport(game, seen);
    settle(game);
    expect(game.debugState().screen).toBe('won');
    expect(game.debugState().palette).toBe('biome3');
    expect(seen.lastPalette).toBe(PALETTES.biome3);
  });
});

/** Écart du fond entre deux palettes, en niveaux de couleur sur le canal le plus éloigné. */
function distanceOfBackground(a: Palette, b: Palette): number {
  return Math.max(...[16, 8, 0].map((shift) => Math.abs(((a.background >> shift) & 0xff) - ((b.background >> shift) & 0xff))));
}

describe('pouls', () => {
  /** Un faux lecteur dont la position de lecture se règle de l'extérieur. */
  function seekableAudio(): { factory: (src: string) => AudioPlayer; players: { currentTime: number }[] } {
    const players: { currentTime: number }[] = [];
    const factory = (): AudioPlayer => {
      const player = { loop: false, volume: 1, paused: true, currentTime: 0, play: () => undefined, pause: () => undefined, release: () => undefined };
      players.push(player);
      return player;
    };
    return { factory, players };
  }

  it('sans musique ni métronome, le rendu reçoit le pouls du silence', () => {
    const { game, seen } = makeGame('');
    game.frame(0.016);
    expect(seen.lastPulse).toBe(SILENT_PULSE);
    expect(game.debugState()).toMatchObject({ pulse: 0, bpm: 0 });
  });

  it('le métronome de ?pouls= bat sur le temps réel, musique ou non', () => {
    const { game, seen } = makeGame('?pouls=120');
    game.frame(0.016);
    expect(game.debugState().bpm).toBe(120);
    expect(game.debugState().pulse).toBeCloseTo(Math.exp((-BEAT_DECAY * 0.016) / 0.5), 6);
    expect(seen.lastPulse?.beat).toBe(game.debugState().pulse);
    // Juste avant le temps suivant, le pouls est au plus bas ; sur le temps, il remonte à 1.
    for (let i = 0; i < 30; i += 1) game.frame(0.016);
    expect(game.debugState().pulse).toBeLessThan(0.1);
    game.frame(0.004);
    expect(game.debugState().pulse).toBeCloseTo(1, 6);
    expect(seen.lastPulse?.inBar).toBe(1);
  });

  it('avec une piste qui joue et un rythme connu, le pouls suit la position de lecture ; musique coupée, le silence', () => {
    const { factory, players } = seekableAudio();
    const music = new Music(factory);
    const rhythm = syntheticRhythm(100, 10);
    const { game, seen } = makeGame('', clearedProfile(2), music, fixedRhythms(rhythm));
    game.frame(0.016);
    // Rien ne joue avant le premier geste : silence.
    expect(seen.lastPulse).toBe(SILENT_PULSE);
    game.press(10, 10);
    game.frame(0.016);
    expect(game.debugState().track).toBe('biome2-1');
    // Le dernier lecteur créé est celui de la piste du niveau ; celui du menu s'éteint en fondu.
    const player = players[players.length - 1]!;
    player.currentTime = 0.75;
    game.frame(0.016);
    expect(seen.lastPulse).toEqual(pulseAt(rhythm, 0.75));
    expect(game.debugState()).toMatchObject({ pulse: pulseAt(rhythm, 0.75).beat, bpm: 100 });
    player.currentTime = 1.2;
    game.frame(0.016);
    expect(seen.lastPulse?.count).toBe(2);
    // Musique coupée : plus de piste, plus de pouls.
    game.restart();
    game.frame(0.016);
    seen.hit = () => 'music';
    game.press(1, 1);
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ musicOn: false, pulse: 0, bpm: 0 });
    expect(seen.lastPulse).toBe(SILENT_PULSE);
  });

  it('une piste sans rythme connu joue sans pouls', () => {
    const { factory, players } = seekableAudio();
    const { game, seen } = makeGame('', clearedProfile(2), new Music(factory));
    game.press(10, 10);
    game.frame(0.016);
    expect(game.debugState().track).toBe('biome2-1');
    players[players.length - 1]!.currentTime = 2;
    game.frame(0.016);
    expect(seen.lastPulse).toBe(SILENT_PULSE);
  });
});

describe('pause et reprise', () => {
  /** Joue une partie, accroche, et attend que la corde tienne. */
  function hanging(): ReturnType<typeof makeGame> {
    const made = makeGame('?graine=3');
    const { game } = made;
    game.press(10, 10);
    for (let i = 0; i < 30 && !game.debugState().attached; i += 1) game.frame(0.016);
    expect(game.debugState()).toMatchObject({ screen: 'playing', attached: true });
    return made;
  }

  it('la pause fige la partie, corde comprise ; hors partie elle ne fait rien', () => {
    const { game } = hanging();
    game.pause();
    const { step } = game.debugState();
    for (let i = 0; i < 10; i += 1) game.frame(0.016);
    expect(game.debugState()).toMatchObject({ screen: 'paused', step, attached: true });
    // Le lever du doigt pendant la pause (le système a annulé le geste) ne lâche pas la corde.
    game.release();
    game.frame(0.016);
    expect(game.debugState().attached).toBe(true);
    game.resume();
    game.frame(0.016);
    expect(game.debugState().screen).toBe('playing');
    expect(game.debugState().step).toBeGreaterThan(step);
    const { game: title } = makeGame('');
    title.pause();
    expect(title.debugState().screen).toBe('title');
  });

  it('le bouton de pause met en pause sans accrocher ; Reprendre reprend et avale le lever du doigt ; Quitter revient au titre', () => {
    const { game, seen } = hanging();
    game.release();
    game.frame(0.016);
    expect(game.debugState().attached).toBe(false);
    seen.hit = () => 'pause';
    game.press(300, 30);
    expect(game.debugState().screen).toBe('paused');
    // Reprendre : l'appui n'accroche rien, et le lever qui le finit est avalé.
    seen.hit = () => 'resume';
    game.press(195, 500);
    expect(game.debugState().screen).toBe('playing');
    game.release();
    game.frame(0.016);
    expect(game.debugState().attached).toBe(false);
    // Un vrai appui ensuite accroche.
    seen.hit = () => null;
    game.press(195, 600);
    for (let i = 0; i < 30 && !game.debugState().attached; i += 1) game.frame(0.016);
    expect(game.debugState().attached).toBe(true);
    game.pause();
    seen.hit = () => 'quit';
    game.press(195, 560);
    expect(game.debugState().screen).toBe('title');
  });

  it('en pause, un appui ailleurs que sur un bouton ne fait rien', () => {
    const { game, seen } = hanging();
    game.pause();
    seen.hit = () => null;
    game.press(100, 100);
    game.release();
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ screen: 'paused', attached: true });
  });
});

describe('sons et départ', () => {
  /** Un lecteur qui note ce qu'on lui demande. */
  function recorder(): { player: SoundPlayer; played: Cue[]; enabled: boolean[]; readonly unlocked: number } {
    const log = { played: [] as Cue[], enabled: [] as boolean[], unlocked: 0 };
    const player: SoundPlayer = {
      unlock: () => void (log.unlocked += 1),
      play: (cue) => void log.played.push(cue),
      setEnabled: (value) => void log.enabled.push(value),
    };
    return {
      player,
      played: log.played,
      enabled: log.enabled,
      get unlocked() {
        return log.unlocked;
      },
    };
  }

  it('le premier appui permet le son ; accrocher et lâcher sonnent ; le réglage Sons coupe et se garde', () => {
    const rec = recorder();
    const { game, seen, storage } = makeGame('?graine=3', undefined, undefined, undefined, rec.player);
    game.frame(0.016);
    expect(rec.unlocked).toBe(0);
    game.press(10, 10);
    expect(rec.unlocked).toBe(1);
    // L'accroche du départ est immédiate ; son événement sonne à l'image suivante.
    game.frame(0.016);
    for (let i = 0; i < 30 && !game.debugState().attached; i += 1) game.frame(0.016);
    expect(rec.played.map((cue) => cue.id)).toContain('attach');
    game.release();
    game.frame(0.016);
    expect(rec.played.map((cue) => cue.id).some((id) => id === 'release' || id === 'perfect')).toBe(true);
    expect(rec.enabled.at(-1)).toBe(true);
    game.restart();
    game.frame(0.016);
    seen.hit = () => 'sfx';
    game.press(1, 1);
    game.frame(0.016);
    expect(game.debugState().sfxOn).toBe(false);
    expect(rec.enabled.at(-1)).toBe(false);
    expect(loadSavedProfile(storage).sfx).toBe(false);
  });

  it('le titre propose d\'installer le jeu quand le navigateur le peut, l\'appui lance l\'invite, et le bouton s\'efface ensuite', () => {
    let invited = 0;
    let state: InstallState = 'prompt';
    const installer: Installer = {
      state: () => state,
      prompt: () => {
        invited += 1;
        state = null;
        return Promise.resolve();
      },
    };
    const { game, seen } = makeGame('', undefined, undefined, undefined, undefined, installer);
    game.frame(0.016);
    expect(seen.lastInstall).toBe('prompt');
    expect(game.debugState().install).toBe('prompt');
    seen.hit = () => 'install';
    game.press(1, 1);
    game.frame(0.016);
    expect(invited).toBe(1);
    expect(game.debugState()).toMatchObject({ screen: 'title', install: null });
    expect(seen.lastInstall).toBeNull();
    // Sur iPhone, le titre porte le rappel ; sans installateur, rien.
    state = 'ios';
    game.frame(0.016);
    expect(seen.lastInstall).toBe('ios');
    const plain = makeGame();
    plain.game.frame(0.016);
    expect(plain.seen.lastInstall).toBeNull();
    expect(plain.game.debugState().install).toBeNull();
  });

  it('l\'atelier du mode test : on coche des éléments, le choix se garde, Jouer lance une partie qui ne porte que ces éléments', () => {
    const { game, seen, storage } = makeGame('?test=1');
    game.frame(0.016);
    seen.hit = () => 'atelier';
    game.press(1, 1);
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ screen: 'atelier', atelier: null, atelierChoice: [] });
    seen.hit = () => 'atelier:porte';
    game.press(1, 1);
    seen.hit = () => 'atelier:roue';
    game.press(1, 1);
    game.frame(0.016);
    expect(game.debugState().atelierChoice).toEqual(['roue', 'porte']);
    expect(loadSavedProfile(storage).atelier).toEqual(['roue', 'porte']);
    seen.hit = () => 'atelier:porte';
    game.press(1, 1);
    expect(game.debugState().atelierChoice).toEqual(['roue']);
    seen.hit = () => 'atelierAll';
    game.press(1, 1);
    expect(game.debugState().atelierChoice).toHaveLength(36);
    seen.hit = () => 'atelierNone';
    game.press(1, 1);
    expect(game.debugState().atelierChoice).toEqual([]);
    seen.hit = () => 'atelier:porte';
    game.press(1, 1);
    seen.hit = () => 'atelierPlay';
    game.press(1, 1);
    game.frame(0.016);
    const state = (game as unknown as { run: { sim: { state: SimState } } }).run.sim.state;
    expect(game.debugState()).toMatchObject({ screen: 'playing', atelier: ['porte'] });
    expect(state.course.plan).toMatchObject({ kind: 'atelier', selection: ['porte'] });
    expect(state.obstacles.some((box) => box.kind === 'porte')).toBe(true);
    expect(state.anchors.every((anchor) => anchor.kind === 'normal')).toBe(true);
    // Retour : l'écran de l'atelier revient au titre.
    game.restart();
    game.frame(0.016);
    seen.hit = () => 'atelier';
    game.press(1, 1);
    seen.hit = () => 'back';
    game.press(1, 1);
    expect(game.debugState().screen).toBe('title');
    // `?atelier=` ouvre une partie d'atelier directement, et `playAtelier` aussi, sur la liste donnée.
    const direct = makeGame('?test=1&atelier=tournant,machin,fragile');
    direct.game.playFree();
    direct.game.frame(0.016);
    expect(direct.game.debugState().atelier).toEqual(['fragile', 'tournant']);
    direct.game.playAtelier(['roue']);
    direct.game.frame(0.016);
    expect(direct.game.debugState().atelier).toEqual(['roue']);
  });

  it('une partie d\'atelier ne compte pas : à sa fin, ni expérience, ni mission, ni record, ni partie de plus au profil', () => {
    const { game, storage } = makeGame('?graine=3&fogBaseSpeed=6', clearedProfile(2));
    const before = game.currentProfile();
    game.playAtelier(['porte', 'tournant']);
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ screen: 'playing', atelier: ['porte', 'tournant'] });
    game.press();
    game.release();
    for (let frames = 0; frames < 400 && game.debugState().screen !== 'dead'; frames += 1) game.frame(0.05);
    expect(game.debugState().screen).toBe('dead');
    // Seuls les conseils du tutoriel, notés pendant la partie, peuvent avoir changé : ce n'est pas un gain de partie.
    const after = game.currentProfile();
    expect({ ...after, tips: [] }).toEqual({ ...before, tips: [] });
    expect({ ...loadSavedProfile(storage), tips: [] }).toEqual({ ...before, tips: [] });
    expect(game.debugState()).toMatchObject({ xp: before.xp, xpGained: 0 });
  });

  it('le départ de la course libre se bascule entre avancé et du sol, et se garde', () => {
    const { game, seen, storage } = makeGame('', clearedProfile(2));
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ freeStart: 'advanced' });
    expect(game.debugState().freeRunStartY).toBeGreaterThan(0);
    seen.hit = () => 'start';
    game.press(1, 1);
    game.frame(0.016);
    expect(game.debugState().freeStart).toBe('ground');
    expect(loadSavedProfile(storage).freeStart).toBe('ground');
    seen.hit = () => 'free';
    game.press(1, 1);
    game.frame(0.016);
    expect(game.debugState().screen).toBe('playing');
    expect(seen.state!.hero.pos.y).toBeLessThan(5);
    game.restart();
    seen.hit = () => 'start';
    game.press(1, 1);
    expect(game.debugState().freeStart).toBe('advanced');
  });
});

describe('tutoriel et apprentissage', () => {
  it('le premier conseil apparaît à la première accroche, se garde dans le profil, et ne revient pas après rechargement', () => {
    const { game, seen, storage } = makeGame('?graine=3');
    // En course libre, pas de bannière de niveau : le conseil a la place.
    game.playFree();
    game.press(10, 10);
    game.frame(0.016);
    for (let i = 0; i < 30 && !game.debugState().attached; i += 1) game.frame(0.016);
    expect(game.debugState().tip).toBe('Garde le doigt posé');
    expect(seen.lastBanner).toBe('Garde le doigt posé');
    expect(loadSavedProfile(storage).tips).toContain('grab');
    // Rechargé : le conseil est connu, la première accroche d'une nouvelle partie ne le redonne pas.
    game.restart();
    game.frame(0.016);
    game.playFree();
    game.press(10, 10);
    game.frame(0.016);
    for (let i = 0; i < 30 && !game.debugState().attached; i += 1) game.frame(0.016);
    expect(game.debugState().tip).toBeNull();
    expect(seen.lastBanner).not.toBe('Garde le doigt posé');
  });

  it('pendant la bannière d\'un niveau, un conseil attend : il n\'est pas perdu', () => {
    const { game, seen } = makeGame('?graine=3');
    game.press(10, 10);
    game.frame(0.016);
    for (let i = 0; i < 30 && !game.debugState().attached; i += 1) game.frame(0.016);
    // L'intro du niveau occupe la bannière : pas de conseil, et rien de noté.
    expect(game.debugState().tip).toBeNull();
    expect(seen.lastBanner).toBe('Niveau 1 · Les premiers anneaux');
    expect(game.currentProfile().tips).toEqual([]);
  });

  it('un profil qui apprend joue avec une brume plus lente et une ombre plus longue ; un profil aguerri non', () => {
    const { game, seen } = makeGame('?graine=3');
    game.press(10, 10);
    game.frame(0.016);
    expect(seen.lastTuning!.fogBaseSpeed).toBeCloseTo(levelById(1)!.fogBaseSpeed * 0.6, 9);
    expect(seen.lastTuning!.shadowSeconds).toBe(0.5);
    const { game: veteran, seen: seenVeteran } = makeGame('?graine=3', { ...createProfile(), bestHeight: 80 });
    veteran.press(10, 10);
    veteran.frame(0.016);
    expect(seenVeteran.lastTuning!.fogBaseSpeed).toBeCloseTo(levelById(1)!.fogBaseSpeed, 9);
    expect(seenVeteran.lastTuning!.shadowSeconds).toBe(DEFAULT_TUNING.shadowSeconds);
  });
});

describe('anchors() : de quelle bande d\'accordéon est chaque prise', () => {
  it('dans la scène « accordeon », les prises des deux bandes disent -1 (la gauche) ou 1 (la droite), toutes les autres null', () => {
    const { game } = makeFreeGame('?scene=accordeon&graine=5');
    const anchors = game.anchors();
    const left = anchors.filter((anchor) => anchor.band === -1);
    const right = anchors.filter((anchor) => anchor.band === 1);
    expect(left.length).toBeGreaterThanOrEqual(2);
    expect(right.length).toBe(left.length);
    // La bande de gauche est à gauche du milieu, celle de droite à droite, à tout instant.
    expect(Math.max(...left.map((anchor) => anchor.x))).toBeLessThan(0);
    expect(Math.min(...right.map((anchor) => anchor.x))).toBeGreaterThan(0);
    expect(anchors.filter((anchor) => anchor.band === null).length).toBeGreaterThan(0);
    expect(anchors.every((anchor) => anchor.band === -1 || anchor.band === 1 || anchor.band === null)).toBe(true);
  });

  it('hors de la scène, aucune prise n\'est d\'une bande', () => {
    const { game } = makeFreeGame('?scene=rebond&graine=5');
    expect(game.anchors().every((anchor) => anchor.band === null)).toBe(true);
  });
});

describe('le passage qui se referme : ce que le jeu en dit', () => {
  it('quand le personnage entre dans le couloir : une bannière, un son grave, et state() le dit (closing, triggered) ; avant, rien', () => {
    const played: Cue[] = [];
    const sfx: SoundPlayer = { unlock: () => undefined, play: (cue) => void played.push(cue), setEnabled: () => undefined };
    const { game, seen } = makeGame('?scene=evasion&graine=5&fogBaseSpeed=0', undefined, undefined, undefined, sfx);
    game.playFree();
    game.frame(0.016);
    expect(game.debugState()).toMatchObject({ closing: false, triggered: [] });
    expect(seen.banners.has(ESCAPE_ANNOUNCEMENT.title)).toBe(false);
    expect(played.some((cue) => cue.pitch === ESCAPE_PITCH)).toBe(false);

    // Le personnage est posé dans le couloir, au-dessus de sa ligne d'entrée : la fermeture se déclenche, une fois.
    const state = seen.state!;
    state.hero = { pos: { x: 0, y: 13 }, vel: { x: 0, y: 0 }, grounded: false };
    hover(game, seen, 0.2);
    expect(seen.lastBanner).toBe(ESCAPE_ANNOUNCEMENT.title);
    expect(seen.lastBannerDetail).toBe(ESCAPE_ANNOUNCEMENT.detail);
    expect(played.filter((cue) => cue.pitch === ESCAPE_PITCH)).toEqual([{ id: 'bounce', pitch: ESCAPE_PITCH }]);
    const debug = game.debugState();
    expect(debug.closing).toBe(true);
    expect(debug.triggered).toHaveLength(2);
    expect(debug.triggered.every((trigger) => trigger.step <= debug.step)).toBe(true);
    expect(state.obstacles.filter((box) => box.closer).map((box) => box.id).sort()).toEqual(debug.triggered.map((trigger) => trigger.obstacleId).sort());

    // Une seule annonce par passage, même si le personnage y reste.
    hover(game, seen, 0.5);
    expect(played.filter((cue) => cue.pitch === ESCAPE_PITCH)).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { Game, readSettings } from '../src/app/game';
import { createProfile, loadProfile, memoryStorage, saveProfile, type Profile, type ProfileStorage, type RunOutcome } from '../src/meta/profile';
import type { TalismanId } from '../src/meta/talismans';
import type { DeathCause, GameFrame, GameScreen } from '../src/render/renderer';
import type { ButtonId } from '../src/render/screens';
import { DEFAULT_TUNING, type Tuning } from '../src/sim/tuning';

/** Ce que le faux rendu a reçu à la dernière image, et tout ce qu'il a vu passer au fil de la partie. */
interface Seen {
  /** Écran demandé à chaque image. */
  readonly screens: GameScreen[];
  lastCause: DeathCause | null;
  /** Textes flottants et bannière de la dernière image. */
  lastTexts: string[];
  lastBanner: string | null;
  /** Textes flottants distincts vus à l'écran, et bannières de palier distinctes. */
  readonly texts: Set<string>;
  readonly banners: Set<string>;
  /** Réglages, profil et bilan de la dernière image. */
  lastTuning: Tuning | null;
  lastProfile: Profile | null;
  lastOutcome: RunOutcome | null;
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
    texts: new Set(),
    banners: new Set(),
    lastTuning: null,
    lastProfile: null,
    lastOutcome: null,
    hit: () => null,
  };
  const view = {
    width: 390,
    height: 844,
    draw: (_state: unknown, _camera: unknown, frame: GameFrame) => {
      seen.screens.push(frame.screen);
      seen.lastCause = frame.deathCause;
      seen.lastTexts = frame.effects.texts.map((item) => item.text);
      seen.lastBanner = frame.effects.banner?.text ?? null;
      seen.lastTuning = frame.tuning;
      seen.lastProfile = frame.profile;
      seen.lastOutcome = frame.outcome;
      for (const text of seen.lastTexts) seen.texts.add(text);
      if (seen.lastBanner) seen.banners.add(seen.lastBanner);
    },
    hitTest: (x: number, y: number) => seen.hit(x, y),
  };
  const storage = memoryStorage();
  if (saved) saveProfile(storage, saved);
  return { game: new Game(view, readSettings(search), storage), seen, storage };
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
    const { game } = makeGame('?graine=1&fogBaseSpeed=6');
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
    expect(game.debugState()).toMatchObject({ screen: 'playing', attached: true });
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
    const { game } = makeGame('?graine=3');
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
        'fogY',
        'height',
        'level',
        'missions',
        'obstacles',
        'pickups',
        'pos',
        'ropeLength',
        'runs',
        'score',
        'screen',
        'seed',
        'step',
        'targetId',
        'tier',
        'vel',
        'xp',
        'xpGained',
      ].sort(),
    );
  });
});

describe('mort et cause', () => {
  it('la brume tue un personnage laissé au sol : cause « fog », transmise au rendu', () => {
    const { game, seen } = makeGame('?graine=3');
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
      const { game, seen } = makeGame(`?graine=${seed}&tierHeight=4`);
      playPilot(game, 60);
      if (game.debugState().cause !== 'obstacle') continue;
      expect(game.debugState().screen).toBe('dead');
      expect(seen.lastCause).toBe('obstacle');
      return;
    }
    expect.unreachable('aucune des dix graines n\'a fini sur un obstacle');
  });

  it('une nouvelle partie efface le palier, la cause et les effets en cours', () => {
    const { game, seen } = makeGame('?graine=3&tierHeight=4');
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
    const { game } = makeGame('?graine=3');
    expect(game.debugState()).toMatchObject({ tier: 0, obstacles: 0, pickups: 0 });

    const hard = makeGame('?graine=3&tierHeight=4').game;
    playPilot(hard, 60);
    expect(hard.debugState().tier).toBeGreaterThan(0);
    expect(hard.debugState().obstacles).toBeGreaterThan(0);
  });

  it('compte les étoiles prises sans jamais les perdre, même quand la simulation les oublie sous la brume', () => {
    let best = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const { game } = makeGame(`?graine=${seed}&tierHeight=4`);
      const run = playPilot(game, 60);
      expect(run.decreased).toBe(false);
      best = Math.max(best, run.maxPickups);
      expect(game.debugState().pickups).toBe(run.maxPickups);
    }
    expect(best).toBeGreaterThan(0);
  });

  it('transmet les événements de règles au rendu : textes flottants et bannière de palier', () => {
    const { game, seen } = makeGame('?graine=3&tierHeight=4');
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

  it('garde la graine annoncée par l\'écran titre quand les talismans changent avant le départ', () => {
    const { game } = makeGame();
    game.restart(41);
    game.equip('treuil');
    game.press();
    expect(game.debugState()).toMatchObject({ screen: 'playing', seed: 41 });
  });

  it('une partie finie ajoute son expérience et ses parties au profil, le sauvegarde, et donne le bilan au rendu', () => {
    const { game, seen, storage } = makeGame('?graine=3&fogBaseSpeed=4');
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
    const { game, storage } = makeGame('?graine=3&fogBaseSpeed=4');
    game.press();
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    for (let frames = 0; frames < 20; frames += 1) game.frame(0.05);
    expect(game.debugState().runs).toBe(1);
    expect(loadProfile(storage).runs).toBe(1);
  });

  it('nourrit les missions des événements de la partie : le pilote en accomplit, avec leur récompense', () => {
    const { game, seen, storage } = makeGame('?graine=3');
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
    const { game } = makeGame('?graine=3&fogBaseSpeed=4');
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
    const { game, storage } = makeGame('?graine=3&fogBaseSpeed=4');
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
    const { game, seen } = makeGame('?graine=3&fogBaseSpeed=4', profileWith(720, ['chance']));
    expect(game.debugState().level).toBe(4);
    game.press();
    game.release();
    expect(frameUntilDead(game)).toBeGreaterThan(0);
    expect(seen.texts.has('Seconde chance !')).toBe(true);

    const plain = makeGame('?graine=3&fogBaseSpeed=4');
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

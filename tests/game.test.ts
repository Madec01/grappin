import { describe, expect, it } from 'vitest';
import { Game, readSettings } from '../src/app/game';
import type { DeathCause, GameFrame, GameScreen } from '../src/render/renderer';
import { DEFAULT_TUNING } from '../src/sim/tuning';

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
}

/** Jeu relié à un faux rendu qui note ce qu'on lui demande de dessiner. */
function makeGame(search = ''): { game: Game; seen: Seen } {
  const seen: Seen = { screens: [], lastCause: null, lastTexts: [], lastBanner: null, texts: new Set(), banners: new Set() };
  const view = {
    width: 390,
    height: 844,
    draw: (_state: unknown, _camera: unknown, frame: GameFrame) => {
      seen.screens.push(frame.screen);
      seen.lastCause = frame.deathCause;
      seen.lastTexts = frame.effects.texts.map((item) => item.text);
      seen.lastBanner = frame.effects.banner?.text ?? null;
      for (const text of seen.lastTexts) seen.texts.add(text);
      if (seen.lastBanner) seen.banners.add(seen.lastBanner);
    },
  };
  return { game: new Game(view, readSettings(search)), seen };
}

/** Joue des images de 50 ms jusqu'à l'écran de fin ; renvoie le nombre d'images, ou -1 si la mort ne vient pas. */
function frameUntilDead(game: Game): number {
  for (let frames = 1; frames <= 400; frames += 1) {
    game.frame(0.05);
    if (game.debugState().screen === 'dead') return frames;
  }
  return -1;
}

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
        'fogY',
        'height',
        'obstacles',
        'pickups',
        'pos',
        'ropeLength',
        'score',
        'screen',
        'seed',
        'step',
        'targetId',
        'tier',
        'vel',
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

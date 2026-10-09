import { describe, expect, it } from 'vitest';
import { Game, readSettings } from '../src/app/game';
import type { GameScreen } from '../src/render/renderer';
import { DEFAULT_TUNING } from '../src/sim/tuning';

/** Jeu relié à un faux rendu qui note l'écran demandé à chaque image. */
function makeGame(search = ''): { game: Game; drawn: GameScreen[] } {
  const drawn: GameScreen[] = [];
  const view = {
    width: 390,
    height: 844,
    draw: (_state: unknown, _camera: unknown, screen: GameScreen) => void drawn.push(screen),
  };
  return { game: new Game(view, readSettings(search)), drawn };
}

/** Joue des images de 50 ms jusqu'à l'écran de fin ; renvoie le nombre d'images, ou -1 si la mort ne vient pas. */
function frameUntilDead(game: Game): number {
  for (let frames = 1; frames <= 400; frames += 1) {
    game.frame(0.05);
    if (game.debugState().screen === 'dead') return frames;
  }
  return -1;
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
    const { game, drawn } = makeGame('?graine=3');
    game.frame(1);
    expect(game.debugState()).toMatchObject({ screen: 'title', step: 0, attached: false, seed: 3 });
    expect(drawn).toEqual(['title']);
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
    expect(game.debugState()).toMatchObject({ screen: 'playing', seed: 3, attached: true });
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
      ['attached', 'combo', 'fogY', 'height', 'pos', 'ropeLength', 'score', 'screen', 'seed', 'step', 'targetId', 'vel'].sort(),
    );
  });
});

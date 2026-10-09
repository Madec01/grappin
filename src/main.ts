import { Game, readSettings, type DebugState } from './app/game';
import { trackPointer } from './input/pointer';
import { Renderer } from './render/renderer';

/**
 * Point d'entrée : démarre PixiJS et le jeu, branche le doigt sur le canvas.
 *
 * `window.__grappin` expose de quoi observer et piloter une partie depuis
 * l'extérieur (tests de bout en bout, séances de réglage sur téléphone).
 */
declare global {
  interface Window {
    __grappin?: {
      readonly version: string;
      state: () => DebugState;
      press: () => void;
      release: () => void;
      restart: (seed?: number) => void;
    };
  }
}

async function start(): Promise<void> {
  const settings = readSettings(window.location.search);
  const renderer = await Renderer.create(settings.tuning);
  const game = new Game(renderer, settings);

  renderer.onFrame((elapsedSeconds) => game.frame(elapsedSeconds));
  trackPointer(renderer.canvas, { onPress: () => game.press(), onRelease: () => game.release() });

  window.__grappin = {
    version: __APP_VERSION__,
    state: () => game.debugState(),
    press: () => game.press(),
    release: () => game.release(),
    restart: (seed?: number) => game.restart(seed),
  };
}

/**
 * Sans rendu, le jeu n'a rien à montrer : un message simple vaut mieux qu'une
 * page noire. PixiJS retombe déjà sur le canvas 2D quand WebGL manque ; on
 * n'arrive ici que si aucun mode d'affichage ne s'initialise.
 */
function showFailure(): void {
  const message = document.createElement('p');
  message.textContent = "Impossible de démarrer GRAPPIN : l'affichage graphique (WebGL) n'a pas pu être initialisé sur cet appareil.";
  message.style.cssText = 'margin:0;padding:24px;color:#f4f6fb;font:18px/1.4 system-ui,sans-serif;';
  document.body.replaceChildren(message);
}

start().catch((error: unknown) => {
  console.error(error);
  showFailure();
});

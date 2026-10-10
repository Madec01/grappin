import { Game, readSettings, type DebugAnchor, type DebugState } from './app/game';
import { Music, browserAudio } from './audio/music';
import { trackPointer } from './input/pointer';
import { STORAGE_KEY, TEST_STORAGE_KEY, browserStorage, type Profile } from './meta/profile';
import type { TalismanId } from './meta/talismans';
import type { ButtonRect } from './render/buttons';
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
      /** Le doigt se pose, à la position donnée en pixels CSS si on la connaît : sans position, aucun bouton n'est touché. */
      press: (x?: number, y?: number) => void;
      /** Le doigt se lève. Tenu à un lanceur, `pullX` et `pullY` sont la traction du lancer en mètres de monde (y vers le haut) : le personnage part à l'opposé. Sans eux, la traction du doigt, sinon la dernière visée. */
      release: (pullX?: number, pullY?: number) => void;
      restart: (seed?: number) => void;
      /** Le profil du joueur tel que le jeu le tient. */
      profile: () => Profile;
      /** Équipe ou retire un talisman, sauvegarde, et renvoie le profil. */
      equip: (id: TalismanId) => Profile;
      /** Efface la progression et revient à l'écran titre. */
      resetProfile: () => void;
      /** Ouvre tous les niveaux (une étoile sur chacun, sauvegardée). Réservé aux tests de bout en bout et au banc de captures. */
      unlockAll: () => void;
      /** Boutons de l'écran affiché, tels que la dernière image les a dessinés. */
      buttons: () => readonly ButtonRect[];
      /** Joue un niveau tout de suite, sans appui d'accroche. Faux, sans rien changer, s'il n'existe pas ou n'est pas débloqué. */
      playLevel: (id: number) => boolean;
      /** Joue la course libre tout de suite, sans appui d'accroche. */
      playFree: () => void;
      /** Les points d'accroche encore là, en mètres de monde : de quoi viser un trou dans un mur. Pour les tests de bout en bout et le banc de captures. */
      anchors: () => DebugAnchor[];
    };
  }
}

async function start(): Promise<void> {
  const settings = readSettings(window.location.search);
  const renderer = await Renderer.create();
  // Le mode test joue sur son propre profil : la vraie progression n'en sait rien.
  // La musique vit dans public/musique, servie sous la base du site.
  const game = new Game(renderer, settings, browserStorage(settings.testMode ? TEST_STORAGE_KEY : STORAGE_KEY), new Music(browserAudio(import.meta.env.BASE_URL)));

  renderer.onFrame((elapsedSeconds) => game.frame(elapsedSeconds));
  trackPointer(renderer.canvas, { onPress: (x, y) => game.press(x, y), onMove: (x, y) => game.move(x, y), onRelease: () => game.release() });

  window.__grappin = {
    version: __APP_VERSION__,
    state: () => game.debugState(),
    press: (x?: number, y?: number) => game.press(x, y),
    release: (pullX?: number, pullY?: number) => game.release(pullX === undefined && pullY === undefined ? undefined : { x: pullX ?? 0, y: pullY ?? 0 }),
    restart: (seed?: number) => game.restart(seed),
    profile: () => game.currentProfile(),
    equip: (id: TalismanId) => game.equip(id),
    resetProfile: () => game.resetProfile(),
    unlockAll: () => game.unlockAll(),
    buttons: () => renderer.buttons(),
    playLevel: (id: number) => game.playLevel(id),
    playFree: () => game.playFree(),
    anchors: () => game.anchors(),
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

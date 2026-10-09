import { Camera } from '../render/camera';
import { Effects } from '../render/effects';
import type { DeathCause, GameScreen, Renderer } from '../render/renderer';
import { Simulation } from '../sim/simulation';
import { DEFAULT_TUNING, withTuning, type Tuning } from '../sim/tuning';

/**
 * Le jeu : écrans, boucle à pas fixe et passage des gestes à la simulation.
 *
 * Il relie la simulation (qui ignore le temps réel), la caméra et le rendu.
 * Il ne dessine rien lui-même.
 */

/**
 * Plafond du temps réel pris en compte par image. Après un onglet en
 * sommeil ou un à-coup, la simulation reprend là où elle en était au lieu de
 * rattraper des secondes entières d'un coup.
 */
const MAX_FRAME_SECONDS = 0.1;

/** Ce que le jeu demande au rendu : sa taille et un dessin. */
export type GameView = Pick<Renderer, 'width' | 'height' | 'draw'>;

export interface GameSettings {
  /** Graine imposée par `?graine=`, ou null pour une graine aléatoire à chaque partie. */
  readonly seed: number | null;
  readonly tuning: Tuning;
}

/** Instantané lisible de l'extérieur : tests de bout en bout et séances de réglage. */
export interface DebugState {
  readonly screen: GameScreen;
  readonly step: number;
  readonly attached: boolean;
  /** Longueur de corde en cours, ou null sans corde. */
  readonly ropeLength: number | null;
  readonly targetId: number | null;
  readonly height: number;
  readonly score: number;
  readonly combo: number;
  readonly pos: { readonly x: number; readonly y: number };
  readonly vel: { readonly x: number; readonly y: number };
  readonly fogY: number;
  readonly seed: number;
  /** Ce qui a tué le personnage, ou null tant qu'il vit. */
  readonly cause: DeathCause | null;
  /** Palier nommé atteint. */
  readonly tier: number;
  /** Nombre d'obstacles chargés en ce moment. */
  readonly obstacles: number;
  /** Étoiles prises depuis le début de la partie. */
  readonly pickups: number;
}

/**
 * Lit les réglages dans la chaîne de requête de l'URL : `?graine=123` fixe la
 * graine, et tout paramètre nommé comme une clé de `Tuning` en surcharge la
 * valeur (`?gravity=9&ropeMax=6`). Une valeur illisible est ignorée.
 */
export function readSettings(search: string): GameSettings {
  const params = new URLSearchParams(search);
  const overrides: Partial<Record<keyof Tuning, number | undefined>> = {};
  for (const key of Object.keys(DEFAULT_TUNING) as (keyof Tuning)[]) {
    const text = params.get(key)?.trim();
    // Number('') vaut 0 : un paramètre vide ne doit pas écraser le réglage.
    if (text) overrides[key] = Number(text);
  }
  const seedText = params.get('graine')?.trim();
  const seed = seedText ? Number(seedText) : Number.NaN;
  return { seed: Number.isInteger(seed) ? seed : null, tuning: withTuning(DEFAULT_TUNING, overrides) };
}

/** Graine 32 bits tirée au hasard : le seul aléa hors simulation, qui ne le relit jamais. */
function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export class Game {
  private readonly view: GameView;
  private readonly settings: GameSettings;
  private readonly camera: Camera;
  /** Animations de temps réel : trait du grappin, textes flottants, bannière de palier. */
  private readonly effects: Effects;
  private sim: Simulation;
  private screen: GameScreen = 'title';
  /** Cause de la mort, connue à l'événement `death`, ou null tant que le personnage vit. */
  private deathCause: DeathCause | null = null;
  /** Étoiles prises : comptées ici, car la simulation retire de sa liste celles passées sous la brume. */
  private pickupsTaken = 0;
  /** Temps réel reçu mais pas encore converti en pas de simulation, en secondes. */
  private accumulator = 0;

  constructor(view: GameView, settings: GameSettings) {
    this.view = view;
    this.settings = settings;
    this.camera = new Camera(settings.tuning.heroRadius, view.width, view.height);
    this.effects = new Effects(settings.tuning);
    this.sim = this.newSimulation(settings.seed ?? randomSeed());
  }

  /** Le doigt se pose. Sur l'écran titre ou de fin, il lance la partie et compte aussi comme l'appui. */
  press(): void {
    if (this.screen === 'dead') this.sim = this.newSimulation(this.settings.seed ?? randomSeed());
    this.screen = 'playing';
    this.sim.press();
  }

  /** Le doigt se lève : le personnage est libéré avec sa vitesse du moment. */
  release(): void {
    if (this.screen === 'playing') this.sim.release();
  }

  /** Nouvelle partie, de retour sur l'écran titre. Sans graine, celle de l'URL, sinon une graine neuve. */
  restart(seed?: number): void {
    this.sim = this.newSimulation(seed ?? this.settings.seed ?? randomSeed());
    this.screen = 'title';
  }

  /**
   * Une image : convertit le temps réel en pas fixes, place la caméra, passe les
   * événements de règles aux effets (et à l'écran de fin si besoin), puis dessine.
   */
  frame(elapsedSeconds: number): void {
    const dt = Math.min(elapsedSeconds, MAX_FRAME_SECONDS);
    if (this.screen === 'playing') this.advance(dt);
    const { hero } = this.sim.state;
    this.camera.resize(this.view.width, this.view.height);
    this.camera.update(dt, hero.pos, hero.vel);
    this.effects.update(dt);
    const heroOnScreen = this.camera.worldToScreen(hero.pos);
    for (const event of this.sim.drain()) {
      if (event.type === 'death') {
        this.screen = 'dead';
        this.deathCause = event.cause;
      }
      if (event.type === 'pickup') this.pickupsTaken += 1;
      this.effects.handle(event, heroOnScreen);
    }
    this.view.draw(this.sim.state, this.camera, { screen: this.screen, deathCause: this.deathCause, effects: this.effects });
  }

  debugState(): DebugState {
    const { state } = this.sim;
    return {
      screen: this.screen,
      step: state.step,
      attached: state.rope !== null,
      ropeLength: state.rope?.length ?? null,
      targetId: state.targetId,
      height: state.height,
      score: state.score,
      combo: state.combo,
      pos: { x: state.hero.pos.x, y: state.hero.pos.y },
      vel: { x: state.hero.vel.x, y: state.hero.vel.y },
      fogY: state.fogY,
      seed: state.course.seed,
      cause: this.deathCause,
      tier: state.tier,
      obstacles: state.obstacles.length,
      pickups: this.pickupsTaken,
    };
  }

  /** Simulation neuve sur une graine, avec la caméra replacée d'un coup sur le personnage. */
  private newSimulation(seed: number): Simulation {
    const sim = new Simulation(seed, this.settings.tuning);
    this.accumulator = 0;
    this.deathCause = null;
    this.pickupsTaken = 0;
    this.effects.clear();
    this.camera.snap(sim.state.hero.pos, sim.state.hero.vel);
    return sim;
  }

  /** Fait avancer la simulation d'autant de pas fixes que le temps reçu en contient. */
  private advance(dtSeconds: number): void {
    const step = this.settings.tuning.stepSeconds;
    this.accumulator += dtSeconds;
    while (this.accumulator >= step && this.sim.state.status === 'alive') {
      this.sim.step();
      this.accumulator -= step;
    }
  }
}

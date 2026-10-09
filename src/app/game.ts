import { levelFor } from '../meta/levels';
import { createProfile, endRun, loadProfile, saveProfile, toggleTalisman, type Profile, type ProfileStorage, type RunOutcome } from '../meta/profile';
import { RunTracker } from '../meta/runTracker';
import { applyTalismans, type TalismanId } from '../meta/talismans';
import { Camera } from '../render/camera';
import { Effects } from '../render/effects';
import type { DeathCause, GameScreen, Renderer } from '../render/renderer';
import type { ButtonId } from '../render/screens';
import { Simulation } from '../sim/simulation';
import { DEFAULT_TUNING, withTuning, type Tuning } from '../sim/tuning';

/**
 * Le jeu : écrans, boucle à pas fixe et passage des gestes à la simulation.
 *
 * Il relie la simulation (qui ignore le temps réel), la caméra, le rendu et le
 * profil du joueur, qu'il charge au départ et sauvegarde à chaque fin de
 * partie. Il ne dessine rien lui-même.
 */

/**
 * Plafond du temps réel pris en compte par image. Après un onglet en
 * sommeil ou un à-coup, la simulation reprend là où elle en était au lieu de
 * rattraper des secondes entières d'un coup.
 */
const MAX_FRAME_SECONDS = 0.1;
/** Après la mort, les appuis sont ignorés ce temps : l'écran de fin doit pouvoir être lu. */
const DEATH_LOCK_SECONDS = 0.6;

/** Ce que le jeu demande au rendu : sa taille, un dessin, et quel bouton se trouve sous un point. */
export type GameView = Pick<Renderer, 'width' | 'height' | 'draw' | 'hitTest'>;

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
  /** Niveau et expérience du profil, talismans équipés et missions actives avec leur avancement. */
  readonly level: number;
  readonly xp: number;
  readonly equipped: TalismanId[];
  readonly missions: { readonly id: string; readonly progress: number }[];
  /** Expérience gagnée par la partie qui vient de finir, 0 hors de l'écran de fin. */
  readonly xpGained: number;
  /** Parties terminées depuis la création du profil. */
  readonly runs: number;
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

/** Une partie : tout ce qui naît avec elle et disparaît avec elle. Une partie neuve repart donc toujours de zéro. */
interface Run {
  readonly sim: Simulation;
  /** Réglages de la partie : ceux de l'URL, plus les talismans équipés au départ. */
  readonly tuning: Tuning;
  readonly camera: Camera;
  /** Animations de temps réel : trait du grappin, textes flottants, bannière de palier. */
  readonly effects: Effects;
  /** Relevé des événements, dont les missions ont besoin à la fin. */
  readonly tracker: RunTracker;
  /** Temps réel reçu mais pas encore converti en pas de simulation, en secondes. */
  accumulator: number;
  /** Cause de la mort, connue à l'événement `death`, ou null tant que le personnage vit. */
  deathCause: DeathCause | null;
  /** Bilan de la partie, connu à sa fin, ou null tant que le personnage vit. */
  outcome: RunOutcome | null;
  /** Étoiles prises : comptées ici, car la simulation retire de sa liste celles passées sous la brume. */
  pickupsTaken: number;
}

export class Game {
  private readonly view: GameView;
  private readonly settings: GameSettings;
  private readonly storage: ProfileStorage;
  private profile: Profile;
  private run: Run;
  private screen: GameScreen = 'title';
  /** Écran d'où l'on a ouvert celui des talismans, et où « Retour » ramène. */
  private returnTo: 'title' | 'dead' = 'title';
  /** Temps réel écoulé depuis la mort, pour le verrou d'entrée de l'écran de fin. */
  private deadSeconds = 0;

  constructor(view: GameView, settings: GameSettings, storage: ProfileStorage) {
    this.view = view;
    this.settings = settings;
    this.storage = storage;
    this.profile = loadProfile(storage);
    this.run = this.newRun(settings.seed ?? randomSeed());
  }

  /**
   * Le doigt se pose, à la position donnée en pixels CSS si on la connaît. En
   * partie, il lance le grappin. Sur l'écran titre ou de fin, un bouton agit, et
   * sinon l'appui lance la partie et compte aussi comme l'appui d'accroche. Sur
   * l'écran des talismans, seuls les boutons agissent.
   */
  press(x?: number, y?: number): void {
    if (this.screen === 'playing') {
      this.run.sim.press();
      return;
    }
    // Juste après la mort, un tap réflexe ne doit pas sauter l'écran de fin et ce qu'il annonce.
    if (this.screen === 'dead' && this.deadSeconds < DEATH_LOCK_SECONDS) return;
    const button = x === undefined || y === undefined ? null : this.view.hitTest(x, y);
    if (this.screen === 'talismans') this.pressTalismans(button);
    else if (button === 'talismans') this.openTalismans(this.screen);
    else this.startRun();
  }

  /** Le doigt se lève : le personnage est libéré avec sa vitesse du moment. */
  release(): void {
    if (this.screen === 'playing') this.run.sim.release();
  }

  /**
   * Nouvelle partie, de retour sur l'écran titre, avec le profil relu depuis le
   * stockage. Sans graine, celle de l'URL, sinon une graine neuve.
   */
  restart(seed?: number): void {
    this.profile = loadProfile(this.storage);
    this.run = this.newRun(seed ?? this.settings.seed ?? randomSeed());
    this.screen = 'title';
  }

  /** Équipe ou retire un talisman, puis sauvegarde. Sans effet s'il n'est pas débloqué ou si les emplacements sont pleins. Renvoie le profil. */
  equip(id: TalismanId): Profile {
    const next = toggleTalisman(this.profile, id);
    if (next !== this.profile) {
      this.profile = next;
      saveProfile(this.storage, next);
    }
    return this.profile;
  }

  /** Efface la progression : un profil neuf est sauvegardé, et le jeu revient à l'écran titre. */
  resetProfile(): void {
    saveProfile(this.storage, createProfile());
    this.restart();
  }

  currentProfile(): Profile {
    return this.profile;
  }

  /**
   * Une image : convertit le temps réel en pas fixes, place la caméra, passe les
   * événements de règles aux effets, au suiveur de partie et à l'écran de fin si
   * besoin, puis dessine.
   */
  frame(elapsedSeconds: number): void {
    const dt = Math.min(elapsedSeconds, MAX_FRAME_SECONDS);
    if (this.screen === 'dead') this.deadSeconds += dt;
    const { sim, camera, effects, tracker } = this.run;
    if (this.screen === 'playing') this.advance(dt);
    const { hero } = sim.state;
    camera.resize(this.view.width, this.view.height);
    camera.update(dt, hero.pos, hero.vel);
    effects.update(dt);
    const heroOnScreen = camera.worldToScreen(hero.pos);
    for (const event of sim.drain()) {
      tracker.handle(event);
      if (event.type === 'death') this.finishRun(event.cause);
      if (event.type === 'pickup') this.run.pickupsTaken += 1;
      effects.handle(event, heroOnScreen);
    }
    this.view.draw(sim.state, camera, {
      screen: this.screen,
      deathCause: this.run.deathCause,
      effects,
      tuning: this.run.tuning,
      profile: this.profile,
      outcome: this.run.outcome,
    });
  }

  debugState(): DebugState {
    const { state } = this.run.sim;
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
      cause: this.run.deathCause,
      tier: state.tier,
      obstacles: state.obstacles.length,
      pickups: this.run.pickupsTaken,
      level: levelFor(this.profile.xp),
      xp: this.profile.xp,
      equipped: [...this.profile.equipped],
      missions: this.profile.missions.map((mission) => ({ id: mission.id, progress: mission.progress })),
      xpGained: this.run.outcome?.xpGained ?? 0,
      runs: this.profile.runs,
    };
  }

  /**
   * Partie neuve sur une graine, avec les réglages du moment : les talismans
   * équipés depuis la partie précédente comptent. La caméra est replacée d'un
   * coup sur le personnage.
   */
  private newRun(seed: number): Run {
    const tuning = applyTalismans(this.settings.tuning, this.profile.equipped);
    const sim = new Simulation(seed, tuning);
    const camera = new Camera(tuning.heroRadius, this.view.width, this.view.height);
    camera.snap(sim.state.hero.pos, sim.state.hero.vel);
    return { sim, tuning, camera, effects: new Effects(tuning), tracker: new RunTracker(), accumulator: 0, deathCause: null, outcome: null, pickupsTaken: 0 };
  }

  /** Lance une partie neuve et compte l'appui comme l'appui d'accroche. Depuis l'écran titre, la graine annoncée est conservée. */
  private startRun(): void {
    this.run = this.newRun(this.screen === 'dead' ? (this.settings.seed ?? randomSeed()) : this.run.sim.state.course.seed);
    this.screen = 'playing';
    this.run.sim.press();
  }

  private openTalismans(from: 'title' | 'dead'): void {
    this.returnTo = from;
    this.screen = 'talismans';
  }

  /** Sur l'écran des talismans : « Retour » ramène d'où l'on vient, une ligne équipe ou retire. Un appui ailleurs ne fait rien. */
  private pressTalismans(button: ButtonId | null): void {
    if (button === 'back') this.screen = this.returnTo;
    else if (button !== null && button !== 'talismans') this.equip(button);
  }

  /** La mort : le bilan est tiré, ajouté au profil et sauvegardé tout de suite, puis l'écran de fin s'affiche. */
  private finishRun(cause: DeathCause): void {
    const { sim, tracker, tuning } = this.run;
    const outcome = endRun(this.profile, tracker.stats(sim.state, tuning), sim.state.score);
    this.profile = outcome.profile;
    saveProfile(this.storage, this.profile);
    this.run.outcome = outcome;
    this.run.deathCause = cause;
    this.screen = 'dead';
    this.deadSeconds = 0;
  }

  /** Fait avancer la simulation d'autant de pas fixes que le temps reçu en contient. */
  private advance(dtSeconds: number): void {
    const { sim, tuning } = this.run;
    this.run.accumulator += dtSeconds;
    while (this.run.accumulator >= tuning.stepSeconds && sim.state.status === 'alive') {
      sim.step();
      this.run.accumulator -= tuning.stepSeconds;
    }
  }
}

import { levelById, type LevelDef } from '../data/levels';
import { levelFor } from '../meta/levels';
import { createProfile, endLevel, endRun, loadProfile, saveProfile, toggleTalisman, type LevelOutcome, type Profile, type ProfileStorage, type RunOutcome } from '../meta/profile';
import { RunTracker } from '../meta/runTracker';
import { TALISMANS, applyTalismans, type TalismanId } from '../meta/talismans';
import { freeRunStartY, isUnlocked, levelPlan, levelTuning, unlockedLevel, type LevelResult } from '../meta/traversee';
import { levelOfButton, type ButtonId } from '../render/buttons';
import { Camera } from '../render/camera';
import { Effects } from '../render/effects';
import { levelTitle } from '../render/labels';
import type { DeathCause, GameScreen, Renderer } from '../render/renderer';
import type { CoursePlan } from '../sim/course';
import { Simulation } from '../sim/simulation';
import { DEFAULT_TUNING, withTuning, type Tuning } from '../sim/tuning';

/**
 * Le jeu : écrans, boucle à pas fixe et passage des gestes à la simulation.
 *
 * Il relie la simulation (qui ignore le temps réel), la caméra, le rendu et le
 * profil du joueur, qu'il charge au départ et sauvegarde à chaque fin de
 * partie. Il ne dessine rien lui-même.
 *
 * Une partie est un niveau de la traversée, sur sa graine et son plan fixes,
 * ou la course libre, qui monte sans fin depuis la zone la plus haute franchie.
 * L'écran titre montre toujours une course libre toute neuve en arrière-plan : c'est
 * elle qui porte la graine annoncée.
 */

/**
 * Plafond du temps réel pris en compte par image. Après un onglet en
 * sommeil ou un à-coup, la simulation reprend là où elle en était au lieu de
 * rattraper des secondes entières d'un coup.
 */
const MAX_FRAME_SECONDS = 0.1;
/** Après la mort ou la victoire, les appuis sont ignorés ce temps : l'écran de fin doit pouvoir être lu. */
const END_LOCK_SECONDS = 0.6;

/** Ce que le jeu demande au rendu : sa taille, un dessin, et quel bouton se trouve sous un point. */
export type GameView = Pick<Renderer, 'width' | 'height' | 'draw' | 'hitTest'>;

export interface GameSettings {
  /** Graine imposée par `?graine=` à la course libre, ou null pour une graine aléatoire à chaque partie. Un niveau a toujours la sienne. */
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
  /** Hauteur absolue : un niveau la compte depuis le sol, pas depuis son toit de départ. */
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
  /** Niveau de la traversée ou course libre ; sur l'écran titre, la course libre qui attend en arrière-plan. */
  readonly mode: 'level' | 'free';
  readonly levelId: number | null;
  /** Hauteur depuis le toit de départ, et hauteur à atteindre depuis ce toit pour un niveau, sinon null. */
  readonly levelHeight: number;
  readonly goal: number | null;
  /** Niveau le plus avancé jouable. */
  readonly unlockedLevel: number;
  /** Étoiles de la dernière partie de niveau finie, 0 tant qu'elle court et en course libre. */
  readonly stars: number;
  /** Hauteur de départ de la prochaine course libre. */
  readonly freeRunStartY: number;
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
  /** Niveau joué, ou null pour la course libre. */
  readonly level: LevelDef | null;
  /** Réglages de la partie : ceux de l'URL, plus les talismans équipés au départ et, dans un niveau, sa brume. */
  readonly tuning: Tuning;
  readonly camera: Camera;
  /** Animations de temps réel : trait du grappin, textes flottants, bannière de palier ou d'intro. */
  readonly effects: Effects;
  /** Relevé des événements, dont les missions ont besoin à la fin. */
  readonly tracker: RunTracker;
  /** Temps réel reçu mais pas encore converti en pas de simulation, en secondes. */
  accumulator: number;
  /** Cause de la mort, connue à l'événement `death`, ou null tant que le personnage vit. */
  deathCause: DeathCause | null;
  /** Bilan de la partie, connu à sa fin, ou null tant que le personnage vit. Celui d'un niveau est un `LevelOutcome`. */
  outcome: RunOutcome | LevelOutcome | null;
  /** Ce qui a fait les étoiles du niveau fini, ou null en course libre et tant que la partie court. */
  result: LevelResult | null;
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
  /** Temps réel écoulé depuis la fin de la partie, pour le verrou d'entrée des écrans de fin. */
  private endSeconds = 0;

  constructor(view: GameView, settings: GameSettings, storage: ProfileStorage) {
    this.view = view;
    this.settings = settings;
    this.storage = storage;
    this.profile = loadProfile(storage);
    this.run = this.newFreeRun(settings.seed ?? randomSeed());
  }

  /**
   * Le doigt se pose, à la position donnée en pixels CSS si on la connaît. En
   * partie, il lance le grappin. Ailleurs, un bouton agit ; hors bouton, l'appui
   * joue le niveau le plus avancé sur le titre et rejoue sur un écran de fin,
   * en comptant aussi comme l'appui d'accroche. Sur les écrans des niveaux et
   * des talismans, seuls les boutons agissent.
   */
  press(x?: number, y?: number): void {
    if (this.screen === 'playing') {
      this.run.sim.press();
      return;
    }
    // Juste après la fin, un tap réflexe ne doit pas sauter l'écran de fin et ce qu'il annonce.
    if ((this.screen === 'dead' || this.screen === 'won') && this.endSeconds < END_LOCK_SECONDS) return;
    const button = x === undefined || y === undefined ? null : this.view.hitTest(x, y);
    switch (this.screen) {
      case 'title':
        return this.pressTitle(button);
      case 'levels':
        return this.pressLevels(button);
      case 'dead':
        return this.pressDead(button);
      case 'won':
        return this.pressWon(button);
      case 'talismans':
        return this.pressTalismans(button);
    }
  }

  /** Le doigt se lève : le personnage est libéré avec sa vitesse du moment. */
  release(): void {
    if (this.screen === 'playing') this.run.sim.release();
  }

  /**
   * De retour sur l'écran titre, avec le profil relu depuis le stockage et une
   * course libre neuve en arrière-plan. Sans graine, celle de l'URL, sinon une
   * graine neuve.
   */
  restart(seed?: number): void {
    this.profile = loadProfile(this.storage);
    this.run = this.newFreeRun(seed ?? this.settings.seed ?? randomSeed());
    this.screen = 'title';
  }

  /**
   * Joue un niveau tout de suite, depuis n'importe quel écran, sans appui
   * d'accroche. Renvoie faux, sans rien changer, si le niveau n'existe pas ou
   * n'est pas encore débloqué.
   */
  playLevel(id: number): boolean {
    return this.startLevel(id, false);
  }

  /** Joue la course libre tout de suite, depuis n'importe quel écran, sans appui d'accroche. */
  playFree(): void {
    this.begin(this.newFreeRun(this.freeSeed()), false);
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
    if (this.screen === 'dead' || this.screen === 'won') this.endSeconds += dt;
    const { sim, camera, effects, tracker } = this.run;
    if (this.screen === 'playing') this.advance(dt);
    const { hero } = sim.state;
    camera.resize(this.view.width, this.view.height);
    camera.update(dt, hero.pos, hero.vel);
    effects.update(dt);
    const heroOnScreen = camera.worldToScreen(hero.pos);
    for (const event of sim.drain()) {
      tracker.handle(event);
      if (event.type === 'death') this.conclude(event.cause);
      if (event.type === 'finish') this.conclude(null);
      if (event.type === 'pickup') this.run.pickupsTaken += 1;
      // Un niveau porte déjà son nom : pas de bannière de palier.
      if (event.type !== 'tier' || this.run.level === null) effects.handle(event, heroOnScreen);
    }
    this.view.draw(sim.state, camera, {
      screen: this.screen,
      deathCause: this.run.deathCause,
      effects,
      tuning: this.run.tuning,
      profile: this.profile,
      outcome: this.run.outcome,
      result: this.run.result,
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
      mode: this.run.level ? 'level' : 'free',
      levelId: this.run.level?.id ?? null,
      levelHeight: state.height - state.groundY,
      goal: this.run.level ? this.run.level.endY - this.run.level.startY : null,
      unlockedLevel: unlockedLevel(this.profile),
      stars: this.run.outcome && 'level' in this.run.outcome ? this.run.outcome.stars : 0,
      freeRunStartY: freeRunStartY(this.profile),
    };
  }

  /** Course libre neuve sur une graine, depuis la zone la plus haute franchie, avec les talismans équipés. */
  private newFreeRun(seed: number): Run {
    const plan: CoursePlan = { kind: 'infinite', startY: freeRunStartY(this.profile) };
    return this.buildRun(null, seed, applyTalismans(this.settings.tuning, this.profile.equipped), plan);
  }

  /** Niveau neuf : sa graine, son plan, et sa brume par-dessus les talismans équipés. L'URL n'en change pas la graine. */
  private newLevelRun(level: LevelDef): Run {
    return this.buildRun(level, level.seed, levelTuning(level, applyTalismans(this.settings.tuning, this.profile.equipped)), levelPlan(level));
  }

  /** La caméra est placée d'un coup sur le personnage. */
  private buildRun(level: LevelDef | null, seed: number, tuning: Tuning, plan: CoursePlan): Run {
    const sim = new Simulation(seed, tuning, plan);
    const camera = new Camera(tuning.heroRadius, this.view.width, this.view.height);
    camera.snap(sim.state.hero.pos, sim.state.hero.vel);
    return { sim, level, tuning, camera, effects: new Effects(tuning), tracker: new RunTracker(), accumulator: 0, deathCause: null, outcome: null, result: null, pickupsTaken: 0 };
  }

  /**
   * Graine d'une course libre qui démarre : celle que l'écran titre annonce,
   * sinon celle de l'URL ou une graine neuve.
   */
  private freeSeed(): number {
    return this.screen === 'title' ? this.run.sim.state.course.seed : (this.settings.seed ?? randomSeed());
  }

  /** Met la partie en route. `grab` : l'appui qui l'a lancée compte aussi comme l'appui d'accroche. Un niveau s'annonce par sa bannière. */
  private begin(run: Run, grab: boolean): void {
    this.run = run;
    this.screen = 'playing';
    if (run.level) run.effects.intro(levelTitle(run.level), run.level.intro);
    if (grab) run.sim.press();
  }

  /** Lance un niveau, s'il existe et si le profil l'a débloqué. */
  private startLevel(id: number, grab: boolean): boolean {
    const level = levelById(id);
    if (!level || !isUnlocked(this.profile, id)) return false;
    this.begin(this.newLevelRun(level), grab);
    return true;
  }

  /** Rejoue la partie qui vient de finir : le même niveau, ou une course libre neuve. */
  private replay(grab: boolean): void {
    const { level } = this.run;
    if (level) this.startLevel(level.id, grab);
    else this.begin(this.newFreeRun(this.freeSeed()), grab);
  }

  /** Titre : un bouton ouvre un écran ou lance la course libre ; sinon l'appui joue le niveau le plus avancé. */
  private pressTitle(button: ButtonId | null): void {
    if (button === 'talismans') this.openTalismans('title');
    else if (button === 'levels') this.openLevels();
    else if (button === 'free') this.playFree();
    else this.startLevel(unlockedLevel(this.profile), true);
  }

  /** Liste des niveaux : « Retour » ramène au titre, un niveau débloqué se lance. Un niveau verrouillé ne réagit pas, même si le rendu le signalait. */
  private pressLevels(button: ButtonId | null): void {
    const id = levelOfButton(button);
    if (button === 'back') this.screen = 'title';
    else if (id !== null) this.startLevel(id, false);
  }

  /** Fin d'une partie perdue : les boutons ouvrent la liste des niveaux ou les talismans ; sinon l'appui rejoue. */
  private pressDead(button: ButtonId | null): void {
    if (button === 'levels') this.openLevels();
    else if (button === 'talismans') this.openTalismans('dead');
    else this.replay(true);
  }

  /** Victoire : niveau suivant, rejouer ou liste des niveaux ; sinon l'appui relance le même niveau. */
  private pressWon(button: ButtonId | null): void {
    const { level } = this.run;
    if (button === 'next' && level) this.startLevel(level.id + 1, false);
    else if (button === 'replay') this.replay(false);
    else if (button === 'levels') this.openLevels();
    else this.replay(true);
  }

  private openTalismans(from: 'title' | 'dead'): void {
    this.returnTo = from;
    this.screen = 'talismans';
  }

  /** Ouvre la liste des niveaux. Depuis un écran de fin, la partie finie est rendue au titre : « Retour » y retrouve une course libre neuve. */
  private openLevels(): void {
    if (this.screen !== 'title') this.run = this.newFreeRun(this.freeSeed());
    this.screen = 'levels';
  }

  /** Sur l'écran des talismans : « Retour » ramène d'où l'on vient, une ligne équipe ou retire. Un appui ailleurs ne fait rien. */
  private pressTalismans(button: ButtonId | null): void {
    if (button === 'back') this.screen = this.returnTo;
    else {
      const talisman = TALISMANS.find((t) => t.id === button);
      if (talisman) this.equip(talisman.id);
    }
  }

  /**
   * La fin de la partie : la mort (`cause`), ou null si le niveau est gagné. Le
   * bilan est tiré, ajouté au profil et sauvegardé tout de suite, puis l'écran
   * de fin ou de victoire s'affiche.
   */
  private conclude(cause: DeathCause | null): void {
    const { sim, tracker, tuning, level } = this.run;
    const stats = tracker.stats(sim.state, tuning);
    let outcome: RunOutcome | LevelOutcome;
    if (level) {
      this.run.result = { won: cause === null, pickupsTaken: stats.pickups, pickupsTotal: sim.state.course.pickupsTotal, perfectStreak: stats.perfectStreak };
      outcome = endLevel(this.profile, level, stats, sim.state.score, this.run.result);
    } else {
      outcome = endRun(this.profile, stats, sim.state.score);
    }
    this.profile = outcome.profile;
    saveProfile(this.storage, this.profile);
    this.run.outcome = outcome;
    this.run.deathCause = cause;
    this.screen = cause === null ? 'won' : 'dead';
    this.endSeconds = 0;
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

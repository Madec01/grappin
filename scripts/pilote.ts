import type { Page } from '@playwright/test';
import type { DebugAnchor } from '../src/app/game';
import type { Vec2 } from '../src/core/math/vec2';
import type { SceneId } from '../src/data/scenes';
import { bestAnchor } from '../src/sim/aim';
import { grabbable } from '../src/sim/cycles';
import { upOf, type Environment } from '../src/sim/environment';
import { flightStep, startFlight } from '../src/sim/flight';
import { railPull } from '../src/sim/holds';
import { launchSet, launchVelocity, pulledPosition } from '../src/sim/launcher';
import { isMoving, obstacleGap } from '../src/sim/moving';
import { provableObstacles, solidObstacles } from '../src/sim/obstacles';
import { EDGE_AHEAD_SECONDS, EDGE_MARGIN, EDGE_SOON_SECONDS, ELASTIC_CATCH_SPEED, ELASTIC_HOLD_MAX_SECONDS, LAUNCH_AIM_SECONDS, LAUNCH_WAIT_MAX_SECONDS, LOOK_AHEAD_SECONDS, MAGNET_HOLD_MAX_SECONDS, RELEASE_EVERY, WHEEL_READY_RATIO, launchIsClear } from '../src/sim/robot';
import { WORLD_HALF_WIDTH, releaseVelocity } from '../src/sim/rules';
import { Simulation } from '../src/sim/simulation';
import type { Anchor, Obstacle, SimState } from '../src/sim/state';
import { DEFAULT_TUNING } from '../src/sim/tuning';
import { flightCatches, swingIsClear } from '../src/sim/verifier';

/**
 * Le pilote image par image des scènes, pour les tests de bout en bout
 * (`e2e/smoke.spec.ts`) et le banc de captures (`scripts/capture.ts`) : une page
 * à l'horloge figée (`page.clock`) que le test mène à la main, et dont le pilote
 * décide côté Node, une image après l'autre. Il applique les règles du robot
 * (`src/sim/robot.ts`), pour ne pas jouer plus bêtement que lui :
 *  - il accroche dès qu'un point est visé, mais pas un point sous lui quand il
 *    monte vite (un courant, une fusée, un lancer) ; après un lancer (lanceur,
 *    roue) il ne rattrape rien sous le point lâché pendant une seconde et demie,
 *    et après un lâcher ordinaire rien sous le point lâché tant qu'il monte
 *    encore (sauf s'il file vers le bord du monde) : sans cela, il fait du
 *    surplace entre des prises voisines au lieu de viser plus haut. « Plus
 *    haut » et « monter » s'entendent à l'opposé de la gravité du moment, que
 *    le serpentin et la bascule inclinent ;
 *  - il n'attrape pas un point si le balancement qui suivrait heurte un mur
 *    (`swingIsClear`, sur le monde de la scène rejoué en Node, ses prises remises
 *    là où la page les a : un câble, une bande d'accordéon glisse) ;
 *  - sur un lanceur, il laisse le temps de bander la fronde (0,35 s), puis tire
 *    la traction que le vérificateur a prouvée (`launchAim`) ; sous un mur dont
 *    le trou va et vient (`glissiere`), il attend, une image après l'autre, que
 *    le tir passe sans heurter ce qui bouge (`launchIsClear`, regardé au pas de
 *    la page), jusqu'à six secondes ;
 *  - il veut lâcher dans la fenêtre du lâcher parfait, ou dès qu'il va assez vite
 *    en montant à 30° à 60°, ou après 2,5 s tenu ; mais il ne lâche que si le vol
 *    qui suivrait ne heurte rien en une demi-seconde, ne sort pas du monde en
 *    une seconde et demie, et attrape une prise plus haute (`flightCatches`,
 *    comme le vérificateur), regardé un pas sur quatre ; pendu depuis plus de
 *    cinq secondes, il lâche quoi qu'il arrive. Sur une roue motorisée, il
 *    attend aussi que le moteur ait pris 95 % de sa vitesse (le tour fait, c'est
 *    là que la roue porte), et il la tient aussi longtemps qu'il le faut pour
 *    cela ;
 *  - sur un rail, comme sur un lanceur : il laisse le temps de bander la fronde,
 *    puis lâche à la position de l'arc que le vérificateur a prouvée
 *    (`launchAim`, ou le milieu sans tir prouvé), après avoir attendu, comme au
 *    lanceur, que ce qui bouge laisse passer le tir ;
 *  - sur un aimant ou un lien élastique, il ne lâche que lorsqu'il monte et que
 *    le vol qui suivrait attrape une prise au-dessus de celle qu'il tient
 *    (regardé un pas sur quatre), jamais plus de quatre secondes à l'aimant, sept
 *    au lien ; après un aimant, comme après un lanceur, il ne rattrape rien plus
 *    bas pendant une seconde et demie. Il laisse un lien élastique qu'il
 *    atteindrait à moins de 6 m/s, s'il a une autre prise à portée du grappin.
 */

/** L'état que le jeu rend à `state()`. */
export type Seen = ReturnType<NonNullable<Window['__grappin']>['state']>;

/** Après un lâcher, le robot ne rattrape rien sous le point lâché pendant ce temps (ms), sauf un point plus d'un mètre au-dessus de lui. */
const LAUNCH_WAIT_MS = 1500;
/** « Plus haut que le point lâché » : de plus de cette distance (m), mesurée à l'opposé de la gravité. */
const ABOVE_RELEASE = 1;
const LAUNCH_AIM_MS = LAUNCH_AIM_SECONDS * 1000;
/** Le pilote qui monte à plus de cette vitesse (m/s) ignore un point visé plus bas que lui de cette distance (m) : il attend la suite, comme le robot. */
const RISING_SPEED = 1;
const RISING_BELOW = 0.5;
/** Jamais plus longtemps pendu, en millisecondes ; à une roue, le moteur a besoin de son tour pour prendre sa vitesse (voir `WHEEL_MAX_HOLD_MS`). */
const MAX_HOLD_MS = 2500;
const WHEEL_MAX_HOLD_MS = 6000;
/** Pendu depuis plus de deux fois la tenue maximale, il lâche sans regarder où mène le vol. */
const OVERHELD_MS = 2 * MAX_HOLD_MS;
/** Sous un mur à ouverture mobile, jamais plus longtemps à attendre que le trou passe, en millisecondes : la borne du robot. */
const LAUNCH_WAIT_MAX_MS = LAUNCH_WAIT_MAX_SECONDS * 1000;
/** Sur un aimant ou un lien élastique, jamais plus longtemps tenu (millisecondes) : les bornes du robot. */
const MAGNET_MAX_HOLD_MS = MAGNET_HOLD_MAX_SECONDS * 1000;
const ELASTIC_MAX_HOLD_MS = ELASTIC_HOLD_MAX_SECONDS * 1000;
/** Sans tir prouvé, le rail lance depuis le milieu de son arc. */
const RAIL_MIDDLE = 0.5;
/** La traction du tir quand le vérificateur n'en prouve aucune. */
const DEFAULT_PULL: Vec2 = { x: 0, y: -1.75 };
/** Un vol libre de pure physique (sans rattrapage) : la durée simulée d'un tir qu'on essaie, en secondes. */
const SHOT_SECONDS = 3.5;
/** La traction du tir mou, en mètres de monde : un peu plus de la moitié de la traction maximale (2,5), soit 12,1 m/s au départ. */
const SOFT_PULL: Vec2 = { x: 0, y: -1.7 };

/**
 * Ce que le pilote retient d'une image à l'autre. `holdSince` : l'instant (ms simulées) de la dernière accroche, et `heldId` le point visé à
 * ce moment-là (celui qu'il tient). `launchedAt` : l'instant du dernier tir d'un lanceur (0 ou moins, avant le premier). `releasedAt`,
 * `releasedPos` et `launched` : l'instant et le point du dernier lâcher, quel qu'il soit, et s'il s'agissait d'un lancer (lanceur, roue ou aimant).
 * `visited` : les numéros des prises qu'il a tenues.
 */
export interface PilotMemory {
  holdSince: number;
  heldId: number | null;
  readonly visited: Set<number>;
  launchedAt: number;
  releasedAt: number;
  releasedPos: Vec2 | null;
  launched: boolean;
}

export function newMemory(): PilotMemory {
  return { holdSince: 0, heldId: null, visited: new Set(), launchedAt: -1e9, releasedAt: -1e9, releasedPos: null, launched: false };
}

export interface PilotOptions {
  /** Le monde de la scène, rejoué en Node (voir `sceneWorld`) : sans lui, le pilote ne regarde pas où le mène un balancement. */
  readonly world?: SimState;
  /**
   * La traction du tir depuis le lanceur : `prouvee` (celle du vérificateur, `launchAim`), `anneau` (une traction qui passe par un anneau
   * avant d'attraper la suite, voir `ringShot`), ou `mou` (un tir à moitié de puissance, droit vers le haut : il ne perce pas une paroi).
   */
  readonly shot?: 'prouvee' | 'anneau' | 'mou';
  /**
   * Le numéro d'une prise que le pilote veut tenir une fois, que le robot ignorerait : l'interrupteur, dont le verrou ne gêne pas la chaîne. Tant qu'il ne l'a
   * pas tenue, et pendu à une prise dont elle est à portée du grappin, il ne lâche que lorsque la visée qui suivrait le lâcher est cette prise (la visée du jeu,
   * `bestAnchor`, rejouée en Node) : il ne la manque pas, et s'il tarde trop il lâche comme à l'ordinaire.
   */
  readonly hold?: number;
  /**
   * Tant que ceci est vrai sur l'état vu, le pilote ne lâche pas la prise qu'il tient (le lanceur et le rail, que `launchNotBefore` retient, mis à part) :
   * de quoi montrer un aimant qui attire, un lien élastique étiré, ou une prise interrupteur tenue, le temps d'une capture.
   */
  readonly keep?: (s: Seen, memory: PilotMemory) => boolean;
  /** Le pilote ne tire pas avant cet instant (ms simulées) : il attend au lanceur, par exemple que la bannière d'intro s'efface avant une prise en vol. */
  readonly launchNotBefore?: number;
  /** Tant que ceci est vrai sur l'état vu (et la mémoire du pilote : `launchedAt` dit s'il a déjà tiré), il n'attrape rien : il attend, par exemple, d'avoir traversé l'anneau. */
  readonly wait?: (s: Seen, memory: PilotMemory) => boolean;
}

/** Le monde d'une scène tel que le jeu le construit, rejoué en Node : points, obstacles, anneaux et zones sont ceux de la page (la scène est déterministe). */
export function sceneWorld(sceneId: SceneId, seed: number): SimState {
  return new Simulation(seed, DEFAULT_TUNING, { kind: 'scene', sceneId, startY: 0 }).state;
}

/**
 * Une traction qui lance le personnage à travers un anneau, puis lui laisse un
 * point à attraper : parmi les tractions du vérificateur, la première dont le vol
 * traverse l'anneau au centre, sinon la première qui le traverse. Le vérificateur
 * ne l'exige pas (un autre tir peut attraper la sortie sans l'anneau) : ici on
 * veut voir l'anneau traversé. Null sans lanceur, sans anneau ou sans tir qui passe.
 */
export function ringShot(world: SimState): Vec2 | null {
  const launcher = world.anchors.find((a) => a.kind === 'lanceur');
  const ring = world.rings[0];
  if (!launcher || !ring) return null;
  const tuning = DEFAULT_TUNING;
  const obstacles = provableObstacles(world.obstacles);
  const candidates = world.anchors.filter((a) => a.id !== launcher.id && !a.broken && a.pos.y > launcher.pos.y + 1);
  let crossing: Vec2 | null = null;
  for (const pull of launchSet(world.env)) {
    const pos = pulledPosition(launcher.pos, pull);
    const vel = launchVelocity(pull, world.env);
    const flight = startFlight({ pos, vel });
    let nearest = Infinity;
    for (let k = 0, steps = Math.round(SHOT_SECONDS / tuning.stepSeconds); k < steps && !flight.ended; k += 1) {
      flightStep(flight, obstacles, world.rings, world.zones, tuning, world.env);
      nearest = Math.min(nearest, Math.hypot(flight.body.pos.x - ring.pos.x, flight.body.pos.y - ring.pos.y));
    }
    if (!flight.rings.has(ring.id) || flightCatches(launcher, { pos, vel }, candidates, obstacles, tuning, world.env, world.zones, world.rings).length === 0) continue;
    if (nearest <= ring.radius * 0.4) return pull;
    crossing ??= pull;
  }
  return crossing;
}

/** Le monde de la scène tel qu'il est au pas de la page, le lanceur `launcherId` tenu : de quoi demander à `launchIsClear` si un tir passe là où les obstacles mobiles seront (leur géométrie ne dépend que du pas). */
function heldWorld(world: SimState, step: number, launcherId: number): SimState {
  return { ...world, step, rope: { anchorId: launcherId, length: 0 } };
}

/** Les prises telles que la page les a en ce moment : celles du monde rejoué (leurs câbles, leur moteur), remises là où la page les montre (un câble, une bande d'accordéon glisse), et celles que le monde rejoué ne connaît pas encore. */
function liveAnchors(world: SimState, live: readonly DebugAnchor[]): Anchor[] {
  return live.map((spot) => {
    const pos = { x: spot.x, y: spot.y };
    const known = world.anchors.find((a) => a.id === spot.id);
    return known ? { ...known, pos } : { id: spot.id, pos, kind: spot.kind, broken: false };
  });
}

/** Les conditions physiques du moment, telles que la page les dit : la gravité (que le serpentin et la bascule inclinent) et le vent. */
function liveEnv(s: Seen): Environment {
  return { gravityDir: { x: s.gravityX, y: s.gravityY }, wind: { x: s.windX, y: 0 } };
}

/**
 * Les obstacles du monde rejoué qui tiennent encore : les parois déjà cassées dans la page ne le sont pas dans le monde rejoué, une paroi cassable
 * cassée ne gêne plus ; et les panneaux d'un passage qui se referme sont déclenchés comme dans la page (leur place à chaque pas en dépend).
 */
function standingObstacles(world: SimState, s: Seen): Obstacle[] {
  return world.obstacles
    .filter((box) => !(s.smashed > 0 && box.kind === 'cassable'))
    .map((box) => {
      const trigger = s.triggered.find((t) => t.obstacleId === box.id);
      return trigger ? { ...box, triggeredStep: trigger.step } : box;
    });
}

/** Vrai si s'accrocher à `targetId` d'ici ne mène pas dans un mur (le balancement qui suit, joué comme le robot le regarde). Sans monde rejoué, on ne regarde pas. */
function swingIsSafe(world: SimState | undefined, s: Seen, live: readonly DebugAnchor[], targetId: number): boolean {
  if (!world) return true;
  const anchors = liveAnchors(world, live);
  const anchor = anchors.find((a) => a.id === targetId);
  if (!anchor) return true;
  return swingIsClear(anchor, { pos: s.pos, vel: s.vel }, anchors, provableObstacles(standingObstacles(world, s)), DEFAULT_TUNING, liveEnv(s), world.zones);
}

/** La vitesse du lâcher maintenant : celle de la règle du lâcher (`releaseVelocity`), propulseur et lanceur compris. */
function releasedVelocity(s: Seen, anchors: Anchor[], held: Anchor | undefined): Vec2 {
  return releaseVelocity({ hero: { pos: s.pos, vel: s.vel, grounded: false }, rope: held ? { anchorId: held.id, length: s.ropeLength ?? 0 } : null, anchors }, DEFAULT_TUNING);
}

/** Le point que le jeu viserait juste après un lâcher maintenant (`bestAnchor`, rejoué en Node, le point lâché écarté), ou null. */
function nextTarget(world: SimState, s: Seen, live: readonly DebugAnchor[], heldId: number | null): number | null {
  const anchors = liveAnchors(world, live);
  const held = anchors.find((a) => a.id === heldId);
  const sight = solidObstacles({ obstacles: standingObstacles(world, s), step: s.step, doorsInside: [] }, DEFAULT_TUNING);
  const candidates = anchors.filter((a) => grabbable(a, s.step, DEFAULT_TUNING));
  return bestAnchor(candidates, sight, { pos: s.pos, vel: releasedVelocity(s, anchors, held) }, false, heldId, DEFAULT_TUNING, liveEnv(s), world.zones)?.id ?? null;
}

/**
 * Vrai si lâcher maintenant est un bon lâcher, comme le robot l'entend : le vol qui suivrait ne heurte rien pendant `LOOK_AHEAD_SECONDS`
 * (rebonds, fracas et anneaux joués ; ce qui bouge regardé là où il sera), ne sort pas du monde pendant `EDGE_AHEAD_SECONDS`, et attrape une
 * prise plus haute que celle qu'on lâche (`flightCatches`, ce que le vérificateur regarde). Une roue n'a pas ce dernier contrôle : sa
 * sortie est prouvée à part.
 */
function releaseIsGood(world: SimState, s: Seen, live: readonly DebugAnchor[], heldId: number | null): boolean {
  const tuning = DEFAULT_TUNING;
  const env = liveEnv(s);
  const anchors = liveAnchors(world, live);
  const held = anchors.find((a) => a.id === heldId);
  const vel = releasedVelocity(s, anchors, held);
  const standing = standingObstacles(world, s);
  const obstacles = provableObstacles(standing);
  const moving = standing.filter((box) => !box.broken && isMoving(box));
  const flight = startFlight({ pos: s.pos, vel });
  for (let k = 0, steps = Math.round(LOOK_AHEAD_SECONDS / tuning.stepSeconds); k < steps; k += 1) {
    flightStep(flight, obstacles, world.rings, world.zones, tuning, env);
    if (flight.ended || moving.some((box) => obstacleGap(flight.body.pos, tuning.heroRadius, box, s.step + k + 1, tuning) <= 0)) return false;
  }
  // Un vol qui file vers le bord du monde : on garde la corde.
  if (!(Math.abs(s.pos.x + vel.x * EDGE_AHEAD_SECONDS) < WORLD_HALF_WIDTH - EDGE_MARGIN)) return false;
  return s.heldKind === 'roue' || held === undefined || flightCatches(held, { pos: s.pos, vel }, anchors, standing, tuning, env, world.zones, world.rings).length > 0;
}

/**
 * Vrai si le vol qui suivrait un lâcher maintenant, à la vitesse du moment, attrape une prise plus haute que celle qu'on tient (`heldId`) : ce que le
 * vérificateur a prouvé de l'aimant et du lien élastique, et ce que le robot regarde pour les lâcher.
 */
function catchesAbove(world: SimState, s: Seen, live: readonly DebugAnchor[], heldId: number | null): boolean {
  const anchors = liveAnchors(world, live);
  const held = anchors.find((a) => a.id === heldId);
  if (!held) return false;
  const caught = flightCatches(held, { pos: s.pos, vel: s.vel }, anchors, standingObstacles(world, s), DEFAULT_TUNING, liveEnv(s), world.zones, world.rings);
  return caught.some((id) => (anchors.find((a) => a.id === id)?.pos.y ?? -Infinity) > held.pos.y + ABOVE_RELEASE);
}

/** La prise que le pilote veut tenir (`hold`), si elle est à portée du grappin de celle qu'il tient en ce moment ; sinon null. */
async function seekedAnchor(page: Page, memory: PilotMemory, hold: number): Promise<DebugAnchor | null> {
  const live = await page.evaluate(() => window.__grappin!.anchors());
  const wanted = live.find((a) => a.id === hold);
  const held = live.find((a) => a.id === memory.heldId);
  return wanted && held && Math.hypot(wanted.x - held.x, wanted.y - held.y) <= DEFAULT_TUNING.ropeMax ? wanted : null;
}

/**
 * Une image du pilote : lit l'état, agit (accroche, tir, lâcher) et rend l'état
 * vu avant l'action. `nowMs` est le temps simulé écoulé, en millisecondes.
 */
export async function pilotFrame(page: Page, memory: PilotMemory, nowMs: number, options: PilotOptions = {}): Promise<Seen> {
  const s = await page.evaluate(() => window.__grappin!.state());
  if (!s.attached && s.targetId !== null) {
    const live = await page.evaluate(() => window.__grappin!.anchors());
    const target = live.find((a) => a.id === s.targetId);
    // Après un lancer (lanceur, roue) on ne rattrape rien sous le point lâché pendant un moment, même en retombant : on monte. Après un lâcher
    // ordinaire, rien sous le point lâché tant qu'on monte encore, sauf si l'on file vers le bord du monde : en retombant, on attrape ce qui vient.
    const up = upOf(liveEnv(s));
    const rise = (from: Vec2, to: Vec2): number => (to.x - from.x) * up.x + (to.y - from.y) * up.y;
    const recently = nowMs - memory.releasedAt <= LAUNCH_WAIT_MS;
    const aboveRelease = target !== undefined && memory.releasedPos !== null && rise(memory.releasedPos, { x: target.x, y: target.y }) > ABOVE_RELEASE;
    const risingStill = rise({ x: 0, y: 0 }, s.vel) > 0;
    const edgeSoon = Math.abs(s.pos.x + s.vel.x * EDGE_SOON_SECONDS) > WORLD_HALF_WIDTH - EDGE_MARGIN;
    // Sans le monde rejoué, le pilote lâche à l'ancienne, sans savoir si le vol attrape plus haut : il attrape alors tout ce qui vient,
    // sinon il filerait hors du monde en refusant les prises plus basses.
    const climbing = memory.launched ? !recently || aboveRelease : !(options.world !== undefined && recently && !aboveRelease && risingStill && !edgeSoon);
    // Porté vers le haut, on ne rattrape pas un point sous soi : on monte d'abord, comme un joueur.
    const rising = s.vel.y > RISING_SPEED && target !== undefined && target.y < s.pos.y - RISING_BELOW;
    // Un lien élastique ne vaut que pris vite (sa puissance vient du mouvement d'arrivée) : trop lentement, on le laisse s'il y a autre chose à portée.
    const others = target ? live.filter((a) => a.id !== target.id && Math.hypot(a.x - s.pos.x, a.y - s.pos.y) <= DEFAULT_TUNING.ropeMax).length : 0;
    const slowForElastic = target?.kind === 'elastique' && others > 0 && Math.hypot(s.vel.x, s.vel.y) < ELASTIC_CATCH_SPEED;
    if (target && climbing && !rising && !slowForElastic && !options.wait?.(s, memory) && swingIsSafe(options.world, s, live, target.id)) {
      await page.evaluate(() => window.__grappin!.press());
      memory.holdSince = nowMs;
      memory.heldId = target.id;
      memory.visited.add(target.id);
    }
  } else if (s.attached && (s.heldKind === 'lanceur' || s.heldKind === 'rail')) {
    if (nowMs - memory.holdSince > LAUNCH_AIM_MS && nowMs >= (options.launchNotBefore ?? 0)) {
      // Sur un rail, la position de l'arc que le vérificateur a prouvée (`launchAim`), sinon le milieu ; les tirs d'essai (`shot`) sont ceux d'un lanceur.
      const onRail = s.heldKind === 'rail';
      const proved = await page.evaluate(() => window.__grappin!.launchAim());
      const aim = onRail ? proved : options.shot === 'mou' ? SOFT_PULL : (options.shot === 'anneau' && options.world ? ringShot(options.world) : null) ?? proved;
      const launcher = (await page.evaluate(() => window.__grappin!.anchors())).find((a) => a.id === memory.heldId || a.kind === s.heldKind);
      const pull = aim ?? (onRail ? railPull(RAIL_MIDDLE) : DEFAULT_PULL);
      // Sous un mur dont le trou va et vient : tant que le tir heurterait ce qui bouge, on attend une image de plus (jamais plus de six secondes
      // une fois le tir permis, pour que la brume ne rattrape pas le pilote).
      const readyAt = Math.max(memory.holdSince + LAUNCH_AIM_MS, options.launchNotBefore ?? 0);
      if (options.world && launcher && nowMs - readyAt < LAUNCH_WAIT_MAX_MS && !launchIsClear(heldWorld(options.world, s.step, launcher.id), pull, DEFAULT_TUNING)) return s;
      await page.evaluate((p) => window.__grappin!.release(p.x, p.y), pull);
      memory.launchedAt = nowMs;
      memory.releasedAt = nowMs;
      memory.releasedPos = launcher ? { x: launcher.x, y: launcher.y } : { ...s.pos };
      memory.launched = true;
    }
  } else if (s.attached && nowMs - memory.holdSince > 80 && !options.keep?.(s, memory)) {
    const speed = Math.hypot(s.vel.x, s.vel.y);
    // Sur une roue, ni treuil ni fenêtre de lâcher parfait qui vaille : il faut la vitesse du moteur, et on la tient le temps qu'il l'atteigne.
    const onWheel = s.heldKind === 'roue';
    // Sur un aimant ou un lien élastique, ni treuil ni fenêtre non plus : on lâche en montant, quand le vol attrape plus haut.
    const onMagnet = s.heldKind === 'aimant';
    const onElastic = s.heldKind === 'elastique';
    const ready = onWheel ? speed >= DEFAULT_TUNING.wheelSpeed * WHEEL_READY_RATIO : speed >= 8 || (s.ropeLength !== null && s.ropeLength <= 1.5 + 1e-9);
    const slope = s.vel.x !== 0 ? s.vel.y / Math.abs(s.vel.x) : Infinity;
    const maxHold = onWheel ? WHEEL_MAX_HOLD_MS : onMagnet ? MAGNET_MAX_HOLD_MS : onElastic ? ELASTIC_MAX_HOLD_MS : MAX_HOLD_MS;
    const lingered = nowMs - memory.holdSince > maxHold;
    let live: DebugAnchor[] | null = null;
    let wants: boolean;
    // Une prise que le robot ignorerait, à tenir une fois (`hold`) : tant qu'elle est à portée de celle qu'on tient, on ne lâche que vers elle.
    const seeking = options.hold !== undefined && !memory.visited.has(options.hold) ? await seekedAnchor(page, memory, options.hold) : null;
    if (seeking !== null && options.world) {
      wants = lingered;
      if (!wants && s.step % RELEASE_EVERY === 0) {
        live = await page.evaluate(() => window.__grappin!.anchors());
        wants = nextTarget(options.world, s, live, memory.heldId) === seeking.id;
      }
    } else if (onMagnet || onElastic) {
      // Le vol se regarde un pas sur quatre, et seulement en montant (à l'opposé de la gravité du moment) ; sans monde rejoué, on ne regarde pas.
      wants = lingered;
      const up = upOf(liveEnv(s));
      if (!wants && options.world && s.step % RELEASE_EVERY === 0 && s.vel.x * up.x + s.vel.y * up.y > 0) {
        live = await page.evaluate(() => window.__grappin!.anchors());
        wants = catchesAbove(options.world, s, live, memory.heldId);
      }
    } else {
      wants = (!onWheel && s.releaseWindow) || (ready && s.vel.y > 1 && slope > 0.6 && slope < 1.8) || lingered;
    }
    if (wants) {
      live ??= await page.evaluate(() => window.__grappin!.anchors());
      // Le vol qui suivrait se regarde un pas sur quatre ; sans monde rejoué, on ne regarde pas. Pendu depuis trop longtemps, on lâche quoi qu'il arrive.
      const good = !options.world || (s.step % RELEASE_EVERY === 0 && releaseIsGood(options.world, s, live, memory.heldId));
      if (good || nowMs - memory.holdSince > OVERHELD_MS) {
        await page.evaluate(() => window.__grappin!.release());
        // Lancé par une roue ou un aimant, comme par un lanceur, ou simplement lâché : on ne rattrape rien sous le point pendant un moment, on monte.
        const held = live.find((a) => a.id === memory.heldId);
        memory.releasedAt = nowMs;
        memory.releasedPos = held ? { x: held.x, y: held.y } : null;
        memory.launched = onWheel || onMagnet;
      }
    }
  }
  return s;
}

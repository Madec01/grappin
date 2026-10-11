import type { Page } from '@playwright/test';
import type { Vec2 } from '../src/core/math/vec2';
import type { SceneId } from '../src/data/scenes';
import { flightStep, startFlight } from '../src/sim/flight';
import { launchSet, launchVelocity, pulledPosition } from '../src/sim/launcher';
import { provableObstacles } from '../src/sim/obstacles';
import { LAUNCH_AIM_SECONDS } from '../src/sim/robot';
import { Simulation } from '../src/sim/simulation';
import type { SimState } from '../src/sim/state';
import { DEFAULT_TUNING } from '../src/sim/tuning';
import { flightCatches, swingIsClear } from '../src/sim/verifier';

/**
 * Le pilote image par image des scènes, pour les tests de bout en bout
 * (`e2e/smoke.spec.ts`) et le banc de captures (`scripts/capture.ts`) : une page
 * à l'horloge figée (`page.clock`) que le test mène à la main, et dont le pilote
 * décide côté Node, une image après l'autre. Il applique les règles du robot
 * (`src/sim/robot.ts`), pour ne pas jouer plus bêtement que lui :
 *  - il accroche dès qu'un point est visé, mais pas un point sous lui quand il
 *    monte vite (un courant, une fusée, un lancer), et pas un point que le
 *    lanceur vient de laisser sous lui ;
 *  - il n'attrape pas un point si le balancement qui suivrait heurte un mur
 *    (`swingIsClear`, sur le monde de la scène rejoué en Node) ;
 *  - sur un lanceur, il laisse le temps de bander la fronde (0,35 s), puis tire
 *    la traction que le vérificateur a prouvée (`launchAim`) ;
 *  - il lâche dans la fenêtre du lâcher parfait, ou dès qu'il va assez vite en
 *    montant à 30° à 60°, jamais plus de 2,5 s tenu.
 */

/** L'état que le jeu rend à `state()`. */
export type Seen = ReturnType<NonNullable<Window['__grappin']>['state']>;

/** Après un lancer, le robot ne rattrape rien sous le lanceur pendant ce temps (ms), sauf un point plus d'un mètre au-dessus de lui. */
const LAUNCH_WAIT_MS = 1500;
const LAUNCH_AIM_MS = LAUNCH_AIM_SECONDS * 1000;
/** Le pilote qui monte à plus de cette vitesse (m/s) ignore un point visé plus bas que lui de cette distance (m) : il attend la suite, comme le robot. */
const RISING_SPEED = 1;
const RISING_BELOW = 0.5;
/** Jamais plus longtemps pendu, en millisecondes. */
const MAX_HOLD_MS = 2500;
/** Un vol libre de pure physique (sans rattrapage) : la durée simulée d'un tir qu'on essaie, en secondes. */
const SHOT_SECONDS = 3.5;
/** La traction du tir mou, en mètres de monde : un peu plus de la moitié de la traction maximale (2,5), soit 12,1 m/s au départ. */
const SOFT_PULL: Vec2 = { x: 0, y: -1.7 };

/** Ce que le pilote retient d'une image à l'autre. `holdSince` : l'instant (ms simulées) de la dernière accroche ; `launchedAt` et `launchedY` : l'instant et la hauteur du lanceur du dernier tir. */
export interface PilotMemory {
  holdSince: number;
  launchedAt: number;
  launchedY: number;
}

export function newMemory(): PilotMemory {
  return { holdSince: 0, launchedAt: -1e9, launchedY: -Infinity };
}

export interface PilotOptions {
  /** Le monde de la scène, rejoué en Node (voir `sceneWorld`) : sans lui, le pilote ne regarde pas où le mène un balancement. */
  readonly world?: SimState;
  /**
   * La traction du tir depuis le lanceur : `prouvee` (celle du vérificateur, `launchAim`), `anneau` (une traction qui passe par un anneau
   * avant d'attraper la suite, voir `ringShot`), ou `mou` (un tir à moitié de puissance, droit vers le haut : il ne perce pas une paroi).
   */
  readonly shot?: 'prouvee' | 'anneau' | 'mou';
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

/** Vrai si s'accrocher à `targetId` d'ici ne mène pas dans un mur (le balancement qui suit, joué comme le robot le regarde). Sans monde rejoué, on ne regarde pas. */
function swingIsSafe(world: SimState | undefined, s: Seen, targetId: number): boolean {
  if (!world) return true;
  const anchor = world.anchors.find((a) => a.id === targetId);
  if (!anchor) return true;
  // Les parois déjà cassées dans la page ne le sont pas dans le monde rejoué : une paroi cassable cassée ne gêne plus.
  const standing = world.obstacles.filter((box) => !(s.smashed > 0 && box.kind === 'cassable'));
  return swingIsClear(anchor, { pos: s.pos, vel: s.vel }, world.anchors, provableObstacles(standing), DEFAULT_TUNING, world.env, world.zones);
}

/**
 * Une image du pilote : lit l'état, agit (accroche, tir, lâcher) et rend l'état
 * vu avant l'action. `nowMs` est le temps simulé écoulé, en millisecondes.
 */
export async function pilotFrame(page: Page, memory: PilotMemory, nowMs: number, options: PilotOptions = {}): Promise<Seen> {
  const s = await page.evaluate(() => window.__grappin!.state());
  if (!s.attached && s.targetId !== null) {
    const target = (await page.evaluate(() => window.__grappin!.anchors())).find((a) => a.id === s.targetId);
    // Après un lancer, on ne rattrape rien sous le lanceur pendant un moment : on monte.
    const climbing = nowMs - memory.launchedAt > LAUNCH_WAIT_MS || (target !== undefined && target.y > memory.launchedY + 1);
    // Porté vers le haut, on ne rattrape pas un point sous soi : on monte d'abord, comme un joueur.
    const rising = s.vel.y > RISING_SPEED && target !== undefined && target.y < s.pos.y - RISING_BELOW;
    if (target && climbing && !rising && !options.wait?.(s, memory) && swingIsSafe(options.world, s, target.id)) {
      await page.evaluate(() => window.__grappin!.press());
      memory.holdSince = nowMs;
    }
  } else if (s.attached && s.heldKind === 'lanceur') {
    if (nowMs - memory.holdSince > LAUNCH_AIM_MS && nowMs >= (options.launchNotBefore ?? 0)) {
      const aim = options.shot === 'mou' ? SOFT_PULL : (options.shot === 'anneau' && options.world ? ringShot(options.world) : null) ?? (await page.evaluate(() => window.__grappin!.launchAim()));
      const launcher = (await page.evaluate(() => window.__grappin!.anchors())).find((a) => a.kind === 'lanceur');
      if (aim) await page.evaluate((pull) => window.__grappin!.release(pull.x, pull.y), aim);
      else await page.evaluate(() => window.__grappin!.release(0, -1.75));
      memory.launchedAt = nowMs;
      memory.launchedY = launcher?.y ?? s.pos.y;
    }
  } else if (s.attached && nowMs - memory.holdSince > 80) {
    const ready = Math.hypot(s.vel.x, s.vel.y) >= 8 || (s.ropeLength !== null && s.ropeLength <= 1.5 + 1e-9);
    const slope = s.vel.x !== 0 ? s.vel.y / Math.abs(s.vel.x) : Infinity;
    if (s.releaseWindow || (ready && s.vel.y > 1 && slope > 0.6 && slope < 1.8) || nowMs - memory.holdSince > MAX_HOLD_MS) await page.evaluate(() => window.__grappin!.release());
  }
  return s;
}

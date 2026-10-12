import { expect, test, type Page } from '@playwright/test';
import { LEVELS, levelById } from '../src/data/levels';
import { doorState, type DoorState } from '../src/sim/cycles';
import { Simulation } from '../src/sim/simulation';
import { DEFAULT_TUNING } from '../src/sim/tuning';
import { newMemory, pilotFrame, sceneWorld } from '../scripts/pilote';

/**
 * Test de fumée sur écran de téléphone (390 × 844, tactile) : la page charge,
 * un doigt posé accroche le grappin, le relâcher libère le personnage, la
 * graine d'URL est respectée, un pilote automatique grimpe sans erreur, la
 * progression (expérience, sauvegarde, talismans, boutons, niveaux et étoiles)
 * tient d'une partie et d'un rechargement à l'autre, la bascule du niveau 5
 * se joue sans erreur, la liste des niveaux se tourne en deux pages, le
 * lanceur se tire au doigt (souris et toucher) puis se franchit au pilote
 * automatique, la pause fige la partie et se reprend sans lâcher la corde, les
 * réglages du titre (Sons, Départ) survivent au rechargement, la fenêtre de
 * lâcher s'ouvre puis se referme pendant un balancement, et le premier conseil
 * du tutoriel apparaît à la première accroche, les quatre scènes de démonstration du lot 2 (le ricochet, le mur à percer, la porte, le cerceau)
 * se jouent et se dessinent sans erreur et le pilote y prouve la mécanique exigée (rebond, fracas, anneau traversé), et les trois scènes de zones (courant ascendant, dérive, fusée) chargent leurs zones et voient le
 * pilote y entrer. Tout passe par `window.__grappin`.
 */

const CENTER = { x: 195, y: 422 };

/** Hauteur à gravir d'un niveau, depuis son toit de départ. */
const goalOf = (id: number): number => levelById(id)!.endY - levelById(id)!.startY;

/** Erreurs de console et de page, au fil de l'eau. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console : ${message.text()}`);
  });
  return errors;
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__grappin !== undefined);
}

const state = (page: Page) => page.evaluate(() => window.__grappin!.state());
const profile = (page: Page) => page.evaluate(() => window.__grappin!.profile());
const buttons = (page: Page) => page.evaluate(() => window.__grappin!.buttons());

/** Touche le centre du bouton `id` de l'écran affiché, après avoir attendu que la dernière image l'ait dessiné. */
async function tapButton(page: Page, id: string): Promise<void> {
  await expect.poll(async () => (await buttons(page)).some((button) => button.id === id), { timeout: 2000 }).toBe(true);
  const button = (await buttons(page)).find((b) => b.id === id)!;
  await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
}

/** Les deux façons de poser le doigt : au toucher, comme sur téléphone, et à la souris. */
const gestures = [
  {
    name: 'toucher',
    async down(page: Page) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [CENTER] });
      return async () => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
    },
  },
  {
    name: 'souris',
    async down(page: Page) {
      await page.mouse.move(CENTER.x, CENTER.y);
      await page.mouse.down();
      return async () => {
        await page.mouse.up();
      };
    },
  },
];

for (const gesture of gestures) {
  test(`le doigt posé accroche, relâché libère (${gesture.name})`, async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, '/');
    expect((await state(page)).screen).toBe('title');

    const lift = await gesture.down(page);
    // Le passage en partie est immédiat dans le jeu ; le délai couvre la première image d'une partie sous rendu logiciel, sur la machine
    // chargée de l'intégration continue (le navigateur est froid : c'est le premier test de la session).
    await expect.poll(async () => (await state(page)).screen, { timeout: 2000 }).toBe('playing');
    expect((await state(page)).attached).toBe(true);

    await page.waitForTimeout(600);
    await lift();
    const released = await state(page);
    expect(released.attached).toBe(false);
    expect(released.pos.y).toBeGreaterThan(0.5);
    expect(errors).toEqual([]);
  });
}

test('un tap tactile sur l\'écran titre lance la partie', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/');
  await page.touchscreen.tap(CENTER.x, CENTER.y);
  await expect.poll(async () => (await state(page)).screen, { timeout: 500 }).toBe('playing');
  expect(errors).toEqual([]);
});

test('?graine=7 fixe la graine et restart() la conserve', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?graine=7');
  expect((await state(page)).seed).toBe(7);

  await page.evaluate(() => window.__grappin!.restart());
  const restarted = await state(page);
  expect(restarted.seed).toBe(7);
  expect(restarted.screen).toBe('title');
  expect(restarted.step).toBe(0);

  await page.evaluate(() => window.__grappin!.restart(9));
  expect((await state(page)).seed).toBe(9);
  expect(errors).toEqual([]);
});

/**
 * Pilote automatique injecté dans la page, même stratégie que `scripts/capture.ts` :
 * accroche dès qu'un point est visé, lâche dans la fenêtre du lâcher parfait,
 * jamais plus de 2,5 s tenu. Sur un lanceur, il vise le point normal le plus
 * proche au-dessus et tire à l'opposé aux sept dixièmes de la force ; dans la
 * seconde et demie qui suit, il n'attrape que ce qui est au-dessus de lui et à
 * moins de quatre mètres, c'est-à-dire une fois le mur à trou passé. Il rend la
 * main quand le personnage dépasse `targetHeight` mètres (absolus) ou
 * `targetLevelHeight` mètres depuis le toit de départ, meurt, gagne le niveau,
 * ou après `limitMs`, avec ce qu'il a vu passer : la plus grande inclinaison de
 * la gravité (`gravityX` en valeur absolue), la plus grande hauteur de niveau
 * et le nombre de lancers. Passé en texte à `page.evaluate` : tsx réécrit les
 * fonctions avec un helper `__name` qui n'existe pas dans la page.
 */
function autopilot(targetHeight: number, limitMs: number, targetLevelHeight = Infinity): string {
  return `new Promise((done) => {
    const api = window.__grappin;
    const start = performance.now();
    let holdSince = 0;
    let launchedAt = -1e9;
    let launches = 0;
    let maxGravityX = 0;
    let maxLevelHeight = 0;
    const gap = (a, s) => Math.hypot(a.x - s.pos.x, a.y - s.pos.y);
    const tick = () => {
      const s = api.state();
      const now = performance.now();
      maxGravityX = Math.max(maxGravityX, Math.abs(s.gravityX));
      maxLevelHeight = Math.max(maxLevelHeight, s.levelHeight);
      if (s.screen === 'dead' || s.screen === 'won' || s.height > ${Number.isFinite(targetHeight) ? targetHeight : 'Infinity'} || s.levelHeight >= ${Number.isFinite(targetLevelHeight) ? targetLevelHeight : 'Infinity'} || now - start > ${limitMs}) { done({ maxGravityX, maxLevelHeight, launches }); return; }
      if (!s.attached && s.targetId !== null) {
        const target = now - launchedAt < 1500 ? api.anchors().find((a) => a.id === s.targetId) : undefined;
        if (!target || (gap(target, s) <= 4 && target.y >= s.pos.y)) {
          api.press();
          holdSince = now;
        }
      } else if (s.attached && s.heldKind === 'lanceur') {
        // Le temps d'être tiré jusqu'au lanceur et de bander la fronde ; puis la traction prouvée par le vérificateur
        // (le trou du mur est décalé : viser au jugé ne suffit plus), au jugé vers le point le plus proche sinon.
        if (now - holdSince > 350) {
          const aim = api.launchAim();
          let best = null;
          for (const a of api.anchors()) {
            if (a.kind !== 'normal' || a.y < s.pos.y + 1) continue;
            const d = gap(a, s);
            if (!best || d < best.d) best = { x: a.x - s.pos.x, y: a.y - s.pos.y, d };
          }
          const dir = best || { x: 0, y: 1, d: 1 };
          if (aim) api.release(aim.x, aim.y);
          else api.release((-dir.x / dir.d) * 1.75, (-dir.y / dir.d) * 1.75);
          launchedAt = now;
          launches += 1;
        }
      } else if (s.attached && now - holdSince > 80) {
        const speed = Math.hypot(s.vel.x, s.vel.y);
        const ready = speed >= 8 || (s.ropeLength !== null && s.ropeLength <= 1.5 + 1e-9);
        const ax = Math.abs(s.vel.x);
        const slope = ax > 0 ? s.vel.y / ax : Infinity;
        if ((ready && s.vel.y > 1 && slope > 0.6 && slope < 1.8) || now - holdSince > 2500) api.release();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`;
}

interface PilotReport {
  maxGravityX: number;
  maxLevelHeight: number;
  launches: number;
}

test('?test=1 : tous les niveaux se jouent, sur un profil à part', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?test=1');
  expect((await state(page)).testMode).toBe(true);
  // Le niveau 7 n'a jamais été débloqué : le mode test le lance quand même.
  expect(await page.evaluate(() => window.__grappin!.playLevel(7))).toBe(true);
  expect(await state(page)).toMatchObject({ screen: 'playing', mode: 'level', levelId: 7 });
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
  // La vraie progression n'est pas touchée : seule la clé du mode test existe, si quelque chose a été écrit.
  const keys = await page.evaluate(() => Object.keys(window.localStorage));
  expect(keys).not.toContain('grappin.profil');

  await open(page, '/');
  expect((await state(page)).testMode).toBe(false);
  expect(await page.evaluate(() => window.__grappin!.playLevel(7))).toBe(false);
});

test('ambiances : chaque famille de musique a sa palette, et le fondu se joue sans erreur de console', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?test=1');
  expect((await state(page)).palette).toBe('menu');
  // Un niveau par famille : le titre, puis les quatre biomes et les boss.
  for (const [level, family] of [
    [1, 'biome1'],
    [3, 'biome2'],
    [5, 'biome3'],
    [7, 'biome4'],
    [9, 'boss'],
  ] as const) {
    expect(await page.evaluate((id) => window.__grappin!.playLevel(id), level)).toBe(true);
    expect((await state(page)).palette, `niveau ${level}`).toBe(family);
    await page.waitForTimeout(400);
  }
  // Retour au titre : l'ambiance revient au menu, sans erreur ni écran qui se retrace de travers.
  await page.evaluate(() => window.__grappin!.restart());
  expect(await state(page)).toMatchObject({ screen: 'title', palette: 'menu' });
  await page.waitForTimeout(400);
  expect(errors).toEqual([]);
});

test('pouls : avec ?test=1&pouls=120 le pouls bat à 120 temps par minute ; sans ?pouls et musique coupée il reste à 0', async ({ page }) => {
  const errors = watchErrors(page);
  // L'horloge de la page est figée, puis menée à la main, une image simulée (16 ms) à la fois : le test ne dépend pas de la vitesse du
  // rendu logiciel, où quelques images par seconde manqueraient le temps (au-dessus de 0,9, il ne dure que 17 ms).
  await page.clock.install({ time: 0 });
  await open(page, '/?test=1&pouls=120');
  expect((await state(page)).bpm).toBe(120);
  await page.clock.pauseAt(60_000);

  // Sur une seconde (deux temps) : le pouls monte près de 1 sur le temps et retombe sous 0,15 au creux, sans sortir de 0 à 1.
  const beats: number[] = [];
  for (let frame = 0; frame < 63; frame += 1) {
    await page.clock.runFor(16);
    beats.push((await state(page)).pulse);
  }
  expect(Math.max(...beats)).toBeGreaterThan(0.9);
  expect(Math.min(...beats)).toBeLessThan(0.15);
  expect(Math.max(...beats)).toBeLessThanOrEqual(1);
  expect(Math.min(...beats)).toBeGreaterThanOrEqual(0);

  // Le métronome bat aussi pendant une partie.
  expect(await page.evaluate(() => window.__grappin!.playLevel(3))).toBe(true);
  await page.clock.runFor(400);
  expect(await state(page)).toMatchObject({ screen: 'playing', bpm: 120 });

  // Sans `?pouls` et la musique coupée : rien ne bat, ni le pouls ni le tempo. L'horloge reprend son cours réel.
  await page.clock.resume();
  await open(page, '/');
  await tapButton(page, 'music');
  await expect.poll(async () => (await state(page)).musicOn).toBe(false);
  const flat: number[] = [];
  for (let frame = 0; frame < 20; frame += 1) {
    flat.push((await state(page)).pulse);
    await page.waitForTimeout(50);
  }
  expect(Math.max(...flat)).toBe(0);
  expect((await state(page)).bpm).toBe(0);
  expect(errors).toEqual([]);
});

test('fenêtre de lâcher : pendant un balancement, state().releaseWindow passe par vrai puis faux', async ({ page }) => {
  const errors = watchErrors(page);
  // Horloge figée puis menée à la main, une image simulée (16 ms) à la fois : la fenêtre ne dure que quelques dixièmes de seconde, et le
  // rendu logiciel, à quelques images par seconde, pourrait ne jamais l'échantillonner.
  await page.clock.install({ time: 0 });
  await open(page, '/?graine=7');
  await page.clock.pauseAt(60_000);
  // Sans corde, lâcher ne serait pas un lâcher : pas de fenêtre.
  expect((await state(page)).releaseWindow).toBe(false);

  await page.evaluate(() => window.__grappin!.playFree());
  await page.evaluate(() => window.__grappin!.press());
  expect((await state(page)).attached).toBe(true);

  // Trois secondes de balancement : la fenêtre s'ouvre (le lâcher monterait entre 30° et 60°) et se referme.
  const seen: boolean[] = [];
  for (let frame = 0; frame < 190; frame += 1) {
    await page.clock.runFor(16);
    const sample = await state(page);
    expect(sample.attached).toBe(true);
    seen.push(sample.releaseWindow);
  }
  expect(seen).toContain(true);
  expect(seen).toContain(false);

  // Lâcher la corde ferme la fenêtre : sans corde, elle reste fausse.
  await page.evaluate(() => window.__grappin!.release());
  await page.clock.runFor(16);
  expect(await state(page)).toMatchObject({ attached: false, releaseWindow: false });
  expect(errors).toEqual([]);
});

test('tutoriel : le premier conseil apparaît à la première accroche, et state().tip le donne', async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.install({ time: 0 });
  await open(page, '/?graine=7');
  await page.clock.pauseAt(60_000);
  // Profil neuf (un contexte de test est vierge) : aucun conseil avant l'accroche.
  await page.evaluate(() => window.__grappin!.playFree());
  await page.clock.runFor(100);
  expect((await state(page)).tip).toBeNull();

  await page.evaluate(() => window.__grappin!.press());
  // Le conseil se dessine par la bannière douce : quelques images, fondu d'entrée compris, sans erreur de console.
  for (let frame = 0; frame < 30; frame += 1) await page.clock.runFor(16);
  expect(await state(page)).toMatchObject({ attached: true, tip: 'Garde le doigt posé' });
  expect(errors).toEqual([]);
});

test('un pilote automatique grimpe au-delà de 10 m sans erreur de console', async ({ page }) => {
  const errors = watchErrors(page);
  // Brume ralentie : sur les machines lentes de l'intégration continue, le pilote réagit à la cadence
  // des images, donc mal ; ce test vérifie que le jeu tourne sans erreur, pas l'adresse du pilote.
  // C'est la course libre qui obéit à l'adresse : un niveau a sa graine et sa brume.
  await open(page, '/?graine=3&fogBaseSpeed=0.15');
  await page.evaluate(() => window.__grappin!.playFree());
  await page.evaluate(autopilot(12, 30_000));

  const climbed = await state(page);
  expect(climbed.screen).toBe('playing');
  expect(climbed.height).toBeGreaterThan(10);
  expect(climbed.cause).toBeNull();
  expect(errors).toEqual([]);
});

/**
 * Scènes de démonstration du lot 2 (`?scene=`) : un premier segment construit à la main, qui montre une mécanique isolée, celle que le jeu
 * EXIGE (0.12.1) : le ricochet (`rebond`), le mur à percer (`cassable`), la porte, le cerceau (`anneau`). Chacune se charge, la course libre
 * commence par elle, et ses images se dessinent sans erreur de console. L'horloge de la page est figée puis menée à la main : peu d'images
 * suffisent, et le test ne dépend pas de la vitesse du rendu logiciel. Les tests qui suivent jouent la mécanique elle-même.
 */
for (const scene of ['rebond', 'cassable', 'porte', 'anneau'] as const) {
  test(`scène « ${scene} » : ?scene=${scene} commence la course libre par elle, et ses images se dessinent sans erreur`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.clock.install({ time: 0 });
    await open(page, `/?scene=${scene}&graine=5&fogBaseSpeed=0.1`);
    await page.clock.pauseAt(60_000);
    await page.evaluate(() => window.__grappin!.playFree());
    // L'intro de la scène (trois secondes de bannière) a le temps de se dessiner, fondus compris.
    for (let frame = 0; frame < 40; frame += 1) await page.clock.runFor(16);
    const shown = await state(page);
    expect(shown).toMatchObject({ screen: 'playing', scene, smashed: 0, rings: 0 });
    // Chaque scène a ses obstacles : le ricochet en a quatre, le mur à percer un, la porte trois, le cerceau deux pans autour de son anneau.
    expect(shown.obstacles).toBeGreaterThanOrEqual(1);
    expect(shown.step).toBeGreaterThan(0);
    // Le doigt posé : la corde part vers le premier point de la scène et la partie continue, sans erreur.
    await page.evaluate(() => window.__grappin!.press());
    for (let frame = 0; frame < 30; frame += 1) await page.clock.runFor(16);
    expect(await state(page)).toMatchObject({ screen: 'playing', scene, attached: true });
    expect(errors).toEqual([]);
  });
}

test('scène « porte » : un cycle complet (6 s) se joue, et le rendu voit la porte ouverte, qui se ferme, puis fermée', async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.install({ time: 0 });
  await open(page, '/?scene=porte&graine=5&fogBaseSpeed=0.1');
  await page.clock.pauseAt(60_000);
  await page.evaluate(() => window.__grappin!.playFree());
  // La porte de la scène, retrouvée en rejouant son segment : le cycle d'une porte ne dépend que du pas et de son numéro.
  const door = new Simulation(5, DEFAULT_TUNING, { kind: 'scene', sceneId: 'porte', startY: 0 }).state.obstacles.find((box) => box.kind === 'porte');
  expect(door).toBeDefined();
  const seen = new Set<DoorState>();
  const first = (await state(page)).step;
  // Un pas dure 1/120 s : 6 s, plus une marge. Cent millisecondes par image, le plafond de temps du jeu : peu d'images à dessiner.
  const period = Math.round(6 / DEFAULT_TUNING.stepSeconds);
  for (let frame = 0; frame < 80; frame += 1) {
    await page.clock.runFor(100);
    const sample = await state(page);
    seen.add(doorState(door!.id, sample.step, DEFAULT_TUNING));
    expect(sample.screen).toBe('playing');
  }
  expect((await state(page)).step - first).toBeGreaterThanOrEqual(period);
  expect([...seen].sort()).toEqual(['fermee', 'ouverte', 'se ferme']);
  expect(errors).toEqual([]);
});

/**
 * Les trois scènes dont le jeu exige la mécanique (0.12.1), jouées image par image sur l'horloge figée de la page, par le pilote des
 * scènes (`scripts/pilote.ts`) : il applique les règles du robot (il ne rattrape pas un point sous lui en montant, ni un point dont le
 * balancement heurte un mur), tient le lanceur au moins 0,35 s, puis tire la traction prouvée par le vérificateur (`launchAim`) ; au cerceau,
 * il en choisit une qui traverse l'anneau (`ringShot` : le vérificateur n'exige pas l'anneau, un autre tir attrape la sortie sans lui).
 * Dans les trois cas le lanceur est en (0,4 ; 11).
 */
const FRAME_MS = 16;

/** Ouvre la scène `scene` sur une horloge figée, la joue, et laisse défiler la bannière d'intro. */
async function openFrozenScene(page: Page, scene: string): Promise<void> {
  await page.clock.install({ time: 0 });
  await open(page, `/?scene=${scene}&graine=5&fogBaseSpeed=0.1`);
  await page.clock.pauseAt(60_000);
  await page.evaluate(() => window.__grappin!.playFree());
  for (let frame = 0; frame < 20; frame += 1) await page.clock.runFor(FRAME_MS);
}

const speedOf = (s: { vel: { x: number; y: number } }): number => Math.hypot(s.vel.x, s.vel.y);

test('scène « cassable » : le pilote tient le lanceur, tire à pleine puissance, et la paroi sans trou se brise (state().smashed passe à 1)', async ({ page }) => {
  const errors = watchErrors(page);
  await openFrozenScene(page, 'cassable');
  const world = sceneWorld('cassable', 5);
  const memory = newMemory();
  let heldFrames = 0;
  let fastest = 0;
  let seen = await state(page);
  expect(seen).toMatchObject({ scene: 'cassable', smashed: 0 });
  for (let frame = 0; frame < 400 && seen.smashed === 0; frame += 1) {
    await page.clock.runFor(FRAME_MS);
    seen = await pilotFrame(page, memory, frame * FRAME_MS, { world });
    expect(seen.screen).toBe('playing');
    if (seen.heldKind === 'lanceur') heldFrames += 1;
    // La paroi s'allume (elle peut céder) quand la vitesse suffit : sur le lanceur tenu elle est nulle, la paroi est donc éteinte jusqu'au vol.
    if (seen.smashed === 0 && seen.pos.y > 12) fastest = Math.max(fastest, speedOf(seen));
  }
  // Le lanceur est tenu au moins le temps de bander la fronde (0,35 s), puis le tir franchit la paroi à pleine puissance.
  expect(heldFrames * FRAME_MS).toBeGreaterThanOrEqual(350);
  expect(fastest).toBeGreaterThanOrEqual(DEFAULT_TUNING.smashSpeed);
  // Les éclats de la paroi se dessinent, sans erreur, pendant que le vol continue.
  for (let frame = 0; frame < 20; frame += 1) await page.clock.runFor(FRAME_MS);
  const after = await state(page);
  expect(after.smashed).toBe(1);
  expect(after.pos.y).toBeGreaterThan(16.4);
  expect(after.screen).toBe('playing');
  expect(errors).toEqual([]);
});

test('scène « cassable » : un tir à moitié de puissance bute sur la paroi, qui reste entière', async ({ page }) => {
  const errors = watchErrors(page);
  await openFrozenScene(page, 'cassable');
  const world = sceneWorld('cassable', 5);
  const memory = newMemory();
  let highest = 0;
  for (let frame = 0; frame < 230; frame += 1) {
    await page.clock.runFor(FRAME_MS);
    const seen = await pilotFrame(page, memory, frame * FRAME_MS, { world, shot: 'mou' });
    highest = Math.max(highest, seen.pos.y);
  }
  // Le tir mou arrive au mur (à 16 m) moins vite que `smashSpeed` : la paroi tient, le personnage ne la franchit pas.
  expect(highest).toBeGreaterThan(14);
  expect(highest).toBeLessThan(16);
  expect((await state(page)).smashed).toBe(0);
  expect(errors).toEqual([]);
});

test('scène « rebond » : le tir prouvé passe sous la chicane, rebondit sur le mur de droite (vel.x change de signe) et atteint plus de 19 m par le trou', async ({ page }) => {
  const errors = watchErrors(page);
  await openFrozenScene(page, 'rebond');
  const world = sceneWorld('rebond', 5);
  const memory = newMemory();
  let before: Awaited<ReturnType<typeof state>> | null = null;
  let bounceFrame = 0;
  let highest = 0;
  for (let frame = 0; frame < 500 && highest <= 19; frame += 1) {
    await page.clock.runFor(FRAME_MS);
    const seen = await pilotFrame(page, memory, frame * FRAME_MS, { world });
    expect(seen.screen).toBe('playing');
    highest = Math.max(highest, seen.pos.y);
    // En vol libre après le tir : le mur de rebond renvoie le personnage vers la gauche, par-dessus la chicane et dans le trou.
    if (memory.launchedAt > 0 && !seen.attached) {
      if (before && !before.attached && before.vel.x > 2 && seen.vel.x < -2 && bounceFrame === 0) bounceFrame = frame;
      before = seen;
    } else before = null;
  }
  expect(bounceFrame, 'vel.x change de signe en vol (le rebond)').toBeGreaterThan(0);
  expect(highest).toBeGreaterThan(19);
  expect(errors).toEqual([]);
});

test('scène « anneau » : le tir passe par l\'anneau du mur, qui accélère le personnage (state().rings ≥ 1), au-dessus de 16,5 m', async ({ page }) => {
  const errors = watchErrors(page);
  await openFrozenScene(page, 'anneau');
  const world = sceneWorld('anneau', 5);
  const memory = newMemory();
  let previous = await state(page);
  let boost = 0;
  let highest = 0;
  for (let frame = 0; frame < 500 && (highest <= 16.5 || previous.rings < 1); frame += 1) {
    await page.clock.runFor(FRAME_MS);
    // Le tir passe l'anneau ; le pilote n'attrape rien avant de l'avoir traversé (la sortie, de côté, se rattrape après).
    const seen = await pilotFrame(page, memory, frame * FRAME_MS, { world, shot: 'anneau', wait: (s, pilot) => pilot.launchedAt > 0 && s.rings < 1 });
    expect(seen.screen).toBe('playing');
    highest = Math.max(highest, seen.pos.y);
    if (previous.rings === 0 && seen.rings >= 1) boost = speedOf(seen) / speedOf(previous);
    previous = seen;
  }
  expect((await state(page)).rings).toBeGreaterThanOrEqual(1);
  // Tout anneau traversé accélère : `ringBoost`, moins le peu que la gravité reprend dans l'image.
  expect(boost).toBeGreaterThan(1.15);
  expect(highest).toBeGreaterThan(16.5);
  // L'éclat et le signe de vitesse de la traversée se dessinent sans erreur.
  for (let frame = 0; frame < 30; frame += 1) await page.clock.runFor(FRAME_MS);
  expect(errors).toEqual([]);
});

/**
 * Zones qui modifient le mouvement (0.12.0), trois scènes de démonstration : le courant ascendant, la dérive, la fusée (couloir
 * d'accélération puis zone de freinage). Chacune se charge avec au moins une zone, et le pilote, mené image par image sur l'horloge figée
 * de la page (une image dure seize millisecondes : le test ne dépend pas de la vitesse du rendu logiciel), entre dans la zone : `state().zone`
 * dit l'espèce de celle où se trouve le personnage. Les zones se dessinent à chaque image, sans erreur de console.
 */
const ZONE_SCENES = [
  { scene: 'courant', zone: 'ascendant' },
  { scene: 'derive', zone: 'lateral' },
  { scene: 'fusee', zone: 'acceleration' },
] as const;

for (const { scene, zone } of ZONE_SCENES) {
  test(`scène « ${scene} » : ?scene=${scene} charge ses zones, et le pilote entre dans la zone « ${zone} »`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.clock.install({ time: 0 });
    await open(page, `/?scene=${scene}&graine=5&fogBaseSpeed=0.1`);
    await page.clock.pauseAt(60_000);
    await page.evaluate(() => window.__grappin!.playFree());
    // L'intro de la scène a le temps de se dessiner, fondus compris, avant que le pilote joue.
    for (let frame = 0; frame < 20; frame += 1) await page.clock.runFor(16);
    const loaded = await state(page);
    expect(loaded).toMatchObject({ screen: 'playing', scene, zone: null });
    expect(loaded.zones).toBeGreaterThanOrEqual(1);

    const memory = newMemory();
    const seen: (typeof loaded.zone)[] = [];
    let highest = 0;
    for (let frame = 0; frame < 400; frame += 1) {
      await page.clock.runFor(16);
      const s = await pilotFrame(page, memory, frame * 16);
      expect(s.screen).toBe('playing');
      if (s.zone !== seen.at(-1)) seen.push(s.zone);
      highest = Math.max(highest, s.pos.y);
      // La fusée : dans le couloir, puis dans le freinage au-dessus (ou au moins au-delà, à plus de 18 m).
      if (scene === 'fusee' ? seen.includes('freinage') || highest > 18 : seen.includes(zone)) break;
    }
    expect(seen, `zones traversées : ${seen.join(', ')}`).toContain(zone);
    if (scene === 'fusee') {
      // Le couloir d'abord, puis le freinage ou une hauteur qui prouve qu'il a été franchi.
      expect(seen.indexOf('acceleration')).toBeGreaterThanOrEqual(0);
      expect(seen.includes('freinage') || highest > 18).toBe(true);
      if (seen.includes('freinage')) expect(seen.indexOf('freinage')).toBeGreaterThan(seen.indexOf('acceleration'));
    }
    expect(errors).toEqual([]);
  });
}

test('progression : une partie rapporte de l\'expérience, le profil survit au rechargement, un talisman s\'équipe', async ({ page }) => {
  const errors = watchErrors(page);
  // Brume rapide : sans personne pour jouer, elle finit la partie en quelques secondes.
  await open(page, '/?graine=3&fogBaseSpeed=4');
  await page.evaluate(() => window.__grappin!.resetProfile());
  expect((await state(page)).level).toBe(1);

  // Un doigt posé un instant, puis levé : de quoi gagner quelques mètres, donc au moins 1 XP (un tap sans durée n'en rapporte aucun).
  const lift = await gestures[0]!.down(page);
  await page.waitForTimeout(150);
  await lift();
  await expect.poll(async () => (await state(page)).screen, { timeout: 20_000 }).toBe('dead');
  const dead = await state(page);
  expect(dead.xp).toBeGreaterThan(0);
  expect(dead.xpGained).toBe(dead.xp);
  expect((await profile(page)).runs).toBe(1);

  await page.reload();
  await page.waitForFunction(() => window.__grappin !== undefined);
  expect((await profile(page)).runs).toBe(1);
  expect((await state(page)).xp).toBe(dead.xp);

  await page.evaluate(() => window.__grappin!.equip('treuil'));
  expect((await profile(page)).equipped).toContain('treuil');
  expect(errors).toEqual([]);
});

test('les boutons répondent au toucher : Talismans, une ligne, Retour, puis un appui ailleurs lance la partie', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?graine=3');
  await page.evaluate(() => window.__grappin!.resetProfile());

  await tapButton(page, 'talismans');
  await expect.poll(async () => (await state(page)).screen).toBe('talismans');
  // Niveau 1 : seul le premier talisman est débloqué, les autres lignes ne sont pas des boutons.
  await expect.poll(async () => (await buttons(page)).map((button) => button.id)).toEqual(['treuil', 'back']);

  await tapButton(page, 'treuil');
  await expect.poll(async () => (await profile(page)).equipped).toEqual(['treuil']);
  // Un appui ailleurs ne fait rien sur cet écran.
  await page.touchscreen.tap(CENTER.x, 20);
  expect((await state(page)).screen).toBe('talismans');

  await tapButton(page, 'back');
  await expect.poll(async () => (await state(page)).screen).toBe('title');
  await expect.poll(async () => (await buttons(page)).map((button) => button.id)).toEqual(['continue', 'levels', 'free', 'talismans', 'music', 'sfx', 'start']);

  await page.touchscreen.tap(CENTER.x, CENTER.y);
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
  expect(errors).toEqual([]);
});

test('titre : l\'action principale « Continuer » joue le niveau le plus avancé', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?graine=3');
  await page.evaluate(() => window.__grappin!.resetProfile());
  await tapButton(page, 'continue');
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
  expect(await state(page)).toMatchObject({ mode: 'level', levelId: 1 });
  expect(errors).toEqual([]);
});

test('titre : Sons et Départ se basculent et survivent au rechargement', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?graine=3');
  await page.evaluate(() => window.__grappin!.resetProfile());
  expect(await state(page)).toMatchObject({ screen: 'title', musicOn: true, sfxOn: true, freeStart: 'advanced' });

  // Chaque bouton ne change que son réglage : la musique reste comme elle est.
  await tapButton(page, 'sfx');
  await expect.poll(async () => (await state(page)).sfxOn).toBe(false);
  await tapButton(page, 'start');
  await expect.poll(async () => (await state(page)).freeStart).toBe('ground');
  expect(await state(page)).toMatchObject({ screen: 'title', musicOn: true, sfxOn: false, freeStart: 'ground' });

  await page.reload();
  await page.waitForFunction(() => window.__grappin !== undefined);
  expect(await state(page)).toMatchObject({ screen: 'title', musicOn: true, sfxOn: false, freeStart: 'ground' });
  expect(await profile(page)).toMatchObject({ sfx: false, freeStart: 'ground' });

  // Et dans l'autre sens : un second appui remet chacun comme avant.
  await tapButton(page, 'sfx');
  await expect.poll(async () => (await state(page)).sfxOn).toBe(true);
  await tapButton(page, 'start');
  await expect.poll(async () => (await state(page)).freeStart).toBe('advanced');
  await page.reload();
  await page.waitForFunction(() => window.__grappin !== undefined);
  expect(await state(page)).toMatchObject({ screen: 'title', sfxOn: true, freeStart: 'advanced' });
  expect(errors).toEqual([]);
});

test('titre : quand le navigateur sait installer, un bouton « Installer le jeu » le propose, l\'appui lance l\'invite, et l\'installation le retire', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?graine=3');
  expect(await state(page)).toMatchObject({ screen: 'title', install: null });
  expect((await buttons(page)).some((button) => button.id === 'install')).toBe(false);
  // Chrome, sur Android, annonce qu'il sait installer : on imite son événement, avec une invite qui compte ses déclenchements.
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    const counter = window as unknown as { __invites?: number };
    event.prompt = () => {
      counter.__invites = (counter.__invites ?? 0) + 1;
      return Promise.resolve();
    };
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });
  await expect.poll(async () => (await state(page)).install).toBe('prompt');
  await tapButton(page, 'install');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __invites?: number }).__invites ?? 0)).toBe(1);
  await expect.poll(async () => (await state(page)).install).toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect.poll(async () => (await buttons(page)).some((button) => button.id === 'install')).toBe(false);
  expect(await state(page)).toMatchObject({ screen: 'title', install: null });
  expect(errors).toEqual([]);
});

test('pause : le bouton met en pause, le pas de simulation ne bouge plus, Reprendre reprend, et le lever du doigt qui finit l\'appui sur Reprendre ne lâche pas la corde', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?graine=3');
  await page.evaluate(() => window.__grappin!.resetProfile());
  await page.evaluate(() => window.__grappin!.playFree());
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
  await page.evaluate(() => window.__grappin!.press());
  await expect.poll(async () => (await state(page)).attached, { timeout: 2000 }).toBe(true);

  // Pendant la partie, le seul bouton est celui de la pause : dans le coin haut droit, assez grand pour un doigt.
  await expect.poll(async () => (await buttons(page)).map((button) => button.id), { timeout: 2000 }).toEqual(['pause']);
  const [pause] = await buttons(page);
  expect(pause!.width).toBeGreaterThanOrEqual(44);
  expect(pause!.height).toBeGreaterThanOrEqual(44);
  expect(pause!.x + pause!.width).toBeLessThanOrEqual(390);
  expect(pause!.x).toBeGreaterThan(195);
  expect(pause!.y).toBeLessThan(100);

  await tapButton(page, 'pause');
  await expect.poll(async () => (await state(page)).screen, { timeout: 2000 }).toBe('paused');
  // Le voile a ses deux boutons, et rien ne bouge derrière : ni le pas de simulation, ni la corde.
  await expect.poll(async () => (await buttons(page)).map((button) => button.id), { timeout: 2000 }).toEqual(['resume', 'quit']);
  const frozen = await state(page);
  expect(frozen.attached).toBe(true);
  await page.waitForTimeout(300);
  const later = await state(page);
  expect(later.step).toBe(frozen.step);
  expect(later.attached).toBe(true);
  expect(later.pos).toEqual(frozen.pos);

  // Un appui ailleurs ne fait rien.
  await page.touchscreen.tap(CENTER.x, CENTER.y);
  expect((await state(page)).screen).toBe('paused');

  // Reprendre : le doigt qui se lève pour finir cet appui n'est pas un lâcher.
  await tapButton(page, 'resume');
  await expect.poll(async () => (await state(page)).screen, { timeout: 2000 }).toBe('playing');
  expect((await state(page)).attached).toBe(true);
  await expect.poll(async () => (await state(page)).step, { timeout: 2000 }).toBeGreaterThan(frozen.step);
  expect((await state(page)).attached).toBe(true);

  // Un vrai lever du doigt, ensuite, lâche bien la corde.
  await page.evaluate(() => window.__grappin!.release());
  expect((await state(page)).attached).toBe(false);
  expect(errors).toEqual([]);
});

test('pause : Quitter revient au titre', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?graine=3');
  await page.evaluate(() => window.__grappin!.playFree());
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
  await tapButton(page, 'pause');
  await expect.poll(async () => (await state(page)).screen, { timeout: 2000 }).toBe('paused');
  await tapButton(page, 'quit');
  await expect.poll(async () => (await state(page)).screen, { timeout: 2000 }).toBe('title');
  expect(errors).toEqual([]);
});

test('niveaux : la liste, un niveau verrouillé, le pilote gagne le niveau 1, le niveau 2 s\'ouvre, et les étoiles survivent au rechargement', async ({ page }) => {
  // Le pilote joue en temps réel : jusqu'à 90 s, plus le temps de démarrer et de recharger.
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await open(page, '/');
  await page.evaluate(() => window.__grappin!.resetProfile());

  // La liste : dix lignes par page, seul le niveau 1 est un bouton, avec « Retour » et le bouton de la page suivante, qui ramène au titre.
  await tapButton(page, 'levels');
  await expect.poll(async () => (await state(page)).screen).toBe('levels');
  await expect.poll(async () => (await buttons(page)).map((button) => button.id)).toEqual(['niveau-1', 'back', 'suite']);
  await tapButton(page, 'back');
  await expect.poll(async () => (await state(page)).screen).toBe('title');

  // Le niveau 2 est verrouillé ; le niveau 1 se lance par la liste.
  expect(await page.evaluate(() => window.__grappin!.playLevel(2))).toBe(false);
  await tapButton(page, 'levels');
  await tapButton(page, 'niveau-1');
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
  expect(await state(page)).toMatchObject({ mode: 'level', levelId: 1, goal: goalOf(1), unlockedLevel: 1 });

  await page.evaluate(autopilot(Infinity, 90_000));
  const won = await state(page);
  expect(won.screen).toBe('won');
  expect(won.levelHeight).toBeGreaterThanOrEqual(goalOf(1));
  expect(won.stars).toBeGreaterThanOrEqual(1);
  expect((await profile(page)).levels['1']!.stars).toBeGreaterThanOrEqual(1);
  expect(won.unlockedLevel).toBe(2);

  // Les boutons de l'écran de victoire, sitôt le verrou d'entrée passé ; « Niveau suivant » lance le niveau 2.
  await page.waitForTimeout(800);
  expect((await buttons(page)).map((button) => button.id)).toEqual(['next', 'replay', 'levels']);
  await tapButton(page, 'next');
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
  expect(await state(page)).toMatchObject({ mode: 'level', levelId: 2, goal: goalOf(2) });

  await page.reload();
  await page.waitForFunction(() => window.__grappin !== undefined);
  expect((await state(page)).unlockedLevel).toBe(2);
  expect((await profile(page)).levels['1']!.stars).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('la bascule du niveau 5 se joue sans erreur de console : la gravité tourne', async ({ page }) => {
  // Le pilote joue en temps réel : il peut mourir avant la bascule sur une machine lente, on le relance alors.
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await open(page, '/');
  await page.evaluate(() => window.__grappin!.resetProfile());
  // Le niveau 5 est verrouillé tant que les quatre premiers ne sont pas franchis : `unlockAll` est fait pour cela.
  expect(await page.evaluate(() => window.__grappin!.playLevel(5))).toBe(false);
  await page.evaluate(() => window.__grappin!.unlockAll());
  expect((await state(page)).unlockedLevel).toBe(LEVELS.length);

  let maxGravityX = 0;
  for (let attempt = 0; attempt < 4 && maxGravityX === 0; attempt += 1) {
    expect(await page.evaluate(() => window.__grappin!.playLevel(5))).toBe(true);
    await expect.poll(async () => (await state(page)).screen).toBe('playing');
    expect(await state(page)).toMatchObject({ mode: 'level', levelId: 5, gravityX: 0, gravityY: -1, windX: 0, lightsOff: false, fogFactor: 1 });
    const report = (await page.evaluate(autopilot(Infinity, 45_000))) as PilotReport;
    maxGravityX = report.maxGravityX;
  }
  expect(maxGravityX).toBeGreaterThan(0);
  // Le niveau 5 compte deux bascules, à des hauteurs différentes : la première a eu lieu, le calendrier est celui du niveau.
  const { events } = await state(page);
  expect(events).toHaveLength(levelById(5)!.events.length);
  expect(events.every((event) => event.kind === 'bascule')).toBe(true);
  expect(events[0]).toMatchObject({ kind: 'bascule', started: true });
  expect(errors).toEqual([]);
});

test('liste des niveaux : deux pages de dix, « Niveaux 11 à 20 » puis « Niveaux 1 à 10 », et un niveau de la seconde page se lance', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/');
  await page.evaluate(() => window.__grappin!.resetProfile());
  await page.evaluate(() => window.__grappin!.unlockAll());

  // Tous les niveaux sont ouverts : la liste s'ouvre sur la page du niveau à jouer, le dernier, donc la seconde.
  await tapButton(page, 'levels');
  await expect.poll(async () => (await state(page)).screen).toBe('levels');
  const second = Array.from({ length: 10 }, (_, i) => `niveau-${i + 11}`);
  await expect.poll(async () => (await buttons(page)).map((button) => button.id)).toEqual([...second, 'back', 'precedents']);

  // La page précédente, puis la suivante : les dix premiers niveaux, puis les dix derniers.
  await tapButton(page, 'precedents');
  const first = Array.from({ length: 10 }, (_, i) => `niveau-${i + 1}`);
  await expect.poll(async () => (await buttons(page)).map((button) => button.id)).toEqual([...first, 'back', 'suite']);
  await tapButton(page, 'suite');
  await expect.poll(async () => (await buttons(page)).map((button) => button.id)).toEqual([...second, 'back', 'precedents']);

  await tapButton(page, 'niveau-14');
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
  expect(await state(page)).toMatchObject({ mode: 'level', levelId: 14, goal: goalOf(14) });
  expect(errors).toEqual([]);
});

/** Les deux façons de tirer : au toucher, par les événements du protocole, et à la souris. Chacune pose le doigt en `from`, le glisse en `to`, et rend de quoi le lever. */
const draggers = [
  {
    name: 'toucher',
    async hold(page: Page, from: { x: number; y: number }) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      return {
        async drag(to: { x: number; y: number }) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
        },
        async lift() {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        },
      };
    },
  },
  {
    name: 'souris',
    async hold(page: Page, from: { x: number; y: number }) {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      return {
        async drag(to: { x: number; y: number }) {
          await page.mouse.move(to.x, to.y, { steps: 4 });
        },
        async lift() {
          await page.mouse.up();
        },
      };
    },
  },
];

for (const dragger of draggers) {
  test(`lanceur : tirer le doigt règle la traction, relâcher lance à l'opposé (${dragger.name})`, async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, '/?test=1');
    // Le niveau 14 commence par un lanceur, à quatre mètres du toit : le doigt posé s'y accroche.
    expect(await page.evaluate(() => window.__grappin!.playLevel(14))).toBe(true);
    const finger = await dragger.hold(page, { x: 195, y: 500 });
    await expect.poll(async () => (await state(page)).heldKind).toBe('lanceur');
    expect(await state(page)).toMatchObject({ attached: true, pullX: 0, pullY: 0 });

    // Le doigt descend de 80 px et glisse à gauche de 30 : la traction va vers le bas (y du monde négatif) et vers la gauche.
    await finger.drag({ x: 165, y: 580 });
    await expect.poll(async () => (await state(page)).pullY).toBeLessThan(-1);
    const pulled = await state(page);
    expect(pulled.pullX).toBeLessThan(-0.3);
    expect(Math.hypot(pulled.pullX, pulled.pullY)).toBeLessThanOrEqual(2.5 + 1e-9);

    // Le personnage est tenu au lanceur, reculé de la traction : sous lui et à gauche.
    const launcher = (await page.evaluate(() => window.__grappin!.anchors())).find((anchor) => anchor.kind === 'lanceur')!;
    expect(pulled.pos.y).toBeLessThan(launcher.y);
    expect(pulled.pos.x).toBeLessThan(launcher.x);

    // Relâché : il part à l'opposé, vers le haut et vers la droite.
    await finger.lift();
    const launched = await state(page);
    expect(launched.attached).toBe(false);
    expect(launched.heldKind).toBeNull();
    expect(launched.vel.x).toBeGreaterThan(0);
    expect(launched.vel.y).toBeGreaterThan(6);
    expect(errors).toEqual([]);
  });
}

test('lanceur : le pilote automatique franchit le mur à trou du niveau 14 sans erreur de console', async ({ page }) => {
  // Le pilote joue en temps réel et peut mourir avant le mur sur une machine lente : on rejoue le niveau, quelques fois au plus.
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await open(page, '/?test=1');
  let report: PilotReport = { maxGravityX: 0, maxLevelHeight: 0, launches: 0 };
  for (let attempt = 0; attempt < 4 && report.maxLevelHeight < 12; attempt += 1) {
    expect(await page.evaluate(() => window.__grappin!.playLevel(14))).toBe(true);
    report = (await page.evaluate(autopilot(Infinity, 30_000, 12))) as PilotReport;
  }
  // Le mur du niveau 14 est à 9,8 m au-dessus du toit de départ : plus de 12 m, c'est qu'on est passé par son trou.
  expect(report.launches).toBeGreaterThanOrEqual(1);
  expect(report.maxLevelHeight).toBeGreaterThanOrEqual(12);
  expect(errors).toEqual([]);
});

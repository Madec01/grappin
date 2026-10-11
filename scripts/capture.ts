import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';
import { doorGauge, doorState } from '../src/sim/cycles';
import { Simulation } from '../src/sim/simulation';
import type { ZoneKind } from '../src/sim/state';
import { DEFAULT_TUNING } from '../src/sim/tuning';
import { newMemory, pilotFrame, sceneWorld, type PilotMemory, type PilotOptions, type Seen } from './pilote';

// Le paquet est en CommonJS avec des accesseurs : Node ne voit pas ses exports nommés, on passe par l'export par défaut.
const { GIFEncoder, applyPalette, quantize } = gifenc;

/**
 * Captures de livraison : lance le build en prévisualisation, joue une partie
 * scénarisée sur un écran de téléphone simulé, et dépose des captures d'écran
 * ainsi qu'une courte vidéo convertie en GIF.
 *
 * Usage : `npm run captures -- <dossier de sortie> [graine] [scenes [nom...]]`. Le build doit
 * exister (`npm run build`). Chromium vient de Playwright ou de
 * `PW_CHROMIUM_PATH`. La vidéo demande le ffmpeg de Playwright
 * (`npx playwright install ffmpeg`), dont le chemin est passé par `FFMPEG_PATH`
 * pour en extraire les images du GIF ; sans lui, seules les captures sont faites.
 */

/** Le GIF : début, durée, cadence et largeur, pour rester léger sur un téléphone. */
const GIF_START_SECONDS = 18;
const GIF_SECONDS = 14;
const GIF_FPS = 12;
const GIF_WIDTH = 300;

/** Les images des ambiances : une seconde et demie de jeu, en pas de simulation (cent vingt par seconde). */
const PALETTE_STEPS = 180;
/** Les images du pouls : l'horloge de la page est figée à cet instant (une dizaine de minutes, bien après le chargement), puis menée à la main. */
const PULSE_CLOCK_MS = 600_000;
/** L'intro d'un niveau dure trois secondes : on en laisse trois et demie, pour que la bannière soit effacée. */
const PULSE_INTRO_MS = 3500;

const PORT = 4175;
const VIEWPORT = { width: 390, height: 844 };
const outDir = resolve(process.argv[2] ?? 'captures');
const seed = Number(process.argv[3] ?? '1');
/** `scenes` en troisième argument : seulement les prises des scènes du lot 2, pour les revoir sans rejouer tout le banc. */
const onlyScenes = process.argv[4] === 'scenes';
/** Après `scenes`, des noms de scènes (`courant derive`) pour ne rejouer que celles-là ; aucun nom, toutes les scènes. */
const sceneFilter = onlyScenes ? process.argv.slice(5) : [];
const wanted = (id: string): boolean => sceneFilter.length === 0 || sceneFilter.includes(id);

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Le serveur n'écoute pas encore.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Serveur de prévisualisation injoignable : ${url}`);
}

function startPreview(): ChildProcess {
  // Détaché dans son propre groupe : à la fin, c'est tout le groupe qui est arrêté, pas seulement l'enveloppe `npx`.
  return spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
}

/** Touche le centre du bouton `id` de l'écran affiché, sitôt qu'une image l'a dessiné. */
async function tapButton(page: Page, id: string): Promise<void> {
  await page.waitForFunction((target) => window.__grappin?.buttons().some((b) => b.id === target), id);
  const button = (await page.evaluate(() => window.__grappin!.buttons())).find((b) => b.id === id)!;
  await page.evaluate(({ x, y }) => window.__grappin!.press(x, y), { x: button.x + button.width / 2, y: button.y + button.height / 2 });
  await page.evaluate(() => window.__grappin!.release());
}

/** Durée d'une image sur l'horloge figée d'une page : celle du rafraîchissement (`requestAnimationFrame`) simulé, un soixantième de seconde. */
const FRAME_MS = 16;

/**
 * Fait avancer, image par image, le temps d'une page dont l'horloge est figée (`page.clock`), jusqu'à ce que le pouls de la musique
 * (`state().pulse`) satisfasse `accept`, et rend sa valeur. Une page qui tourne en temps réel ne tiendrait pas : sur le rendu logiciel
 * du banc, la cadence tombe à quelques images par seconde, et un temps ne reste au-dessus de 0,9 que dix-sept millisecondes ; une
 * capture arriverait des images plus tard, ailleurs dans le battement, et la brume aurait le temps de rattraper le personnage. Ici le
 * jeu ne vit que du temps qu'on lui donne : l'image voulue y est exacte, et la capture qui suit la montre telle quelle.
 */
async function stepPulse(page: Page, accept: (pulse: number) => boolean): Promise<number> {
  // Un temps dure bien plus de deux fois une image : si le pouls ne passe pas la condition en quelques battements, rien ne bat.
  for (let frame = 0; frame < 240; frame += 1) {
    await page.clock.runFor(FRAME_MS);
    const { pulse } = await page.evaluate(() => window.__grappin!.state());
    if (accept(pulse)) return pulse;
  }
  throw new Error('Le pouls ne passe jamais la condition : le métronome (?pouls=120) bat-il ?');
}

/**
 * Pilote automatique injecté dans la page, même stratégie que `scripts/robot.ts` :
 * accroche dès qu'un point est visé, garde le doigt posé jusqu'à une vitesse
 * cible ou une corde au plus court, lâche dans la fenêtre du lâcher parfait,
 * jamais plus de deux secondes et demie pendu. Sur un lanceur, il vise le point
 * normal le plus proche au-dessus et tire à l'opposé aux sept dixièmes de la
 * force (`release(pullX, pullY)`, en mètres de monde) ; dans la seconde et demie
 * qui suit, il n'attrape que ce qui est au-dessus de lui et à moins de quatre
 * mètres, c'est-à-dire une fois le mur à trou passé. Il passe par la même API
 * que les tests de fumée, jusqu'à la mort ou la fin du temps imparti.
 */
async function autoplay(page: Page, seconds: number, untilHeight = Infinity, untilLevelHeight = Infinity): Promise<void> {
  // Le pilote est passé en texte : tsx réécrit les fonctions avec un helper `__name` qui n'existe pas dans la page.
  const script = `new Promise((done) => {
    const api = window.__grappin;
    const limitMs = ${seconds * 1000};
    const untilHeight = ${Number.isFinite(untilHeight) ? untilHeight : 'Infinity'};
    const untilLevelHeight = ${Number.isFinite(untilLevelHeight) ? untilLevelHeight : 'Infinity'};
    const start = performance.now();
    let holdSince = 0;
    let launchedAt = -1e9;
    const gap = (a, s) => Math.hypot(a.x - s.pos.x, a.y - s.pos.y);
    const tick = () => {
      const s = api.state();
      const now = performance.now();
      if (s.screen === 'dead' || s.screen === 'won' || now - start > limitMs || s.height >= untilHeight || s.levelHeight >= untilLevelHeight) { done(); return; }
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
  await page.evaluate(script);
}

/**
 * Fabrique le GIF : le ffmpeg de Playwright, réduit au strict minimum, sait
 * décoder la vidéo et écrire des PNG mais pas encoder un GIF. On extrait donc
 * des images réduites, puis on les quantifie et on les encode en Node.
 */
function encodeGif(ffmpeg: string, webm: string, gif: string): void {
  const framesDir = `${gif}.frames`;
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const result = spawnSync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-ss', String(GIF_START_SECONDS), '-t', String(GIF_SECONDS), '-i', webm, '-r', String(GIF_FPS), '-vf', `scale=${GIF_WIDTH}:-2`, join(framesDir, '%04d.png')],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.warn(`Extraction des images impossible, GIF omis : ${result.stderr.trim()}`);
    rmSync(framesDir, { recursive: true, force: true });
    return;
  }
  const files = readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort();
  const encoder = GIFEncoder();
  for (const file of files) {
    const png = PNG.sync.read(readFileSync(join(framesDir, file)));
    const rgba = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);
    const palette = quantize(rgba, 256, { format: 'rgb444' });
    const index = applyPalette(rgba, palette, 'rgb444');
    encoder.writeFrame(index, png.width, png.height, { palette, delay: Math.round(1000 / GIF_FPS) });
  }
  encoder.finish();
  writeFileSync(gif, encoder.bytes());
  rmSync(framesDir, { recursive: true, force: true });
  console.log(`GIF : ${gif} (${files.length} images)`);
}

/**
 * Les scènes du lot 2 (`playScene(id)` : un premier segment construit à la main pour chaque mécanique). Chaque prise a son contexte neuf,
 * l'horloge de la page figée avant la scène puis menée à la main, comme pour le pouls : l'image voulue est exacte, jamais à quelques images
 * près. La brume est lente, car on laisse le personnage s'attarder pour bien voir. Les pas par image sont ceux d'une image à 60 Hz.
 */
const SCENE_FOG = 0.1;
const STEPS_PER_FRAME = FRAME_MS / 1000 / DEFAULT_TUNING.stepSeconds;
/** Le pilote des scènes cherche jusqu'à ce nombre d'images (une dizaine de secondes) avant d'abandonner une prise. */
const SCENE_FRAMES = 700;
/** Images laissées après l'événement montré : le rebond (le personnage en vol vers le trou), la paroi cassable (la hauteur où elle s'allume, puis le fracas), l'anneau traversé. */
const REBOND_AFTER_FRAMES = 16;
const CASSABLE_LIT_Y = 15.2;
const CASSABLE_AFTER_FRAMES = 4;
const RING_AFTER_FRAMES = 2;

/** Mène l'horloge figée de la page jusqu'au pas de simulation `target` (à un pas ou deux près, par excès), par grands bonds puis image par image. */
async function advanceToStep(page: Page, target: number): Promise<number> {
  for (let guard = 0; guard < 1000; guard += 1) {
    const { step } = await page.evaluate(() => window.__grappin!.state());
    if (step >= target) return step;
    const frames = Math.max(1, Math.floor((target - step) / STEPS_PER_FRAME) - 1);
    await page.clock.runFor(frames * FRAME_MS);
  }
  throw new Error(`Le pas ${target} n'est jamais atteint`);
}

/** Une page neuve sur la scène `id`, l'horloge figée et la bannière d'intro encore intacte (à l'image 0). */
async function openScene(browser: Browser, id: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.clock.install({ time: 0 });
  await page.goto(`http://localhost:${PORT}/?graine=${seed}&fogBaseSpeed=${SCENE_FOG}`);
  await page.waitForFunction(() => window.__grappin?.state().screen === 'title');
  await page.clock.pauseAt(PULSE_CLOCK_MS);
  if (!(await page.evaluate((scene) => window.__grappin!.playScene(scene), id))) throw new Error(`Scène inconnue : ${id}`);
  return { page, close: () => context.close() };
}

/**
 * Le pilote des scènes (`scripts/pilote.ts`, les règles du robot) mène le personnage jusqu'à `until` (vrai sur l'état vu et la mémoire du
 * pilote), image par image ; `true` s'il y est arrivé avant `SCENE_FRAMES` images. Il rend la main à cet instant : le personnage reste là où il
 * est, corde tenue s'il en tenait une. Le temps est celui de la page depuis la scène, en millisecondes simulées.
 */
async function climbUntil(page: Page, until: (s: Seen, memory: PilotMemory) => boolean, options: PilotOptions = {}): Promise<boolean> {
  const memory = newMemory();
  for (let frame = 0; frame < SCENE_FRAMES; frame += 1) {
    await page.clock.runFor(FRAME_MS);
    const s = await pilotFrame(page, memory, frame * FRAME_MS, options);
    if (s.screen !== 'playing') return false;
    if (until(s, memory)) return true;
  }
  return false;
}

/** Les prises des scènes de zone : le nom de la scène, celui du fichier, l'espèce de zone attendue, et l'instant voulu (le personnage bien dans la zone, la colonne ou la bande entière autour de lui). */
const ZONE_SHOTS: readonly { readonly id: string; readonly file: string; readonly zone: ZoneKind; readonly ready: (s: Seen) => boolean }[] = [
  { id: 'courant', file: '32-scene-courant', zone: 'ascendant', ready: (s) => s.zone === 'ascendant' && s.pos.y >= 11 },
  { id: 'derive', file: '33-scene-derive', zone: 'lateral', ready: (s) => s.zone === 'lateral' && s.pos.y >= 10 },
  { id: 'fusee', file: '34-scene-fusee', zone: 'acceleration', ready: (s) => s.zone === 'acceleration' && s.pos.y >= 11 },
];

/**
 * Les scènes du lot 2, une ou plusieurs prises chacune, en 390 × 844. Les trois scènes dont le jeu exige la mécanique (0.12.1) se jouent par
 * le pilote des scènes (`scripts/pilote.ts`) : lanceur tenu en (0,4 ; 11), tir prouvé par le vérificateur (au cerceau, un tir qui traverse l'anneau), mur franchi par la mécanique.
 *  - 28-scene-rebond : le ricochet, lanceur tenu, bannière effacée : la chicane qui barre le tir direct, le mur de rebond à droite, le trou
 *    à gauche ; 28-scene-rebond-vol : quelques images après le rebond, le personnage en vol vers le trou ;
 *  - 29-scene-cassable : le mur à percer, lanceur tenu, paroi éteinte (la vitesse est nulle) ; 29-scene-cassable-allumee : en vol, la paroi
 *    allumée juste avant l'impact (la vitesse suffit à la traverser) ; 29-scene-cassable-fracas : quelques images après, « Fracas » ;
 *  - 30-scene-porte-ouverte, -avertit, -fermee : la porte aux trois moments de son cycle (contour tireté et jauge, clignotement, masse pleine),
 *    le personnage tenu au lanceur sous le mur ;
 *  - 31-scene-anneau : le cerceau, lanceur tenu, le mur dont le seul passage est l'anneau ; 31-scene-anneau-passage : l'anneau juste traversé,
 *    son éclat, « Au centre ! » ou « Anneau » et les traits de vitesse derrière le personnage ;
 *  - 32-scene-courant, 33-scene-derive, 34-scene-fusee : le personnage dans la zone (colonne du courant ascendant, bande de dérive,
 *    couloir d'accélération avec la zone de freinage au-dessus), bannière effacée.
 * Une prise que le parcours ne permet plus (réglages changés) est omise avec un avertissement, sans bloquer le banc.
 */
async function captureScenes(browser: Browser): Promise<void> {
  /** Le lanceur tenu, la bannière d'intro effacée : le pilote s'y accroche, puis on laisse passer l'intro (rien ne bouge tant qu'il n'a pas tiré). */
  const holdAtLauncher = async (page: Page, world: ReturnType<typeof sceneWorld>): Promise<boolean> => {
    if (!(await climbUntil(page, (s) => s.attached && s.heldKind === 'lanceur', { world, launchNotBefore: Infinity }))) return false;
    await page.clock.runFor(PULSE_INTRO_MS);
    return true;
  };
  /** Le personnage mené jusqu'à l'instant `until` par un tir qui ne part qu'une fois la bannière d'intro effacée (elle cacherait le haut de la prise). */
  const flyUntil = async (page: Page, world: ReturnType<typeof sceneWorld>, until: (s: Seen, memory: PilotMemory) => boolean, options: PilotOptions = {}): Promise<boolean> =>
    climbUntil(page, until, { world, launchNotBefore: PULSE_INTRO_MS, ...options });

  // Le ricochet : le lanceur tenu, la chicane, le mur de rebond et le trou sont dans la vue ; la bannière s'efface.
  if (wanted('rebond')) {
    const world = sceneWorld('rebond', seed);
    {
      const { page, close } = await openScene(browser, 'rebond');
      if (!(await holdAtLauncher(page, world))) console.warn('28-scene-rebond : le pilote n\'atteint pas le lanceur, prise omise');
      else {
        await page.screenshot({ path: join(outDir, '28-scene-rebond.png') });
        console.log(`Scène rebond : lanceur tenu, pas ${(await page.evaluate(() => window.__grappin!.state())).step}`);
      }
      await close();
    }
    // Le vol : quelques images après le rebond (la vitesse horizontale change de sens), le personnage repart vers le trou, « Rebond » flotte.
    {
      const { page, close } = await openScene(browser, 'rebond');
      const bounced = await flyUntil(page, world, (s, memory) => memory.launchedAt > 0 && !s.attached && s.vel.x < -2 && s.pos.y > 13.5);
      if (!bounced) console.warn('28-scene-rebond-vol : le tir ne rebondit pas sur le mur, prise omise');
      else {
        await page.clock.runFor(REBOND_AFTER_FRAMES * FRAME_MS);
        const s = await page.evaluate(() => window.__grappin!.state());
        await page.screenshot({ path: join(outDir, '28-scene-rebond-vol.png') });
        console.log(`Scène rebond en vol : (${s.pos.x.toFixed(1)}, ${s.pos.y.toFixed(1)}) m, vitesse (${s.vel.x.toFixed(1)}, ${s.vel.y.toFixed(1)}) m/s`);
      }
      await close();
    }
  }

  // Le mur à percer : lanceur tenu (paroi éteinte, la vitesse est nulle), puis en vol la paroi allumée juste avant l'impact, puis le fracas.
  if (wanted('cassable')) {
    const world = sceneWorld('cassable', seed);
    {
      const { page, close } = await openScene(browser, 'cassable');
      if (!(await holdAtLauncher(page, world))) console.warn('29-scene-cassable : le pilote n\'atteint pas le lanceur, prise omise');
      else {
        const s = await page.evaluate(() => window.__grappin!.state());
        await page.screenshot({ path: join(outDir, '29-scene-cassable.png') });
        console.log(`Scène cassable éteinte : vitesse ${Math.hypot(s.vel.x, s.vel.y).toFixed(1)} m/s (en dessous de ${DEFAULT_TUNING.smashSpeed}), hauteur ${s.pos.y.toFixed(1)} m`);
      }
      await close();
    }
    {
      // Le pilote n'attrape rien avant le fracas : le personnage arrive libre sur la paroi.
      const { page, close } = await openScene(browser, 'cassable');
      const lit = await flyUntil(page, world, (s, memory) => memory.launchedAt > 0 && !s.attached && s.smashed === 0 && s.pos.y >= CASSABLE_LIT_Y && Math.hypot(s.vel.x, s.vel.y) >= DEFAULT_TUNING.smashSpeed, { wait: (s, memory) => memory.launchedAt > 0 && s.smashed === 0 });
      if (!lit) console.warn('29-scene-cassable-allumee : le tir n\'arrive pas assez vite sous la paroi, prise omise');
      else {
        const s = await page.evaluate(() => window.__grappin!.state());
        await page.screenshot({ path: join(outDir, '29-scene-cassable-allumee.png') });
        console.log(`Scène cassable allumée : vitesse ${Math.hypot(s.vel.x, s.vel.y).toFixed(1)} m/s (au moins ${DEFAULT_TUNING.smashSpeed}), hauteur ${s.pos.y.toFixed(1)} m`);
        // Le fracas : quelques images plus loin, la paroi en éclats et le texte.
        await page.clock.runFor(CASSABLE_AFTER_FRAMES * FRAME_MS);
        const after = await page.evaluate(() => window.__grappin!.state());
        if (after.smashed < 1) console.warn('29-scene-cassable-fracas : la paroi n\'a pas cédé, prise omise');
        else {
          await page.screenshot({ path: join(outDir, '29-scene-cassable-fracas.png') });
          console.log(`Scène cassable après le fracas : ${after.smashed} paroi(s) cassée(s), hauteur ${after.pos.y.toFixed(1)} m`);
        }
      }
      await close();
    }
  }

  // La porte : le personnage tenu au lanceur (ou accroché assez haut), sous le mur à trou ; la bannière s'efface, puis le cycle de la porte
  // est mené pas à pas jusqu'à trois instants (la jauge à moitié ouverte, l'avertissement, la jauge à moitié fermée).
  if (wanted('porte')) {
    const { page, close } = await openScene(browser, 'porte');
    const door = new Simulation(seed, DEFAULT_TUNING, { kind: 'scene', sceneId: 'porte', startY: 0 }).state.obstacles.find((box) => box.kind === 'porte');
    const held = await climbUntil(page, (s) => s.attached && (s.heldKind === 'lanceur' || s.pos.y >= 9));
    if (!door || !held) console.warn('30-scene-porte : pas de porte, ou le pilote n\'atteint pas le mur, prises omises');
    else {
      await page.clock.runFor(PULSE_INTRO_MS);
      const now = (await page.evaluate(() => window.__grappin!.state())).step;
      // Le premier pas, à partir de maintenant, de chaque instant voulu ; on les prend dans l'ordre où ils viennent.
      const first = (wanted: (step: number) => boolean): number => {
        for (let step = now; step < now + 8 * Math.round(1 / DEFAULT_TUNING.stepSeconds); step += 1) if (wanted(step)) return step;
        return -1;
      };
      const moments: Array<[string, number]> = [
        ['30-scene-porte-ouverte', first((step) => doorState(door.id, step, DEFAULT_TUNING) === 'ouverte' && doorGauge(door.id, step, DEFAULT_TUNING) >= 0.5)],
        ['30-scene-porte-avertit', first((step) => doorState(door.id, step, DEFAULT_TUNING) === 'se ferme' && doorGauge(door.id, step, DEFAULT_TUNING) >= 0.88)],
        ['30-scene-porte-fermee', first((step) => doorState(door.id, step, DEFAULT_TUNING) === 'fermee' && doorGauge(door.id, step, DEFAULT_TUNING) >= 0.5)],
      ];
      for (const [name, target] of moments.filter(([, step]) => step >= 0).sort((a, b) => a[1] - b[1])) {
        const reached = await advanceToStep(page, target);
        await page.screenshot({ path: join(outDir, `${name}.png`) });
        console.log(`${name} : pas ${reached}, porte ${doorState(door.id, reached, DEFAULT_TUNING)}, jauge ${doorGauge(door.id, reached, DEFAULT_TUNING).toFixed(2)}`);
      }
      if (moments.some(([, step]) => step < 0)) console.warn('30-scene-porte : un instant du cycle n\'arrive pas en huit secondes, prise omise');
    }
    await close();
  }

  // Le cerceau : le lanceur tenu sous le mur dont le seul passage est l'anneau ; puis le tir qui le traverse (le pilote attend d'être passé
  // avant d'attraper la sortie), à l'image qui suit la traversée.
  if (wanted('anneau')) {
    const world = sceneWorld('anneau', seed);
    {
      const { page, close } = await openScene(browser, 'anneau');
      if (!(await holdAtLauncher(page, world))) console.warn('31-scene-anneau : le pilote n\'atteint pas le lanceur, prise omise');
      else {
        await page.screenshot({ path: join(outDir, '31-scene-anneau.png') });
        console.log(`Scène anneau : lanceur tenu, pas ${(await page.evaluate(() => window.__grappin!.state())).step}`);
      }
      await close();
    }
    {
      const { page, close } = await openScene(browser, 'anneau');
      const crossed = await flyUntil(page, world, (s) => s.rings >= 1, { shot: 'anneau', wait: (s, memory) => memory.launchedAt > 0 && s.rings < 1 });
      if (!crossed) console.warn('31-scene-anneau-passage : le tir ne traverse pas l\'anneau, prise omise');
      else {
        await page.clock.runFor(RING_AFTER_FRAMES * FRAME_MS);
        const s = await page.evaluate(() => window.__grappin!.state());
        await page.screenshot({ path: join(outDir, '31-scene-anneau-passage.png') });
        console.log(`Scène anneau, passage : ${s.rings} anneau(x) traversé(s), score ${Math.round(s.score)}, vitesse ${Math.hypot(s.vel.x, s.vel.y).toFixed(1)} m/s`);
      }
      await close();
    }
  }

  // Les zones : le personnage attend sur le toit que la bannière d'intro s'efface (elle cacherait le haut de la zone), puis le pilote le mène
  // jusqu'à l'instant voulu, dans la zone. La zone vit sur le temps réel de la page (horloge figée, menée à la main) : ses traînées sont
  // à des endroits précis, les mêmes à chaque prise.
  for (const shot of ZONE_SHOTS) {
    if (!wanted(shot.id)) continue;
    const { page, close } = await openScene(browser, shot.id);
    await page.clock.runFor(PULSE_INTRO_MS);
    const inside = await climbUntil(page, shot.ready);
    if (!inside) console.warn(`${shot.file} : le pilote n'entre pas dans la zone « ${shot.zone} », prise omise`);
    else {
      const s = await page.evaluate(() => window.__grappin!.state());
      await page.screenshot({ path: join(outDir, `${shot.file}.png`) });
      console.log(`${shot.file} : zone ${s.zone}, pas ${s.step}, hauteur ${s.pos.y.toFixed(1)} m, vitesse (${s.vel.x.toFixed(1)}, ${s.vel.y.toFixed(1)}) m/s, ${s.zones} zone(s) chargée(s)`);
    }
    await close();
  }
}

async function main(): Promise<void> {
  if (!existsSync('dist')) throw new Error('Aucun build : lancer `npm run build` d\'abord.');
  mkdirSync(outDir, { recursive: true });
  const videoDir = join(outDir, 'video-tmp');
  mkdirSync(videoDir, { recursive: true });
  const server = startPreview();
  try {
    await waitForServer(`http://localhost:${PORT}/`, 30_000);
    const executablePath = process.env['PW_CHROMIUM_PATH'];
    const browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    if (onlyScenes) {
      rmSync(videoDir, { recursive: true, force: true });
      await captureScenes(browser);
      await browser.close();
      return;
    }
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      recordVideo: { dir: videoDir, size: VIEWPORT },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`http://localhost:${PORT}/?graine=${seed}`);
    await page.waitForFunction(() => window.__grappin?.state().screen === 'title');
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, '01-accueil.png') });

    // Course libre, puis doigt posé et tenu : le grappin accroche, le personnage se balance.
    await page.evaluate(() => window.__grappin!.playFree());
    await page.waitForFunction(() => window.__grappin?.state().screen === 'playing');
    await page.evaluate(() => window.__grappin!.press());
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(outDir, '02-balancement.png') });
    await page.evaluate(() => window.__grappin!.release());
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, '03-vol-libre.png') });

    // Le pilote monte ; on capture la chaîne, puis le premier palier avec ses obstacles et sa fourche,
    // puis les accroches fragiles, tant qu'il survit : il ne sait pas éviter les obstacles.
    await autoplay(page, 30, 22);
    await page.screenshot({ path: join(outDir, '04-chaine.png') });
    await autoplay(page, 60, 58);
    await page.screenshot({ path: join(outDir, '05-obstacles-et-fourche.png') });
    await autoplay(page, 60, 112);
    await page.screenshot({ path: join(outDir, '06-fragiles.png') });
    const final = await page.evaluate(() => window.__grappin!.state());
    console.log(`Course libre du robot : ${final.height.toFixed(1)} m, score ${Math.round(final.score)}, écran ${final.screen}`);
    // Les pages du banc partagent le stockage du navigateur : cette partie, laissée à la brume, finirait un jour et sauvegarderait son
    // profil par-dessus celui des autres pages (leurs niveaux ouverts), au beau milieu de la suite. On la ramène au titre, où rien ne s'écrit.
    await page.evaluate(() => window.__grappin!.restart());

    // Un niveau : le premier, joué jusqu'à la ligne d'arrivée, puis l'écran de victoire et la liste des niveaux.
    const levelPage = await context.newPage();
    await levelPage.goto(`http://localhost:${PORT}/`);
    await levelPage.waitForFunction(() => window.__grappin?.state().screen === 'title');
    await levelPage.evaluate(() => window.__grappin!.resetProfile());
    await levelPage.evaluate(() => window.__grappin!.playLevel(1));
    await levelPage.waitForFunction(() => window.__grappin?.state().screen === 'playing');
    await levelPage.waitForTimeout(600);
    await levelPage.screenshot({ path: join(outDir, '08-niveau-depart.png') });
    await autoplay(levelPage, 90);
    await levelPage.waitForTimeout(800);
    await levelPage.screenshot({ path: join(outDir, '09-niveau-fin.png') });
    const levelState = await levelPage.evaluate(() => window.__grappin!.state());
    console.log(`Niveau 1 du robot : écran ${levelState.screen}, ${levelState.levelHeight.toFixed(1)} m sur ${levelState.goal ?? 0}`);
    await levelPage.evaluate(() => window.__grappin!.restart());
    await levelPage.waitForFunction(() => window.__grappin?.state().screen === 'title');
    await levelPage.waitForTimeout(300);
    await levelPage.screenshot({ path: join(outDir, '10-titre-apres-niveau.png') });

    // Le mode test : le titre qui le dit, puis la liste des niveaux tous ouverts, avec leurs événements.
    const testPage = await context.newPage();
    // Brume lente pour la course libre de la zone haute, où le pilote meurt vite ; un niveau garde sa propre brume.
    await testPage.goto(`http://localhost:${PORT}/?test=1&fogBaseSpeed=0.12`);
    await testPage.waitForFunction(() => window.__grappin?.state().screen === 'title');
    await testPage.waitForTimeout(300);
    await testPage.screenshot({ path: join(outDir, '17-mode-test-titre.png') });
    const levelsButton = (await testPage.evaluate(() => window.__grappin!.buttons())).find((b) => b.id === 'levels');
    if (levelsButton) {
      await testPage.evaluate(({ x, y }) => window.__grappin!.press(x, y), { x: levelsButton.x + levelsButton.width / 2, y: levelsButton.y + levelsButton.height / 2 });
      await testPage.evaluate(() => window.__grappin!.release());
      await testPage.waitForTimeout(300);
      await testPage.screenshot({ path: join(outDir, '18-mode-test-niveaux.png') });
      // La seconde page de la liste (niveaux 11 à 20), puis retour à la première pour la suite du scénario.
      await tapButton(testPage, 'suite');
      await testPage.waitForTimeout(300);
      await testPage.screenshot({ path: join(outDir, '18-mode-test-niveaux-suite.png') });
      await tapButton(testPage, 'precedents');
      await testPage.waitForTimeout(300);
      // Un niveau lointain lancé depuis la liste : le rappel « MODE TEST » pendant la partie.
      const row = (await testPage.evaluate(() => window.__grappin!.buttons())).find((b) => b.id === 'niveau-8');
      if (row) {
        await testPage.evaluate(({ x, y }) => window.__grappin!.press(x, y), { x: row.x + row.width / 2, y: row.y + row.height / 2 });
        await testPage.evaluate(() => window.__grappin!.release());
        await testPage.waitForFunction(() => window.__grappin?.state().screen === 'playing');
        await testPage.waitForTimeout(600);
        await testPage.screenshot({ path: join(outDir, '19-mode-test-partie.png') });
      }
    }
    // Le lanceur : le niveau 14 en mode test commence par un lanceur, à quatre mètres du toit. Le doigt posé s'y accroche, puis tire
    // vers le bas et à gauche (le trou du mur est à droite) : la fronde se bande, l'ombre montre le vol. Relâché, le personnage part à l'opposé.
    // La brume rattrape celui qui s'attarde : chaque image repart d'un niveau neuf, pour ne jamais photographier un écran de fin.
    await testPage.evaluate(() => {
      window.__grappin!.restart();
      window.__grappin!.unlockAll();
    });
    const pullShot = async (name: string, to: { x: number; y: number } | null, lift = false): Promise<void> => {
      await testPage.evaluate(() => window.__grappin!.playLevel(14));
      await testPage.waitForFunction(() => window.__grappin?.state().screen === 'playing');
      await testPage.mouse.move(250, 640);
      await testPage.mouse.down();
      // Le parcours du niveau 14 peut changer (réglages des niveaux, générateur) : sans lanceur sous le doigt, la prise est omise plutôt que de bloquer le banc.
      const held = await testPage
        .waitForFunction(() => window.__grappin?.state().heldKind === 'lanceur', undefined, { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (!held) {
        console.warn(`${name} : pas de lanceur à saisir au départ du niveau 14, prise omise`);
        await testPage.mouse.up();
        await testPage.evaluate(() => window.__grappin!.restart());
        return;
      }
      if (to) await testPage.mouse.move(to.x, to.y, { steps: 4 });
      await testPage.waitForTimeout(250);
      if (lift) {
        await testPage.mouse.up();
        await testPage.waitForTimeout(150);
      }
      await testPage.screenshot({ path: join(outDir, `${name}.png`) });
      const state = await testPage.evaluate(() => window.__grappin!.state());
      console.log(`${name} : traction (${state.pullX.toFixed(2)}, ${state.pullY.toFixed(2)}) m, personnage en (${state.pos.x.toFixed(2)}, ${state.pos.y.toFixed(2)}), écran ${state.screen}`);
      if (!lift) await testPage.mouse.up();
      await testPage.evaluate(() => window.__grappin!.restart());
    };
    await pullShot('22-lanceur-tenu', null);
    await pullShot('22-lanceur', { x: 225, y: 705 });
    await pullShot('22-lanceur-plein', { x: 205, y: 760 });
    await pullShot('23-lancer', { x: 215, y: 735 }, true);
    // Le pilote qui sait lancer, sur le même niveau : il vise le point au-dessus et passe le trou du mur.
    await testPage.evaluate(() => window.__grappin!.playLevel(14));
    await testPage.waitForFunction(() => window.__grappin?.state().screen === 'playing');
    await autoplay(testPage, 40, Number.POSITIVE_INFINITY, 18);
    const launched = await testPage.evaluate(() => window.__grappin!.state());
    console.log(`Niveau 14 du pilote : ${launched.levelHeight.toFixed(1)} m, écran ${launched.screen}`);

    // Les prises à cycles : la course libre du mode test part de la zone la plus haute, où elles abondent.
    await testPage.evaluate(() => window.__grappin!.restart());
    await testPage.waitForFunction(() => window.__grappin?.state().screen === 'title');
    await testPage.evaluate(() => {
      window.__grappin!.unlockAll();
      window.__grappin!.playFree();
    });
    await testPage.waitForFunction(() => window.__grappin?.state().screen === 'playing');
    const topStart = (await testPage.evaluate(() => window.__grappin!.state())).freeRunStartY;
    await autoplay(testPage, 30, topStart + 6);
    await testPage.waitForTimeout(400);
    await testPage.screenshot({ path: join(outDir, '20-prises-a-cycles.png') });
    await autoplay(testPage, 30, topStart + 16);
    await testPage.waitForTimeout(400);
    await testPage.screenshot({ path: join(outDir, '21-prises-a-cycles-suite.png') });
    await testPage.close();

    // Les événements : tous les niveaux ouverts, puis chaque événement attrapé à sa hauteur.
    await levelPage.evaluate(() => window.__grappin!.unlockAll());
    const shots: Array<[number, number, string]> = [
      [5, 25, '11-bascule'],
      [6, 20, '12-vent'],
      [4, 25, '13-panne'],
      [3, 20, '14-pluie'],
      [7, 15, '15-alerte'],
      [7, 45, '16-cables'],
    ];
    const ATTEMPTS = 5;
    for (const [id, at, name] of shots) {
      // Le pilote meurt parfois avant la hauteur voulue : on rejoue le niveau, quelques fois au plus.
      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        await levelPage.evaluate((levelId) => window.__grappin!.playLevel(levelId), id);
        await levelPage.waitForFunction(() => window.__grappin?.state().screen === 'playing');
        await autoplay(levelPage, 60, Number.POSITIVE_INFINITY, at + 3);
        const reached = await levelPage.evaluate(() => window.__grappin!.state());
        if ((reached.screen === 'playing' && reached.levelHeight >= at) || attempt === ATTEMPTS) break;
        await levelPage.evaluate(() => window.__grappin!.restart());
        await levelPage.waitForFunction(() => window.__grappin?.state().screen === 'title');
      }
      // Deux images : la bannière d'annonce encore affichée, puis l'événement installé, bannière effacée.
      await levelPage.waitForTimeout(800);
      await levelPage.screenshot({ path: join(outDir, `${name}-annonce.png`) });
      await levelPage.waitForTimeout(1800);
      await levelPage.screenshot({ path: join(outDir, `${name}.png`) });
      const st = await levelPage.evaluate(() => window.__grappin!.state());
      console.log(`Niveau ${id} : écran ${st.screen}, ${st.levelHeight.toFixed(1)} m, gravité x ${st.gravityX.toFixed(2)}, vent ${st.windX.toFixed(1)}`);
      await levelPage.evaluate(() => window.__grappin!.restart());
      await levelPage.waitForFunction(() => window.__grappin?.state().screen === 'title');
    }

    // Écran de fin : une partie à brume rapide où personne ne joue, pour montrer « Perdu ».
    const ending = await context.newPage();
    await ending.goto(`http://localhost:${PORT}/?graine=${seed}&fogBaseSpeed=6`);
    await ending.waitForFunction(() => window.__grappin?.state().screen === 'title');
    await ending.evaluate(() => window.__grappin!.playFree());
    await ending.evaluate(() => window.__grappin!.press());
    await ending.waitForTimeout(100);
    await ending.evaluate(() => window.__grappin!.release());
    await ending.waitForFunction(() => window.__grappin?.state().screen === 'dead', undefined, { timeout: 20_000 });
    await ending.waitForTimeout(200);
    await ending.screenshot({ path: join(outDir, '07-fin.png') });

    // La pause : une partie en cours, le doigt posé (la corde tenue), puis le bouton de pause en haut à droite. Le jeu reste visible,
    // figé, sous le voile ; « Reprendre » tombe sous le pouce, « Quitter » est plus discret, plus bas.
    const pausePage = await context.newPage();
    await pausePage.goto(`http://localhost:${PORT}/?graine=${seed}`);
    await pausePage.waitForFunction(() => window.__grappin?.state().screen === 'title');
    await pausePage.evaluate(() => window.__grappin!.playFree());
    await pausePage.waitForFunction(() => window.__grappin?.state().screen === 'playing');
    await pausePage.evaluate(() => window.__grappin!.press());
    await pausePage.waitForTimeout(700);
    await tapButton(pausePage, 'pause');
    await pausePage.waitForFunction(() => window.__grappin?.state().screen === 'paused');
    await pausePage.waitForFunction(() => window.__grappin?.buttons().some((b) => b.id === 'resume'));
    await pausePage.waitForTimeout(200);
    await pausePage.screenshot({ path: join(outDir, '25-pause.png') });
    const paused = await pausePage.evaluate(() => window.__grappin!.state());
    console.log(`Pause : écran ${paused.screen}, pas ${paused.step}, corde ${paused.attached ? 'tenue' : 'lâchée'}`);
    await pausePage.close();

    // Les ambiances : une image par famille de musique (niveaux 1, 3, 5, 7 et 9), après une seconde et demie de jeu, soit le fondu fini.
    // Le temps de jeu se compte en pas de simulation (cent vingt par seconde) et non à l'horloge : le rendu logiciel est lent, et le jeu
    // plafonne le temps de chaque image, si bien qu'une seconde et demie d'horloge peut n'être qu'une seconde de jeu.
    const palettePage = await context.newPage();
    await palettePage.goto(`http://localhost:${PORT}/?test=1`);
    await palettePage.waitForFunction(() => window.__grappin?.state().screen === 'title');
    await palettePage.evaluate(() => window.__grappin!.unlockAll());
    const families: Array<[number, string]> = [
      [1, 'biome1'],
      [3, 'biome2'],
      [5, 'biome3'],
      [7, 'biome4'],
      [9, 'boss'],
    ];
    for (const [id, family] of families) {
      await palettePage.evaluate((levelId) => window.__grappin!.playLevel(levelId), id);
      await palettePage.waitForFunction(() => window.__grappin?.state().screen === 'playing');
      await palettePage.waitForFunction((steps) => window.__grappin!.state().step >= steps, PALETTE_STEPS, { timeout: 30_000 });
      await palettePage.screenshot({ path: join(outDir, `palette-${family}.png`) });
      const st = await palettePage.evaluate(() => window.__grappin!.state());
      console.log(`Ambiance ${family} : niveau ${id}, palette ${st.palette}, écran ${st.screen}`);
      await palettePage.evaluate(() => window.__grappin!.restart());
      await palettePage.waitForFunction(() => window.__grappin?.state().screen === 'title');
    }
    await palettePage.close();

    // Le pouls : le métronome de `?pouls=120` fait battre l'ambiance sans son. Le niveau 3 (Indigo) montre la ville sur les côtés ;
    // une image sur le temps (le pouls vient de monter à plus de 0,9), une autre au creux (retombé sous 0,12), sur la même scène : le
    // personnage reste sur son toit. L'horloge de la page est figée avant le niveau (voir `stepPulse`), puis menée à la main.
    // Les pages des niveaux et de la fin ont fini leur travail : on les ferme, car chaque page ouverte fait tourner son rendu logiciel et
    // ralentit toutes les autres. Le pouls a son propre contexte, sans vidéo : l'horloge figée d'une page n'aime pas celui, chargé, du banc.
    await levelPage.close();
    await ending.close();
    const pulseContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const pulsePage = await pulseContext.newPage();
    await pulsePage.clock.install({ time: 0 });
    await pulsePage.goto(`http://localhost:${PORT}/?test=1&pouls=120`);
    await pulsePage.waitForFunction(() => window.__grappin?.state().screen === 'title');
    await pulsePage.evaluate(() => window.__grappin!.unlockAll());
    await pulsePage.evaluate(() => window.__grappin!.playLevel(3));
    await pulsePage.waitForFunction(() => window.__grappin?.state().screen === 'playing');
    await pulsePage.clock.pauseAt(PULSE_CLOCK_MS);
    // L'intro du niveau (trois secondes) a le temps de s'effacer, à l'image près.
    await pulsePage.clock.runFor(PULSE_INTRO_MS);
    const onBeat = await stepPulse(pulsePage, (pulse) => pulse > 0.9);
    await pulsePage.screenshot({ path: join(outDir, '24-pouls-temps.png') });
    const trough = await stepPulse(pulsePage, (pulse) => pulse < 0.12);
    await pulsePage.screenshot({ path: join(outDir, '24-pouls-creux.png') });
    const st = await pulsePage.evaluate(() => window.__grappin!.state());
    console.log(`Pouls : image du temps à ${onBeat.toFixed(2)}, du creux à ${trough.toFixed(2)}, ${st.bpm} bpm, palette ${st.palette}, écran ${st.screen}`);
    await pulseContext.close();

    // La fenêtre de lâcher et le premier conseil : un contexte neuf (un profil vierge, donc un tutoriel qui n'a rien montré), l'horloge de la
    // page figée avant la partie comme pour le pouls, puis le doigt posé et les images menées une à une. La corde, le halo du personnage
    // et l'ombre passent à la teinte chaude pendant la fenêtre : on photographie la première image où `state().releaseWindow` est vrai.
    // Le conseil « Garde le doigt posé » se dessine dès l'accroche ; on le photographie une fois son fondu d'entrée fini, avant la fenêtre.
    const windowContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const windowPage = await windowContext.newPage();
    await windowPage.clock.install({ time: 0 });
    await windowPage.goto(`http://localhost:${PORT}/?graine=${seed}`);
    await windowPage.waitForFunction(() => window.__grappin?.state().screen === 'title');
    await windowPage.clock.pauseAt(PULSE_CLOCK_MS);
    await windowPage.evaluate(() => window.__grappin!.playFree());
    await windowPage.evaluate(() => window.__grappin!.press());
    let tipShot = false;
    let tipSince = -1;
    let windowStep = -1;
    for (let frame = 0; frame < 400 && windowStep < 0; frame += 1) {
      await windowPage.clock.runFor(FRAME_MS);
      const st = await windowPage.evaluate(() => window.__grappin!.state());
      if (st.tip !== null && tipSince < 0) tipSince = frame;
      // Le fondu d'entrée d'une bannière dure un quart de seconde, une quinzaine d'images.
      if (!tipShot && !st.releaseWindow && st.tip !== null && frame - tipSince >= 20) {
        await windowPage.screenshot({ path: join(outDir, '27-conseil.png') });
        tipShot = true;
        console.log(`Conseil : « ${st.tip} », image ${frame}`);
      }
      if (st.releaseWindow) {
        await windowPage.screenshot({ path: join(outDir, '26-fenetre-de-lacher.png') });
        windowStep = st.step;
      }
    }
    if (windowStep < 0) console.warn('26-fenetre-de-lacher : la fenêtre de lâcher ne s\'ouvre pas en 400 pas, prise omise');
    else console.log(`Fenêtre de lâcher : ouverte au pas ${windowStep}`);
    if (!tipShot) console.warn('27-conseil : aucun conseil affiché avant la fenêtre de lâcher, prise omise');
    await windowContext.close();

    // Les scènes de démonstration du lot 2 : rebond, paroi cassable, porte, anneaux.
    await captureScenes(browser);

    if (errors.length > 0) console.warn('Erreurs console :', errors);

    const videoPath = await page.video()?.path();
    await context.close();
    await browser.close();
    const videos = readdirSync(videoDir).filter((f) => f.endsWith('.webm') && (!videoPath || videoPath.endsWith(f)));
    console.log(`Vidéos enregistrées : ${readdirSync(videoDir).join(', ') || 'aucune'}`);
    if (videos[0]) {
      const webm = join(outDir, 'partie.webm');
      renameSync(join(videoDir, videos[0]), webm);
      const ffmpeg = process.env['FFMPEG_PATH'];
      if (ffmpeg && existsSync(ffmpeg)) encodeGif(ffmpeg, webm, join(outDir, 'partie.gif'));
    }
    rmSync(videoDir, { recursive: true, force: true });
  } finally {
    if (server.pid !== undefined) process.kill(-server.pid, 'SIGTERM');
    else server.kill();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

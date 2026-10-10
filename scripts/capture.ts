import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';

// Le paquet est en CommonJS avec des accesseurs : Node ne voit pas ses exports nommés, on passe par l'export par défaut.
const { GIFEncoder, applyPalette, quantize } = gifenc;

/**
 * Captures de livraison : lance le build en prévisualisation, joue une partie
 * scénarisée sur un écran de téléphone simulé, et dépose des captures d'écran
 * ainsi qu'une courte vidéo convertie en GIF.
 *
 * Usage : `npm run captures -- <dossier de sortie> [graine]`. Le build doit
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

const PORT = 4175;
const VIEWPORT = { width: 390, height: 844 };
const outDir = resolve(process.argv[2] ?? 'captures');
const seed = Number(process.argv[3] ?? '1');

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
  return spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
}

/**
 * Pilote automatique injecté dans la page, même stratégie que `scripts/robot.ts` :
 * accroche dès qu'un point est visé, garde le doigt posé jusqu'à une vitesse
 * cible ou une corde au plus court, lâche dans la fenêtre du lâcher parfait,
 * jamais plus de deux secondes et demie pendu. Il passe par la même API que
 * les tests de fumée, jusqu'à la mort ou la fin du temps imparti.
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
    const tick = () => {
      const s = api.state();
      const now = performance.now();
      if (s.screen === 'dead' || s.screen === 'won' || now - start > limitMs || s.height >= untilHeight || s.levelHeight >= untilLevelHeight) { done(); return; }
      if (!s.attached && s.targetId !== null) {
        api.press();
        holdSince = now;
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
    server.kill();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

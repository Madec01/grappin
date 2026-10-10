import { expect, test, type Page } from '@playwright/test';
import { LEVELS, levelById } from '../src/data/levels';

/**
 * Test de fumée sur écran de téléphone (390 × 844, tactile) : la page charge,
 * un doigt posé accroche le grappin, le relâcher libère le personnage, la
 * graine d'URL est respectée, un pilote automatique grimpe sans erreur, la
 * progression (expérience, sauvegarde, talismans, boutons, niveaux et étoiles)
 * tient d'une partie et d'un rechargement à l'autre, la bascule du niveau 5
 * se joue sans erreur, la liste des niveaux se tourne en deux pages, et le
 * lanceur se tire au doigt (souris et toucher) puis se franchit au pilote
 * automatique. Tout passe par `window.__grappin`.
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
    await expect.poll(async () => (await state(page)).screen, { timeout: 500 }).toBe('playing');
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
        if (now - holdSince > 150) {
          let best = null;
          for (const a of api.anchors()) {
            if (a.kind !== 'normal' || a.y < s.pos.y + 1) continue;
            const d = gap(a, s);
            if (!best || d < best.d) best = { x: a.x - s.pos.x, y: a.y - s.pos.y, d };
          }
          const dir = best || { x: 0, y: 1, d: 1 };
          api.release((-dir.x / dir.d) * 1.75, (-dir.y / dir.d) * 1.75);
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
  await expect.poll(async () => (await buttons(page)).map((button) => button.id)).toEqual(['levels', 'free', 'talismans']);

  await page.touchscreen.tap(CENTER.x, CENTER.y);
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
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

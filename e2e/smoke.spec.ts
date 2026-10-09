import { expect, test, type Page } from '@playwright/test';

/**
 * Test de fumée sur écran de téléphone (390 × 844, tactile) : la page charge,
 * un doigt posé accroche le grappin, le relâcher libère le personnage, la
 * graine d'URL est respectée, un pilote automatique grimpe sans erreur, et la
 * progression (expérience, sauvegarde, talismans, boutons) tient d'une partie
 * et d'un rechargement à l'autre. Tout passe par `window.__grappin`.
 */

const CENTER = { x: 195, y: 422 };

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
 * jamais plus de 2,5 s tenu. Il rend la main quand le personnage dépasse
 * `targetHeight` mètres, meurt, ou après `limitMs`. Passé en texte à
 * `page.evaluate` : tsx réécrit les fonctions avec un helper `__name` qui n'existe pas dans la page.
 */
function autopilot(targetHeight: number, limitMs: number): string {
  return `new Promise((done) => {
    const api = window.__grappin;
    const start = performance.now();
    let holdSince = 0;
    const tick = () => {
      const s = api.state();
      const now = performance.now();
      if (s.screen === 'dead' || s.height > ${targetHeight} || now - start > ${limitMs}) { done(); return; }
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
}

test('un pilote automatique grimpe au-delà de 10 m sans erreur de console', async ({ page }) => {
  const errors = watchErrors(page);
  // Brume ralentie : sur les machines lentes de l'intégration continue, le pilote réagit à la cadence
  // des images, donc mal ; ce test vérifie que le jeu tourne sans erreur, pas l'adresse du pilote.
  await open(page, '/?graine=3&fogBaseSpeed=0.15');
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
  await expect.poll(async () => (await buttons(page)).map((button) => button.id)).toEqual(['talismans']);

  await page.touchscreen.tap(CENTER.x, CENTER.y);
  await expect.poll(async () => (await state(page)).screen).toBe('playing');
  expect(errors).toEqual([]);
});

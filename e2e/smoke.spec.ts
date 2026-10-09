import { expect, test, type Page } from '@playwright/test';

/**
 * Test de fumée sur écran de téléphone (390 × 844, tactile) : la page charge,
 * un doigt posé accroche le grappin, le relâcher libère le personnage, et la
 * graine d'URL est respectée. Tout passe par `window.__grappin`.
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

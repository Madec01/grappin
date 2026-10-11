import { expect, test } from '@playwright/test';

/**
 * L'installation sur un téléphone : le manifeste et les icônes sont servis, le
 * service worker prend la page en main, et le jeu se relance sans réseau.
 */

test('installation : manifeste, icônes, service worker, et le jeu se relance hors-ligne', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__grappin !== undefined);

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', 'icones/icone-180.png');
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const data = (await manifest.json()) as { name: string; display: string; start_url: string; icons: { src: string; sizes: string; purpose?: string }[] };
  expect(data.name).toBe('GRAPPIN');
  expect(data.display).toBe('standalone');
  expect(data.start_url).toBe('./');
  expect(data.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512', '512x512']);
  expect(data.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  for (const file of [...data.icons.map((icon) => icon.src), 'icones/icone-180.png']) {
    const icon = await page.request.get(`/${file}`);
    expect(icon.ok(), file).toBe(true);
    expect(icon.headers()['content-type'], file).toContain('image/png');
  }

  // Le service worker s'installe, puis prend la page en main.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });
  const version = await page.evaluate(() => window.__grappin!.version);

  // Sans réseau, la page, le code et les icônes viennent du cache : le jeu démarre.
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__grappin !== undefined, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__grappin!.version)).toBe(version);
  expect(await page.evaluate(() => window.__grappin!.state().screen)).toBe('title');
  const icon = await page.evaluate(async () => (await fetch('icones/icone-192.png')).ok);
  expect(icon).toBe(true);
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

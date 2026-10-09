import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Configuration Vite.
 *
 * `GRAPPIN_BASE` permet de construire le jeu pour un sous-chemin, par exemple
 * `/grappin/` sur GitHub Pages. En local la base reste `/`.
 */
export default defineConfig({
  base: process.env['GRAPPIN_BASE'] ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: true,
  },
});

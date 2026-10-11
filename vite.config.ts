import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { serviceWorker } from './scripts/pwa.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Configuration Vite.
 *
 * `GRAPPIN_BASE` permet de construire le jeu pour un sous-chemin, par exemple
 * `/grappin/` sur GitHub Pages. En local la base reste `/`. Le service worker
 * (`src/sw/sw.ts`, construit par `scripts/pwa.ts`) rend le jeu installable et
 * jouable hors-ligne ; il garde la coquille du jeu et les fichiers publics
 * listés ici.
 */
export default defineConfig({
  base: process.env['GRAPPIN_BASE'] ?? '/',
  plugins: [
    serviceWorker({
      entry: 'src/sw/sw.ts',
      version: pkg.version,
      extras: ['manifest.webmanifest', 'icones/icone.svg', 'icones/icone-192.png', 'icones/icone-512.png', 'icones/icone-maskable-512.png', 'icones/icone-180.png'],
    }),
  ],
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

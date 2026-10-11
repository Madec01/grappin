import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * L'extension Vite qui construit le service worker (`src/sw/sw.ts`) à côté du
 * jeu, sous le nom `sw.js`, et lui injecte la liste des fichiers de la coquille
 * à garder hors-ligne : la page, le code et les styles produits par le build,
 * plus les fichiers publics nommés dans `extras` (manifeste, icônes). La version
 * du cache change dès qu'un de ces fichiers change, puisque les noms des
 * fichiers du build portent leur empreinte.
 */

export interface ServiceWorkerOptions {
  /** Le fichier source du service worker, relatif à la racine du projet. */
  readonly entry: string;
  /** Version de l'application, qui préfixe celle du cache. */
  readonly version: string;
  /** Fichiers de `public/` à garder hors-ligne, relatifs à la racine du site. */
  readonly extras: readonly string[];
}

/** Nom du fichier produit. */
export const SERVICE_WORKER_FILE = 'sw.js';

/** La page, que Vite n'ajoute au build qu'après le passage des extensions : toujours de la coquille. */
export const PAGE_FILE = 'index.html';

/** Les fichiers de la coquille : la page, ceux du build sauf le service worker lui-même et les cartes de source, plus les extras, triés et sans doublon. */
export function precacheFiles(built: readonly string[], extras: readonly string[]): string[] {
  const kept = built.filter((file) => file !== SERVICE_WORKER_FILE && !file.endsWith('.map'));
  return [...new Set([PAGE_FILE, ...kept, ...extras])].sort();
}

/** La version du cache : celle de l'application, et une empreinte courte de la liste des fichiers. */
export function cacheVersion(version: string, files: readonly string[]): string {
  const digest = createHash('sha1').update(files.join('\n')).digest('hex').slice(0, 8);
  return `${version}-${digest}`;
}

/** Remplace, dans le code du service worker, les deux constantes injectées au build. */
export function injectManifest(code: string, files: readonly string[], version: string): string {
  const withFiles = code.replace(/\b__PRECACHE__\b/g, JSON.stringify(files));
  const withVersion = withFiles.replace(/\b__CACHE_VERSION__\b/g, JSON.stringify(version));
  if (withVersion === code) throw new Error('service worker : aucune constante à injecter trouvée dans le code');
  return withVersion;
}

export function serviceWorker(options: ServiceWorkerOptions): Plugin {
  return {
    name: 'grappin:service-worker',
    apply: 'build',
    buildStart() {
      this.emitFile({ type: 'chunk', id: resolve(options.entry), fileName: SERVICE_WORKER_FILE, preserveSignature: false });
    },
    generateBundle(_output, bundle) {
      const worker = bundle[SERVICE_WORKER_FILE];
      if (!worker || worker.type !== 'chunk') throw new Error(`service worker : ${SERVICE_WORKER_FILE} absent du build`);
      const files = precacheFiles(Object.keys(bundle), options.extras);
      worker.code = injectManifest(worker.code, files, cacheVersion(options.version, files));
    },
  };
}

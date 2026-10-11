/// <reference lib="webworker" />
import { parseRange, partialHeaders, wantsWhole } from './ranges';

/**
 * Le service worker : ce qui fait du jeu une application installable, et qui
 * se lance sans réseau.
 *
 * À l'installation, il garde la coquille du jeu (la page, le code, le manifeste,
 * les icônes : la liste `__PRECACHE__`, injectée au build par `scripts/pwa.ts`)
 * dans un cache nommé d'après la version. Ensuite :
 * - la page elle-même se demande d'abord au réseau, pour avoir toujours la
 *   dernière version en ligne, et se lit dans le cache hors-ligne ;
 * - le code et les icônes, nommés par leur empreinte, se lisent dans le cache ;
 * - les musiques se gardent dans un cache à part, commun à toutes les versions,
 *   à leur première écoute : hors-ligne, une piste déjà entendue joue, une
 *   piste jamais entendue reste muette (le jeu tolère un lecteur qui échoue) ;
 *   les demandes partielles des lecteurs audio sont servies tranche par tranche ;
 * - les fichiers de rythme suivent le même cache, réseau d'abord.
 * Une nouvelle version prend la main dès son installation et jette les caches
 * de coquille des versions passées.
 */

declare const self: ServiceWorkerGlobalScope;
/** Injectés au build : les fichiers de la coquille, relatifs à la racine du site, et la version du cache. */
declare const __PRECACHE__: readonly string[];
declare const __CACHE_VERSION__: string;

const SHELL_CACHE = `grappin-coquille-${__CACHE_VERSION__}`;
const MEDIA_CACHE = 'grappin-musique';
const scope = self.registration.scope;
const indexUrl = new URL('index.html', scope).href;
const shellUrls = new Set(__PRECACHE__.map((file) => new URL(file, scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([...shellUrls]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('grappin-coquille-') && key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // L'adresse sans ses paramètres (`?test=1`, `?graine=`) : c'est le fichier qui compte.
  const file = url.origin + url.pathname;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, indexUrl));
  } else if (shellUrls.has(file)) {
    event.respondWith(cacheFirst(SHELL_CACHE, file, request));
  } else if (url.pathname.endsWith('.mp3')) {
    event.respondWith(media(event, request, file));
  } else if (url.pathname.endsWith('.rythme.json')) {
    event.respondWith(networkFirst(request, MEDIA_CACHE, file));
  }
});

/** Le réseau d'abord, et le cache gardé à jour ; hors-ligne, le cache. */
async function networkFirst(request: Request, cacheName: string, key: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch {
    const cached = await cache.match(key);
    return cached ?? Response.error();
  }
}

/** Le cache d'abord ; sinon le réseau, et la réponse gardée. */
async function cacheFirst(cacheName: string, key: string, request: Request): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(key, response.clone());
  return response;
}

/**
 * Une musique. En cache : servie entière, ou par tranche si le lecteur en
 * demande une. Pas en cache et demandée entière : téléchargée une fois, le flux
 * part au lecteur pendant qu'une copie se garde. Pas en cache et demandée par
 * tranche (certains lecteurs sondent d'abord quelques octets) : la tranche vient
 * du réseau telle quelle, et le fichier entier se garde en tâche de fond.
 */
async function media(event: FetchEvent, request: Request, file: string): Promise<Response> {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(file);
  const rangeHeader = request.headers.get('range');
  if (cached) {
    if (rangeHeader === null) return cached;
    const blob = await cached.blob();
    const range = parseRange(rangeHeader, blob.size);
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
    return new Response(blob.slice(range.start, range.end + 1), { status: 206, headers: partialHeaders(cached.headers, range, blob.size) });
  }
  if (wantsWhole(rangeHeader)) {
    const response = await fetch(file);
    if (!response.ok || !response.body) return response;
    const [toPlayer, toCache] = response.body.tee();
    event.waitUntil(cache.put(file, new Response(toCache, { status: 200, headers: response.headers })));
    return new Response(toPlayer, { status: 200, headers: response.headers });
  }
  event.waitUntil(
    fetch(file)
      .then((whole) => (whole.ok ? cache.put(file, whole) : undefined))
      .catch(() => undefined),
  );
  return fetch(request);
}

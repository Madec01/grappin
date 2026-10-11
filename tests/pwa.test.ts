import { describe, expect, it } from 'vitest';
import { SERVICE_WORKER_FILE, cacheVersion, injectManifest, precacheFiles } from '../scripts/pwa';

describe('la coquille hors-ligne', () => {
  it('garde la page, les fichiers du build sauf le service worker et les cartes de source, plus les extras, triés et sans doublon', () => {
    const files = precacheFiles(['assets/index-abc.js', 'assets/index-abc.js.map', SERVICE_WORKER_FILE, 'sw.js.map', 'assets/index-abc.css'], ['manifest.webmanifest', 'index.html']);
    expect(files).toEqual(['assets/index-abc.css', 'assets/index-abc.js', 'index.html', 'manifest.webmanifest']);
  });

  it('la version du cache suit celle de l\'application et le contenu de la liste', () => {
    const a = cacheVersion('0.7.0', ['index.html', 'assets/index-abc.js']);
    const b = cacheVersion('0.7.0', ['index.html', 'assets/index-def.js']);
    expect(a).toMatch(/^0\.7\.0-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(cacheVersion('0.7.0', ['index.html', 'assets/index-abc.js'])).toBe(a);
  });

  it('injecte la liste et la version dans le code, et refuse un code sans constante', () => {
    const code = 'const a=__PRECACHE__.map(f=>f);const v=__CACHE_VERSION__;';
    expect(injectManifest(code, ['index.html'], '0.7.0-1234abcd')).toBe('const a=["index.html"].map(f=>f);const v="0.7.0-1234abcd";');
    expect(() => injectManifest('rien', [], 'v')).toThrow();
  });
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Dessine les icônes de l'application installée, dans le style néon du jeu :
 * un anneau de visée cyan à halo, la corde qui y monte depuis le personnage,
 * sur le fond nuit. Le dessin est un SVG construit ici, rendu en PNG par
 * Chromium aux tailles demandées. À relancer si le dessin change :
 * `npm run icones`. `PW_CHROMIUM_PATH` désigne un Chromium déjà installé.
 *
 * - `icone.svg`, `icone-192.png`, `icone-512.png` : coins arrondis, le dessin
 *   occupe l'icône (Android, bureau, favicon) ;
 * - `icone-maskable-512.png` : fond plein bord à bord et dessin resserré dans
 *   la zone sûre, pour les formes qu'Android découpe lui-même ;
 * - `icone-180.png` : fond plein, pour l'écran d'accueil d'iOS, qui arrondit
 *   les coins à sa manière.
 */

const OUT = join(import.meta.dirname, '..', 'public', 'icones');
const NIGHT = '#070b16';
const HALO = '#38e8ff';
const TUBE = '#e6fbff';

/** Le dessin : `rounded` arrondit les coins du fond, `scale` resserre le motif vers le centre. */
function icon(rounded: boolean, scale: number): string {
  const rope = 'M136 400 Q 200 300 330 190';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <filter id="large" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="16" /></filter>
    <filter id="small" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="5" /></filter>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${NIGHT}" />
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="${rope}" stroke="${HALO}" stroke-width="18" fill="none" stroke-linecap="round" opacity="0.45" filter="url(#large)" />
    <path d="${rope}" stroke="${HALO}" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.7" filter="url(#small)" />
    <path d="${rope}" stroke="${TUBE}" stroke-width="5" fill="none" stroke-linecap="round" />
    <circle cx="352" cy="168" r="66" stroke="${HALO}" stroke-width="30" fill="none" opacity="0.5" filter="url(#large)" />
    <circle cx="352" cy="168" r="66" stroke="${HALO}" stroke-width="16" fill="none" opacity="0.75" filter="url(#small)" />
    <circle cx="352" cy="168" r="66" stroke="${TUBE}" stroke-width="9" fill="none" />
    <circle cx="352" cy="168" r="18" fill="${HALO}" opacity="0.8" filter="url(#small)" />
    <circle cx="352" cy="168" r="13" fill="${TUBE}" />
    <circle cx="136" cy="400" r="34" fill="${HALO}" opacity="0.5" filter="url(#large)" />
    <circle cx="136" cy="400" r="24" fill="${HALO}" opacity="0.75" filter="url(#small)" />
    <circle cx="136" cy="400" r="19" fill="${TUBE}" />
  </g>
</svg>
`;
}

const TARGETS: readonly { file: string; size: number; rounded: boolean; scale: number }[] = [
  { file: 'icone-192.png', size: 192, rounded: true, scale: 1 },
  { file: 'icone-512.png', size: 512, rounded: true, scale: 1 },
  { file: 'icone-maskable-512.png', size: 512, rounded: false, scale: 0.78 },
  { file: 'icone-180.png', size: 180, rounded: false, scale: 1 },
];

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icone.svg'), icon(true, 1));
const chromiumPath = process.env['PW_CHROMIUM_PATH'];
const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath } : {});
for (const target of TARGETS) {
  const page = await browser.newPage({ viewport: { width: target.size, height: target.size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${target.size}px;height:${target.size}px}</style></head><body>${icon(target.rounded, target.scale)}</body></html>`,
  );
  await page.screenshot({ path: join(OUT, target.file), omitBackground: true, type: 'png' });
  await page.close();
  console.log(`${target.file} : ${target.size} px`);
}
await browser.close();

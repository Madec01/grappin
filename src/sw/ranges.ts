/**
 * Les demandes partielles (en-tête `Range`) des lecteurs audio, pour servir une
 * musique gardée en cache morceau par morceau, comme le ferait un serveur.
 * Sans effet de bord : le service worker (`sw.ts`) s'en sert, les tests aussi.
 */

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/**
 * La tranche demandée par `bytes=a-b`, `bytes=a-` ou `bytes=-n`, bornée à la
 * taille du fichier ; null si l'en-tête est absent, illisible ou hors du fichier.
 */
export function parseRange(header: string | null, size: number): ByteRange | null {
  if (header === null || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, fromText, toText] = match;
  if (fromText === '' && toText === '') return null;
  if (fromText === '') {
    const suffix = Number(toText);
    if (suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(fromText);
  const end = toText === '' ? size - 1 : Math.min(size - 1, Number(toText));
  if (start >= size || end < start) return null;
  return { start, end };
}

/** Vrai quand la demande veut le fichier entier : pas d'en-tête, ou `bytes=0-`. */
export function wantsWhole(header: string | null): boolean {
  return header === null || /^bytes=0-$/.test(header.trim());
}

/** Les en-têtes d'une réponse partielle (206) pour la tranche `range` d'un fichier de `size` octets. */
export function partialHeaders(source: Headers, range: ByteRange, size: number): Headers {
  const headers = new Headers();
  const type = source.get('content-type');
  if (type) headers.set('Content-Type', type);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('Content-Length', String(range.end - range.start + 1));
  return headers;
}

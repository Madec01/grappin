import { describe, expect, it } from 'vitest';
import { parseRange, partialHeaders, wantsWhole } from '../src/sw/ranges';

describe('les demandes partielles', () => {
  it('lit une tranche, une tranche ouverte et un suffixe, bornés au fichier', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange(' bytes=0-1 ', 1000)).toEqual({ start: 0, end: 1 });
  });

  it('refuse ce qui est absent, illisible ou hors du fichier', () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('octets=0-1', 1000)).toBeNull();
    expect(parseRange('bytes=-', 1000)).toBeNull();
    expect(parseRange('bytes=1000-', 1000)).toBeNull();
    expect(parseRange('bytes=10-5', 1000)).toBeNull();
    expect(parseRange('bytes=-0', 1000)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull();
    expect(parseRange('bytes=0-', 0)).toBeNull();
  });

  it('sait quand le fichier entier est voulu', () => {
    expect(wantsWhole(null)).toBe(true);
    expect(wantsWhole('bytes=0-')).toBe(true);
    expect(wantsWhole('bytes=0-1')).toBe(false);
    expect(wantsWhole('bytes=100-')).toBe(false);
  });

  it('écrit les en-têtes d\'une réponse partielle', () => {
    const headers = partialHeaders(new Headers({ 'content-type': 'audio/mpeg', 'x-autre': 'non' }), { start: 10, end: 19 }, 100);
    expect(headers.get('Content-Type')).toBe('audio/mpeg');
    expect(headers.get('Content-Range')).toBe('bytes 10-19/100');
    expect(headers.get('Content-Length')).toBe('10');
    expect(headers.get('Accept-Ranges')).toBe('bytes');
    expect(headers.get('x-autre')).toBeNull();
    expect(partialHeaders(new Headers(), { start: 0, end: 0 }, 1).get('Content-Type')).toBeNull();
  });
});

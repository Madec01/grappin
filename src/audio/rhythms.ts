import { rhythmFile, type TrackId } from '../data/musique';
import { decodeRhythm, type Rhythm } from './rhythm';

/**
 * D'où viennent les rythmes des pistes. Le jeu en demande un à chaque image ;
 * tant qu'il n'est pas là (fichier en cours de chargement, absent, ou illisible),
 * la réponse est null et le rendu reste immobile : un rythme manquant ne casse
 * rien, il ne fait que ne pas pulser.
 */
export interface RhythmSource {
  get(id: TrackId): Rhythm | null;
}

/** Ce qu'il faut du navigateur : lire un fichier texte à une adresse. Injecté, pour les tests. */
export type TextFetcher = (url: string) => Promise<string>;

/** Le lecteur de fichiers du navigateur ; une réponse en erreur lève. */
export function browserFetcher(): TextFetcher {
  return async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} : ${response.status}`);
    return response.text();
  };
}

/**
 * Les rythmes lus depuis `public/musique/`, chargés à la première demande et
 * gardés ensuite. Un fichier qui manque ou qui est illisible est noté absent,
 * sans nouvel essai : la piste joue alors sans pouls.
 */
export function browserRhythms(base: string, fetcher: TextFetcher = browserFetcher()): RhythmSource {
  const loaded = new Map<TrackId, Rhythm | null>();
  const pending = new Set<TrackId>();
  return {
    get(id) {
      const known = loaded.get(id);
      if (known !== undefined) return known;
      if (!pending.has(id)) {
        pending.add(id);
        fetcher(base + rhythmFile(id))
          .then((text) => loaded.set(id, decodeRhythm(text)))
          .catch(() => loaded.set(id, null))
          .finally(() => pending.delete(id));
      }
      return null;
    },
  };
}

/** Aucun rythme : les tests, et le jeu quand rien n'est branché. */
export function silentRhythms(): RhythmSource {
  return { get: () => null };
}

/** Le même rythme pour toute piste, pour les tests. */
export function fixedRhythms(rhythm: Rhythm): RhythmSource {
  return { get: () => rhythm };
}

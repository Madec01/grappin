import type { LevelDef } from '../data/levels';
import { levelFor } from './levels';
import { nextMissions, settleMissions, type MissionDef, type MissionState, type RunStats } from './missions';
import { TALISMANS, slotsFor, talismanById, type Talisman, type TalismanId } from './talismans';
import { FIRST_CLEAR_XP, STAR_XP, levelStars, type LevelResult } from './traversee';

/**
 * Profil du joueur : expérience, records, talismans équipés, missions. Il est
 * sauvegardé sur l'appareil après chaque partie, en données simples
 * versionnées. La lecture est tolérante : une sauvegarde absente, corrompue
 * ou d'une autre version donne un profil neuf, sans erreur.
 */

export const PROFILE_VERSION = 1;
/** Missions actives à la fois. */
export const ACTIVE_MISSIONS = 3;
/** L'indice de départ s'affiche tant que le joueur n'a pas atteint cette hauteur. */
export const HINT_UNTIL_HEIGHT = 30;

/** Résultat retenu pour un niveau : ses étoiles et son meilleur score. */
export interface LevelRecord {
  readonly stars: number;
  readonly bestScore: number;
}

export interface Profile {
  readonly version: typeof PROFILE_VERSION;
  readonly xp: number;
  readonly runs: number;
  /** Meilleure montée en une partie, en mètres depuis le toit de départ. */
  readonly bestHeight: number;
  readonly bestScore: number;
  readonly equipped: TalismanId[];
  readonly missions: MissionState[];
  readonly completedMissions: string[];
  /** Niveaux, par numéro en texte pour le JSON. */
  readonly levels: Record<string, LevelRecord>;
}

/** Lecture et écriture d'un texte : `localStorage` dans le navigateur, une mémoire dans les tests. */
export interface ProfileStorage {
  read(): string | null;
  write(text: string): void;
}

/** Clé du profil dans `localStorage`, et celle du profil à part du mode test. */
export const STORAGE_KEY = 'grappin.profil';
export const TEST_STORAGE_KEY = 'grappin.profil.test';

export function createProfile(): Profile {
  return {
    version: PROFILE_VERSION,
    xp: 0,
    runs: 0,
    bestHeight: 0,
    bestScore: 0,
    equipped: [],
    missions: nextMissions([], [], ACTIVE_MISSIONS).map((id) => ({ id, progress: 0 })),
    completedMissions: [],
    levels: {},
  };
}

export function browserStorage(key: string = STORAGE_KEY): ProfileStorage {
  return {
    read: () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write: (text) => {
      try {
        window.localStorage.setItem(key, text);
      } catch {
        // Stockage indisponible, navigation privée par exemple : la partie se joue sans mémoire.
      }
    },
  };
}

export function memoryStorage(initial: string | null = null): ProfileStorage {
  let text = initial;
  return { read: () => text, write: (t) => void (text = t) };
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Relit un profil ; toute donnée douteuse ramène au profil neuf. */
export function loadProfile(storage: ProfileStorage): Profile {
  const fresh = createProfile();
  const text = storage.read();
  if (!text) return fresh;
  try {
    const raw = JSON.parse(text) as Partial<Record<keyof Profile, unknown>>;
    if (raw.version !== PROFILE_VERSION || !isNumber(raw.xp) || !isNumber(raw.runs) || !isNumber(raw.bestHeight) || !isNumber(raw.bestScore)) return fresh;
    const ids = new Set(TALISMANS.map((t) => t.id));
    const equipped = Array.isArray(raw.equipped) ? raw.equipped.filter((id): id is TalismanId => typeof id === 'string' && ids.has(id as TalismanId)) : [];
    const completedMissions = Array.isArray(raw.completedMissions) ? raw.completedMissions.filter((id): id is string => typeof id === 'string') : [];
    const missions = Array.isArray(raw.missions)
      ? raw.missions
          .filter((m): m is MissionState => typeof m === 'object' && m !== null && typeof (m as MissionState).id === 'string' && isNumber((m as MissionState).progress))
          .map((m) => ({ id: m.id, progress: m.progress }))
      : [];
    const levels: Record<string, LevelRecord> = {};
    if (typeof raw.levels === 'object' && raw.levels !== null) {
      for (const [id, record] of Object.entries(raw.levels as Record<string, Partial<LevelRecord>>)) {
        if (/^\d+$/.test(id) && isNumber(record?.stars) && isNumber(record?.bestScore)) levels[id] = { stars: Math.min(3, Math.floor(record.stars)), bestScore: record.bestScore };
      }
    }
    const profile: Profile = {
      version: PROFILE_VERSION,
      xp: raw.xp,
      runs: raw.runs,
      bestHeight: raw.bestHeight,
      bestScore: raw.bestScore,
      equipped: equipped.slice(0, slotsFor(levelFor(raw.xp))),
      missions: missions.length > 0 ? missions : fresh.missions,
      completedMissions,
      levels,
    };
    return refillMissions(profile);
  } catch {
    return fresh;
  }
}

export function saveProfile(storage: ProfileStorage, profile: Profile): void {
  storage.write(JSON.stringify(profile));
}

/** Complète les missions actives si le catalogue le permet. */
function refillMissions(profile: Profile): Profile {
  const missing = ACTIVE_MISSIONS - profile.missions.length;
  if (missing <= 0) return profile;
  const more = nextMissions(profile.completedMissions, profile.missions.map((m) => m.id), missing).map((id) => ({ id, progress: 0 }));
  return { ...profile, missions: [...profile.missions, ...more] };
}

export interface RunOutcome {
  readonly profile: Profile;
  /** Expérience gagnée : score de la partie plus récompenses des missions. */
  readonly xpGained: number;
  readonly missionsCompleted: MissionDef[];
  readonly levelBefore: number;
  readonly levelAfter: number;
  /** Talismans dont le niveau vient d'être atteint. */
  readonly unlocked: Talisman[];
  readonly newBestHeight: boolean;
}

/** Fin de partie : expérience, missions, records, déblocages. `extraXp` : primes d'un niveau. */
export function endRun(profile: Profile, run: RunStats, score: number, extraXp = 0): RunOutcome {
  const settled = settleMissions(profile.missions, profile.completedMissions, run);
  // Une partie compte toujours, même quittée sur le toit : au moins un point.
  const xpGained = Math.max(1, Math.floor(score)) + settled.xp + extraXp;
  const levelBefore = levelFor(profile.xp);
  const xp = profile.xp + xpGained;
  const levelAfter = levelFor(xp);
  const unlocked = TALISMANS.filter((t) => t.level > levelBefore && t.level <= levelAfter);
  const next: Profile = {
    ...profile,
    xp,
    runs: profile.runs + 1,
    bestHeight: Math.max(profile.bestHeight, run.height),
    bestScore: Math.max(profile.bestScore, Math.floor(score)),
    missions: settled.active,
    completedMissions: settled.allCompleted,
  };
  return { profile: next, xpGained, missionsCompleted: settled.completed, levelBefore, levelAfter, unlocked, newBestHeight: run.height > profile.bestHeight };
}

export interface LevelOutcome extends RunOutcome {
  readonly level: LevelDef;
  readonly won: boolean;
  readonly result: LevelResult;
  /** Étoiles de cette partie, et étoiles retenues pour le niveau après elle. */
  readonly stars: number;
  readonly totalStars: number;
  /** Étoiles gagnées pour la première fois, et premier passage du niveau. */
  readonly newStars: number;
  readonly firstClear: boolean;
}

/** Fin d'un niveau, gagné ou perdu : comme une partie, plus les étoiles et les primes du niveau. */
export function endLevel(profile: Profile, level: LevelDef, run: RunStats, score: number, result: LevelResult): LevelOutcome {
  const before = profile.levels[String(level.id)] ?? { stars: 0, bestScore: 0 };
  const stars = levelStars(result);
  const newStars = Math.max(0, stars - before.stars);
  const firstClear = result.won && before.stars === 0;
  const outcome = endRun(profile, run, score, newStars * STAR_XP + (firstClear ? FIRST_CLEAR_XP : 0));
  const record: LevelRecord = { stars: Math.max(before.stars, stars), bestScore: Math.max(before.bestScore, Math.floor(score)) };
  const next: Profile = { ...outcome.profile, levels: { ...outcome.profile.levels, [String(level.id)]: record } };
  return { ...outcome, profile: next, level, won: result.won, result, stars, totalStars: record.stars, newStars, firstClear };
}

/** Équipe ou retire un talisman, dans la limite des emplacements et des déblocages. Renvoie le profil inchangé si impossible. */
export function toggleTalisman(profile: Profile, id: TalismanId): Profile {
  const level = levelFor(profile.xp);
  if (profile.equipped.includes(id)) return { ...profile, equipped: profile.equipped.filter((t) => t !== id) };
  if (talismanById(id).level > level || profile.equipped.length >= slotsFor(level)) return profile;
  return { ...profile, equipped: [...profile.equipped, id] };
}

/** Faut-il encore afficher l'indice de départ ? */
export function showsHint(profile: Profile): boolean {
  return profile.bestHeight < HINT_UNTIL_HEIGHT;
}

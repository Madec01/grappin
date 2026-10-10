/**
 * Missions : des objectifs qui enseignent la technique et rapportent de
 * l'expérience. Trois sont actives à la fois ; une mission remplie est
 * remplacée par la suivante du catalogue, dans l'ordre. Les missions de
 * comptage s'accumulent d'une partie à l'autre ; celles de record ne
 * retiennent que le meilleur d'une partie.
 */

export type MissionKind =
  | 'holds'
  | 'perfectStreak'
  | 'grazes'
  | 'height'
  | 'pickups'
  | 'combo'
  | 'fragileReleases'
  | 'boosters'
  | 'survive';

export interface MissionDef {
  readonly id: string;
  readonly kind: MissionKind;
  readonly target: number;
  /** Expérience donnée à l'accomplissement. */
  readonly reward: number;
  readonly text: string;
}

/** Ce qu'une partie a produit, relevé par le suiveur de partie. */
export interface RunStats {
  /** Tenues d'au moins une seconde avant un lâcher volontaire. */
  readonly holds: number;
  readonly perfectStreak: number;
  readonly grazes: number;
  /** Mètres grimpés depuis le toit de départ de la partie. */
  readonly height: number;
  readonly pickups: number;
  readonly combo: number;
  /** Lâchers volontaires depuis une accroche fragile, avant qu'elle casse. */
  readonly fragileReleases: number;
  readonly boosters: number;
  readonly seconds: number;
}

/** Les missions de record gardent le meilleur d'une partie ; les autres s'accumulent. */
const RECORD_KINDS: ReadonlySet<MissionKind> = new Set(['perfectStreak', 'height', 'combo', 'survive']);

export const MISSIONS: readonly MissionDef[] = [
  { id: 'tenir-3', kind: 'holds', target: 3, reward: 40, text: 'Tiens la corde une seconde avant de lâcher, trois fois' },
  { id: 'hauteur-30', kind: 'height', target: 30, reward: 40, text: 'Grimpe 30 m en une partie' },
  { id: 'parfait-2', kind: 'perfectStreak', target: 2, reward: 50, text: 'Deux lâchers parfaits d\'affilée' },
  { id: 'hauteur-60', kind: 'height', target: 60, reward: 60, text: 'Grimpe 60 m en une partie' },
  { id: 'froler-5', kind: 'grazes', target: 5, reward: 60, text: 'Frôle cinq obstacles' },
  { id: 'etoiles-3', kind: 'pickups', target: 3, reward: 60, text: 'Ramasse trois étoiles' },
  { id: 'combo-3', kind: 'combo', target: 8, reward: 70, text: 'Monte le multiplicateur à ×3' },
  { id: 'survie-60', kind: 'survive', target: 60, reward: 70, text: 'Survis une minute' },
  { id: 'parfait-4', kind: 'perfectStreak', target: 4, reward: 80, text: 'Quatre lâchers parfaits d\'affilée' },
  { id: 'fragile-3', kind: 'fragileReleases', target: 3, reward: 80, text: 'Lâche trois accroches fragiles avant qu\'elles cassent' },
  { id: 'hauteur-120', kind: 'height', target: 120, reward: 100, text: 'Grimpe 120 m en une partie' },
  { id: 'propulseur-3', kind: 'boosters', target: 3, reward: 80, text: 'Lâche depuis trois propulseurs' },
  { id: 'froler-15', kind: 'grazes', target: 15, reward: 100, text: 'Frôle quinze obstacles' },
  { id: 'etoiles-10', kind: 'pickups', target: 10, reward: 100, text: 'Ramasse dix étoiles' },
  { id: 'combo-5', kind: 'combo', target: 16, reward: 120, text: 'Monte le multiplicateur à ×5' },
  { id: 'hauteur-200', kind: 'height', target: 200, reward: 150, text: 'Grimpe 200 m en une partie' },
  { id: 'survie-120', kind: 'survive', target: 120, reward: 150, text: 'Survis deux minutes' },
  { id: 'hauteur-300', kind: 'height', target: 300, reward: 200, text: 'Grimpe 300 m en une partie' },
];

export interface MissionState {
  readonly id: string;
  readonly progress: number;
}

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/** Les `count` premières missions du catalogue ni finies ni déjà actives. */
export function nextMissions(completed: readonly string[], active: readonly string[], count: number): string[] {
  return MISSIONS.filter((m) => !completed.includes(m.id) && !active.includes(m.id))
    .slice(0, count)
    .map((m) => m.id);
}

/** Valeur qu'une partie apporte à une mission d'un genre donné. */
export function runValue(kind: MissionKind, run: RunStats): number {
  switch (kind) {
    case 'holds':
      return run.holds;
    case 'perfectStreak':
      return run.perfectStreak;
    case 'grazes':
      return run.grazes;
    case 'height':
      return run.height;
    case 'pickups':
      return run.pickups;
    case 'combo':
      return run.combo;
    case 'fragileReleases':
      return run.fragileReleases;
    case 'boosters':
      return run.boosters;
    case 'survive':
      return run.seconds;
  }
}

export interface MissionsOutcome {
  /** Missions actives après la partie, les finies remplacées. */
  readonly active: MissionState[];
  readonly completed: MissionDef[];
  readonly allCompleted: string[];
  readonly xp: number;
}

/** Applique une partie aux missions actives : avancement, accomplissements, remplacements. */
export function settleMissions(active: readonly MissionState[], completedBefore: readonly string[], run: RunStats): MissionsOutcome {
  const completed: MissionDef[] = [];
  const kept: MissionState[] = [];
  for (const state of active) {
    const def = missionById(state.id);
    if (!def) continue;
    const value = runValue(def.kind, run);
    const progress = Math.min(def.target, RECORD_KINDS.has(def.kind) ? Math.max(state.progress, value) : state.progress + value);
    if (progress >= def.target) completed.push(def);
    else kept.push({ id: state.id, progress });
  }
  const allCompleted = [...completedBefore, ...completed.map((m) => m.id)];
  const replacements = nextMissions(allCompleted, kept.map((m) => m.id), active.length - kept.length).map((id) => ({ id, progress: 0 }));
  return { active: [...kept, ...replacements], completed, allCompleted, xp: completed.reduce((sum, m) => sum + m.reward, 0) };
}

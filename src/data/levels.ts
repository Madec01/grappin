import type { ScheduledEvent } from '../sim/events';
import type { TierProfile } from '../sim/generator';

/**
 * Les dix niveaux de la traversée. Chaque niveau est un parcours fixe, le même
 * à chaque essai grâce à sa graine, de `startY` à `endY`, avec une nouveauté
 * par niveau et une brume à sa vitesse. Les hauteurs se suivent : finir un
 * niveau ouvre le suivant, et la course libre démarre à la zone la plus haute
 * franchie.
 */

export interface LevelDef {
  readonly id: number;
  readonly name: string;
  /** Une phrase qui annonce la nouveauté du niveau. */
  readonly intro: string;
  readonly seed: number;
  readonly startY: number;
  readonly endY: number;
  readonly fogBaseSpeed: number;
  readonly profile: TierProfile;
  /** Événements du niveau, aux hauteurs fixes au-dessus de son départ. */
  readonly events: readonly ScheduledEvent[];
}

const plain = (spacing: number): TierProfile => ({ spacing, obstacles: 0, split: false, fragileChance: 0, boosters: 0, archetypes: ['chaine', 'couloir'] });

export const LEVELS: readonly LevelDef[] = [
  {
    id: 1,
    name: 'Les toits',
    intro: 'Garde le doigt posé pour prendre de l\'élan, relâche en montant.',
    seed: 1001,
    startY: 0,
    endY: 60,
    fogBaseSpeed: 0.6,
    profile: plain(3),
    events: [],
  },
  {
    id: 2,
    name: 'Les gouttières',
    intro: 'Des corniches à frôler, et une première fourche : la route haute porte une étoile.',
    seed: 1002,
    startY: 60,
    endY: 130,
    fogBaseSpeed: 0.7,
    profile: { spacing: 3.2, obstacles: 1, split: true, fragileChance: 0, boosters: 0, archetypes: ['chaine', 'escalier', 'dalles'] },
    events: [],
  },
  {
    id: 3,
    name: 'Les enseignes',
    intro: 'Des couloirs d\'étoiles, et une pluie d\'étoiles à cueillir au vol.',
    seed: 1003,
    startY: 130,
    endY: 200,
    fogBaseSpeed: 0.8,
    profile: { spacing: 3.4, obstacles: 1, split: true, fragileChance: 0, boosters: 0, archetypes: ['chaine', 'couloir', 'couloir', 'dalles'] },
    events: [{ kind: 'pluie', at: 20, length: 30 }],
  },
  {
    id: 4,
    name: 'Les clochers',
    intro: 'Les accroches en pointillés cassent après une seconde. Et les lampadaires ont des pannes.',
    seed: 1004,
    startY: 200,
    endY: 280,
    fogBaseSpeed: 0.9,
    profile: { spacing: 3.6, obstacles: 1, split: true, fragileChance: 0.3, boosters: 0, archetypes: ['chaine', 'fragiles', 'escalier', 'dalles'] },
    events: [{ kind: 'panne', at: 25, length: 30 }],
  },
  {
    id: 5,
    name: 'Les antennes',
    intro: 'Les accroches à chevron propulsent le lâcher. Attention : le niveau va basculer.',
    seed: 1005,
    startY: 280,
    endY: 360,
    fogBaseSpeed: 1,
    profile: { spacing: 3.8, obstacles: 1, split: true, fragileChance: 0, boosters: 1, archetypes: ['chaine', 'rafale', 'saut', 'couloir'] },
    events: [{ kind: 'bascule', at: 25, length: 30, side: 1 }],
  },
  {
    id: 6,
    name: 'Les grues',
    intro: 'Un champ de dalles à frôler sans toucher, et un coup de vent.',
    seed: 1006,
    startY: 360,
    endY: 450,
    fogBaseSpeed: 1.1,
    profile: { spacing: 4, obstacles: 2, split: true, fragileChance: 0.2, boosters: 0, archetypes: ['dalles', 'dalles', 'chaine', 'escalier'] },
    events: [{ kind: 'vent', at: 20, length: 30, side: -1, strength: 3 }],
  },
  {
    id: 7,
    name: 'Les nuages',
    intro: 'Fragiles et propulseurs ensemble, une alerte de brume, et des accroches sur câble.',
    seed: 1007,
    startY: 450,
    endY: 540,
    fogBaseSpeed: 1.2,
    profile: { spacing: 4.2, obstacles: 2, split: true, fragileChance: 0.3, boosters: 1, archetypes: ['chaine', 'fragiles', 'rafale', 'couloir', 'saut'] },
    events: [{ kind: 'alerte', at: 15, length: 25 }, { kind: 'cable', at: 45, length: 30 }],
  },
  {
    id: 8,
    name: 'Les toits, de nuit',
    intro: 'Plus espacé, plus rapide, et le niveau bascule de l\'autre côté.',
    seed: 1008,
    startY: 540,
    endY: 630,
    fogBaseSpeed: 1.35,
    profile: { spacing: 4.5, obstacles: 2, split: true, fragileChance: 0.3, boosters: 1, archetypes: ['chaine', 'escalier', 'dalles', 'fragiles', 'rafale'] },
    events: [{ kind: 'bascule', at: 20, length: 30, side: -1 }, { kind: 'panne', at: 55, length: 30 }],
  },
  {
    id: 9,
    name: 'Les gouttières, de nuit',
    intro: 'Trois obstacles par segment, du vent, une pluie d\'étoiles et des câbles.',
    seed: 1009,
    startY: 630,
    endY: 720,
    fogBaseSpeed: 1.5,
    profile: { spacing: 4.7, obstacles: 3, split: true, fragileChance: 0.35, boosters: 1, archetypes: ['dalles', 'chaine', 'fragiles', 'saut', 'couloir'] },
    events: [{ kind: 'vent', at: 10, length: 25, side: 1, strength: 3.5 }, { kind: 'pluie', at: 40, length: 20 }, { kind: 'cable', at: 62, length: 25 }],
  },
  {
    id: 10,
    name: 'Le sommet',
    intro: 'Tout, en plus serré et plus haut, avec une bascule, une alerte et une panne.',
    seed: 1010,
    startY: 720,
    endY: 820,
    fogBaseSpeed: 1.65,
    profile: { spacing: 5, obstacles: 3, split: true, fragileChance: 0.4, boosters: 1, archetypes: ['chaine', 'escalier', 'couloir', 'dalles', 'rafale', 'fragiles', 'saut'] },
    events: [{ kind: 'bascule', at: 15, length: 28, side: 1 }, { kind: 'alerte', at: 48, length: 20 }, { kind: 'panne', at: 70, length: 25 }],
  },
];

export function levelById(id: number): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

import type { ScheduledEvent } from '../sim/events';
import type { TierProfile } from '../sim/generator';

/**
 * Les vingt niveaux de la traversée. Chaque niveau est un parcours fixe, le même
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

const plain = (spacing: number): TierProfile => ({ spacing, obstacles: 0, split: false, fragileChance: 0, boosters: 0, archetypes: ['chaine', 'couloir'], spread: 1, electric: 0, eclipse: 0 });

export const LEVELS: readonly LevelDef[] = [
  {
    id: 1,
    name: 'Les toits',
    intro: 'Garde le doigt posé pour prendre de l\'élan, relâche en montant.',
    seed: 1001,
    startY: 0,
    endY: 90,
    fogBaseSpeed: 0.5,
    profile: plain(3),
    events: [],
  },
  {
    id: 2,
    name: 'Les gouttières',
    intro: 'Des corniches à frôler, et une première fourche : la route haute porte une étoile.',
    seed: 1002,
    startY: 90,
    endY: 200,
    fogBaseSpeed: 0.6,
    profile: { spacing: 3.2, obstacles: 1, split: true, fragileChance: 0, boosters: 0, archetypes: ['chaine', 'escalier', 'dalles'], spread: 1, electric: 0, eclipse: 0 },
    events: [],
  },
  {
    id: 3,
    name: 'Les enseignes',
    intro: 'Des couloirs d\'étoiles, et une pluie d\'étoiles à cueillir au vol.',
    seed: 1003,
    startY: 200,
    endY: 320,
    fogBaseSpeed: 0.7,
    profile: { spacing: 3.4, obstacles: 1, split: true, fragileChance: 0, boosters: 0, archetypes: ['chaine', 'couloir', 'couloir', 'dalles'], spread: 1, electric: 0, eclipse: 0 },
    events: [{ kind: 'pluie', at: 20, length: 30 }, { kind: 'pluie', at: 80, length: 30 }],
  },
  {
    id: 4,
    name: 'Les clochers',
    intro: 'Les accroches en pointillés cassent après une seconde. Et les lampadaires ont des pannes.',
    seed: 1004,
    startY: 320,
    endY: 450,
    fogBaseSpeed: 0.75,
    profile: { spacing: 3.6, obstacles: 1, split: true, fragileChance: 0.3, boosters: 0, archetypes: ['chaine', 'fragiles', 'escalier', 'dalles'], spread: 1.05, electric: 0, eclipse: 0 },
    events: [{ kind: 'panne', at: 25, length: 30 }, { kind: 'panne', at: 90, length: 30 }],
  },
  {
    id: 5,
    name: 'Les antennes',
    intro: 'Les accroches à chevron propulsent le lâcher. Attention : le niveau va basculer.',
    seed: 1005,
    startY: 450,
    endY: 590,
    fogBaseSpeed: 0.85,
    profile: { spacing: 3.8, obstacles: 1, split: true, fragileChance: 0, boosters: 1, archetypes: ['chaine', 'rafale', 'saut', 'couloir'], spread: 1.1, electric: 0, eclipse: 0 },
    events: [{ kind: 'bascule', at: 25, length: 30, side: 1 }, { kind: 'bascule', at: 95, length: 30, side: -1 }],
  },
  {
    id: 6,
    name: 'Les grues',
    intro: 'Un champ de dalles à frôler sans toucher, et un coup de vent.',
    seed: 1006,
    startY: 590,
    endY: 740,
    fogBaseSpeed: 0.95,
    profile: { spacing: 4, obstacles: 2, split: true, fragileChance: 0.2, boosters: 0, archetypes: ['dalles', 'dalles', 'chaine', 'escalier'], spread: 1.15, electric: 0, eclipse: 0 },
    events: [{ kind: 'vent', at: 20, length: 30, side: -1, strength: 3 }, { kind: 'vent', at: 90, length: 35, side: 1, strength: 3 }],
  },
  {
    id: 7,
    name: 'Les nuages',
    intro: 'Fragiles et propulseurs ensemble, une alerte de brume, et des accroches sur câble.',
    seed: 1007,
    startY: 740,
    endY: 900,
    fogBaseSpeed: 1,
    profile: { spacing: 4.2, obstacles: 2, split: true, fragileChance: 0.3, boosters: 1, archetypes: ['chaine', 'fragiles', 'rafale', 'couloir', 'saut'], spread: 1.2, electric: 0, eclipse: 0 },
    events: [{ kind: 'alerte', at: 15, length: 25 }, { kind: 'cable', at: 45, length: 30 }, { kind: 'alerte', at: 100, length: 25 }, { kind: 'cable', at: 130, length: 25 }],
  },
  {
    id: 8,
    name: 'Les toits, de nuit',
    intro: 'Plus espacé, plus rapide, et le niveau bascule de l\'autre côté.',
    seed: 1008,
    startY: 900,
    endY: 1070,
    fogBaseSpeed: 1.15,
    profile: { spacing: 4.5, obstacles: 2, split: true, fragileChance: 0.3, boosters: 1, archetypes: ['chaine', 'escalier', 'dalles', 'fragiles', 'rafale'], spread: 1.3, electric: 0, eclipse: 1 },
    events: [{ kind: 'bascule', at: 20, length: 30, side: -1 }, { kind: 'panne', at: 55, length: 30 }, { kind: 'bascule', at: 110, length: 30, side: 1 }, { kind: 'panne', at: 150, length: 15 }],
  },
  {
    id: 9,
    name: 'Les gouttières, de nuit',
    intro: 'Trois obstacles par segment, du vent, une pluie d\'étoiles et des câbles.',
    seed: 1009,
    startY: 1070,
    endY: 1250,
    fogBaseSpeed: 1.3,
    profile: { spacing: 4.7, obstacles: 3, split: true, fragileChance: 0.35, boosters: 1, archetypes: ['dalles', 'chaine', 'fragiles', 'saut', 'couloir'], spread: 1.4, electric: 1, eclipse: 0 },
    events: [{ kind: 'vent', at: 10, length: 25, side: 1, strength: 3.5 }, { kind: 'pluie', at: 40, length: 20 }, { kind: 'cable', at: 62, length: 25 }, { kind: 'vent', at: 110, length: 25, side: -1, strength: 3.5 }, { kind: 'traversiere', at: 140, length: 30 }],
  },
  {
    id: 10,
    name: 'Le sommet',
    intro: 'Tout, en plus serré et plus haut, avec une bascule, une alerte et une panne.',
    seed: 1010,
    startY: 1250,
    endY: 1450,
    fogBaseSpeed: 1.4,
    profile: { spacing: 5, obstacles: 3, split: true, fragileChance: 0.4, boosters: 1, archetypes: ['chaine', 'escalier', 'couloir', 'dalles', 'rafale', 'fragiles', 'saut'], spread: 1.5, electric: 1, eclipse: 1 },
    events: [{ kind: 'bascule', at: 15, length: 28, side: 1 }, { kind: 'alerte', at: 48, length: 20 }, { kind: 'panne', at: 70, length: 25 }, { kind: 'bascule', at: 110, length: 30, side: -1 }, { kind: 'alerte', at: 150, length: 20 }, { kind: 'panne', at: 175, length: 20 }],
  },
  {
    id: 11,
    name: 'Les passerelles',
    intro: 'Le lanceur : accroche-toi, tire le doigt à l\'opposé, relâche. Vise le trou du mur.',
    seed: 1011,
    startY: 1450,
    endY: 1630,
    fogBaseSpeed: 1.3,
    profile: { spacing: 4.2, obstacles: 1, split: true, fragileChance: 0.2, boosters: 0, archetypes: ['lanceur', 'lanceur', 'chaine', 'couloir'], spread: 1.2, electric: 0, eclipse: 0 },
    events: [{ kind: 'pluie', at: 90, length: 30 }],
  },
  {
    id: 12,
    name: 'Les cheminées',
    intro: 'Des murs à trou entre les dalles, et une pluie d\'étoiles à mi-chemin.',
    seed: 1012,
    startY: 1630,
    endY: 1820,
    fogBaseSpeed: 1.3,
    profile: { spacing: 4.4, obstacles: 2, split: true, fragileChance: 0.25, boosters: 1, archetypes: ['lanceur', 'dalles', 'chaine', 'escalier'], spread: 1.25, electric: 0, eclipse: 1 },
    events: [{ kind: 'pluie', at: 30, length: 25 }, { kind: 'pluie', at: 120, length: 25 }],
  },
  {
    id: 13,
    name: 'Les tours',
    intro: 'Les traversières balaient la ville, puis le vent se lève.',
    seed: 1013,
    startY: 1820,
    endY: 2020,
    fogBaseSpeed: 1.35,
    profile: { spacing: 4.5, obstacles: 2, split: true, fragileChance: 0.3, boosters: 1, archetypes: ['chaine', 'lanceur', 'couloir', 'rafale'], spread: 1.3, electric: 0, eclipse: 1 },
    events: [{ kind: 'traversiere', at: 20, length: 30 }, { kind: 'vent', at: 65, length: 30, side: 1, strength: 3 }, { kind: 'traversiere', at: 120, length: 30 }, { kind: 'vent', at: 160, length: 30, side: -1, strength: 3 }],
  },
  {
    id: 14,
    name: 'La centrale',
    intro: 'Des prises électriques partout : attrape-les calmes, lâche avant la charge. Et une panne.',
    seed: 1014,
    startY: 2020,
    endY: 2220,
    fogBaseSpeed: 1.35,
    profile: { spacing: 4.5, obstacles: 2, split: true, fragileChance: 0.2, boosters: 1, archetypes: ['lanceur', 'chaine', 'fragiles', 'dalles'], spread: 1.3, electric: 2, eclipse: 0 },
    events: [{ kind: 'panne', at: 40, length: 30 }, { kind: 'panne', at: 130, length: 30 }],
  },
  {
    id: 15,
    name: 'Les enseignes, de nuit',
    intro: 'Des éclipses pour aller plus vite, une alerte qui presse.',
    seed: 1015,
    startY: 2220,
    endY: 2430,
    fogBaseSpeed: 1.4,
    profile: { spacing: 4.6, obstacles: 2, split: true, fragileChance: 0.3, boosters: 1, archetypes: ['couloir', 'lanceur', 'chaine', 'saut'], spread: 1.35, electric: 1, eclipse: 2 },
    events: [{ kind: 'pluie', at: 15, length: 25 }, { kind: 'alerte', at: 60, length: 25 }, { kind: 'pluie', at: 120, length: 25 }, { kind: 'alerte', at: 170, length: 25 }],
  },
  {
    id: 16,
    name: 'Le pont',
    intro: 'Le niveau bascule : lance de côté. Puis des câbles.',
    seed: 1016,
    startY: 2430,
    endY: 2650,
    fogBaseSpeed: 1.4,
    profile: { spacing: 4.7, obstacles: 3, split: true, fragileChance: 0.3, boosters: 1, archetypes: ['lanceur', 'chaine', 'escalier', 'dalles'], spread: 1.4, electric: 1, eclipse: 1 },
    events: [{ kind: 'bascule', at: 25, length: 35, side: -1 }, { kind: 'cable', at: 75, length: 30 }, { kind: 'bascule', at: 130, length: 35, side: 1 }, { kind: 'cable', at: 185, length: 25 }],
  },
  {
    id: 17,
    name: 'L\'orage',
    intro: 'Le vent tourne, les prises électriques crépitent.',
    seed: 1017,
    startY: 2650,
    endY: 2870,
    fogBaseSpeed: 1.45,
    profile: { spacing: 4.8, obstacles: 2, split: true, fragileChance: 0.35, boosters: 1, archetypes: ['chaine', 'lanceur', 'rafale', 'fragiles'], spread: 1.4, electric: 2, eclipse: 1 },
    events: [{ kind: 'vent', at: 10, length: 30, side: -1, strength: 3.5 }, { kind: 'vent', at: 60, length: 30, side: 1, strength: 3.5 }, { kind: 'vent', at: 120, length: 30, side: -1, strength: 3.5 }, { kind: 'vent', at: 170, length: 30, side: 1, strength: 3.5 }],
  },
  {
    id: 18,
    name: 'Le phare',
    intro: 'Dans le noir, vise de mémoire ; puis les traversières.',
    seed: 1018,
    startY: 2870,
    endY: 3100,
    fogBaseSpeed: 1.45,
    profile: { spacing: 4.8, obstacles: 3, split: true, fragileChance: 0.3, boosters: 1, archetypes: ['lanceur', 'dalles', 'couloir', 'chaine'], spread: 1.45, electric: 1, eclipse: 2 },
    events: [{ kind: 'panne', at: 20, length: 35 }, { kind: 'traversiere', at: 70, length: 30 }, { kind: 'panne', at: 130, length: 35 }, { kind: 'traversiere', at: 180, length: 30 }],
  },
  {
    id: 19,
    name: 'Le vertige',
    intro: 'Tout, plus haut, plus large.',
    seed: 1019,
    startY: 3100,
    endY: 3340,
    fogBaseSpeed: 1.5,
    profile: { spacing: 5, obstacles: 3, split: true, fragileChance: 0.35, boosters: 1, archetypes: ['chaine', 'lanceur', 'escalier', 'saut', 'fragiles'], spread: 1.5, electric: 2, eclipse: 2 },
    events: [{ kind: 'bascule', at: 20, length: 30, side: 1 }, { kind: 'alerte', at: 65, length: 25 }, { kind: 'pluie', at: 95, length: 25 }, { kind: 'bascule', at: 140, length: 30, side: -1 }, { kind: 'alerte', at: 190, length: 25 }],
  },
  {
    id: 20,
    name: 'Le ciel',
    intro: 'Le dernier : tout ce que la ville sait faire.',
    seed: 1020,
    startY: 3340,
    endY: 3600,
    fogBaseSpeed: 1.55,
    profile: { spacing: 5, obstacles: 3, split: true, fragileChance: 0.4, boosters: 1, archetypes: ['lanceur', 'chaine', 'rafale', 'dalles', 'couloir', 'fragiles', 'saut'], spread: 1.5, electric: 2, eclipse: 2 },
    events: [{ kind: 'vent', at: 15, length: 30, side: -1, strength: 3.5 }, { kind: 'bascule', at: 55, length: 35, side: -1 }, { kind: 'traversiere', at: 100, length: 30 }, { kind: 'alerte', at: 130, length: 15 }, { kind: 'bascule', at: 170, length: 35, side: 1 }, { kind: 'traversiere', at: 215, length: 30 }],
  },
];

export function levelById(id: number): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

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
  },
  {
    id: 3,
    name: 'Les enseignes',
    intro: 'Des couloirs d\'étoiles : suis-les pour les ramasser toutes.',
    seed: 1003,
    startY: 130,
    endY: 200,
    fogBaseSpeed: 0.8,
    profile: { spacing: 3.4, obstacles: 1, split: true, fragileChance: 0, boosters: 0, archetypes: ['chaine', 'couloir', 'couloir', 'dalles'] },
  },
  {
    id: 4,
    name: 'Les clochers',
    intro: 'Les accroches en pointillés cassent après une seconde : lâche à temps.',
    seed: 1004,
    startY: 200,
    endY: 280,
    fogBaseSpeed: 0.9,
    profile: { spacing: 3.6, obstacles: 1, split: true, fragileChance: 0.3, boosters: 0, archetypes: ['chaine', 'fragiles', 'escalier', 'dalles'] },
  },
  {
    id: 5,
    name: 'Les antennes',
    intro: 'Les accroches à chevron propulsent le lâcher : vise loin.',
    seed: 1005,
    startY: 280,
    endY: 360,
    fogBaseSpeed: 1,
    profile: { spacing: 3.8, obstacles: 1, split: true, fragileChance: 0, boosters: 1, archetypes: ['chaine', 'rafale', 'saut', 'couloir'] },
  },
  {
    id: 6,
    name: 'Les grues',
    intro: 'Un champ de dalles : frôle sans toucher.',
    seed: 1006,
    startY: 360,
    endY: 450,
    fogBaseSpeed: 1.1,
    profile: { spacing: 4, obstacles: 2, split: true, fragileChance: 0.2, boosters: 0, archetypes: ['dalles', 'dalles', 'chaine', 'escalier'] },
  },
  {
    id: 7,
    name: 'Les nuages',
    intro: 'Fragiles et propulseurs ensemble : tout ce que tu sais.',
    seed: 1007,
    startY: 450,
    endY: 540,
    fogBaseSpeed: 1.2,
    profile: { spacing: 4.2, obstacles: 2, split: true, fragileChance: 0.3, boosters: 1, archetypes: ['chaine', 'fragiles', 'rafale', 'couloir', 'saut'] },
  },
  {
    id: 8,
    name: 'Les toits, de nuit',
    intro: 'Plus espacé, plus rapide : la brume ne pardonne plus.',
    seed: 1008,
    startY: 540,
    endY: 630,
    fogBaseSpeed: 1.35,
    profile: { spacing: 4.5, obstacles: 2, split: true, fragileChance: 0.3, boosters: 1, archetypes: ['chaine', 'escalier', 'dalles', 'fragiles', 'rafale'] },
  },
  {
    id: 9,
    name: 'Les gouttières, de nuit',
    intro: 'Trois obstacles par segment : chaque passage se lit avant de se jouer.',
    seed: 1009,
    startY: 630,
    endY: 720,
    fogBaseSpeed: 1.5,
    profile: { spacing: 4.7, obstacles: 3, split: true, fragileChance: 0.35, boosters: 1, archetypes: ['dalles', 'chaine', 'fragiles', 'saut', 'couloir'] },
  },
  {
    id: 10,
    name: 'Le sommet',
    intro: 'Tout, en plus serré et plus haut. Le sommet est à cent mètres.',
    seed: 1010,
    startY: 720,
    endY: 820,
    fogBaseSpeed: 1.65,
    profile: { spacing: 5, obstacles: 3, split: true, fragileChance: 0.4, boosters: 1, archetypes: ['chaine', 'escalier', 'couloir', 'dalles', 'rafale', 'fragiles', 'saut'] },
  },
];

export function levelById(id: number): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

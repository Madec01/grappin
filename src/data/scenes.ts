import type { Vec2 } from '../core/math/vec2';
import { FIRST_ANCHOR_OFFSET, HALF_WIDTH, RING_RADIUS, drift, rocket, updraft, type IdCounters, type Segment } from '../sim/generator';
import type { Anchor, Obstacle, ObstacleKind, Pickup, Ring, Zone } from '../sim/state';

/**
 * Scènes déterministes de démonstration, une par mécanique du lot 2 (brief du
 * 11 octobre 2026, section 18) : un premier segment construit à la main, le
 * même à chaque fois, où la nouveauté se rencontre isolément et se comprend ;
 * puis la course libre continue. Elles servent au propriétaire pour sentir
 * chaque mécanique (`?scene=rebond`), aux tests de bout en bout, au banc de
 * captures et aux robots. Les tests prouvent chaque scène par le vérificateur.
 */

export type SceneId = 'rebond' | 'cassable' | 'porte' | 'anneau' | 'courant' | 'derive' | 'fusee';

export interface SceneDef {
  readonly id: SceneId;
  readonly name: string;
  /** Une phrase, en bannière au départ. */
  readonly intro: string;
}

export const SCENES: readonly SceneDef[] = [
  { id: 'rebond', name: 'Le rebond', intro: 'Les surfaces à chevrons renvoient ton élan : une chute devient une remontée.' },
  { id: 'cassable', name: 'La paroi cassable', intro: 'Une paroi fissurée se traverse si tu arrives assez vite.' },
  { id: 'porte', name: 'La porte', intro: 'La porte se ferme et s\'ouvre : tire quand elle est ouverte.' },
  { id: 'anneau', name: 'Les anneaux', intro: 'Traverse les anneaux au centre pour marquer davantage.' },
  { id: 'courant', name: 'Le courant', intro: 'Le courant te porte : lâche dedans et laisse-toi monter.' },
  { id: 'derive', name: 'La dérive', intro: 'Dans la bande, le courant te pousse de côté : vise avant d\'entrer.' },
  { id: 'fusee', name: 'La fusée', intro: 'Le couloir t\'accélère, la zone qui suit te freine : rattrape la prise en haut.' },
];

export function sceneById(id: string): SceneDef | undefined {
  return SCENES.find((scene) => scene.id === id);
}

export function isSceneId(id: string): id is SceneId {
  return sceneById(id) !== undefined;
}

/** Hauteur, au-dessus du premier point, de la sortie d'un courant et d'une fusée partis du deuxième point (voir `updraft`, `rocket`). */
const UPDRAFT_EXIT_RISE = 3.6 + 10;
const ROCKET_EXIT_RISE = 3.6 + 12;

/** Positions des points d'une chaîne de démonstration, depuis le premier point au-dessus du toit : un zigzag doux, à portée de corde. */
const CHAIN: readonly Vec2[] = [
  { x: -2.8, y: 3.6 },
  { x: 0.8, y: 7.2 },
  { x: -2.6, y: 11 },
  { x: 0.8, y: 14.6 },
  { x: -2.2, y: 18.2 },
];

interface Builder {
  readonly ids: IdCounters;
  readonly origin: Vec2;
  readonly anchors: Anchor[];
  readonly obstacles: Obstacle[];
  readonly pickups: Pickup[];
  readonly rings: Ring[];
  readonly zones: Zone[];
}


function anchor(b: Builder, offset: Vec2, kind: Anchor['kind'] = 'normal'): Anchor {
  const a: Anchor = { id: b.ids.anchor, pos: { x: b.origin.x + FIRST_ANCHOR_OFFSET.x + offset.x, y: b.origin.y + FIRST_ANCHOR_OFFSET.y + offset.y }, kind, broken: false };
  b.ids.anchor += 1;
  b.anchors.push(a);
  return a;
}

/** Une boîte en coordonnées relatives au premier point. */
function box(b: Builder, x0: number, y0: number, x1: number, y1: number, kind: ObstacleKind = 'solide'): Obstacle {
  const ox = b.origin.x + FIRST_ANCHOR_OFFSET.x;
  const oy = b.origin.y + FIRST_ANCHOR_OFFSET.y;
  const o: Obstacle = kind === 'solide' ? { id: b.ids.obstacle, x0: ox + x0, y0: oy + y0, x1: ox + x1, y1: oy + y1 } : { id: b.ids.obstacle, x0: ox + x0, y0: oy + y0, x1: ox + x1, y1: oy + y1, kind };
  b.ids.obstacle += 1;
  b.obstacles.push(o);
  return o;
}

function star(b: Builder, offset: Vec2): void {
  b.pickups.push({ id: b.ids.pickup, pos: { x: b.origin.x + FIRST_ANCHOR_OFFSET.x + offset.x, y: b.origin.y + FIRST_ANCHOR_OFFSET.y + offset.y }, taken: false });
  b.ids.pickup += 1;
}

function ring(b: Builder, offset: Vec2): void {
  b.rings.push({ id: b.ids.ring, pos: { x: b.origin.x + FIRST_ANCHOR_OFFSET.x + offset.x, y: b.origin.y + FIRST_ANCHOR_OFFSET.y + offset.y }, radius: RING_RADIUS, closest: null, taken: false });
  b.ids.ring += 1;
}

/** Le premier point, puis la chaîne de démonstration. */
function chain(b: Builder): void {
  anchor(b, { x: 0, y: 0 });
  for (const p of CHAIN) anchor(b, p);
}

/**
 * Le segment d'une scène, depuis le toit de départ `origin` : les identifiants
 * viennent des compteurs de la partie, comme pour un segment engendré.
 */
export function buildScene(id: SceneId, ids: IdCounters, origin: Vec2): Segment {
  const b: Builder = { ids, origin, anchors: [], obstacles: [], pickups: [], rings: [], zones: [] };
  switch (id) {
    case 'courant': {
      // Deux points, puis le courant ascendant du générateur lui-même porte jusqu'à un point hors de portée de corde ; la chaîne reprend.
      anchor(b, { x: 0, y: 0 });
      const from = anchor(b, CHAIN[0]!);
      const { zone, exit } = updraft(b.ids, from.pos, HALF_WIDTH);
      b.zones.push(zone);
      b.anchors.push({ id: b.ids.anchor, pos: exit, kind: 'normal', broken: false });
      b.ids.anchor += 1;
      anchor(b, { x: 2.2, y: UPDRAFT_EXIT_RISE + 3.6 });
      anchor(b, { x: -1, y: UPDRAFT_EXIT_RISE + 7.2 });
      break;
    }
    case 'derive': {
      // Deux points, une bande de dérive qui pousse vers la droite au-dessus du deuxième, et la chaîne qui continue au-dessus de la bande.
      anchor(b, { x: 0, y: 0 });
      const from = anchor(b, CHAIN[0]!);
      b.zones.push(drift(b.ids, from.pos.y, 1, HALF_WIDTH));
      for (const p of CHAIN.slice(1)) anchor(b, p);
      break;
    }
    case 'fusee': {
      // Deux points, puis le couloir d'accélération et le freinage du générateur, et la chaîne qui reprend au point de sortie.
      anchor(b, { x: 0, y: 0 });
      const from = anchor(b, CHAIN[0]!);
      const { boost, brake, exit } = rocket(b.ids, from.pos, HALF_WIDTH);
      b.zones.push(boost, brake);
      b.anchors.push({ id: b.ids.anchor, pos: exit, kind: 'normal', broken: false });
      b.ids.anchor += 1;
      anchor(b, { x: 2.4, y: ROCKET_EXIT_RISE + 3.6 });
      anchor(b, { x: -1, y: ROCKET_EXIT_RISE + 7.2 });
      break;
    }
    case 'rebond':
      chain(b);
      // Un tapis de rebond à gauche, sous le deuxième point mais hors de sa zone de pendaison : une chute y rebondit jusqu'à reprendre le point.
      box(b, -5.8, -0.8, -3.4, -0.4, 'rebond');
      // Un mur de rebond à droite, à hauteur du quatrième point : un lâcher vers la droite revient vers la chaîne.
      box(b, 3.8, 5, 4.2, 9.5, 'rebond');
      break;
    case 'cassable':
      chain(b);
      // Une paroi cassable à droite de la chaîne, entre le quatrième et le cinquième point, une étoile au-dessus : seule la vitesse y mène.
      box(b, 0.2, 9.2, 2.8, 9.6, 'cassable');
      star(b, { x: 1.5, y: 10.6 });
      break;
    case 'porte':
      // Un lanceur sous un mur dont le trou est une porte : le tir prouvé passe quand elle est ouverte, il faut attendre le bon moment.
      anchor(b, { x: 0, y: 0 });
      anchor(b, CHAIN[0]!);
      anchor(b, { x: -0.4, y: 7 }, 'lanceur');
      box(b, -6, 12, 0.6, 12.4);
      box(b, 0.6, 12, 3, 12.4, 'porte');
      box(b, 3, 12, 6, 12.4);
      anchor(b, { x: 1.8, y: 16.4 });
      anchor(b, { x: -1.4, y: 20 });
      break;
    case 'anneau':
      chain(b);
      // Un anneau au milieu de chaque vol, un peu au-dessus de la ligne entre les deux points.
      for (let i = 0; i < CHAIN.length - 1; i += 1) {
        const a = CHAIN[i]!;
        const c = CHAIN[i + 1]!;
        ring(b, { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 + 0.5 });
      }
      break;
  }
  return { anchors: b.anchors, obstacles: b.obstacles, pickups: b.pickups, rings: b.rings, zones: b.zones, junctionId: null, branchIds: [] };
}

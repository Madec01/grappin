import type { Vec2 } from '../core/math/vec2';
import { FIRST_ANCHOR_OFFSET, HALF_WIDTH, RICOCHET_WALL_RISE, RING_RADIUS, ROTOR_TURN_SECONDS, WHEEL_RISE, drift, hoop, ricochet, rocket, rotorBar, slidingWall, smashWall, updraft, wheel, type IdCounters, type Segment } from '../sim/generator';
import type { Anchor, Obstacle, ObstacleKind, Pickup, Ring, Zone } from '../sim/state';

/**
 * Scènes déterministes de démonstration, une par mécanique du lot 2 (brief du
 * 11 octobre 2026, section 18) : un premier segment construit à la main, le
 * même à chaque fois, où la nouveauté se rencontre isolément et se comprend ;
 * puis la course libre continue. Elles servent au propriétaire pour sentir
 * chaque mécanique (`?scene=rebond`), aux tests de bout en bout, au banc de
 * captures et aux robots. Les tests prouvent chaque scène par le vérificateur.
 */

export type SceneId = 'rebond' | 'cassable' | 'porte' | 'anneau' | 'courant' | 'derive' | 'fusee' | 'roue' | 'tournant' | 'glissiere';

export interface SceneDef {
  readonly id: SceneId;
  readonly name: string;
  /** Une phrase, en bannière au départ. */
  readonly intro: string;
}

export const SCENES: readonly SceneDef[] = [
  { id: 'rebond', name: 'Le ricochet', intro: 'La chicane barre le trou : tire sous elle vers le mur violet, il te renvoie dedans.' },
  { id: 'cassable', name: 'Le mur à percer', intro: 'Pas de trou dans ce mur : tire à pleine puissance pour le traverser.' },
  { id: 'porte', name: 'La porte', intro: 'La porte se ferme et s\'ouvre : tire quand elle est ouverte.' },
  { id: 'anneau', name: 'Le cerceau', intro: 'La prise est trop loin : passe l\'anneau au centre, il t\'accélère.' },
  { id: 'courant', name: 'Le courant', intro: 'Le courant te porte : lâche dedans et laisse-toi monter.' },
  { id: 'derive', name: 'La dérive', intro: 'Dans la bande, le courant te pousse de côté : vise avant d\'entrer.' },
  { id: 'fusee', name: 'La fusée', intro: 'Le couloir t\'accélère, la zone qui suit te freine : rattrape la prise en haut.' },
  { id: 'roue', name: 'La roue', intro: 'La roue t\'entraîne de plus en plus vite : fais le tour, lâche en montant.' },
  { id: 'tournant', name: 'Le tournant', intro: 'La barre tourne : passe quand elle laisse le passage.' },
  { id: 'glissiere', name: 'La glissière', intro: 'Le trou du mur va et vient : tire quand il passe au-dessus de toi.' },
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

function ring(b: Builder, offset: Vec2): void {
  b.rings.push({ id: b.ids.ring, pos: { x: b.origin.x + FIRST_ANCHOR_OFFSET.x + offset.x, y: b.origin.y + FIRST_ANCHOR_OFFSET.y + offset.y }, radius: RING_RADIUS, closest: null, taken: false });
  b.ids.ring += 1;
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
    case 'rebond': {
      // Un lanceur, une chicane qui barre le tir direct vers le trou, et un mur de rebond à droite qui renvoie dans le trou (brief, L5).
      anchor(b, { x: 0, y: 0 });
      anchor(b, CHAIN[0]!);
      const launcher = anchor(b, { x: -0.4, y: 7 }, 'lanceur');
      const { boxes, exit } = ricochet(b.ids, launcher.pos, RICOCHET_WALL_RISE, 1, HALF_WIDTH);
      b.obstacles.push(...boxes);
      b.anchors.push({ id: b.ids.anchor, pos: exit, kind: 'normal', broken: false });
      b.ids.anchor += 1;
      anchor(b, { x: 2.4, y: 19.8 });
      break;
    }
    case 'cassable': {
      // Un lanceur sous un mur cassable sans trou : il faut tirer à pleine puissance ; un tir mou rebondit sur le mur.
      anchor(b, { x: 0, y: 0 });
      anchor(b, CHAIN[0]!);
      const launcher = anchor(b, { x: -0.4, y: 7 }, 'lanceur');
      const { wall, exit } = smashWall(b.ids, launcher.pos, 5, 0.6, HALF_WIDTH);
      b.obstacles.push(wall);
      b.anchors.push({ id: b.ids.anchor, pos: exit, kind: 'normal', broken: false });
      b.ids.anchor += 1;
      anchor(b, { x: -2.4, y: 19.8 });
      break;
    }
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
    case 'anneau': {
      // Un lanceur sous un mur dont le seul passage est un anneau, étroit et décalé : un tir de précision ; puis un anneau libre sur la chaîne.
      anchor(b, { x: 0, y: 0 });
      anchor(b, CHAIN[0]!);
      const launcher = anchor(b, { x: -0.4, y: 7 }, 'lanceur');
      const { walls, ring: hole, exit } = hoop(b.ids, launcher.pos, 5, launcher.pos.x + 2.3, HALF_WIDTH);
      b.obstacles.push(...walls);
      b.rings.push(hole);
      b.anchors.push({ id: b.ids.anchor, pos: exit, kind: 'normal', broken: false });
      b.ids.anchor += 1;
      const next: Vec2 = { x: -1.6, y: 19.8 };
      ring(b, { x: (exit.x - FIRST_ANCHOR_OFFSET.x + next.x) / 2, y: (exit.y - FIRST_ANCHOR_OFFSET.y + next.y) / 2 + 0.5 });
      anchor(b, next);
      break;
    }
    case 'roue': {
      // Deux points, puis une roue motorisée (vers la gauche) ; la chaîne reprend bien plus haut, là où la roue envoie.
      anchor(b, { x: 0, y: 0 });
      anchor(b, CHAIN[0]!);
      const at = { x: b.origin.x + FIRST_ANCHOR_OFFSET.x + 0.8, y: b.origin.y + FIRST_ANCHOR_OFFSET.y + 7.2 };
      const { anchor: hub, exit } = wheel(b.ids, at, 1, HALF_WIDTH);
      b.anchors.push(hub);
      b.anchors.push({ id: b.ids.anchor, pos: exit, kind: 'normal', broken: false });
      b.ids.anchor += 1;
      anchor(b, { x: -1, y: 7.2 + WHEEL_RISE + 3.6 });
      anchor(b, { x: 1.6, y: 7.2 + WHEEL_RISE + 7.2 });
      break;
    }
    case 'tournant': {
      // La chaîne de démonstration, et une barre qui tourne entre le deuxième et le troisième point, dans le passage.
      anchor(b, { x: 0, y: 0 });
      for (const p of CHAIN) anchor(b, p);
      const pivot = { x: b.origin.x + FIRST_ANCHOR_OFFSET.x - 0.9, y: b.origin.y + FIRST_ANCHOR_OFFSET.y + 9.6 };
      b.obstacles.push(rotorBar(b.ids, pivot, 1 / ROTOR_TURN_SECONDS, 0.1));
      break;
    }
    case 'glissiere': {
      // Un lanceur sous un mur dont le trou va et vient au-dessus de lui : on tire quand il passe.
      anchor(b, { x: 0, y: 0 });
      anchor(b, CHAIN[0]!);
      const launcher = anchor(b, { x: -0.4, y: 7 }, 'lanceur');
      const { walls, exit } = slidingWall(b.ids, launcher.pos, 5, HALF_WIDTH, 0);
      b.obstacles.push(...walls);
      b.anchors.push({ id: b.ids.anchor, pos: exit, kind: 'normal', broken: false });
      b.ids.anchor += 1;
      anchor(b, { x: 2.2, y: 19.8 });
      break;
    }
  }
  return { anchors: b.anchors, obstacles: b.obstacles, pickups: b.pickups, rings: b.rings, zones: b.zones, junctionId: null, branchIds: [] };
}

import { add, clampLength, dot, length, scale, sub, type Vec2 } from '../core/math/vec2';
import { STILL, upOf, type Environment } from './environment';
import { NO_ZONES, constrainVelocity, integrate, type Body } from './physics';
import type { Rail, Zone } from './state';
import type { Tuning } from './tuning';

/**
 * Les prises du lot 5 (brief du 11 octobre 2026, section 7) : l'aimant de
 * trajectoire (P3), le lien élastique (P4) et le rail de lancement (P2). Chacune
 * tient le personnage autrement qu'une corde : l'aimant l'attire vers son noyau
 * tant que le doigt reste posé, sans corde ; le lien élastique s'étire sous son
 * poids et sa vitesse puis le rappelle ; le rail le retient sur un arc où le
 * doigt choisit la position, et lance dans la direction de cet endroit. Pur,
 * déterministe, quatre opérations et la racine carrée ; la simulation, le
 * vérificateur et les robots jouent exactement la même chose.
 */

/**
 * Aimant : l'attraction vers le noyau, en m/s², quatre fois la gravité, dans un
 * champ visqueux (`MAGNET_DRAG`, part de la vitesse retirée par seconde) : d'où
 * que l'on arrive, on est happé vers le noyau en une seconde ou deux, en
 * courbe, et l'on y reste suspendu tant que le doigt tient ; lâché en chemin,
 * on garde sa vitesse du moment, c'est la trajectoire courbée du brief. Près
 * du noyau (`MAGNET_CORE_RADIUS`), l'attraction s'adoucit avec la distance,
 * pour une suspension sans tremblement. L'aimant est un ascenseur : il monte le
 * personnage jusqu'à son noyau, d'où la prise suivante est à portée. Et le
 * temps de tenue que le vérificateur examine.
 */
export const MAGNET_PULL = 30;
export const MAGNET_DRAG = 3;
export const MAGNET_CORE_RADIUS = 0.4;
export const MAGNET_HOLD_SECONDS = 3;
/**
 * Lien élastique : raideur (m/s² par mètre d'étirement) ; le lien rappelle
 * `ELASTIC_RETURN_GAIN` fois plus fort qu'il ne retient (c'est sa source
 * d'énergie, comme le treuil pour la corde : une chute devient une remontée
 * plus haute que le point de départ, et même pris sans élan il rebondit de
 * plus en plus haut, en six secondes environ) ; amortissement de la vitesse radiale en
 * s'étirant (par seconde) ; étirement maximal au-delà de la longueur de repos
 * (butée franche, lisible, qui borne aussi l'énergie rendue) ; l'arrivée que
 * le vérificateur suppose, une chute depuis `ELASTIC_ENTRY_ABOVE` au-dessus de
 * la prise, un peu de côté, à `ELASTIC_ENTRY_SPEED` ; et le temps de tenue
 * qu'il examine.
 */
export const ELASTIC_STIFFNESS = 24;
export const ELASTIC_RETURN_GAIN = 3;
export const ELASTIC_DAMPING = 0.2;
export const ELASTIC_MAX_STRETCH = 2;
/** Tenu, le lien freine la vitesse de côté (perpendiculaire à la gravité, part par seconde) : pas de pendule fou, le personnage se range sous la prise et rebondit à la verticale, de plus en plus haut, lisible. */
export const ELASTIC_DRAG = 4;
export const ELASTIC_ENTRY_ABOVE = 2;
export const ELASTIC_ENTRY_SPEED = 6;
export const ELASTIC_HOLD_SECONDS = 4;
/**
 * Rail : un arc en dôme de `RAIL_HALF_WIDTH` de demi-largeur et `RAIL_RISE` de
 * flèche ; la position se choisit en glissant le doigt de `RAIL_DRAG` mètres de
 * monde de part et d'autre ; le lancer part à `RAIL_SPEED` selon la normale de
 * l'arc à cet endroit (un quart de tour d'éventail d'un bout à l'autre, à
 * 45° de chaque côté). Rien à moins de `RAIL_CLEARANCE` d'un rail. Le
 * vérificateur essaie `RAIL_POSITIONS` positions réparties sur l'arc.
 */
export const RAIL_HALF_WIDTH = 1.5;
export const RAIL_RISE = 0.75;
export const RAIL_SPEED = 12;
export const RAIL_DRAG = 1.5;
export const RAIL_CLEARANCE = RAIL_HALF_WIDTH + 1;
export const RAIL_POSITIONS = 11;
/** Prise interrupteur (P5) : le mécanisme qu'elle commande reste ouvert ce temps après le lâcher, le temps d'un passage humain. */
export const SWITCH_HOLD_SECONDS = 4;

/** Le rail ordinaire du générateur et des scènes. */
export const DEFAULT_RAIL: Rail = { halfWidth: RAIL_HALF_WIDTH, rise: RAIL_RISE };

/**
 * Un pas tenu par un aimant : attiré vers le noyau de `MAGNET_PULL`, puis le
 * vol libre ordinaire, gravité, vent et zones compris ; aucune corde ne retient.
 */
export function magnetStep(body: Body, core: Vec2, tuning: Tuning, env: Environment = STILL, zones: readonly Zone[] = NO_ZONES): Body {
  const towards = sub(core, body.pos);
  const d = length(towards);
  const dt = tuning.stepSeconds;
  const damped = scale(body.vel, Math.max(0, 1 - MAGNET_DRAG * dt));
  if (d <= 1e-9) return integrate({ pos: body.pos, vel: damped }, null, 0, tuning, env, zones);
  const pull = MAGNET_PULL * (d < MAGNET_CORE_RADIUS ? d / MAGNET_CORE_RADIUS : 1);
  return integrate({ pos: body.pos, vel: add(damped, scale(towards, (pull * dt) / d)) }, null, 0, tuning, env, zones);
}

/**
 * Un pas tenu par un lien élastique de longueur de repos `restLength` : étiré,
 * le lien rappelle vers la prise à raison de `ELASTIC_STIFFNESS` par mètre
 * d'étirement et amortit la vitesse radiale ; en deçà de la longueur de repos il
 * est mou. Il ne s'étire jamais au-delà de `ELASTIC_MAX_STRETCH` : butée.
 */
export function elasticStep(body: Body, anchor: Vec2, restLength: number, tuning: Tuning, env: Environment = STILL, zones: readonly Zone[] = NO_ZONES): Body {
  const r = sub(body.pos, anchor);
  const d = length(r);
  // Tenu, la vitesse de côté s'amortit : le personnage se range sous la prise, le rebond est vertical.
  const up = upOf(env);
  const lift = dot(body.vel, up);
  let vel = add(scale(sub(body.vel, scale(up, lift)), Math.max(0, 1 - ELASTIC_DRAG * tuning.stepSeconds)), scale(up, lift));
  const stretch = d - restLength;
  if (stretch > 0 && d > 1e-9) {
    const n = scale(r, 1 / d);
    const radial = dot(vel, n);
    // En s'étirant (vitesse radiale sortante), le lien retient et amortit ; en se rétractant, il rappelle plus fort.
    const accel = radial > 0 ? -ELASTIC_STIFFNESS * stretch - ELASTIC_DAMPING * radial : -ELASTIC_STIFFNESS * ELASTIC_RETURN_GAIN * stretch;
    vel = add(vel, scale(n, accel * tuning.stepSeconds));
  }
  const moved = integrate({ pos: body.pos, vel }, null, 0, tuning, env, zones);
  const max = restLength + ELASTIC_MAX_STRETCH;
  const r2 = sub(moved.pos, anchor);
  const d2 = length(r2);
  if (d2 <= max) return moved;
  const pos = add(anchor, scale(r2, max / d2));
  return { pos, vel: clampLength(constrainVelocity(pos, moved.vel, anchor, max), tuning.maxSpeed) };
}

/** L'étirement d'un lien élastique tenu, en mètres au-delà de sa longueur de repos, jamais négatif : le rendu l'épaissit. */
export function elasticStretch(pos: Vec2, anchor: Vec2, restLength: number): number {
  return Math.max(0, length(sub(pos, anchor)) - restLength);
}

/** La position sur le rail, de 0 (bout gauche) à 1 (bout droit), que choisit une traction du doigt : son glissement de côté, `RAIL_DRAG` pour aller d'un bout au milieu. */
export function railParam(pull: Vec2): number {
  const t = 0.5 + pull.x / (2 * RAIL_DRAG);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Le point de l'arc du rail à la position `t`, l'arc étant posé sur la prise, ses bouts à sa hauteur et son sommet `rise` plus haut. */
export function railPoint(anchor: Vec2, rail: Rail, t: number): Vec2 {
  const u = 2 * t - 1;
  return { x: anchor.x + rail.halfWidth * u, y: anchor.y + rail.rise * (1 - u * u) };
}

/** La direction de lancer à la position `t` : la normale de l'arc, vers le haut, qui penche vers le bout où l'on est. */
export function railDirection(rail: Rail, t: number): Vec2 {
  const u = 2 * t - 1;
  const nx = 2 * rail.rise * u;
  const ny = rail.halfWidth;
  const len = Math.sqrt(nx * nx + ny * ny);
  return { x: nx / len || 0, y: ny / len };
}

/** La vitesse de départ d'un lancer depuis la position `t` du rail. */
export function railVelocity(rail: Rail, t: number): Vec2 {
  return scale(railDirection(rail, t), RAIL_SPEED);
}

/** Les positions du rail que le vérificateur et les pilotes essaient, réparties d'un bout à l'autre. */
export function railSet(): number[] {
  const positions: number[] = [];
  for (let i = 0; i < RAIL_POSITIONS; i += 1) positions.push(i / (RAIL_POSITIONS - 1));
  return positions;
}

/** La traction du doigt qui mène à la position `t` du rail : l'inverse de `railParam`, pour les pilotes. */
export function railPull(t: number): Vec2 {
  return { x: (t - 0.5) * 2 * RAIL_DRAG || 0, y: 0 };
}

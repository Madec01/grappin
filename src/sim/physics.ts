import { add, clampLength, dot, length, lengthSq, normalize, scale, sub, type Vec2 } from '../core/math/vec2';
import { STILL, acceleration, type Environment } from './environment';
import type { Motor, Zone } from './state';
import type { Tuning } from './tuning';

/**
 * Physique du personnage : vol libre et pendule à corde.
 *
 * Un pas fait trois choses, toujours dans le même ordre : la gravité, la
 * corde, le déplacement. La corde est une corde et non une tige : elle ne
 * retient le personnage que lorsqu'elle est tendue et qu'il s'en éloigne.
 * Quand elle est molle, le personnage vole librement jusqu'à ce qu'elle se
 * tende à nouveau. Seules les quatre opérations et la racine carrée sont
 * utilisées : le résultat est identique sur tout moteur JavaScript.
 */

export interface Body {
  readonly pos: Vec2;
  readonly vel: Vec2;
}

/** Tolérance sous laquelle une corde est considérée tendue. */
const TAUT_EPSILON = 1e-6;

/** Aucune zone : le cas ordinaire, partagé pour ne rien allouer. */
export const NO_ZONES: readonly Zone[] = [];
/** Près du bord d'un courant, la poussée monte en douceur sur cette distance, en mètres (brief : « force progressive »). */
export const ZONE_RAMP = 0.6;
/** Une zone de freinage ne ralentit jamais sous cette vitesse, en m/s : lisible, jamais brutal, jamais arrêté. */
export const BRAKE_FLOOR = 2;

/**
 * Accélération que les zones ajoutent en ce point, à cette vitesse. Un courant
 * (ascendant, latéral) pousse dans sa direction, en douceur près de ses bords ;
 * un couloir d'accélération pousse le long de son axe, à plein, tant que la
 * vitesse le long de l'axe est sous son plafond ; une zone de freinage retire
 * une part de la vitesse par seconde, jamais sous `BRAKE_FLOOR`. Quatre
 * opérations : le résultat est identique sur tout moteur.
 */
export function zoneAcceleration(zones: readonly Zone[], pos: Vec2, vel: Vec2): Vec2 {
  let x = 0;
  let y = 0;
  for (const zone of zones) {
    if (pos.x < zone.x0 || pos.x > zone.x1 || pos.y < zone.y0 || pos.y > zone.y1) continue;
    if (zone.kind === 'freinage') {
      if (length(vel) <= BRAKE_FLOOR) continue;
      x -= vel.x * zone.strength;
      y -= vel.y * zone.strength;
      continue;
    }
    if (zone.kind === 'acceleration') {
      if (zone.cap !== undefined && dot(vel, zone.dir) >= zone.cap) continue;
      x += zone.dir.x * zone.strength;
      y += zone.dir.y * zone.strength;
      continue;
    }
    const edge = Math.min(pos.x - zone.x0, zone.x1 - pos.x, pos.y - zone.y0, zone.y1 - pos.y);
    const ramp = edge >= ZONE_RAMP ? 1 : edge / ZONE_RAMP;
    x += zone.dir.x * zone.strength * ramp;
    y += zone.dir.y * zone.strength * ramp;
  }
  return { x, y };
}

/** La zone dans laquelle se trouve ce point, ou null : la première de la liste s'il y en a plusieurs. */
export function zoneAt(zones: readonly Zone[], pos: Vec2): Zone | null {
  for (const zone of zones) if (pos.x >= zone.x0 && pos.x <= zone.x1 && pos.y >= zone.y0 && pos.y <= zone.y1) return zone;
  return null;
}

/**
 * Retire la composante radiale sortante de la vitesse si la corde est tendue.
 * Si la corde est molle ou si le personnage se rapproche du point, la vitesse
 * est rendue telle quelle.
 */
export function constrainVelocity(pos: Vec2, vel: Vec2, anchor: Vec2, ropeLength: number): Vec2 {
  const r = sub(pos, anchor);
  const d = length(r);
  if (d === 0 || d < ropeLength - TAUT_EPSILON) return vel;
  const n = scale(r, 1 / d);
  const outward = dot(vel, n);
  if (outward <= 0) return vel;
  return sub(vel, scale(n, outward));
}

/**
 * Avance le personnage d'un pas. `anchor` vaut null en vol libre.
 *
 * Après le déplacement, si le personnage a dépassé la longueur de corde, il
 * est ramené sur le cercle et sa vitesse est contrainte une seconde fois,
 * afin que la corde garde exactement sa longueur à chaque pas.
 */
export function integrate(body: Body, anchor: Vec2 | null, ropeLength: number, tuning: Tuning, env: Environment = STILL, zones: readonly Zone[] = NO_ZONES): Body {
  const dt = tuning.stepSeconds;
  const a = acceleration(env, tuning);
  const z = zones.length > 0 ? zoneAcceleration(zones, body.pos, body.vel) : { x: 0, y: 0 };
  let vel: Vec2 = { x: body.vel.x + (a.x + z.x) * dt, y: body.vel.y + (a.y + z.y) * dt };
  if (anchor) vel = constrainVelocity(body.pos, vel, anchor, ropeLength);
  let pos = add(body.pos, scale(vel, dt));
  if (anchor) {
    const r = sub(pos, anchor);
    const d = length(r);
    if (d > ropeLength) {
      pos = add(anchor, scale(r, ropeLength / d));
      vel = constrainVelocity(pos, vel, anchor, ropeLength);
    }
  }
  return { pos, vel: clampLength(vel, tuning.maxSpeed) };
}

/**
 * Treuil : la corde passe de `oldLength` à `newLength` pendant ce pas.
 *
 * Si la corde est tendue, le personnage est tiré vers le point à la vitesse
 * d'enroulement, et sa vitesse le long du cercle est augmentée d'une part
 * `spin` de ce que donnerait la conservation du moment cinétique, comme un
 * patineur qui ramène les bras. C'est la source d'énergie du jeu : sans elle,
 * un pendule ne monte jamais plus haut que son élan de départ. Si la corde est
 * molle, rien ne change : elle se tendra plus tard.
 */
export function reelIn(body: Body, anchor: Vec2, oldLength: number, newLength: number, spin: number, dt: number, maxSpin = Infinity): Body {
  if (newLength >= oldLength) return body;
  const r = sub(body.pos, anchor);
  const d = length(r);
  if (d === 0 || d < oldLength - TAUT_EPSILON) return body;
  const n = scale(r, 1 / d);
  const t: Vec2 = { x: -n.y, y: n.x };
  const radial = dot(body.vel, n);
  const along = dot(body.vel, t);
  const pulled = -(oldLength - newLength) / dt;
  // Le treuil accélère, mais jamais au-delà de `maxSpin` : ce qu'il ne gagne pas, il ne le retire pas non plus.
  const gained = along * (1 + spin * (oldLength / newLength - 1));
  const cap = Math.max(Math.abs(along), maxSpin);
  const spun = Math.abs(gained) > cap ? (gained < 0 ? -cap : cap) : gained;
  const vel = add(scale(n, radial < pulled ? radial : pulled), scale(t, spun));
  return { pos: body.pos, vel };
}

/**
 * Pompage : accroché et sans élan, le personnage se relance le long du cercle
 * dans le sens où il va déjà, comme un enfant qui pousse sur une balançoire.
 * L'élan se mesure par la vitesse qu'aurait le personnage au point bas du
 * cercle, pas par sa vitesse du moment, qui est faible en haut de chaque
 * balancement même quand l'élan est bon. Cela garantit un balancement jamais
 * mou une fois la corde au plus court, où le treuil n'apporte plus rien. La
 * vitesse plancher reste bien sous ce qu'un joueur obtient par ses lâchers :
 * le jeu ne joue pas à sa place.
 */
export function swingAssist(body: Body, anchor: Vec2, ropeLength: number, tuning: Tuning, env: Environment = STILL): Body {
  if (tuning.swingAssistAccel <= 0) return body;
  // Le point bas du cercle est du côté où tire la gravité ; l'élan se mesure par rapport à lui.
  const bottom = add(anchor, scale(env.gravityDir, ropeLength));
  const lift = -dot(sub(body.pos, bottom), env.gravityDir);
  const bottomSpeedSq = lengthSq(body.vel) + 2 * tuning.gravity * lift;
  if (bottomSpeedSq >= tuning.swingAssistSpeed * tuning.swingAssistSpeed) return body;
  const n = normalize(sub(body.pos, anchor));
  if (n.x === 0 && n.y === 0) return body;
  const tangent: Vec2 = { x: -n.y, y: n.x };
  const along = dot(body.vel, tangent);
  if (along > -0.05 && along < 0.05) return body;
  const sign = along > 0 ? 1 : -1;
  return { pos: body.pos, vel: add(body.vel, scale(tangent, sign * tuning.swingAssistAccel * tuning.stepSeconds)) };
}

/**
 * Le moteur d'une roue : corde tendue, il pousse le personnage le long du
 * cercle dans son sens de rotation, de `wheelAccel` par seconde, jusqu'à la
 * vitesse `wheelSpeed` qu'il entretient ; au-delà, il ne freine pas. Corde
 * molle, rien : on n'est pas sur la roue. Vite, la gravité ne suffit plus à
 * retenir le personnage en bas : il fait le tour, et lâche où il veut.
 */
export function motorStep(body: Body, anchor: Vec2, ropeLength: number, motor: Motor, tuning: Tuning): Body {
  const r = sub(body.pos, anchor);
  const d = length(r);
  if (d === 0 || d < ropeLength - TAUT_EPSILON) return body;
  const n = scale(r, 1 / d);
  const tangent: Vec2 = { x: -n.y * motor.spin, y: n.x * motor.spin };
  const along = dot(body.vel, tangent);
  if (along >= tuning.wheelSpeed) return body;
  const gain = Math.min(tuning.wheelAccel * tuning.stepSeconds, tuning.wheelSpeed - along);
  return { pos: body.pos, vel: add(body.vel, scale(tangent, gain)) };
}

/**
 * Un pas de personnage accroché : pompage, treuil puis mouvement. Renvoie le
 * corps déplacé et la nouvelle longueur de corde. Partagé par la simulation et
 * le vérificateur de parcours, qui jouent ainsi exactement la même physique.
 * Sur une roue (`motor`), ni pompage ni treuil : le moteur seul, à longueur
 * de corde constante.
 */
export function swingStep(body: Body, anchor: Vec2, ropeLength: number, tuning: Tuning, env: Environment = STILL, zones: readonly Zone[] = NO_ZONES, motor: Motor | null = null): { body: Body; ropeLength: number } {
  if (motor) return { body: integrate(motorStep(body, anchor, ropeLength, motor, tuning), anchor, ropeLength, tuning, env, zones), ropeLength };
  const assisted = swingAssist(body, anchor, ropeLength, tuning, env);
  const shorter = Math.max(tuning.ropeMin, ropeLength - tuning.reelSpeed * tuning.stepSeconds);
  const pulled = reelIn(assisted, anchor, ropeLength, shorter, tuning.reelSpin, tuning.stepSeconds, tuning.reelMaxSpeed);
  return { body: integrate(pulled, anchor, shorter, tuning, env, zones), ropeLength: shorter };
}

/** Position en vol libre après `t` secondes, sans corde, ni plafond, ni zone : la formule fermée, pour viser. */
export function freeFlightAt(body: Body, t: number, tuning: Tuning, env: Environment = STILL): Vec2 {
  const a = acceleration(env, tuning);
  return {
    x: body.pos.x + body.vel.x * t + 0.5 * a.x * t * t,
    y: body.pos.y + body.vel.y * t + 0.5 * a.y * t * t,
  };
}

/**
 * Le vol libre échantillonné : le corps (position et vitesse) tous les
 * `sampleSeconds` jusqu'à `seconds`, en commençant au premier échantillon. Sans
 * zone, la formule fermée ; avec des zones, le vol est joué pas à pas avec la
 * vraie physique, car un courant dépend de l'endroit où l'on passe. Vise,
 * ombre et vérificateur passent tous par ici : ils disent vrai sous un courant.
 */
export function flightSamples(body: Body, seconds: number, sampleSeconds: number, tuning: Tuning, env: Environment = STILL, zones: readonly Zone[] = NO_ZONES): Body[] {
  const samples: Body[] = [];
  const count = Math.max(0, Math.round(seconds / sampleSeconds));
  if (zones.length === 0) {
    const a = acceleration(env, tuning);
    for (let i = 1; i <= count; i += 1) {
      const t = sampleSeconds * i;
      samples.push({ pos: freeFlightAt(body, t, tuning, env), vel: { x: body.vel.x + a.x * t, y: body.vel.y + a.y * t } });
    }
    return samples;
  }
  const stepsPerSample = Math.max(1, Math.round(sampleSeconds / tuning.stepSeconds));
  let flying = body;
  for (let i = 1; i <= count; i += 1) {
    for (let k = 0; k < stepsPerSample; k += 1) flying = integrate(flying, null, 0, tuning, env, zones);
    samples.push(flying);
  }
  return samples;
}

/** Le corps en vol libre après `t` secondes, zones comprises : la formule fermée sans zone, sinon pas à pas. */
export function flightAt(body: Body, t: number, tuning: Tuning, env: Environment = STILL, zones: readonly Zone[] = NO_ZONES): Body {
  if (zones.length === 0) {
    const a = acceleration(env, tuning);
    return { pos: freeFlightAt(body, t, tuning, env), vel: { x: body.vel.x + a.x * t, y: body.vel.y + a.y * t } };
  }
  return flightSamples(body, t, t, tuning, env, zones)[0] ?? body;
}

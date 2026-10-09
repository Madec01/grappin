import { describe, expect, it } from 'vitest';
import { length } from '../src/core/math/vec2';
import { constrainVelocity, freeFlightAt, integrate, reelIn } from '../src/sim/physics';
import { DEFAULT_TUNING } from '../src/sim/tuning';

const T = DEFAULT_TUNING;

describe('vol libre', () => {
  it('suit une parabole : après une seconde, la hauteur perdue vaut g/2', () => {
    let body = { pos: { x: 0, y: 10 }, vel: { x: 2, y: 0 } };
    const steps = Math.round(1 / T.stepSeconds);
    for (let i = 0; i < steps; i += 1) body = integrate(body, null, 0, T);
    // Euler semi-implicite : légèrement sous la parabole exacte, d'un demi-pas de gravité.
    expect(body.pos.x).toBeCloseTo(2, 6);
    expect(body.pos.y).toBeCloseTo(10 - T.gravity / 2, 1);
    expect(freeFlightAt({ pos: { x: 0, y: 10 }, vel: { x: 2, y: 0 } }, 1, T).y).toBeCloseTo(10 - T.gravity / 2, 9);
  });

  it('ne dépasse jamais le plafond de vitesse', () => {
    let body = { pos: { x: 0, y: 1000 }, vel: { x: 0, y: 0 } };
    for (let i = 0; i < 2000; i += 1) {
      body = integrate(body, null, 0, T);
      expect(length(body.vel)).toBeLessThanOrEqual(T.maxSpeed + 1e-9);
    }
    expect(length(body.vel)).toBeCloseTo(T.maxSpeed, 9);
  });
});

describe('pendule', () => {
  const anchor = { x: 0, y: 5 };
  const rope = 3;

  it('garde la corde à sa longueur à chaque pas, et conserve presque toute son énergie', () => {
    // Départ au point bas, vitesse horizontale : le personnage monte, redescend, repasse au point bas.
    let body = { pos: { x: 0, y: 2 }, vel: { x: 6, y: 0 } };
    const energy = (b: typeof body): number => 0.5 * (b.vel.x * b.vel.x + b.vel.y * b.vel.y) + T.gravity * b.pos.y;
    const e0 = energy(body);
    let maxY = body.pos.y;
    let passedBottomAgain = false;
    let wasAbove = false;
    for (let i = 0; i < 2000 && !passedBottomAgain; i += 1) {
      body = integrate(body, anchor, rope, T);
      const d = Math.hypot(body.pos.x - anchor.x, body.pos.y - anchor.y);
      expect(d).toBeLessThanOrEqual(rope + 1e-9);
      maxY = Math.max(maxY, body.pos.y);
      if (body.pos.y > 2.5) wasAbove = true;
      if (wasAbove && body.pos.x < 0 && body.vel.x < 0 && body.pos.y < 2.001) passedBottomAgain = true;
    }
    expect(passedBottomAgain).toBe(true);
    // Hauteur atteinte : v²/2g = 36 / 15 = 2,4 m au-dessus du point bas.
    expect(maxY - 2).toBeGreaterThan(2.3);
    expect(maxY - 2).toBeLessThan(2.45);
    const loss = (e0 - energy(body)) / e0;
    expect(loss).toBeGreaterThanOrEqual(-1e-6);
    expect(loss).toBeLessThan(0.02);
  });

  it('la corde molle laisse voler librement, puis se tend sans traverser', () => {
    let body = { pos: { x: 0, y: 4.5 }, vel: { x: 0, y: 0 } };
    // À 0,5 m du point avec une corde de 3 m : chute libre jusqu'à ce que la corde se tende.
    let taut = false;
    for (let i = 0; i < 600; i += 1) {
      body = integrate(body, anchor, rope, T);
      const d = Math.hypot(body.pos.x - anchor.x, body.pos.y - anchor.y);
      expect(d).toBeLessThanOrEqual(rope + 1e-9);
      if (d >= rope - 1e-6) taut = true;
    }
    expect(taut).toBe(true);
    // Chute verticale : une fois tendue, la corde immobilise le personnage au point bas.
    expect(body.pos.y).toBeCloseTo(2, 6);
    expect(length(body.vel)).toBeLessThan(1e-6);
  });

  it('constrainVelocity ne retire que la composante sortante', () => {
    const pos = { x: 3, y: 5 };
    expect(constrainVelocity(pos, { x: 1, y: 0 }, anchor, rope)).toEqual({ x: 0, y: 0 });
    expect(constrainVelocity(pos, { x: -1, y: 0 }, anchor, rope)).toEqual({ x: -1, y: 0 });
    expect(constrainVelocity(pos, { x: 0, y: 2 }, anchor, rope)).toEqual({ x: 0, y: 2 });
    expect(constrainVelocity({ x: 1, y: 5 }, { x: 1, y: 0 }, anchor, rope)).toEqual({ x: 1, y: 0 });
  });
});

describe('treuil', () => {
  const anchor = { x: 0, y: 5 };

  it('tire le personnage vers le point et accélère son balancement', () => {
    const body = { pos: { x: 0, y: 2 }, vel: { x: 4, y: 0 } };
    const pulled = reelIn(body, anchor, 3, 3 - 2.5 * T.stepSeconds, 0.5, T.stepSeconds);
    // Vers le point : la vitesse radiale vaut la vitesse d'enroulement, vers le haut ici.
    expect(pulled.vel.y).toBeCloseTo(2.5, 9);
    // Le long du cercle : une moitié de la conservation du moment cinétique.
    expect(pulled.vel.x).toBeCloseTo(4 * (1 + 0.5 * (3 / (3 - 2.5 * T.stepSeconds) - 1)), 9);
  });

  it('ne fait rien si la corde est molle ou ne raccourcit pas', () => {
    const slack = { pos: { x: 0, y: 4 }, vel: { x: 1, y: 0 } };
    expect(reelIn(slack, anchor, 3, 2.9, 0.5, T.stepSeconds)).toEqual(slack);
    const taut = { pos: { x: 0, y: 2 }, vel: { x: 1, y: 0 } };
    expect(reelIn(taut, anchor, 3, 3, 0.5, T.stepSeconds)).toEqual(taut);
  });
});

import { describe, expect, it } from 'vitest';
import { cosTurns, sinTurns } from '../src/core/math/trig';
import { ROTOR_THICKNESS, isMoving, obstacleAt, obstacleGap, pushOutAt, rotorEnds, rotorTurns, slideOffset } from '../src/sim/moving';
import { motorStep, swingStep } from '../src/sim/physics';
import { provableObstacles, solidObstacles } from '../src/sim/obstacles';
import type { Obstacle } from '../src/sim/state';
import { DEFAULT_TUNING as T } from '../src/sim/tuning';

/** Lot 2, fin (0.13.0) : la barre qui tourne, le panneau qui glisse, la roue motorisée. */

describe('la trigonométrie déterministe', () => {
  it('suit le sinus et le cosinus à un millième près sur tout le cercle, et boucle', () => {
    for (let t = -2; t <= 2; t += 0.01) {
      expect(Math.abs(sinTurns(t) - Math.sin(2 * Math.PI * t)), `sin ${t.toFixed(2)}`).toBeLessThan(0.0011);
      expect(Math.abs(cosTurns(t) - Math.cos(2 * Math.PI * t)), `cos ${t.toFixed(2)}`).toBeLessThan(0.0011);
    }
    expect(sinTurns(0)).toBe(0);
    expect(sinTurns(0.25)).toBe(1);
    expect(sinTurns(0.5)).toBe(0);
    expect(sinTurns(-0.25)).toBe(-1);
    expect(sinTurns(3.25)).toBe(sinTurns(0.25));
  });
});

const rotor: Obstacle = { id: 1, x0: -1.6, y0: 8.4, x1: 1.6, y1: 11.6, kind: 'tournant', rotor: { pivot: { x: 0, y: 10 }, length: 3, spin: 0.25, phase: 0 } };
const pane: Obstacle = { id: 2, x0: -10, y0: 20, x1: -1.2, y1: 20.4, slide: { amplitude: 2, period: 4, phase: 0 } };
const slab: Obstacle = { id: 3, x0: -2, y0: 4, x1: 2, y1: 4.4 };

describe('la barre qui tourne', () => {
  it('fait un quart de tour par seconde à partir de sa phase, et ses bouts suivent', () => {
    const second = Math.round(1 / T.stepSeconds);
    expect(rotorTurns(rotor.rotor!, 0, T)).toBe(0);
    expect(rotorTurns(rotor.rotor!, second, T)).toBeCloseTo(0.25, 6);
    const flat = rotorEnds(rotor, 0, T)!;
    expect(flat.a).toEqual({ x: -1.5, y: 10 });
    expect(flat.b).toEqual({ x: 1.5, y: 10 });
    const upright = rotorEnds(rotor, second, T)!;
    expect(upright.a.x).toBeCloseTo(0, 6);
    expect(upright.a.y).toBeCloseTo(8.5, 6);
    expect(upright.b.y).toBeCloseTo(11.5, 6);
    expect(rotorEnds(slab, 0, T)).toBeNull();
  });

  it('touche là où la barre est à ce pas, et plus loin elle laisse passer', () => {
    const second = Math.round(1 / T.stepSeconds);
    // À plat : un cercle juste au-dessus du milieu la touche ; une seconde plus tard, la barre est debout, et il est libre.
    const above = { x: 0.7, y: 10 + ROTOR_THICKNESS / 2 + 0.2 };
    expect(obstacleGap(above, 0.3, rotor, 0, T)).toBeLessThan(0);
    expect(obstacleGap(above, 0.3, rotor, second, T)).toBeGreaterThan(0);
    // Au bout de la barre, pas au-delà.
    expect(obstacleGap({ x: 1.6, y: 10 }, 0.3, rotor, 0, T)).toBeLessThan(0);
    expect(obstacleGap({ x: 2.2, y: 10 }, 0.3, rotor, 0, T)).toBeGreaterThan(0);
    // Un obstacle fixe passe par l'écart ordinaire.
    expect(obstacleGap({ x: 0, y: 4.9 }, 0.3, slab, 0, T)).toBeCloseTo(0.2, 6);
  });

  it('repousse hors de la barre par le chemin le plus court, avec la normale du contact', () => {
    const out = pushOutAt({ x: 0.5, y: 10.3 }, 0.3, rotor, 0, T);
    expect(out.n.x).toBeCloseTo(0, 6);
    expect(out.n.y).toBeCloseTo(1, 6);
    expect(out.pos.y).toBeGreaterThan(10 + ROTOR_THICKNESS / 2 + 0.3);
    expect(obstacleGap(out.pos, 0.3, rotor, 0, T)).toBeGreaterThan(0);
    const under = pushOutAt({ x: -0.5, y: 9.8 }, 0.3, rotor, 0, T);
    expect(under.n.y).toBeCloseTo(-1, 6);
  });
});

describe('le panneau qui glisse', () => {
  it('va et vient en triangle, à vitesse constante, de -amplitude à +amplitude', () => {
    const quarter = Math.round(1 / T.stepSeconds);
    expect(slideOffset(pane.slide!, 0, T)).toBe(-2);
    expect(slideOffset(pane.slide!, quarter, T)).toBeCloseTo(0, 6);
    expect(slideOffset(pane.slide!, 2 * quarter, T)).toBeCloseTo(2, 6);
    expect(slideOffset(pane.slide!, 3 * quarter, T)).toBeCloseTo(0, 6);
    expect(slideOffset(pane.slide!, 4 * quarter, T)).toBeCloseTo(-2, 6);
    expect(slideOffset({ ...pane.slide!, phase: 0.5 }, 0, T)).toBeCloseTo(2, 6);
  });

  it('est là où il est à ce pas : la boîte décalée, l\'écart et la sortie avec elle ; un obstacle fixe reste lui-même', () => {
    const quarter = Math.round(1 / T.stepSeconds);
    expect(obstacleAt(pane, 0, T)).toMatchObject({ x0: -12, x1: -3.2 });
    expect(obstacleAt(pane, 2 * quarter, T)).toMatchObject({ x0: -8, x1: 0.8 });
    expect(obstacleAt(slab, 7, T)).toBe(slab);
    expect(obstacleGap({ x: -2, y: 20.2 }, 0.3, pane, 0, T)).toBeGreaterThan(0);
    expect(obstacleGap({ x: -2, y: 20.2 }, 0.3, pane, 2 * quarter, T)).toBeLessThan(0);
    expect(pushOutAt({ x: 0.5, y: 20.5 }, 0.3, pane, 2 * quarter, T).n.y).toBe(1);
    expect(isMoving(pane)).toBe(true);
    expect(isMoving(rotor)).toBe(true);
    expect(isMoving(slab)).toBe(false);
  });

  it('le vérificateur ne compte ni sur les tournants ni sur les panneaux ; la visée voit les panneaux où ils sont, jamais les tournants', () => {
    expect(provableObstacles([rotor, pane, slab]).map((box) => box.id)).toEqual([3]);
    const quarter = Math.round(1 / T.stepSeconds);
    const seen = solidObstacles({ obstacles: [rotor, pane, slab], step: 2 * quarter, doorsInside: [] }, T);
    expect(seen.map((box) => box.id)).toEqual([2, 3]);
    expect(seen[0]).toMatchObject({ x0: -8, x1: 0.8 });
  });
});

describe('la roue motorisée', () => {
  const anchor = { x: 0, y: 20 };

  it('corde tendue, le moteur pousse le long du cercle dans son sens, jusqu\'à sa vitesse, et jamais au-delà', () => {
    // Pendu sous la roue, immobile : le moteur +1 pousse vers la droite (sens trigonométrique vu de face), -1 vers la gauche.
    const hanging = { pos: { x: 0, y: 16 }, vel: { x: 0, y: 0 } };
    const pushed = motorStep(hanging, anchor, 4, { spin: 1 }, T);
    expect(pushed.vel.x).toBeCloseTo(T.wheelAccel * T.stepSeconds, 9);
    expect(pushed.vel.y).toBe(0);
    expect(motorStep(hanging, anchor, 4, { spin: -1 }, T).vel.x).toBeCloseTo(-T.wheelAccel * T.stepSeconds, 9);
    // Déjà à la vitesse du moteur : rien de plus ; plus vite : il ne freine pas.
    const fast = { pos: { x: 0, y: 16 }, vel: { x: T.wheelSpeed, y: 0 } };
    expect(motorStep(fast, anchor, 4, { spin: 1 }, T)).toBe(fast);
    const faster = { pos: { x: 0, y: 16 }, vel: { x: T.wheelSpeed + 3, y: 0 } };
    expect(motorStep(faster, anchor, 4, { spin: 1 }, T)).toBe(faster);
    // Corde molle : rien.
    const slack = { pos: { x: 0, y: 18 }, vel: { x: 0, y: 0 } };
    expect(motorStep(slack, anchor, 4, { spin: 1 }, T)).toBe(slack);
  });

  it('en deux secondes, le personnage tourne autour de la roue à la vitesse du moteur, corde de longueur constante, sans treuil, et fait le tour', () => {
    let swing = { body: { pos: { x: 0, y: 16 }, vel: { x: 0, y: 0 } }, ropeLength: 4 };
    let above = false;
    const speeds: number[] = [];
    for (let k = 0; k < Math.round(2 / T.stepSeconds); k += 1) {
      swing = swingStep(swing.body, anchor, swing.ropeLength, T, undefined, undefined, { spin: 1 });
      const d = Math.hypot(swing.body.pos.x - anchor.x, swing.body.pos.y - anchor.y);
      expect(d).toBeLessThanOrEqual(4 + 1e-6);
      if (swing.body.pos.y > anchor.y + 3) above = true;
      speeds.push(Math.hypot(swing.body.vel.x, swing.body.vel.y));
    }
    expect(swing.ropeLength).toBe(4);
    expect(above).toBe(true);
    expect(Math.max(...speeds.slice(-60))).toBeGreaterThan(T.wheelSpeed * 0.8);
    // Sans moteur, le même départ reste pendu : il n'arrive jamais au-dessus de la roue, et le treuil raccourcit la corde.
    let plain = { body: { pos: { x: 0, y: 16 }, vel: { x: 0, y: 0 } }, ropeLength: 4 };
    for (let k = 0; k < Math.round(2 / T.stepSeconds); k += 1) {
      plain = swingStep(plain.body, anchor, plain.ropeLength, T);
      expect(plain.body.pos.y).toBeLessThan(anchor.y);
    }
    expect(plain.ropeLength).toBeLessThan(4);
  });
});

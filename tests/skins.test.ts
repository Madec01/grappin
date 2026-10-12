import { describe, expect, it } from 'vitest';
import {
  DOOR_BLINK_HZ,
  CRACK_SPACING,
  ROTOR_PIVOT_RADIUS,
  SKIN,
  WHEEL_RIM_RADIUS,
  WHEEL_SPOKES,
  WHEEL_TURNS_PER_SECOND,
  crackPattern,
  doorLook,
  ringPhase,
  rotorWidths,
  springTeeth,
  stepWave,
  wheelAngle,
  wheelChevrons,
  wheelDirection,
  wheelSpokes,
} from '../src/render/skins';
import { COLOR } from '../src/render/style';
import { DOOR_OPEN_SECONDS, DOOR_PERIOD_SECONDS, DOOR_WARNING_SECONDS, doorGauge, doorState } from '../src/sim/cycles';
import { RING_RADIUS } from '../src/sim/generator';
import { ROTOR_THICKNESS } from '../src/sim/moving';
import { motorStep } from '../src/sim/physics';
import { RING_CENTRE_RATIO } from '../src/sim/rules';
import { DEFAULT_TUNING as T } from '../src/sim/tuning';

const SECOND = Math.round(1 / T.stepSeconds);
const DOOR_ID = 2;

/** Les pas d'un cycle complet de la porte, de 0 à sa période. */
function cycleSteps(): number[] {
  return Array.from({ length: Math.round(DOOR_PERIOD_SECONDS * SECOND) }, (_, step) => step);
}

describe('stepWave', () => {
  it('oscille entre 0 et 1 au rythme demandé, d\'après le pas de simulation seul', () => {
    const values = Array.from({ length: 2 * SECOND }, (_, step) => stepWave(step, T.stepSeconds, 2));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(Math.max(...values)).toBeGreaterThan(0.99);
    expect(Math.min(...values)).toBeLessThan(0.01);
    // Deux hertz : la même valeur une demi-seconde plus tard, et la même à chaque appel.
    expect(stepWave(7, T.stepSeconds, 2)).toBeCloseTo(stepWave(7 + SECOND / 2, T.stepSeconds, 2), 9);
    expect(stepWave(7, T.stepSeconds, 2)).toBe(stepWave(7, T.stepSeconds, 2));
  });
});

describe('doorLook : ce que le rendu dessine d\'une porte', () => {
  it('suit le cycle de la simulation : ouverte, avertit, fermée, sans jamais en inventer un autre', () => {
    const phaseOf = { ouverte: 'ouverte', 'se ferme': 'avertit', fermee: 'fermee' } as const;
    for (const step of cycleSteps()) {
      const look = doorLook({ id: DOOR_ID }, { step, doorsInside: [] }, T);
      expect(look.phase).toBe(phaseOf[doorState(DOOR_ID, step, T)]);
      expect(look.gauge).toBe(doorGauge(DOOR_ID, step, T));
    }
  });

  it('montre tout le cycle : ouverte la plus grande part, puis un avertissement de 0,8 s, puis fermée', () => {
    const counts = { ouverte: 0, avertit: 0, fermee: 0, passage: 0 };
    for (const step of cycleSteps()) counts[doorLook({ id: DOOR_ID }, { step, doorsInside: [] }, T).phase] += 1;
    expect(counts.avertit).toBe(Math.round(DOOR_WARNING_SECONDS * SECOND));
    expect(counts.ouverte).toBe(Math.round((DOOR_OPEN_SECONDS - DOOR_WARNING_SECONDS) * SECOND));
    expect(counts.fermee).toBe(Math.round((DOOR_PERIOD_SECONDS - DOOR_OPEN_SECONDS) * SECOND));
    expect(counts.passage).toBe(0);
  });

  it('la jauge se remplit de 0 à 1 pendant l\'ouverture (avertissement compris), puis encore pendant la fermeture', () => {
    let previous = -1;
    let rises = 0;
    for (const step of cycleSteps()) {
      const { gauge } = doorLook({ id: DOOR_ID }, { step, doorsInside: [] }, T);
      expect(gauge).toBeGreaterThanOrEqual(0);
      expect(gauge).toBeLessThanOrEqual(1);
      // Elle ne redescend jamais en cours de phase : elle repart de 0 au changement de phase seulement.
      if (gauge < previous) rises += 1;
      previous = gauge;
    }
    // Deux remises à zéro dans un cycle (ouverte vers fermée, fermée vers ouverte), à une près du bouclage du cycle.
    expect(rises).toBeGreaterThanOrEqual(1);
    expect(rises).toBeLessThanOrEqual(2);
  });

  it('le clignotement n\'existe que pendant l\'avertissement : franc (1) ailleurs, entre 0 et 1 et vraiment changeant pendant', () => {
    const warning = cycleSteps().filter((step) => doorLook({ id: DOOR_ID }, { step, doorsInside: [] }, T).phase === 'avertit');
    const beats = warning.map((step) => doorLook({ id: DOOR_ID }, { step, doorsInside: [] }, T).beat);
    expect(Math.min(...beats)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...beats)).toBeLessThanOrEqual(1);
    // Sur 0,8 s à 3 Hz : plus de deux clignotements, donc la valeur monte et descend.
    expect(DOOR_BLINK_HZ * DOOR_WARNING_SECONDS).toBeGreaterThan(2);
    expect(Math.max(...beats) - Math.min(...beats)).toBeGreaterThan(0.5);
    for (const step of cycleSteps()) {
      const look = doorLook({ id: DOOR_ID }, { step, doorsInside: [] }, T);
      if (look.phase !== 'avertit') expect(look.beat).toBe(1);
    }
  });

  it('fermée sur le personnage qu\'elle a surpris dedans, elle le laisse passer : phase « passage », jamais « fermée »', () => {
    const closed = cycleSteps().filter((step) => doorState(DOOR_ID, step, T) === 'fermee');
    expect(closed.length).toBeGreaterThan(0);
    for (const step of closed) {
      expect(doorLook({ id: DOOR_ID }, { step, doorsInside: [DOOR_ID] }, T).phase).toBe('passage');
      // Une autre porte, elle, n'est pas concernée.
      expect(doorLook({ id: DOOR_ID }, { step, doorsInside: [DOOR_ID + 1] }, T).phase).toBe('fermee');
    }
    // Ouverte, rien ne change que le personnage soit dedans ou non.
    const open = cycleSteps().find((step) => doorState(DOOR_ID, step, T) === 'ouverte')!;
    expect(doorLook({ id: DOOR_ID }, { step: open, doorsInside: [DOOR_ID] }, T).phase).toBe('ouverte');
  });

  it('est le même d\'une fois sur l\'autre, et deux portes voisines ne battent pas ensemble', () => {
    const step = 301;
    expect(doorLook({ id: DOOR_ID }, { step, doorsInside: [] }, T)).toEqual(doorLook({ id: DOOR_ID }, { step, doorsInside: [] }, T));
    const phases = cycleSteps().filter((s) => doorLook({ id: 1 }, { step: s, doorsInside: [] }, T).phase !== doorLook({ id: 2 }, { step: s, doorsInside: [] }, T).phase);
    expect(phases.length).toBeGreaterThan(0);
  });
});

describe('ringPhase : ce que le rendu dessine d\'un anneau', () => {
  const ring = (patch: { taken?: boolean; closest?: number | null }) => ({ taken: false, closest: null, radius: RING_RADIUS, ...patch });

  it('libre tant que le personnage n\'est pas dans le disque', () => {
    expect(ringPhase(ring({}))).toBe('libre');
  });

  it('en cours de traversée dès que le personnage est dans le disque, et « au centre » s\'il est passé à 0,4 rayon ou moins du milieu', () => {
    expect(ringPhase(ring({ closest: RING_RADIUS }))).toBe('traverse');
    expect(ringPhase(ring({ closest: RING_RADIUS * RING_CENTRE_RATIO + 0.001 }))).toBe('traverse');
    expect(ringPhase(ring({ closest: RING_RADIUS * RING_CENTRE_RATIO }))).toBe('centre');
    expect(ringPhase(ring({ closest: 0 }))).toBe('centre');
  });

  it('prise une fois traversée, quoi qu\'il reste de la traversée', () => {
    expect(ringPhase(ring({ taken: true }))).toBe('prise');
    expect(ringPhase(ring({ taken: true, closest: 0 }))).toBe('prise');
  });
});

describe('crackPattern : les fissures d\'une paroi cassable', () => {
  it('est le même à chaque appel, d\'après le numéro et la longueur seuls', () => {
    expect(crackPattern(4, 2.6)).toEqual(crackPattern(4, 2.6));
  });

  it('change d\'une paroi à l\'autre', () => {
    expect(crackPattern(4, 2.6)).not.toEqual(crackPattern(5, 2.6));
  });

  it('reste dans la paroi : tous les points entre 0 et 1, par paires (le long, en travers)', () => {
    for (const id of [0, 1, 7, 123, 99999]) {
      for (const length of [0.5, 2.6, 8]) {
        for (const crack of crackPattern(id, length)) {
          expect(crack.length % 2).toBe(0);
          expect(crack.length).toBeGreaterThanOrEqual(4);
          for (const value of crack) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('a une fissure principale par tranche de longueur et une branche qui en part : une paroi plus longue en a plus', () => {
    const short = crackPattern(3, CRACK_SPACING);
    const long = crackPattern(3, 4 * CRACK_SPACING);
    expect(short).toHaveLength(2);
    expect(long).toHaveLength(8);
    // La fissure principale traverse la paroi de bord à bord (en travers de 0 à 1).
    const main = long[0]!;
    expect(main[1]).toBe(0);
    expect(main.at(-1)).toBe(1);
  });

  it('une paroi minuscule a quand même sa fissure', () => {
    expect(crackPattern(8, 0.01).length).toBeGreaterThanOrEqual(2);
  });
});

describe('springTeeth : le ressort d\'une surface de rebond', () => {
  it('a plus de dents sur une surface plus longue, et deux au moins, même minuscule', () => {
    expect(springTeeth(0)).toBe(2);
    expect(springTeeth(10)).toBe(2);
    expect(springTeeth(150)).toBeGreaterThan(springTeeth(60));
    expect(springTeeth(200)).toBe(Math.round(200 / 15));
  });
});

describe('teintes dérivées', () => {
  it('chaque masse reste sombre : aucun canal ne dépasse 0x70', () => {
    for (const [name, color] of Object.entries({ bounceBody: SKIN.bounceBody, smashBody: SKIN.smashBody, smashBodyLit: SKIN.smashBodyLit, doorBody: SKIN.doorBody, rotorBody: SKIN.rotorBody })) {
      for (const channel of [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]) expect(channel, name).toBeLessThan(0x70);
    }
  });

  it('une paroi cassable qui s\'allume se réchauffe : le corps et les fissures passent à plus de rouge et de lumière', () => {
    expect((SKIN.smashBodyLit >> 16) & 0xff).toBeGreaterThan((SKIN.smashBody >> 16) & 0xff);
    const light = (color: number): number => ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
    expect(light(SKIN.crackHot)).toBeGreaterThan(light(SKIN.crackDim));
  });
});

describe('la roue motorisée : rayons et chevrons de la jante', () => {
  const TAU = 2 * Math.PI;
  const NEAR = 0.01;

  /** L'angle d'un point dans le repère de l'écran, de -π à π. */
  const angleOf = (x: number, y: number): number => Math.atan2(y, x);
  /** L'écart signé de `to` à `from`, ramené entre -π et π. */
  const turnBetween = (from: number, to: number): number => {
    const d = (to - from) % TAU;
    return d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d;
  };

  it('a de quatre à six rayons, une jante de 0,9 m et tourne à 0,4 tour par seconde', () => {
    expect(WHEEL_SPOKES).toBeGreaterThanOrEqual(4);
    expect(WHEEL_SPOKES).toBeLessThanOrEqual(6);
    expect(WHEEL_RIM_RADIUS).toBeCloseTo(0.9, 9);
    expect(WHEEL_TURNS_PER_SECOND).toBeCloseTo(0.4, 9);
    // Un tour en 2,5 s : l'angle revient au même (à un tour près) puis a fait précisément un tour.
    for (const spin of [1, -1] as const) {
      expect(Math.abs(wheelAngle(2.5, spin) - wheelAngle(0, spin))).toBeCloseTo(TAU, 9);
    }
  });

  it('tourne dans le sens du moteur : +1 vers la gauche en haut (sens trigonométrique, vu de face), -1 l\'inverse', () => {
    expect(wheelDirection(1)).toBe(-1);
    expect(wheelDirection(-1)).toBe(1);
    // À l'écran (y vers le bas), tourner vers la gauche en haut, c'est un angle qui décroît.
    expect(wheelAngle(0.2, 1)).toBeLessThan(wheelAngle(0, 1));
    expect(wheelAngle(0.2, -1)).toBeGreaterThan(wheelAngle(0, -1));
    // Au premier instant, les deux sens sont dans la même position : seul le sens change.
    expect(wheelAngle(0, 1)).toBeCloseTo(0, 12);
    expect(wheelAngle(0, -1)).toBeCloseTo(0, 12);
  });

  it('un rayon se déplace comme le moteur pousse : le bout d\'un rayon va où va le personnage accroché au même endroit de la roue', () => {
    const rope = 3;
    for (const spin of [1, -1] as const) {
      for (const clock of [0, 0.37, 1.1]) {
        const before = wheelSpokes(clock, spin, 4, 20, WHEEL_SPOKES);
        const after = wheelSpokes(clock + 0.01, spin, 4, 20, WHEEL_SPOKES);
        before.forEach((spoke, k) => {
          // Le déplacement du bout du rayon, à l'écran (y vers le bas).
          const move = { x: after[k]!.x1 - spoke.x1, y: after[k]!.y1 - spoke.y1 };
          // Le personnage au même endroit : en repère du monde (y vers le haut), le point de l'écran (x, y) est en (x, -y).
          const norm = Math.hypot(spoke.x1, spoke.y1);
          const hero = { x: (spoke.x1 / norm) * rope, y: (-spoke.y1 / norm) * rope };
          const pushed = motorStep({ pos: hero, vel: { x: 0, y: 0 } }, { x: 0, y: 0 }, rope, { spin }, T);
          const push = { x: pushed.vel.x, y: -pushed.vel.y };
          expect(move.x * push.x + move.y * push.y, `spin ${spin}, horloge ${clock}, rayon ${k}`).toBeGreaterThan(0);
        });
      }
    }
  });

  it('a ses rayons également répartis, de `inner` à `outer`, et les fait avancer avec l\'horloge', () => {
    const spokes = wheelSpokes(0.6, 1, 6, 30, WHEEL_SPOKES);
    expect(spokes).toHaveLength(WHEEL_SPOKES);
    spokes.forEach((spoke, k) => {
      expect(Math.hypot(spoke.x0, spoke.y0)).toBeCloseTo(6, 9);
      expect(Math.hypot(spoke.x1, spoke.y1)).toBeCloseTo(30, 9);
      // Un rayon : son bout est dans le prolongement de son pied.
      expect(angleOf(spoke.x0, spoke.y0)).toBeCloseTo(angleOf(spoke.x1, spoke.y1), 9);
      const next = spokes[(k + 1) % WHEEL_SPOKES]!;
      // Le rayon suivant est un cinquième de tour plus loin, dans le sens de l'angle qui croît.
      expect(turnBetween(angleOf(spoke.x1, spoke.y1), angleOf(next.x1, next.y1))).toBeCloseTo(TAU / WHEEL_SPOKES, 9);
    });
    const first = wheelSpokes(0, 1, 6, 30);
    const later = wheelSpokes(1, 1, 6, 30);
    expect(turnBetween(angleOf(first[0]!.x1, first[0]!.y1), angleOf(later[0]!.x1, later[0]!.y1))).toBeCloseTo(-WHEEL_TURNS_PER_SECOND * TAU, 9);
  });

  it('est le même d\'un appel à l\'autre, et les deux sens sont le miroir l\'un de l\'autre', () => {
    expect(wheelSpokes(0.5, 1, 4, 20)).toEqual(wheelSpokes(0.5, 1, 4, 20));
    const left = wheelSpokes(0.5, 1, 4, 20);
    const right = wheelSpokes(0.5, -1, 4, 20);
    // Le rayon k de l'une est, au miroir (y changé de signe), le rayon -k de l'autre : mêmes rayons, tournés dans l'autre sens.
    left.forEach((spoke, k) => {
      const mirrored = right[(WHEEL_SPOKES - k) % WHEEL_SPOKES]!;
      expect(mirrored.x1).toBeCloseTo(spoke.x1, 9);
      expect(mirrored.y1).toBeCloseTo(-spoke.y1, 9);
    });
  });

  it('pose un chevron entre chaque paire de rayons, sur la jante, la pointe dans le sens du tour', () => {
    const rim = 28;
    const size = 5;
    for (const spin of [1, -1] as const) {
      for (const clock of [0, 0.8]) {
        const chevrons = wheelChevrons(clock, spin, rim, size, WHEEL_SPOKES);
        const spokes = wheelSpokes(clock, spin, 4, rim, WHEEL_SPOKES);
        expect(chevrons).toHaveLength(WHEEL_SPOKES);
        chevrons.forEach(([ax, ay, tx, ty, bx, by]) => {
          // Sur la jante : la pointe, à la taille du chevron près.
          expect(Math.abs(Math.hypot(tx, ty) - rim)).toBeLessThan(size * 0.2);
          // La pointe est en avant des bras, dans le sens où tourne la roue (l'angle croît pour +1 = -1 vers la gauche, voir `wheelDirection`).
          const arms = angleOf((ax + bx) / 2, (ay + by) / 2);
          expect(Math.sign(turnBetween(arms, angleOf(tx, ty))), `spin ${spin}`).toBe(wheelDirection(spin));
          // Entre deux rayons : à plus d'un chevron d'un pied de rayon.
          for (const spoke of spokes) expect(Math.hypot(tx - spoke.x1, ty - spoke.y1)).toBeGreaterThan(size);
        });
      }
    }
  });

  it('ne tremble pas près de zéro : la rotation est lisse, un pas de temps minuscule déplace à peine un rayon', () => {
    const a = wheelSpokes(3, 1, 4, 20)[0]!;
    const b = wheelSpokes(3 + NEAR / 1000, 1, 4, 20)[0]!;
    expect(Math.hypot(b.x1 - a.x1, b.y1 - a.y1)).toBeLessThan(0.001);
  });
});

describe('rotorWidths : la barre d\'un obstacle tournant, en pixels', () => {
  const EDGE = 2;

  it('a l\'épaisseur de la collision (0,4 m de monde) : le trait extérieur déborde d\'un demi-contour de chaque côté, le corps en retire autant', () => {
    for (const scale of [20, 32, 45]) {
      const { outer, body } = rotorWidths(scale, EDGE);
      expect(outer).toBeCloseTo(ROTOR_THICKNESS * scale + EDGE, 9);
      expect(body).toBeCloseTo(ROTOR_THICKNESS * scale - EDGE, 9);
      // L'anneau de contour que laisse le corps vaut le trait du contour.
      expect((outer - body) / 2).toBeCloseTo(EDGE, 9);
    }
  });

  it('se voit encore très dézoomée : au moins quatre pixels de barre, de quoi garder un contour', () => {
    const { outer, body } = rotorWidths(2, EDGE);
    expect(outer - EDGE).toBeGreaterThanOrEqual(4);
    expect(body).toBeGreaterThan(0);
    expect((outer - body) / 2).toBeCloseTo(EDGE, 9);
  });

  it('le disque du pivot est plus gros que la barre, à tout zoom', () => {
    for (const scale of [2, 10, 32, 60]) {
      const { outer, pivot } = rotorWidths(scale, EDGE);
      expect(pivot).toBeGreaterThan(outer / 2);
    }
    expect(ROTOR_PIVOT_RADIUS).toBeGreaterThan(ROTOR_THICKNESS / 2);
  });

  it('la masse de la barre est sombre, avec un soupçon du rouge-magenta du danger', () => {
    const red = (color: number): number => (color >> 16) & 0xff;
    expect(red(SKIN.rotorBody)).toBeGreaterThan(red(COLOR.obstacle));
    expect(red(SKIN.rotorBody)).toBeLessThan(red(COLOR.obstacleEdge));
  });
});

import { describe, expect, it } from 'vitest';
import {
  BAND_CHEVRON_SPACING,
  BAND_LINK,
  BAND_MIN_WIDTH,
  BAND_PAD_X,
  BAND_PAD_Y,
  CLOSER_BLINK_HZ,
  DOOR_BLINK_HZ,
  CRACK_SPACING,
  ELASTIC_GLOW_MAX,
  ELASTIC_GLOW_MIN,
  ELASTIC_WIDTH_MAX,
  ELASTIC_WIDTH_MIN,
  ELASTIC_WIGGLE_MAX,
  MAGNET_RINGS_PER_SECOND,
  MAGNET_RING_COUNT,
  RAIL_SEGMENTS,
  ROTOR_PIVOT_RADIUS,
  SKIN,
  SWITCH_WARNING_SECONDS,
  WHEEL_RIM_RADIUS,
  WHEEL_SPOKES,
  WHEEL_TURNS_PER_SECOND,
  accordionBands,
  arrowWings,
  bandChevronCount,
  closerLook,
  crackPattern,
  doorLook,
  elasticLook,
  lockLook,
  magnetPhase,
  magnetRing,
  railArc,
  rectEdgePoint,
  ringPhase,
  rotorWidths,
  springTeeth,
  stepWave,
  strandOffset,
  strandPhase,
  wheelAngle,
  wheelChevrons,
  wheelDirection,
  wheelSpokes,
} from '../src/render/skins';
import { COLOR } from '../src/render/style';
import { DOOR_OPEN_SECONDS, DOOR_PERIOD_SECONDS, DOOR_WARNING_SECONDS, doorGauge, doorState, switchGauge } from '../src/sim/cycles';
import { cablePosition } from '../src/sim/events';
import { RING_RADIUS } from '../src/sim/generator';
import { DEFAULT_RAIL, ELASTIC_MAX_STRETCH, RAIL_HALF_WIDTH, RAIL_RISE, SWITCH_HOLD_SECONDS, railPoint } from '../src/sim/holds';
import { ROTOR_THICKNESS, closerState } from '../src/sim/moving';
import { motorStep } from '../src/sim/physics';
import { RING_CENTRE_RATIO } from '../src/sim/rules';
import type { Anchor, Obstacle } from '../src/sim/state';
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

describe('les bandes de l\'accordéon : un panneau derrière les prises de chaque bande', () => {
  const PERIOD = 6;
  /** Une prise de bande : écartée au pas 0 (`from`, vers l'extérieur), elle va vers le milieu (`to`) jusqu'à mi-période, puis revient. */
  const slider = (id: number, band: -1 | 1, x: number, y: number, sway = 1.2): Anchor => ({
    id,
    pos: { x, y },
    kind: 'normal',
    broken: false,
    band,
    cable: { from: { x: x + band * sway, y }, to: { x: x - band * sway, y }, period: PERIOD },
  });
  /** L'accordéon du générateur : trois prises par bande en zigzag (rentrée, sortie, rentrée), la droite décalée d'un demi-pas. */
  const accordion = (): Anchor[] => [
    slider(1, -1, -2.2 - 0.4, 14.2),
    slider(2, 1, 2.2 - 0.4, 15.7),
    slider(3, -1, -2.2 + 0.4, 17.2),
    slider(4, 1, 2.2 + 0.4, 18.7),
    slider(5, -1, -2.2 - 0.4, 20.2),
    slider(6, 1, 2.2 - 0.4, 21.7),
  ];
  const quarter = Math.round((PERIOD / 4) / T.stepSeconds);

  it('une bande par côté : la gauche et la droite, chacune du bas de sa plus basse prise au haut de sa plus haute, plus la marge', () => {
    const bands = accordionBands(accordion(), 0, T);
    expect(bands.map((band) => band.side).sort()).toEqual([-1, 1]);
    const left = bands.find((band) => band.side === -1)!;
    const right = bands.find((band) => band.side === 1)!;
    expect(left.bottom).toBeCloseTo(14.2 - BAND_PAD_Y, 9);
    expect(left.top).toBeCloseTo(20.2 + BAND_PAD_Y, 9);
    expect(right.bottom).toBeCloseTo(15.7 - BAND_PAD_Y, 9);
    expect(right.top).toBeCloseTo(21.7 + BAND_PAD_Y, 9);
    // La bande de gauche est à gauche de celle de droite, et chaque panneau est centré sur le zigzag de ses prises.
    expect(left.right).toBeLessThan(right.left);
    expect((left.left + left.right) / 2).toBeCloseTo(-2.2, 9);
    expect((right.left + right.right) / 2).toBeCloseTo(2.2, 9);
  });

  it('le panneau couvre le zigzag de ses prises plus sa marge, et ne fait jamais moins de 1,2 m de large', () => {
    for (const band of accordionBands(accordion(), 0, T)) {
      expect(band.right - band.left).toBeGreaterThanOrEqual(BAND_MIN_WIDTH - 1e-9);
      expect(band.right - band.left).toBeCloseTo(0.8 + 2 * BAND_PAD_X, 9);
    }
    // Une bande en ligne droite garde la largeur minimale.
    const straight = accordionBands([slider(1, -1, -2, 10), slider(2, -1, -2, 13)], 0, T);
    expect(straight[0]!.right - straight[0]!.left).toBeCloseTo(BAND_MIN_WIDTH, 9);
  });

  it('le panneau suit les prises : il glisse avec elles d\'un pas à l\'autre (rien n\'est figé dans le temps)', () => {
    const at = (step: number): number => {
      const moved = accordion().map((anchor) => ({ ...anchor, pos: cablePosition(anchor, step, T) }));
      const left = accordionBands(moved, step, T).find((band) => band.side === -1)!;
      return (left.left + left.right) / 2;
    };
    // De l'écartement (pas 0) au resserrement (mi-période) : la bande de gauche va vers la droite, de deux fois l'amplitude.
    expect(at(Math.round((PERIOD / 2) / T.stepSeconds)) - at(0)).toBeCloseTo(2.4, 6);
  });

  it('le sens de la bande : au début de la période, elle se resserre (gauche vers la droite, droite vers la gauche) ; à mi-période, elle s\'écarte', () => {
    const closing = accordionBands(accordion(), quarter, T);
    expect(closing.find((band) => band.side === -1)!.heading).toBe(1);
    expect(closing.find((band) => band.side === 1)!.heading).toBe(-1);
    const opening = accordionBands(accordion(), 3 * quarter, T);
    expect(opening.find((band) => band.side === -1)!.heading).toBe(-1);
    expect(opening.find((band) => band.side === 1)!.heading).toBe(1);
  });

  it('une prise qui ne glisse pas dit « 0 » : pas de sens à montrer', () => {
    const still: Anchor = { id: 1, pos: { x: -2, y: 10 }, kind: 'normal', broken: false, band: -1 };
    expect(accordionBands([still], quarter, T)[0]!.heading).toBe(0);
  });

  it('deux prises du même côté à moins de BAND_LINK mètres sont de la même bande, au-delà de deux bandes ; les deux côtés ne se mêlent jamais', () => {
    expect(accordionBands([slider(1, -1, -2, 10), slider(2, -1, -2, 10 + BAND_LINK - 0.1)], 0, T)).toHaveLength(1);
    expect(accordionBands([slider(1, -1, -2, 10), slider(2, -1, -2, 10 + BAND_LINK + 0.1)], 0, T)).toHaveLength(2);
    expect(accordionBands([slider(1, -1, -2, 10), slider(2, 1, 2, 10)], 0, T)).toHaveLength(2);
    // Une chaîne de prises à moins de BAND_LINK l'une de l'autre est une seule bande, même plus longue.
    expect(accordionBands([slider(1, 1, 2, 10), slider(2, 1, 2, 15), slider(3, 1, 2, 20), slider(4, 1, 2, 25)], 0, T)).toHaveLength(1);
  });

  it('ni les prises cassées ni les autres prises (sans bande, même sur câble) ne font de panneau', () => {
    const plain: Anchor = { id: 7, pos: { x: 0, y: 12 }, kind: 'normal', broken: false };
    const cable: Anchor = { id: 8, pos: { x: 0, y: 13 }, kind: 'normal', broken: false, cable: { from: { x: -1, y: 13 }, to: { x: 1, y: 13 }, period: 3 } };
    expect(accordionBands([plain, cable], 0, T)).toEqual([]);
    expect(accordionBands([{ ...slider(1, -1, -2, 10), broken: true }], 0, T)).toEqual([]);
    expect(accordionBands([], 0, T)).toEqual([]);
  });

  it('les chevrons : un tous les 0,9 m environ, un au moins', () => {
    const [band] = accordionBands([slider(1, -1, -2, 10), slider(2, -1, -2, 13), slider(3, -1, -2, 16)], 0, T);
    expect(bandChevronCount(band!)).toBe(Math.round((6 + 2 * BAND_PAD_Y) / BAND_CHEVRON_SPACING));
    const [tiny] = accordionBands([slider(1, 1, 2, 10)], 0, T);
    expect(bandChevronCount(tiny!)).toBe(1);
  });
});

describe('l\'aimant : les anneaux de son champ', () => {
  it('au repos, des anneaux fixes également répartis entre le noyau et le bord, tous visibles, sans jamais toucher ni l\'un ni l\'autre', () => {
    const rings = Array.from({ length: MAGNET_RING_COUNT }, (_, k) => magnetRing(k, MAGNET_RING_COUNT, 0, false));
    for (const ring of rings) {
      expect(ring.ratio).toBeGreaterThan(0);
      expect(ring.ratio).toBeLessThan(1);
      expect(ring.alpha).toBe(1);
    }
    const gaps = rings.map((ring, k) => ring.ratio - (rings[k - 1]?.ratio ?? 0));
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 9);
    // La phase n'y change rien : au repos, rien ne bouge.
    expect(magnetRing(1, MAGNET_RING_COUNT, 0.7, false)).toEqual(magnetRing(1, MAGNET_RING_COUNT, 0, false));
  });

  it('tenu, les anneaux convergent vers le noyau : leur rayon décroît quand la phase avance, et ils naissent et s\'éteignent invisibles', () => {
    for (let k = 0; k < MAGNET_RING_COUNT; k += 1) {
      let previous = Infinity;
      for (let phase = 0; phase < 1; phase += 0.05) {
        const ring = magnetRing(k, MAGNET_RING_COUNT, phase, true);
        expect(ring.ratio).toBeLessThan(previous);
        expect(ring.ratio).toBeGreaterThan(0);
        expect(ring.ratio).toBeLessThanOrEqual(1);
        expect(ring.alpha).toBeGreaterThanOrEqual(0);
        expect(ring.alpha).toBeLessThanOrEqual(1);
        previous = ring.ratio;
      }
    }
    // Au bord (rayon 1) l'anneau n'est pas là ; au noyau non plus : il passe de l'un à l'autre en s'éclairant à mi-chemin.
    expect(magnetRing(0, MAGNET_RING_COUNT, 0, true)).toEqual({ ratio: 1, alpha: 0 });
    const last = magnetRing(MAGNET_RING_COUNT - 1, MAGNET_RING_COUNT, 0.999999, true);
    expect(last.ratio).toBeCloseTo(0, 5);
    expect(last.alpha).toBeCloseTo(0, 5);
    expect(magnetRing(1, MAGNET_RING_COUNT, 0.5, true).alpha).toBeGreaterThan(0.9);
  });

  it('la phase revient à 0 à chaque période de l\'horloge des effets, sans jamais atteindre 1', () => {
    const period = 1 / MAGNET_RINGS_PER_SECOND;
    expect(magnetPhase(0)).toBe(0);
    expect(magnetPhase(period / 2)).toBeCloseTo(0.5, 9);
    expect(magnetPhase(3 * period)).toBeCloseTo(0, 9);
    for (let clock = 0; clock < 10; clock += 0.0731) {
      expect(magnetPhase(clock)).toBeGreaterThanOrEqual(0);
      expect(magnetPhase(clock)).toBeLessThan(1);
    }
  });
});

describe('lockLook : ce que le rendu dessine du verrou d\'une prise interrupteur', () => {
  const LOCK_ID = 5;
  const LEVER_ID = 3;
  const OPEN_STEPS = Math.round(SWITCH_HOLD_SECONDS * SECOND);
  /** Un verrou ouvert jusqu'au pas `until` (ou jamais ouvert), et la prise tenue ou non. */
  const lock = (openUntilStep?: number): Pick<Obstacle, 'id' | 'switchedBy' | 'openUntilStep'> => ({ id: LOCK_ID, switchedBy: LEVER_ID, ...(openUntilStep === undefined ? {} : { openUntilStep }) });
  const at = (step: number, holding: boolean, inside: number[] = []) => ({ step, doorsInside: inside, rope: holding ? { anchorId: LEVER_ID, length: 3 } : null });

  it('fermé tant que la prise n\'a pas été tenue : masse pleine, jauge vide ; fermé de nouveau une fois le délai écoulé', () => {
    expect(lockLook(lock(), at(10, false), T)).toEqual({ phase: 'fermee', gauge: 0, beat: 1, held: false });
    expect(lockLook(lock(100), at(100, false), T).phase).toBe('fermee');
    expect(lockLook(lock(100), at(500, false), T).phase).toBe('fermee');
  });

  it('tenu, il est franchement ouvert : jauge à 0, rien ne s\'écoule, et il est dit tenu', () => {
    const look = lockLook(lock(50 + OPEN_STEPS), at(50, true), T);
    expect(look).toEqual({ phase: 'ouverte', gauge: 0, beat: 1, held: true });
  });

  it('après le lâcher, la jauge se remplit de 0 à 1 comme `switchGauge`, il avertit pendant la dernière seconde, puis se ferme', () => {
    const release = 1000;
    const until = release + OPEN_STEPS;
    let warned = 0;
    let previous = -1;
    for (let step = release; step < until; step += 1) {
      const look = lockLook(lock(until), at(step, false), T);
      expect(look.held).toBe(false);
      expect(look.gauge).toBe(switchGauge({ openUntilStep: until }, step, T, SWITCH_HOLD_SECONDS));
      expect(look.gauge).toBeGreaterThanOrEqual(previous);
      previous = look.gauge;
      expect(look.phase).toBe(step >= until - Math.round(SWITCH_WARNING_SECONDS * SECOND) ? 'avertit' : 'ouverte');
      if (look.phase === 'avertit') warned += 1;
    }
    expect(warned).toBe(Math.round(SWITCH_WARNING_SECONDS * SECOND));
    expect(lockLook(lock(until), at(until, false), T).phase).toBe('fermee');
  });

  it('l\'avertissement clignote entre 0 et 1, et vraiment ; ailleurs le contour est franc', () => {
    const until = 600;
    const beats = Array.from({ length: Math.round(SWITCH_WARNING_SECONDS * SECOND) }, (_, k) => lockLook(lock(until), at(until - 1 - k, false), T).beat);
    expect(Math.min(...beats)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...beats)).toBeLessThanOrEqual(1);
    expect(Math.max(...beats) - Math.min(...beats)).toBeGreaterThan(0.5);
    expect(lockLook(lock(until), at(until - 2 * SECOND, false), T).beat).toBe(1);
  });

  it('refermé sur le personnage qu\'il a surpris dedans, il le laisse passer ; ouvert, rien ne change qu\'il y soit ou non', () => {
    expect(lockLook(lock(100), at(200, false, [LOCK_ID]), T).phase).toBe('passage');
    expect(lockLook(lock(100), at(200, false, [LOCK_ID + 1]), T).phase).toBe('fermee');
    expect(lockLook(lock(200 + OPEN_STEPS), at(200, false, [LOCK_ID]), T).phase).toBe('ouverte');
  });
});

describe('rectEdgePoint : où le lien d\'un interrupteur touche son verrou', () => {
  it('sort du rectangle par le côté que le segment rencontre, sur le segment', () => {
    // Un verrou large et bas, centré en (0, 0) : vu de loin à droite, il est touché par son côté droit ; vu de loin en haut, par son côté haut.
    expect(rectEdgePoint(0, 0, 2, 0.5, 10, 0)).toEqual({ x: 2, y: 0 });
    expect(rectEdgePoint(0, 0, 2, 0.5, 0, -10)).toEqual({ x: 0, y: -0.5 });
    const oblique = rectEdgePoint(0, 0, 2, 0.5, 4, 4);
    expect(oblique.x).toBeCloseTo(0.5, 9);
    expect(oblique.y).toBeCloseTo(0.5, 9);
  });

  it('une cible dans le rectangle, ou au centre, reste elle-même', () => {
    expect(rectEdgePoint(1, 1, 2, 2, 1.5, 1.2)).toEqual({ x: 1.5, y: 1.2 });
    expect(rectEdgePoint(1, 1, 2, 2, 1, 1)).toEqual({ x: 1, y: 1 });
  });
});

describe('railArc : l\'arc du rail', () => {
  it('suit la simulation : les positions de `railPoint`, de bout en bout, relatives à la prise', () => {
    const arc = railArc(DEFAULT_RAIL);
    expect(arc).toHaveLength(2 * (RAIL_SEGMENTS + 1));
    for (let i = 0; i <= RAIL_SEGMENTS; i += 1) {
      const point = railPoint({ x: 0, y: 0 }, DEFAULT_RAIL, i / RAIL_SEGMENTS);
      expect(arc[2 * i]).toBeCloseTo(point.x, 12);
      expect(arc[2 * i + 1]).toBeCloseTo(point.y, 12);
    }
    // Les bouts sont à la hauteur de la prise, de part et d\'autre ; le sommet est la flèche de l\'arc, au milieu.
    expect(arc[0]).toBeCloseTo(-RAIL_HALF_WIDTH, 12);
    expect(arc[1]).toBeCloseTo(0, 12);
    expect(arc[2 * RAIL_SEGMENTS]).toBeCloseTo(RAIL_HALF_WIDTH, 12);
    expect(arc[2 * RAIL_SEGMENTS + 1]).toBeCloseTo(0, 12);
    expect(arc[RAIL_SEGMENTS]).toBeCloseTo(0, 12);
    expect(arc[RAIL_SEGMENTS + 1]).toBeCloseTo(RAIL_RISE, 12);
  });

  it('une quinzaine de positions, calculées une fois par rail : le même tableau à chaque appel', () => {
    expect(RAIL_SEGMENTS + 1).toBeGreaterThanOrEqual(15);
    expect(railArc(DEFAULT_RAIL)).toBe(railArc(DEFAULT_RAIL));
    // Un autre rail a son propre arc.
    const wide = { halfWidth: 2, rise: 1 };
    expect(railArc(wide)).not.toBe(railArc(DEFAULT_RAIL));
    expect(railArc(wide)[2 * RAIL_SEGMENTS]).toBeCloseTo(2, 12);
  });
});

describe('arrowWings : la pointe d\'une flèche', () => {
  it('deux ailes en arrière de la pointe, de part et d\'autre de la direction, de même longueur', () => {
    const [ax, ay, bx, by] = arrowWings(0, -1, 10);
    // Une flèche qui monte (y vers le bas à l\'écran) : ses ailes sont plus bas que la pointe, et symétriques.
    expect(ay).toBeGreaterThan(0);
    expect(by).toBeGreaterThan(0);
    expect(ax).toBeCloseTo(-bx, 9);
    expect(ay).toBeCloseTo(by, 9);
    expect(Math.hypot(ax, ay)).toBeCloseTo(Math.hypot(bx, by), 9);
  });

  it('ne dépend que de la direction, pas de la longueur du vecteur, et se tourne avec elle', () => {
    expect(arrowWings(0, -5, 10)).toEqual(arrowWings(0, -1, 10));
    const [ax, ay] = arrowWings(1, 0, 10);
    const [rx, ry] = arrowWings(0, 1, 10);
    // Tournée d\'un quart de tour, l\'aile garde sa longueur.
    expect(Math.hypot(ax, ay)).toBeCloseTo(Math.hypot(rx, ry), 9);
    expect(arrowWings(0, 0, 10)).toEqual([0, 0, 0, 0]);
  });
});

describe('elasticLook : ce que le rendu dessine du lien élastique tenu', () => {
  const SCALE = 39;

  it('tendu à peine, un trait fin, vert tendre ; à l\'étirement maximal, le plus épais et le plus lumineux, blanc', () => {
    const taut = elasticLook(0, 0, SCALE);
    const full = elasticLook(ELASTIC_MAX_STRETCH, 0, SCALE);
    expect(taut).toMatchObject({ ratio: 0, width: ELASTIC_WIDTH_MIN, color: COLOR.elastic, wiggle: 0 });
    expect(taut.glow).toBeCloseTo(ELASTIC_GLOW_MIN, 9);
    expect(full).toMatchObject({ ratio: 1, width: ELASTIC_WIDTH_MAX, color: COLOR.white, wiggle: 0 });
    expect(full.glow).toBeCloseTo(ELASTIC_GLOW_MAX, 9);
    // Au-delà de la butée (le rendu ne le voit jamais), rien de plus.
    expect(elasticLook(5 * ELASTIC_MAX_STRETCH, 0, SCALE)).toEqual(full);
  });

  it('l\'épaisseur, la lumière et la clarté croissent avec l\'étirement, sans jamais décroître', () => {
    let previous = elasticLook(0, 0, SCALE);
    const brightness = (color: number): number => ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
    for (let stretch = 0.1; stretch <= ELASTIC_MAX_STRETCH + 1e-9; stretch += 0.1) {
      const look = elasticLook(stretch, 0, SCALE);
      expect(look.width).toBeGreaterThan(previous.width);
      expect(look.glow).toBeGreaterThan(previous.glow);
      expect(brightness(look.color)).toBeGreaterThanOrEqual(brightness(previous.color));
      previous = look;
    }
  });

  it('mou, un trait fin qui ondule d\'autant plus qu\'il pend, jusqu\'à un plafond ; tendu, il ne bouge plus', () => {
    const slack = (meters: number) => elasticLook(0, meters, SCALE);
    expect(slack(0.1).width).toBe(ELASTIC_WIDTH_MIN);
    expect(slack(0.1).wiggle).toBeGreaterThan(0);
    expect(slack(0.2).wiggle).toBeGreaterThan(slack(0.1).wiggle);
    expect(slack(0.2).wiggle).toBeLessThan(ELASTIC_WIGGLE_MAX);
    expect(slack(100).wiggle).toBe(ELASTIC_WIGGLE_MAX);
    expect(elasticLook(1, 0, SCALE).wiggle).toBe(0);
  });

  it('l\'ondulation est nulle aux deux bouts du lien, bornée par son amplitude, et avance avec le pas de simulation', () => {
    for (const phase of [0, 1, 2.5]) {
      expect(strandOffset(0, 8, phase)).toBeCloseTo(0, 9);
      expect(strandOffset(1, 8, phase)).toBeCloseTo(0, 9);
      for (let u = 0; u <= 1; u += 0.05) expect(Math.abs(strandOffset(u, 8, phase))).toBeLessThanOrEqual(8 + 1e-9);
    }
    expect(strandOffset(0.3, 8, 0)).not.toBeCloseTo(strandOffset(0.3, 8, 1), 3);
    expect(strandPhase(0, T.stepSeconds)).toBe(0);
    expect(strandPhase(2 * SECOND, T.stepSeconds)).toBeGreaterThan(strandPhase(SECOND, T.stepSeconds));
    expect(strandOffset(0.4, 0, 1.7)).toBe(0);
  });
});

describe('closerLook : ce que le rendu dessine d\'un panneau de passage qui se referme', () => {
  const CLOSE = 8;
  const SHUT = 4;
  const panel = (triggeredStep?: number): Obstacle => ({
    id: 3,
    x0: -7.2,
    y0: 19.1,
    x1: -3.6,
    y1: 19.5,
    closer: { triggerY: 10.1, travel: 3.6, side: 1, closeSeconds: CLOSE, shutSeconds: SHUT },
    ...(triggeredStep === undefined ? {} : { triggeredStep }),
  });
  const after = (seconds: number): number => 500 + Math.round(seconds * SECOND);

  it('armé tant qu\'il n\'est pas déclenché : discret, jauge vide, liseré franc', () => {
    expect(closerLook(panel(), 0, T)).toEqual({ phase: 'arme', gauge: 0, beat: 1 });
    expect(closerLook(panel(), 100_000, T).phase).toBe('arme');
  });

  it('suit la séquence de la simulation, sans en inventer une autre : se ferme, fermé, rouvre', () => {
    const box = panel(500);
    for (let step = 500; step < after(2 * CLOSE + SHUT) + 5; step += 7) expect(closerLook(box, step, T).phase).toBe(closerState(box, step, T));
    expect(closerLook(box, after(1), T).phase).toBe('se ferme');
    expect(closerLook(box, after(CLOSE + 1), T).phase).toBe('ferme');
    expect(closerLook(box, after(CLOSE + SHUT + 1), T).phase).toBe('rouvre');
    // La simulation réarme le panneau en retirant son pas de déclenchement : il redevient discret.
    expect(closerLook(panel(), after(2 * CLOSE + SHUT + 1), T).phase).toBe('arme');
  });

  it('la jauge se remplit pendant la fermeture, reste pleine fermé, se vide en rouvrant', () => {
    const box = panel(500);
    expect(closerLook(box, after(0), T).gauge).toBeCloseTo(0, 9);
    expect(closerLook(box, after(CLOSE / 2), T).gauge).toBeCloseTo(0.5, 2);
    expect(closerLook(box, after(CLOSE - 0.01), T).gauge).toBeGreaterThan(0.99);
    expect(closerLook(box, after(CLOSE + SHUT / 2), T).gauge).toBe(1);
    expect(closerLook(box, after(CLOSE + SHUT + CLOSE / 2), T).gauge).toBeCloseTo(0.5, 2);
    expect(closerLook(box, after(CLOSE + SHUT + CLOSE - 0.01), T).gauge).toBeLessThan(0.01);
    let previous = -1;
    for (let step = after(0); step < after(CLOSE); step += 5) {
      const { gauge } = closerLook(box, step, T);
      expect(gauge).toBeGreaterThanOrEqual(previous);
      previous = gauge;
    }
  });

  it('le liseré ne clignote que pendant la fermeture, entre 0 et 1 et vraiment ; franc ailleurs', () => {
    const box = panel(500);
    const beats = Array.from({ length: SECOND }, (_, k) => closerLook(box, after(1) + k, T).beat);
    expect(Math.min(...beats)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...beats)).toBeLessThanOrEqual(1);
    expect(Math.max(...beats) - Math.min(...beats)).toBeGreaterThan(0.5);
    expect(CLOSER_BLINK_HZ).toBeGreaterThan(1);
    expect(closerLook(box, after(CLOSE + 1), T).beat).toBe(1);
    expect(closerLook(box, after(CLOSE + SHUT + 1), T).beat).toBe(1);
    expect(closerLook(panel(), 12, T).beat).toBe(1);
  });
});

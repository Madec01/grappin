import { describe, expect, it } from 'vitest';
import { DOOR_BLINK_HZ, CRACK_SPACING, SKIN, crackPattern, doorLook, ringPhase, springTeeth, stepWave } from '../src/render/skins';
import { DOOR_OPEN_SECONDS, DOOR_PERIOD_SECONDS, DOOR_WARNING_SECONDS, doorGauge, doorState } from '../src/sim/cycles';
import { RING_RADIUS } from '../src/sim/generator';
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
    for (const [name, color] of Object.entries({ bounceBody: SKIN.bounceBody, smashBody: SKIN.smashBody, smashBodyLit: SKIN.smashBodyLit, doorBody: SKIN.doorBody })) {
      for (const channel of [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]) expect(channel, name).toBeLessThan(0x70);
    }
  });

  it('une paroi cassable qui s\'allume se réchauffe : le corps et les fissures passent à plus de rouge et de lumière', () => {
    expect((SKIN.smashBodyLit >> 16) & 0xff).toBeGreaterThan((SKIN.smashBody >> 16) & 0xff);
    const light = (color: number): number => ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
    expect(light(SKIN.crackHot)).toBeGreaterThan(light(SKIN.crackDim));
  });
});

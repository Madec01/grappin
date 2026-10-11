import { describe, expect, it } from 'vitest';
import { LEARNING_FOG_FACTOR, LEARNING_SHADOW_SECONDS, isLearning, learningTuning } from '../src/meta/learning';
import { createProfile } from '../src/meta/profile';
import { DEFAULT_TUNING as T, withTuning } from '../src/sim/tuning';

describe("l'apprentissage par l'action", () => {
  it('un profil neuf apprend ; dès 30 m atteints une fois, plus', () => {
    expect(isLearning(createProfile())).toBe(true);
    expect(isLearning({ ...createProfile(), bestHeight: 29.9 })).toBe(true);
    expect(isLearning({ ...createProfile(), bestHeight: 30 })).toBe(false);
  });

  it('pour qui apprend, la brume est plus lente et l\'ombre prédictive porte plus loin ; sinon les réglages sont rendus tels quels', () => {
    const soft = learningTuning(T, createProfile());
    expect(soft.fogBaseSpeed).toBeCloseTo(T.fogBaseSpeed * LEARNING_FOG_FACTOR, 9);
    expect(soft.fogSpeedGain).toBeCloseTo(T.fogSpeedGain * LEARNING_FOG_FACTOR, 9);
    expect(soft.shadowSeconds).toBe(LEARNING_SHADOW_SECONDS);
    expect(soft.gravity).toBe(T.gravity);
    const done = { ...createProfile(), bestHeight: 40 };
    expect(learningTuning(T, done)).toBe(T);
    // Une ombre déjà longue (mode facile) n'est pas raccourcie.
    const easy = withTuning(T, { shadowSeconds: 0.9 });
    expect(learningTuning(easy, createProfile()).shadowSeconds).toBe(0.9);
  });
});

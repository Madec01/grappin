import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';
import { DEFAULT_TUNING } from '../src/sim/tuning';

const R = DEFAULT_TUNING.heroRadius;
const REST = { x: 0, y: 0 };

/** Laisse la caméra converger : cinq secondes de temps réel à 60 images par seconde. */
function settle(camera: Camera, pos: { x: number; y: number }, vel: { x: number; y: number }): void {
  for (let i = 0; i < 300; i += 1) camera.update(1 / 60, pos, vel);
}

describe('caméra', () => {
  it('fait tenir 10 mètres dans la largeur, avec Y du monde vers le haut et Y de l\'écran vers le bas', () => {
    const camera = new Camera(R, 390, 844);
    camera.snap({ x: 0, y: 10 }, REST);
    const left = camera.worldToScreen({ x: -5, y: 10 });
    const right = camera.worldToScreen({ x: 5, y: 10 });
    expect(right.x - left.x).toBeCloseTo(390, 6);
    const lower = camera.worldToScreen({ x: 0, y: 10 });
    const higher = camera.worldToScreen({ x: 0, y: 11 });
    expect(lower.y - higher.y).toBeCloseTo(39, 6);
    expect(camera.worldYAt(lower.y)).toBeCloseTo(10, 6);
  });

  it('au repos : zoom 1, avance de 2,5 m, personnage sous le milieu de l\'écran', () => {
    const camera = new Camera(R, 390, 844);
    camera.snap({ x: 0, y: 0 }, REST);
    expect(camera.zoom).toBe(1);
    expect(camera.centerY).toBeCloseTo(2.5, 6);
    expect(camera.worldToScreen({ x: 0, y: 0 }).y).toBeCloseTo(422 + 2.5 * 39, 6);
  });

  it('dézoome en douceur vers 0,6 à grande vitesse, puis remonte à l\'arrêt', () => {
    const camera = new Camera(R, 390, 844);
    camera.snap(REST, REST);
    camera.update(1 / 60, REST, { x: 20, y: 0 });
    expect(camera.zoom).toBeLessThan(1);
    expect(camera.zoom).toBeGreaterThan(0.95);
    settle(camera, REST, { x: 20, y: 0 });
    expect(camera.zoom).toBeCloseTo(0.6, 3);
    settle(camera, REST, REST);
    expect(camera.zoom).toBeCloseTo(1, 3);
  });

  it('suit la formule 1 / (1 + vitesse / 18) quand elle reste dans les bornes', () => {
    const camera = new Camera(R, 390, 844);
    camera.snap(REST, { x: 6, y: 0 });
    expect(camera.zoom).toBeCloseTo(1 / (1 + 6 / 18), 6);
  });

  it('ne laisse jamais le personnage sous 14 px de diamètre', () => {
    for (const width of [320, 390, 768, 1280]) {
      for (const speed of [0, 10, 24, 60]) {
        const camera = new Camera(R, width, 844);
        settle(camera, REST, { x: speed, y: 0 });
        expect(2 * R * camera.scale).toBeGreaterThanOrEqual(14 - 1e-9);
      }
    }
  });

  it('règle l\'avance sur la vitesse verticale, bornée entre 1 et 5 m', () => {
    const lead = (vy: number): number => {
      const camera = new Camera(R, 390, 844);
      settle(camera, REST, { x: 0, y: vy });
      return camera.centerY;
    };
    expect(lead(0)).toBeCloseTo(2.5, 3);
    expect(lead(20)).toBeCloseTo(2.5 + 0.08 * 20, 3);
    expect(lead(-30)).toBeCloseTo(1, 3);
    expect(lead(100)).toBeCloseTo(5, 3);
  });

  it('garde le personnage entre 45 % et 70 % de la hauteur, sur téléphone comme sur écran large', () => {
    for (const [width, height] of [
      [390, 844],
      [1920, 1080],
      [600, 1200],
    ] as const) {
      const camera = new Camera(R, width, height);
      camera.snap(REST, REST);
      // Montée à pleine vitesse pendant deux secondes, puis chute : la caméra traîne, la bande la rattrape.
      for (let i = 0; i < 240; i += 1) {
        const rising = i < 120;
        const hero = { x: 0, y: rising ? (i * 24) / 60 : (240 - i) * 0.4 };
        camera.update(1 / 60, hero, { x: 0, y: rising ? 24 : -24 });
        const fraction = camera.worldToScreen(hero).y / height;
        expect(fraction).toBeGreaterThanOrEqual(0.45 - 1e-9);
        expect(fraction).toBeLessThanOrEqual(0.7 + 1e-9);
      }
    }
  });

  it('reste centrée sur x = 0 et ne suit le personnage que près du bord de l\'écran', () => {
    const camera = new Camera(R, 390, 844);
    settle(camera, { x: 4, y: 0 }, REST);
    expect(camera.centerX).toBeCloseTo(0, 6);
    settle(camera, { x: 6, y: 0 }, REST);
    expect(camera.centerX).toBeCloseTo(2, 6);
    expect(camera.worldToScreen({ x: 6, y: 0 }).x).toBeLessThan(390);
    settle(camera, { x: 0, y: 0 }, REST);
    expect(camera.centerX).toBeCloseTo(0, 3);
  });

  it('suit une nouvelle taille d\'écran', () => {
    const camera = new Camera(R, 390, 844);
    camera.snap(REST, REST);
    camera.resize(780, 1688);
    expect(camera.scale).toBeCloseTo(78, 6);
  });
});

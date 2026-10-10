import { describe, expect, it } from 'vitest';
import { Camera, worldAngle } from '../src/render/camera';
import { STILL, turnedGravity, type Environment } from '../src/sim/environment';
import { DEFAULT_TUNING } from '../src/sim/tuning';

const R = DEFAULT_TUNING.heroRadius;
const REST = { x: 0, y: 0 };
/** Gravité à mi-bascule, bascule à fond vers la droite ou vers la gauche. */
const MID: Environment = { gravityDir: turnedGravity(1, 0.5), wind: STILL.wind };
const RIGHT: Environment = { gravityDir: turnedGravity(1, 1), wind: STILL.wind };
const LEFT: Environment = { gravityDir: turnedGravity(-1, 1), wind: STILL.wind };

/** Laisse la caméra converger : cinq secondes de temps réel à 60 images par seconde. */
function settle(camera: Camera, pos: { x: number; y: number }, vel: { x: number; y: number }, env: Environment = STILL): void {
  for (let i = 0; i < 300; i += 1) camera.update(1 / 60, pos, vel, env);
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

describe('bascule : le monde tourne pour garder la gravité vers le bas de l\'écran', () => {
  it('l\'angle est nul gravité vers le bas, et d\'un quart de tour quand elle tire de côté', () => {
    expect(worldAngle({ x: 0, y: -1 })).toBe(0);
    expect(worldAngle({ x: 1, y: 0 })).toBeCloseTo(Math.PI / 2, 12);
    expect(worldAngle({ x: -1, y: 0 })).toBeCloseTo(-Math.PI / 2, 12);
    expect(worldAngle(MID.gravityDir)).toBeCloseTo(Math.PI / 4, 12);
  });

  it('la caméra prend l\'angle de la gravité du moment, d\'un coup, et revient à zéro', () => {
    const camera = new Camera(R, 390, 844);
    camera.snap(REST, REST);
    expect(camera.angle).toBe(0);
    camera.update(1 / 60, REST, REST, MID);
    expect(camera.angle).toBeCloseTo(Math.PI / 4, 12);
    camera.update(1 / 60, REST, REST, LEFT);
    expect(camera.angle).toBeCloseTo(-Math.PI / 2, 12);
    camera.update(1 / 60, REST, REST);
    expect(camera.angle).toBe(0);
  });

  it('un monde tourné remet bien la gravité vers le bas de l\'écran, et la progression sur le côté', () => {
    for (const [env, side] of [[RIGHT, 1], [LEFT, -1]] as const) {
      const camera = new Camera(R, 390, 844);
      camera.snap(REST, REST, env);
      const hero = camera.worldToDisplay(REST);
      // Un mètre dans le sens de la gravité s'affiche pile sous le personnage.
      const below = camera.worldToDisplay({ x: env.gravityDir.x, y: env.gravityDir.y });
      expect(below.x).toBeCloseTo(hero.x, 6);
      expect(below.y - hero.y).toBeCloseTo(camera.scale, 6);
      // Un mètre vers le haut du monde, la progression, part de côté : à droite pour une gravité à droite, à gauche sinon.
      const ahead = camera.worldToDisplay({ x: 0, y: 1 });
      expect(ahead.y).toBeCloseTo(hero.y, 6);
      expect(Math.sign(ahead.x - hero.x)).toBe(side);
    }
  });

  it('sans bascule, l\'affichage est la position de worldToScreen', () => {
    const camera = new Camera(R, 390, 844);
    camera.snap({ x: 1, y: 7 }, REST);
    expect(camera.worldToDisplay({ x: 2, y: 9 })).toEqual(camera.worldToScreen({ x: 2, y: 9 }));
  });

  it('le centre de l\'écran reste fixe sous la rotation', () => {
    const camera = new Camera(R, 390, 844);
    camera.snap(REST, REST, MID);
    const center = camera.worldToDisplay({ x: camera.centerX, y: camera.centerY });
    expect(center.x).toBeCloseTo(195, 9);
    expect(center.y).toBeCloseTo(422, 9);
  });

  it('dézoome vers 0,7 pendant que la gravité est tournée, au repos comme à pleine vitesse, puis remonte', () => {
    const camera = new Camera(R, 390, 844);
    settle(camera, REST, REST, RIGHT);
    expect(camera.zoom).toBeCloseTo(0.7, 3);
    // Le zoom de vitesse reste le maître quand il dézoome davantage.
    settle(camera, REST, { x: 20, y: 0 }, RIGHT);
    expect(camera.zoom).toBeCloseTo(0.6, 3);
    // À mi-bascule la gravité est déjà tournée.
    const half = new Camera(R, 390, 844);
    settle(half, REST, REST, MID);
    expect(half.zoom).toBeCloseTo(0.7, 3);
    settle(camera, REST, REST);
    expect(camera.zoom).toBeCloseTo(1, 3);
  });

  it('lisse le zoom de bascule comme le reste : pas de saut à la première image', () => {
    const camera = new Camera(R, 390, 844);
    camera.snap(REST, REST);
    camera.update(1 / 60, REST, REST, RIGHT);
    expect(camera.zoom).toBeLessThan(1);
    expect(camera.zoom).toBeGreaterThan(0.95);
  });

  it('un écran étroit, qui ne peut pas descendre à 0,7 sans rendre le personnage trop petit, garde son zoom minimal', () => {
    const camera = new Camera(R, 260, 600);
    expect(camera.minZoom).toBeGreaterThan(0.7);
    settle(camera, REST, REST, RIGHT);
    expect(camera.zoom).toBeCloseTo(camera.minZoom, 9);
    expect(2 * R * camera.scale).toBeGreaterThanOrEqual(14 - 1e-9);
  });

  it('le rectangle à remplir couvre l\'écran entier, quel que soit l\'angle, et se confond avec lui sans bascule', () => {
    const upright = new Camera(R, 390, 844);
    upright.snap(REST, REST);
    expect(upright.viewBounds()).toEqual({ left: 0, right: 390, top: 0, bottom: 844 });

    for (const gravityDir of [turnedGravity(1, 0.2), turnedGravity(1, 0.5), turnedGravity(-1, 0.7), turnedGravity(1, 1), turnedGravity(-1, 1)]) {
      const camera = new Camera(R, 390, 844);
      camera.snap(REST, REST, { gravityDir, wind: STILL.wind });
      const bounds = camera.viewBounds();
      // Chaque coin de l'écran, ramené dans le repère du monde tourné, tombe dans le rectangle.
      const cos = Math.cos(-camera.angle);
      const sin = Math.sin(-camera.angle);
      for (const [x, y] of [[0, 0], [390, 0], [0, 844], [390, 844]] as const) {
        const local = { x: 195 + (x - 195) * cos - (y - 422) * sin, y: 422 + (x - 195) * sin + (y - 422) * cos };
        expect(local.x).toBeGreaterThanOrEqual(bounds.left - 1e-6);
        expect(local.x).toBeLessThanOrEqual(bounds.right + 1e-6);
        expect(local.y).toBeGreaterThanOrEqual(bounds.top - 1e-6);
        expect(local.y).toBeLessThanOrEqual(bounds.bottom + 1e-6);
      }
    }
  });

  it('à un quart de tour, la largeur et la hauteur du rectangle sont échangées', () => {
    const camera = new Camera(R, 390, 844);
    camera.snap(REST, REST, RIGHT);
    const bounds = camera.viewBounds();
    expect(bounds.right - bounds.left).toBeCloseTo(844, 6);
    expect(bounds.bottom - bounds.top).toBeCloseTo(390, 6);
    expect((bounds.left + bounds.right) / 2).toBeCloseTo(195, 6);
    expect((bounds.top + bounds.bottom) / 2).toBeCloseTo(422, 6);
  });

  it('garde le personnage à l\'écran, derrière lui sur l\'axe de la progression, monde tourné', () => {
    for (const env of [RIGHT, LEFT, MID]) {
      const camera = new Camera(R, 390, 844);
      camera.snap(REST, REST, env);
      // Montée à pleine vitesse pendant deux secondes, puis chute : la caméra traîne, la bande la rattrape.
      for (let i = 0; i < 240; i += 1) {
        const rising = i < 120;
        const hero = { x: 0, y: rising ? (i * 24) / 60 : (240 - i) * 0.4 };
        camera.update(1 / 60, hero, { x: 0, y: rising ? 24 : -24 }, env);
        const shown = camera.worldToDisplay(hero);
        expect(shown.x).toBeGreaterThanOrEqual(0);
        expect(shown.x).toBeLessThanOrEqual(390);
        expect(shown.y).toBeGreaterThanOrEqual(0);
        expect(shown.y).toBeLessThanOrEqual(844);
      }
    }
  });

  it('au repos monde tourné d\'un quart de tour, le personnage est du côté d\'où vient la progression et il reste de la place devant', () => {
    const camera = new Camera(R, 390, 844);
    settle(camera, REST, REST, RIGHT);
    // Gravité à droite : le haut du monde est à droite, le personnage est à gauche du centre, avec l'avance de 2,5 m.
    const hero = camera.worldToDisplay(REST);
    expect(hero.x).toBeCloseTo(195 - 2.5 * camera.scale, 3);
    expect(hero.y).toBeCloseTo(422, 3);
    expect(390 - hero.x).toBeGreaterThan(2 * hero.x);
  });

  it('suit le personnage en x selon la hauteur de l\'écran, monde tourné : un quart de tour donne bien plus de largeur de monde', () => {
    const camera = new Camera(R, 390, 844);
    settle(camera, { x: 9, y: 0 }, REST, RIGHT);
    // Zoom 0,7 : l'écran couvre 844 / 27,3 m le long de x, la demi-portée est de 15,4 m moins la marge de 1 m.
    expect(camera.centerX).toBeCloseTo(0, 6);
    settle(camera, { x: 20, y: 0 }, REST, RIGHT);
    expect(camera.centerX).toBeGreaterThan(5);
    expect(camera.worldToDisplay({ x: 20, y: 0 }).y).toBeLessThan(844);
  });
});

describe('prises écartées : la caméra dézoome pour les montrer', () => {
  it('ne change rien tant que tout tient dans 10 m, dézoome à 5 / demi-largeur au-delà, sans passer sous 0,6', () => {
    const camera = new Camera(R, 390, 844);
    camera.snap({ x: 0, y: 10 }, { x: 0, y: 0 }, undefined, 4.5);
    expect(camera.zoom).toBe(1);
    camera.snap({ x: 0, y: 10 }, { x: 0, y: 0 }, undefined, 7.2);
    expect(camera.zoom).toBeCloseTo(5 / 7.2, 6);
    camera.snap({ x: 0, y: 10 }, { x: 0, y: 0 }, undefined, 20);
    expect(camera.zoom).toBe(0.6);
    camera.snap({ x: 0, y: 10 }, { x: 0, y: 0 });
    expect(camera.zoom).toBe(1);
  });

  it('se lisse comme le zoom de vitesse, et le plus petit des deux zooms gagne', () => {
    const camera = new Camera(R, 390, 844);
    camera.update(0.016, { x: 0, y: 10 }, { x: 0, y: 0 }, undefined, 7.2);
    expect(camera.zoom).toBeGreaterThan(5 / 7.2);
    expect(camera.zoom).toBeLessThan(1);
    camera.snap({ x: 0, y: 10 }, { x: 0, y: 40 }, undefined, 7.2);
    expect(camera.zoom).toBe(0.6);
  });
});

import type { Vec2 } from '../core/math/vec2';

/**
 * Caméra : passage des mètres du monde aux pixels de l'écran.
 *
 * Le monde a l'axe Y vers le haut, l'écran vers le bas. La caméra ne connaît
 * ni PixiJS ni le DOM : tout y est arithmétique, ce qui la rend testable sous
 * Node. Elle lit la position et la vitesse du personnage et ne décide rien
 * d'autre que ce qu'on voit.
 */

/** Largeur du monde visible à zoom 1, en mètres : 10 m tiennent dans la largeur de l'écran. */
const VISIBLE_WIDTH = 10;

/** Constante du lissage exponentiel, en secondes de temps réel. */
const SMOOTHING_SECONDS = 0.25;

/** Zoom cible = 1 / (1 + vitesse / 18), borné : à 18 m/s le zoom brut vaut la moitié du zoom au repos. */
const ZOOM_SPEED_SCALE = 18;
/** Plus fort dézoom permis : au-delà, les accroches deviendraient trop petites pour être visées. */
const ZOOM_MIN = 0.6;

/** Taille minimale du personnage à l'écran, diamètre en pixels CSS. */
const MIN_HERO_DIAMETER = 14;

/** Avance vers le haut : de quoi voir les prochaines accroches. Mètres, puis mètres par m/s de vitesse verticale. */
const LEAD_BASE = 2.5;
const LEAD_PER_SPEED = 0.08;
const LEAD_MIN = 1;
const LEAD_MAX = 5;

/**
 * Bande verticale où le personnage reste à l'écran, en fraction de la hauteur
 * mesurée depuis le haut. Le lissage fait traîner la caméra à grande vitesse :
 * cette bande est la garantie dure que le personnage ne sort jamais du tiers
 * inférieur-milieu, même sur un écran large où l'avance en mètres serait trop
 * grande.
 */
const HERO_BAND_TOP = 0.45;
const HERO_BAND_BOTTOM = 0.7;

/**
 * Le monde jouable fait environ 10 m de large : la caméra reste centrée sur
 * x = 0 pour ne pas balancer tout le décor avec le pendule. Elle ne suit le
 * personnage en x que s'il s'approche du bord de l'écran de moins que cette
 * marge, en mètres.
 */
const EDGE_MARGIN = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class Camera {
  /** Centre de la vue dans le monde, en mètres. */
  centerX = 0;
  centerY = 0;
  /** Zoom lissé, entre `minZoom` et 1. */
  zoom = 1;

  private readonly heroRadius: number;
  private width: number;
  private height: number;

  constructor(heroRadius: number, width: number, height: number) {
    this.heroRadius = heroRadius;
    this.width = width;
    this.height = height;
  }

  /** Pixels par mètre, zoom compris. */
  get scale(): number {
    return (this.width / VISIBLE_WIDTH) * this.zoom;
  }

  /**
   * Zoom le plus petit permis : celui qui garde le personnage à 14 px de
   * diamètre, jamais en dessous de 0,6, jamais au-dessus de 1 (sur un écran
   * minuscule, on ne grossit pas plus que la vue de base).
   */
  get minZoom(): number {
    const fitsHero = MIN_HERO_DIAMETER / (2 * this.heroRadius * (this.width / VISIBLE_WIDTH));
    return Math.min(1, Math.max(ZOOM_MIN, fitsHero));
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Position à l'écran, en pixels CSS, d'un point du monde en mètres. */
  worldToScreen(point: Vec2): Vec2 {
    const scale = this.scale;
    return {
      x: this.width / 2 + (point.x - this.centerX) * scale,
      y: this.height / 2 - (point.y - this.centerY) * scale,
    };
  }

  /** Ordonnée du monde, en mètres, qui tombe sur une ordonnée d'écran donnée. */
  worldYAt(screenY: number): number {
    return this.centerY - (screenY - this.height / 2) / this.scale;
  }

  /** Avance la caméra de `dtSeconds` de temps réel vers le personnage. */
  update(dtSeconds: number, heroPos: Vec2, heroVel: Vec2): void {
    this.follow(1 - Math.exp(-dtSeconds / SMOOTHING_SECONDS), heroPos, heroVel);
  }

  /** Place la caméra d'un coup, sans lissage : début de partie. */
  snap(heroPos: Vec2, heroVel: Vec2): void {
    this.follow(1, heroPos, heroVel);
  }

  /** Rapproche zoom et centre de leur cible d'une fraction `blend`, puis impose les bornes dures. */
  private follow(blend: number, heroPos: Vec2, heroVel: Vec2): void {
    const speed = Math.hypot(heroVel.x, heroVel.y);
    const targetZoom = clamp(1 / (1 + speed / ZOOM_SPEED_SCALE), ZOOM_MIN, 1);
    this.zoom = clamp(this.zoom + (targetZoom - this.zoom) * blend, this.minZoom, 1);

    const lead = clamp(LEAD_BASE + LEAD_PER_SPEED * heroVel.y, LEAD_MIN, LEAD_MAX);
    const visibleHeight = this.height / this.scale;
    this.centerY = clamp(
      this.centerY + (heroPos.y + lead - this.centerY) * blend,
      heroPos.y + (HERO_BAND_TOP - 0.5) * visibleHeight,
      heroPos.y + (HERO_BAND_BOTTOM - 0.5) * visibleHeight,
    );

    const reach = this.width / this.scale / 2 - EDGE_MARGIN;
    this.centerX = clamp(this.centerX * (1 - blend), heroPos.x - reach, heroPos.x + reach);
  }
}

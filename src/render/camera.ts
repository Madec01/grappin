import type { Vec2 } from '../core/math/vec2';
import { STILL, isUpright, type Environment } from '../sim/environment';

/**
 * Caméra : passage des mètres du monde aux pixels de l'écran.
 *
 * Le monde a l'axe Y vers le haut, l'écran vers le bas. La caméra ne connaît
 * ni PixiJS ni le DOM : tout y est arithmétique, ce qui la rend testable sous
 * Node. Elle lit la position et la vitesse du personnage et ne décide rien
 * d'autre que ce qu'on voit.
 *
 * Pendant une bascule, la gravité tourne et le monde, lui, reste en place :
 * pour que le personnage pende toujours vers le bas de l'écran, c'est l'image
 * du monde qui tourne autour du centre de la caméra. `worldToScreen` donne la
 * position dans le repère du monde tourné, celui où le rendu dessine ;
 * `angle` dit de combien ce repère est tourné sur l'écran.
 */

/** Largeur du monde visible à zoom 1, en mètres : 10 m tiennent dans la largeur de l'écran. */
const VISIBLE_WIDTH = 10;

/** Constante du lissage exponentiel, en secondes de temps réel. */
const SMOOTHING_SECONDS = 0.25;

/** Zoom cible = 1 / (1 + vitesse / 18), borné : à 18 m/s le zoom brut vaut la moitié du zoom au repos. */
const ZOOM_SPEED_SCALE = 18;
/** Plus fort dézoom permis : au-delà, les accroches deviendraient trop petites pour être visées. */
const ZOOM_MIN = 0.6;

/** Gravité tournée (bascule) : le zoom visé ne dépasse pas cette valeur, pour voir plus loin de côté. */
const ZOOM_TILTED = 0.7;

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

/** Rectangle dans le repère du monde tourné, en pixels CSS. */
export interface ViewBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Angle, en radians dans le sens des aiguilles d'une montre à l'écran, dont il
 * faut tourner le monde pour que la gravité tombe vers le bas de l'écran : 0
 * quand elle tire vers le bas, un quart de tour quand elle tire vers la droite
 * du monde. Le rendu a le droit à la trigonométrie, la simulation non.
 */
export function worldAngle(gravityDir: Vec2): number {
  return Math.atan2(gravityDir.x, -gravityDir.y);
}

export class Camera {
  /** Centre de la vue dans le monde, en mètres. */
  centerX = 0;
  centerY = 0;
  /** Zoom lissé, entre `minZoom` et 1. */
  zoom = 1;
  /** Rotation du monde à l'écran autour du centre de la caméra, en radians : voir `worldAngle`. */
  angle = 0;

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

  /**
   * Position, en pixels CSS, d'un point du monde en mètres dans le repère du
   * monde tourné, c'est-à-dire avant la rotation de `angle`. Sans bascule, c'est
   * la position à l'écran.
   */
  worldToScreen(point: Vec2): Vec2 {
    const scale = this.scale;
    return {
      x: this.width / 2 + (point.x - this.centerX) * scale,
      y: this.height / 2 - (point.y - this.centerY) * scale,
    };
  }

  /** Ordonnée du monde, en mètres, qui tombe sur une ordonnée du repère du monde tourné. */
  worldYAt(screenY: number): number {
    return this.centerY - (screenY - this.height / 2) / this.scale;
  }

  /**
   * Position réellement affichée, en pixels CSS, d'un point du monde : celle de
   * `worldToScreen` une fois le monde tourné de `angle` autour du centre de l'écran.
   */
  worldToDisplay(point: Vec2): Vec2 {
    const { x, y } = this.worldToScreen(point);
    const dx = x - this.width / 2;
    const dy = y - this.height / 2;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    return { x: this.width / 2 + dx * cos - dy * sin, y: this.height / 2 + dx * sin + dy * cos };
  }

  /**
   * Ce que l'écran couvre dans le repère du monde tourné : le rectangle à
   * remplir pour que les lignes, la brume et les traînées touchent tous les
   * bords, même quand le monde est de travers. Sans bascule, c'est l'écran.
   */
  viewBounds(): ViewBounds {
    const half = this.halfExtents();
    return { left: this.width / 2 - half.x, right: this.width / 2 + half.x, top: this.height / 2 - half.y, bottom: this.height / 2 + half.y };
  }

  /** Avance la caméra de `dtSeconds` de temps réel vers le personnage, dans les conditions `env` du moment. */
  update(dtSeconds: number, heroPos: Vec2, heroVel: Vec2, env: Environment = STILL): void {
    this.follow(1 - Math.exp(-dtSeconds / SMOOTHING_SECONDS), heroPos, heroVel, env);
  }

  /** Place la caméra d'un coup, sans lissage : début de partie. */
  snap(heroPos: Vec2, heroVel: Vec2, env: Environment = STILL): void {
    this.follow(1, heroPos, heroVel, env);
  }

  /**
   * Demi-étendue de l'écran, en pixels, mesurée le long des axes x et y du
   * monde : celle de l'écran sans bascule, échangée largeur contre hauteur à un
   * quart de tour.
   */
  private halfExtents(): Vec2 {
    const cos = Math.abs(Math.cos(this.angle));
    const sin = Math.abs(Math.sin(this.angle));
    return { x: (this.width * cos + this.height * sin) / 2, y: (this.height * cos + this.width * sin) / 2 };
  }

  /** Rapproche zoom et centre de leur cible d'une fraction `blend`, puis impose les bornes dures. */
  private follow(blend: number, heroPos: Vec2, heroVel: Vec2, env: Environment): void {
    this.angle = worldAngle(env.gravityDir);
    const speed = Math.hypot(heroVel.x, heroVel.y);
    const speedZoom = clamp(1 / (1 + speed / ZOOM_SPEED_SCALE), ZOOM_MIN, 1);
    const targetZoom = isUpright(env) ? speedZoom : Math.min(speedZoom, ZOOM_TILTED);
    this.zoom = clamp(this.zoom + (targetZoom - this.zoom) * blend, this.minZoom, 1);

    // Le monde tourné d'un quart de tour, la progression (le long de y) court dans la largeur de l'écran : la bande et la portée en suivent la mesure.
    const half = this.halfExtents();
    const lead = clamp(LEAD_BASE + LEAD_PER_SPEED * heroVel.y, LEAD_MIN, LEAD_MAX);
    const visibleHeight = (2 * half.y) / this.scale;
    this.centerY = clamp(
      this.centerY + (heroPos.y + lead - this.centerY) * blend,
      heroPos.y + (HERO_BAND_TOP - 0.5) * visibleHeight,
      heroPos.y + (HERO_BAND_BOTTOM - 0.5) * visibleHeight,
    );

    const reach = half.x / this.scale - EDGE_MARGIN;
    this.centerX = clamp(this.centerX * (1 - blend), heroPos.x - reach, heroPos.x + reach);
  }
}

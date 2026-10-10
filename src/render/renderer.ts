import { Application, Container, Graphics, type Text } from 'pixi.js';
import type { Vec2 } from '../core/math/vec2';
import type { LevelOutcome, Profile, RunOutcome } from '../meta/profile';
import type { LevelResult } from '../meta/traversee';
import { PULL_MAX } from '../sim/launcher';
import { WORLD_HALF_WIDTH, multiplier } from '../sim/rules';
import type { Anchor, AnchorKind, RuleEvent, SimState } from '../sim/state';
import type { Tuning } from '../sim/tuning';
import type { ButtonId, ButtonRect } from './buttons';
import type { Camera, ViewBounds } from './camera';
import { bandsInView, cityBand } from './city';
import { electricState, type ElectricState } from '../sim/cycles';
import { fragileGauge, heldKind, isDark, isOff, shadowPoints } from './cues';
import { alertAlpha, bannerAlpha, flicker, floatAlpha, floatRise, pulse, sizzle, type Effects } from './effects';
import { formatDecimal } from './format';
import { neonCircle, neonDiscs, neonFill, neonLine, neonRects, neonStroke, type NeonStrokeStyle } from './neon';
import { Screens, type OverlayView } from './screens';
import { bandWidth, cupRadius, cupTips, mixColor, pullRatio, traceCup } from './sling';
import { COLOR, GlowText, PALETTES, makeText, readSafeInset, starPoints, type Palette } from './style';

/**
 * Rendu PixiJS en néon minimaliste : formes et textes, aucun asset.
 *
 * Le rendu lit l'état de la simulation et la caméra, il ne décide rien. Toutes
 * les formes sont redessinées à chaque image à partir de coordonnées déjà
 * calculées par la caméra. Chaque élément de jeu est un tube de néon sur fond
 * nuit : sa forme tracée trois fois (deux halos, un cœur), voir neon.ts, sans
 * aucun filtre de flou. Les formes regroupées par couleur, le nombre d'ordres
 * de dessin reste de l'ordre de la centaine par image. Règle de lisibilité :
 * rien de ce qui est dessiné ici ne masque jamais une accroche ni un danger ;
 * le décor de ville est le plus discret des tracés, dessous tout le reste.
 *
 * Deux sortes de couleurs : le langage du jeu (espèces de prises, étoiles,
 * obstacles, bords de la ville), fixe dans `COLOR`, et l'ambiance, que la
 * palette de l'image donne et qui change avec la musique (voir palette.ts).
 * Rien d'ambiant n'est figé à la construction : les dessins relisent la palette
 * à chaque image, et les textes que la palette teinte n'ont qu'une teinte à
 * changer, jamais un nouveau tracé.
 *
 * Tout le décor vit dans un conteneur, `world`, que la bascule fait tourner
 * autour du centre de l'écran : on y dessine donc en coordonnées de la caméra,
 * sur le rectangle `ViewBounds` qui déborde de l'écran quand le monde est de
 * travers. L'interface, les textes flottants, la bannière et les écrans restent
 * à l'écran, hors du conteneur.
 */

/** Écran du jeu à habiller : le rendu ne sait que l'afficher, c'est le jeu qui le choisit. */
export type GameScreen = 'title' | 'levels' | 'playing' | 'dead' | 'won' | 'talismans';

/** Ce qui a tué le personnage. */
export type DeathCause = Extract<RuleEvent, { type: 'death' }>['cause'];

/**
 * Ce que le jeu ajoute à l'état de la simulation pour un dessin : l'écran à
 * montrer, la cause de la mort, les effets de temps réel, les réglages de la
 * partie (talismans compris), le profil du joueur et l'issue de la partie
 * qui vient de finir, avec ce qui a fait ses étoiles si c'était un niveau.
 */
export interface GameFrame {
  readonly screen: GameScreen;
  readonly deathCause: DeathCause | null;
  readonly effects: Effects;
  readonly tuning: Tuning;
  readonly profile: Profile;
  /** Bilan de la partie finie, ou null tant qu'elle court. Celui d'un niveau est un `LevelOutcome`. */
  readonly outcome: RunOutcome | LevelOutcome | null;
  /** Étoiles prises et série de parfaits du niveau fini, ou null en course libre ou tant que la partie court. */
  readonly result: LevelResult | null;
  /** Mode test : un rappel discret pendant la partie, et les écrans le disent. */
  readonly testMode: boolean;
  /** Page de la liste des niveaux montrée (dix niveaux par page), à partir de 0. */
  readonly levelsPage: number;
  /** L'ambiance du moment : la palette de la famille de musique, ou son fondu quand la famille change. */
  readonly palette: Palette;
}

const TAU = Math.PI * 2;

/** Géométrie du monde, en mètres. */
const ALTITUDE_STEP = 10;
const ANCHOR_RADIUS = 0.25;
const TARGET_RING_RADIUS = 0.6;
const ROOF_HALF_WIDTH = 5;
const ROOF_THICKNESS = 0.4;

/** Épaisseurs de trait, en pixels CSS : des tubes fins, c'est le halo qui fait la lumière. */
const ROPE_WIDTH = 2;
/** La corde chauffe avec la vitesse : au-dessus de cette vitesse, elle épaissit (jusqu'à +3 px), son halo se renforce et s'élargit. */
const ROPE_CALM_SPEED = 4;
const ROPE_HEAT_WIDTH = 3;
const ROPE_HEAT_GLOW = 1.4;
const ROPE_HEAT_SPREAD = 0.9;
const TARGET_RING_WIDTH = 3;
const FOG_EDGE_WIDTH = 2;
const OBSTACLE_EDGE_WIDTH = 2;
const KIND_MARK_WIDTH = 2;
const WEAR_RING_WIDTH = 3;
const CHEVRON_WIDTH = 2;
const CABLE_WIDTH = 1.5;
const WIND_WIDTH = 1.5;
const CITY_WIDTH = 1;
const EDGE_WIDTH = 2;
const ROOF_EDGE_WIDTH = 2;

/**
 * Marques des accroches spéciales, en pixels CSS. L'anneau de marque entoure
 * le disque de quatre pixels : il reste donc toujours plus petit que l'anneau
 * de visée, même très dézoomé.
 */
const KIND_RING_GAP = 4;
/** Lanceur : épaisseur du trait de sa coupe, en pixels. */
const CUP_WIDTH = 3;
/** Portée du halo des anneaux, tirets et chevrons : plus courte que celle des disques, pour que leurs marques restent lisibles. */
const MARK_SPREAD = 0.6;
/** Accroche fragile tenue : l'anneau qui se vide entoure l'anneau de marque, de cet écart en pixels. */
const WEAR_RING_GAP = 5;
/** Opacité du rail de l'anneau qui se vide : la part déjà usée reste devinée. */
const WEAR_TRACK_ALPHA = 0.2;
/** Accroche fragile : anneau en huit tirets, chacun couvrant cette part de son huitième. */
const DASH_COUNT = 8;
const DASH_FILL = 0.55;
/** Accroche fragile : trait de fissure en éclair, en fractions du rayon du disque autour de son centre. */
const CRACK: readonly (readonly [number, number])[] = [
  [-0.55, -0.8],
  [0.1, -0.25],
  [-0.15, 0.2],
  [0.5, 0.8],
];
/** Prise électrique : éclair sombre sur le disque, même repère que la fissure. */
const BOLT: readonly (readonly [number, number])[] = [
  [0.3, -0.85],
  [-0.3, -0.05],
  [0.3, 0.05],
  [-0.3, 0.85],
];
/** Prise électrique chargée : pointes autour de l'anneau, leur nombre, leur longueur en pixels, et leur tour par seconde. */
const SPIKE_COUNT = 8;
const SPIKE_LENGTH = 6;
const SPIKE_GAP = 3;
const SPIKE_TURN = 0.4;
/** Prise électrique qui avertit : de combien l'anneau tremble, en pixels. */
const SIZZLE_JITTER = 3;
/** Propulseur : deux chevrons empilés au-dessus de l'anneau. Demi-largeur d'un chevron en mètres, au moins en pixels. */
const CHEVRON_HALF_WIDTH = 0.22;
const CHEVRON_MIN_HALF_WIDTH = 4;
const CHEVRON_COUNT = 2;
const CHEVRON_GAP = 2;
/** Propulseur : les chevrons scintillent à ce rythme (Hz), l'un derrière l'autre de ce retard en secondes. */
const CHEVRON_HZ = 1.8;
const CHEVRON_LAG = 0.15;

/** Au-delà de la vue de cette marge en pixels, un élément n'est plus dessiné : de quoi couvrir son halo et ses marques. */
const CULL_MARGIN = 24;

/** Un point éteint (panne) ou une prise à éclipse hors cycle : la trace très sombre d'un néon coupé. */
const DARK_ALPHA = 0.12;
/** Câble : tirets et blancs en pixels, opacité du rail et de sa lueur continue dessous. */
const CABLE_DASH = 6;
const CABLE_GAP = 5;
const CABLE_ALPHA = 0.55;
const CABLE_GLOW_WIDTH = 7;
const CABLE_GLOW_ALPHA = 0.08;
/** Coup de vent : opacité des traînées. */
const WIND_ALPHA = 0.35;

/** Étoile à quatre branches : rayon d'une pointe au moins en pixels. */
const STAR_MIN_RADIUS = 5;
/** Rayon dessiné d'une étoile, en mètres : constant, quel que soit le rayon de ramassage. */
const STAR_RADIUS = 0.35;
/** Les étoiles respirent : de cette part de leur halo à tout, à ce rythme (Hz). */
const STAR_PULSE_MIN = 0.7;
const STAR_PULSE_HZ = 0.9;
/** Étoile de la pluie : trois points de plus en plus petits et pâles la suivent, le premier à cet écart de sa pointe puis de cet écart entre eux, en pixels. */
const TRAIL: readonly { readonly radius: number; readonly alpha: number }[] = [
  { radius: 2.4, alpha: 0.5 },
  { radius: 1.9, alpha: 0.32 },
  { radius: 1.4, alpha: 0.18 },
];
const TRAIL_GAP = 6;
const TRAIL_STEP = 8;

/** Ligne d'arrivée d'un niveau : épaisseur, longueur d'un tiret et d'un blanc, en pixels CSS. */
const FINISH_WIDTH = 2;
const FINISH_DASH = 14;
const FINISH_GAP = 10;
const FINISH_FONT_SIZE = 14;

/** Ombre prédictive : rayon d'un point en pixels, opacité. */
const SHADOW_DOT_RADIUS = 1.8;
const SHADOW_ALPHA = 0.55;
/** Tenu à un lanceur, l'ombre est la visée elle-même : plus longue (secondes de vol), plus grosse et plus nette. */
const LAUNCH_SHADOW_SECONDS = 0.6;
const LAUNCH_SHADOW_DOT_RADIUS = 2.6;
const LAUNCH_SHADOW_ALPHA = 0.9;

/**
 * Lanceur tenu : le cercle qui borne la traction (tireté, pâle, plus net quand
 * on s'en approche), et la jauge de force, un anneau autour du personnage qui se
 * remplit avec la traction. Tailles en pixels.
 */
const LIMIT_DASHES = 28;
const LIMIT_DASH_FILL = 0.5;
const LIMIT_WIDTH = 1.5;
const LIMIT_ALPHA_MIN = 0.2;
const LIMIT_ALPHA_MAX = 0.75;
const GAUGE_GAP = 6;
const GAUGE_WIDTH = 3;
const GAUGE_TRACK_ALPHA = 0.3;
/** Sous cette part de force, ni jauge ni anneau de la jauge : le personnage est encore dans la coupe. */
const GAUGE_MIN_RATIO = 0.04;
/** À pleine force, l'élastique et la jauge battent à ce rythme (Hz). */
const FULL_PULL_HZ = 5;

/** Anneau de visée : il s'allume en cette durée (secondes) en se resserrant sur le point, d'abord plus large de cette part. */
const TARGET_IGNITE_SECONDS = 0.12;
const TARGET_IGNITE_WIDEN = 0.4;
/** Point tenu : l'anneau qui pulse autour, écart au disque en pixels et rythme (Hz). */
const HELD_RING_GAP = 3;
const HELD_PULSE_HZ = 2.5;

/** Brume : opacité de la nappe, et une bande plus claire sous la crête (profondeur en pixels, opacité) qui imite un dégradé sans en payer le coût. */
const FOG_ALPHA = 0.85;
const FOG_BANDS: readonly { readonly depth: number; readonly alpha: number }[] = [{ depth: 28, alpha: 0.13 }];

/** Silhouettes de ville : elles défilent à cette part de la vitesse du monde (de la profondeur), et s'éclaircissent vers l'avant : opacité par rang. */
const CITY_PARALLAX = 0.6;
const CITY_ROW_ALPHA: readonly number[] = [1, 0.8, 0.6];
/** Bords de la ville : le néon rouge sombre est discret, et une très légère teinte rougit l'extérieur. */
const EDGE_STRENGTH = 0.7;
const EDGE_TINT_ALPHA = 0.05;

/** Mise en page de l'interface, en pixels CSS. */
const HUD_SIDE_MARGIN = 16;
const HUD_MIN_TOP = 24;
const HUD_SAFE_GAP = 16;
const HEIGHT_FONT_SIZE = 44;
/** La bannière de palier, centrée, sous l'interface : distance sous le haut de l'interface. */
const BANNER_OFFSET = 88;
const BANNER_SIDE_MARGIN = 32;
const FLOAT_FONT_SIZE = 20;
const BANNER_FONT_SIZE = 24;
/** Seconde ligne de la bannière (l'intro d'un niveau), et distance qui la sépare de la première. */
const BANNER_DETAIL_FONT_SIZE = 16;
const BANNER_DETAIL_GAP = 4;
/** Objectif d'un niveau à côté de la hauteur, plus petit. */
const GOAL_FONT_SIZE = 22;
const GOAL_GAP = 8;

const DEATH_MESSAGES: Record<DeathCause, string> = {
  fog: "La brume t'a rattrapé",
  fall: 'Tombé hors de la ville',
};

/** Couleur du cœur et du halo d'une espèce d'accroche. */
interface Tube {
  readonly color: number;
  readonly halo: number;
}

/**
 * Couleur du cœur et du halo de chaque espèce d'accroche qui a un sens : elles
 * ne changent jamais d'une musique à l'autre. Le point normal, lui, prend le
 * tube de la palette (voir `Renderer.tubeOf`).
 */
const SPECIES_TUBE: Record<Exclude<AnchorKind, 'normal'>, Tube> = {
  fragile: { color: COLOR.fragile, halo: COLOR.fragile },
  booster: { color: COLOR.booster, halo: COLOR.booster },
  electrique: { color: COLOR.electric, halo: COLOR.electric },
  eclipse: { color: COLOR.eclipse, halo: COLOR.eclipse },
  lanceur: { color: COLOR.launcher, halo: COLOR.launcher },
};
const CHARGED_TUBE: Tube = { color: COLOR.electricCharged, halo: COLOR.electricCharged };
/** Dans quel groupe tombe une prise électrique selon son cycle. */
const ELECTRIC_GROUP: Record<ElectricState, 'calm' | 'warning' | 'charged'> = { calme: 'calm', avertit: 'warning', chargee: 'charged' };
const KINDS: readonly AnchorKind[] = ['normal', 'fragile', 'booster', 'electrique', 'eclipse', 'lanceur'];

/** Un point à l'écran, avec le numéro de l'accroche : le grésillement le décale d'une prise à l'autre. */
interface Spot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** Les accroches allumées, rangées par ce qu'elles sont : une prise électrique se range d'après son cycle. */
interface LitGroups {
  readonly normal: Spot[];
  readonly fragile: Spot[];
  readonly booster: Spot[];
  readonly calm: Spot[];
  readonly warning: Spot[];
  readonly charged: Spot[];
  readonly eclipse: Spot[];
  readonly lanceur: Spot[];
}

/** Ce que le dessin des accroches a besoin de savoir de l'image : tailles en pixels et horloge des effets. */
interface AnchorPaint {
  readonly scale: number;
  readonly radius: number;
  readonly ring: number;
  readonly clock: number;
}

/** Hauteur à afficher : depuis le toit de départ dans un niveau, absolue en course libre. */
function shownHeight(state: SimState): number {
  return state.finishY === null ? state.height : Math.max(0, state.height - state.groundY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Anneaux de tube autour de ces points, d'un seul lot, au rayon que donne `radiusOf` ; rien à tracer sans point. */
function neonRings(g: Graphics, spots: readonly Spot[], radiusOf: (spot: Spot) => number, style: NeonStrokeStyle): void {
  if (spots.length === 0) return;
  neonStroke(g, (target) => spots.forEach((spot) => target.circle(spot.x, spot.y, radiusOf(spot))), style);
}

/** Ajoute au tracé, sur chacun de ces points, la ligne brisée `shape` (en fractions du rayon, autour du centre) : la fêlure ou l'éclair, qui se trace d'un trait sombre. */
function glyph(g: Graphics, spots: readonly Spot[], shape: readonly (readonly [number, number])[], radius: number): void {
  for (const spot of spots) {
    shape.forEach(([dx, dy], i) => {
      if (i === 0) g.moveTo(spot.x + dx * radius, spot.y + dy * radius);
      else g.lineTo(spot.x + dx * radius, spot.y + dy * radius);
    });
  }
}

/** Le point est-il dans la vue, élargie de `margin` pixels ? */
function inView(view: ViewBounds, p: Vec2, margin: number): boolean {
  return p.x >= view.left - margin && p.x <= view.right + margin && p.y >= view.top - margin && p.y <= view.bottom + margin;
}

/** Ajoute au tracé une ligne pointillée de `from` à `to`, en tirets de `dash` pixels séparés de `gap`. */
function dashedLine(g: Graphics, from: Vec2, to: Vec2, dash: number, gap: number): void {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  for (let start = 0; start < length; start += dash + gap) {
    const end = Math.min(start + dash, length);
    g.moveTo(from.x + ux * start, from.y + uy * start).lineTo(from.x + ux * end, from.y + uy * end);
  }
}

export class Renderer {
  private readonly app: Application;

  /** Le décor, que la bascule fait tourner autour du centre de l'écran. */
  private readonly world = new Container();

  // Couches du décor, du fond vers l'avant. L'ordre d'ajout au conteneur dans le constructeur fait foi.
  private readonly city = new Graphics();
  private readonly cityEdges = new Graphics();
  private readonly altitudeLines = new Graphics();
  private readonly altitudeLabelLayer = new Container();
  private readonly windStreaks = new Graphics();
  private readonly finishLine = new Graphics();
  private readonly obstacles = new Graphics();
  private readonly pickups = new Graphics();
  private readonly roof = new Graphics();
  private readonly cables = new Graphics();
  private readonly anchors = new Graphics();
  private readonly targetRing = new Graphics();
  private readonly rope = new Graphics();
  private readonly fog = new Graphics();
  private readonly shadow = new Graphics();
  private readonly hero = new Graphics();

  // Par-dessus le décor, à l'écran.
  private readonly floatLayer = new Container();

  private readonly altitudeLabels: Text[] = [];
  private readonly floatLabels: Text[] = [];

  private readonly hud = new Container();
  private readonly heightText = makeText('', HEIGHT_FONT_SIZE, COLOR.text, { bold: true });
  private readonly goalText = makeText('', GOAL_FONT_SIZE, COLOR.textDim, { bold: true });
  /** Le multiplicateur : un texte blanc que l'accent de la palette teinte. */
  private readonly multiplierText = makeText('', 30, COLOR.white, { bold: true });
  private readonly scoreText = makeText('', 20, COLOR.textDim);
  private readonly testTag = makeText('MODE TEST', 13, COLOR.textDim, { bold: true });
  /** La bannière : texte blanc au léger halo de l'accent, qui change rarement (un palier, un événement), si bien que le flou ne coûte presque rien. */
  private readonly bannerText = new GlowText('', BANNER_FONT_SIZE, COLOR.text, PALETTES.menu.accent, { bold: true, outlined: true });
  /** Seconde ligne de la bannière : sa largeur de retour à la ligne est fixée par `layout()`. */
  private readonly bannerDetail = new GlowText('', BANNER_DETAIL_FONT_SIZE, COLOR.text, PALETTES.menu.accent, { outlined: true, wrap: 0 });
  /** « Arrivée », petit, à droite de la ligne d'arrivée, au halo du tube. */
  private readonly finishLabel = new GlowText('Arrivée', FINISH_FONT_SIZE, COLOR.hot, PALETTES.menu.halo, { bold: true });

  /** L'ambiance de la dernière image. Les tubes et les teintes qui en dépendent sont rafraîchis quand elle change. */
  private palette: Palette = PALETTES.menu;
  /** Tube du point normal : cœur et halo de la palette. */
  private normalTube: Tube = { color: PALETTES.menu.tube, halo: PALETTES.menu.halo };

  /** Titre, niveaux, fin de partie, victoire et talismans, par-dessus tout le reste. */
  private readonly screens = new Screens();

  /** Dimensions pour lesquelles la mise en page a été calculée. */
  private laidOutWidth = 0;
  private laidOutHeight = 0;

  /** Anneau de visée : le point qu'il entoure et l'instant, sur l'horloge des effets, où il s'est allumé. Du dessin seulement. */
  private litTarget: number | null = null;
  private litSince = 0;

  private constructor(app: Application) {
    this.app = app;

    this.tintTexts();
    this.hud.addChild(this.heightText, this.goalText, this.multiplierText, this.scoreText, this.testTag);
    this.multiplierText.anchor.set(1, 0);
    this.testTag.anchor.set(0.5, 0);
    this.heightText.anchor.set(0, 0);
    this.goalText.anchor.set(0, 1);
    this.scoreText.anchor.set(0, 0);
    this.bannerText.anchorAt(0.5, 0);
    this.bannerDetail.anchorAt(0.5, 0);
    this.finishLabel.anchorAt(1, 1);
    this.world.addChild(
      this.city,
      this.cityEdges,
      this.altitudeLines,
      this.altitudeLabelLayer,
      this.windStreaks,
      this.finishLine,
      this.finishLabel,
      this.obstacles,
      this.pickups,
      this.roof,
      this.cables,
      this.anchors,
      this.targetRing,
      this.rope,
      this.fog,
      this.shadow,
      this.hero,
    );
    app.stage.addChild(
      this.world,
      this.floatLayer,
      this.hud,
      this.bannerText,
      this.bannerDetail,
      this.screens.root,
    );
  }

  /** Démarre PixiJS et attache son canvas à la page. Échoue si WebGL est indisponible. */
  static async create(): Promise<Renderer> {
    const app = new Application();
    await app.init({
      background: PALETTES.menu.background,
      resizeTo: window,
      resolution: window.devicePixelRatio,
      autoDensity: true,
      antialias: true,
      preference: 'webgl',
      // Le jeu écoute lui-même le canvas (src/input/pointer.ts) : le système d'événements de Pixi ne sert à rien.
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    document.body.appendChild(app.canvas);
    return new Renderer(app);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  /** Largeur et hauteur de l'écran, en pixels CSS. */
  get width(): number {
    return this.app.screen.width;
  }

  get height(): number {
    return this.app.screen.height;
  }

  /** Appelle `callback` à chaque image avant le rendu, avec le temps réel écoulé en secondes. */
  onFrame(callback: (elapsedSeconds: number) => void): void {
    this.app.ticker.add((ticker) => callback(ticker.elapsedMS / 1000));
  }

  /** Boutons de l'écran affiché, en pixels CSS : ceux que la dernière image a dessinés. */
  buttons(): readonly ButtonRect[] {
    return this.screens.buttons();
  }

  /** Le bouton ou la ligne de talisman sous un point de l'écran, en pixels CSS, pour l'écran courant ; null ailleurs. */
  hitTest(x: number, y: number): ButtonId | null {
    return this.screens.hitTest(x, y);
  }

  /** Met la scène à jour pour l'état donné ; PixiJS la rend juste après. */
  draw(state: SimState, camera: Camera, frame: GameFrame): void {
    if (this.width !== this.laidOutWidth || this.height !== this.laidOutHeight) this.layout();
    this.applyPalette(frame.palette);
    const { tuning, effects } = frame;
    const view = camera.viewBounds();
    this.world.rotation = camera.angle;
    this.drawCity(camera, view);
    this.drawCityEdges(camera, view);
    this.drawAltitude(state, camera, view);
    this.drawWind(effects, state.env.wind.x, view);
    this.drawFinish(state, camera, view);
    this.drawObstacles(state, camera, view);
    this.drawPickups(state, camera, view, tuning, effects);
    this.drawRoof(state, camera);
    this.drawCables(state, camera);
    this.drawAnchors(state, camera, view, tuning, effects);
    this.drawTargetRing(state, camera, tuning, effects);
    this.drawRope(state, camera, tuning, effects);
    this.drawFog(state, camera, view, effects);
    this.drawShadow(state, camera, tuning);
    this.drawHero(state, camera, tuning);
    this.drawFloatingTexts(effects);
    this.drawHud(state, frame, tuning);
    this.drawBanner(effects);
    this.drawOverlay(state, frame);
  }

  /**
   * Prend l'ambiance de l'image. Les dessins la relisent d'eux-mêmes à chaque
   * image ; ici, seulement ce qui vit d'une image à l'autre : le fond de la scène
   * et les teintes des textes. Une teinte se change sans retracer le texte, même
   * à chaque image d'un fondu. Une palette identique à la précédente ne coûte rien.
   */
  private applyPalette(palette: Palette): void {
    if (palette === this.palette) return;
    this.palette = palette;
    this.app.renderer.background.color = palette.background;
    this.normalTube = { color: palette.tube, halo: palette.halo };
    this.tintTexts();
  }

  /** Teintes des textes qui suivent la palette. */
  private tintTexts(): void {
    const { accent, halo, altitudeLabel } = this.palette;
    this.multiplierText.tint = accent;
    this.bannerText.glow = accent;
    this.bannerDetail.glow = accent;
    this.finishLabel.glow = halo;
    for (const label of this.altitudeLabels) label.tint = altitudeLabel;
  }

  /** Cœur et halo de l'espèce `kind` : fixes, sauf le point normal qui prend le tube de la palette. */
  private tubeOf(kind: AnchorKind): Tube {
    return kind === 'normal' ? this.normalTube : SPECIES_TUBE[kind];
  }

  /** Positions qui ne dépendent que de la taille de l'écran. */
  private layout(): void {
    const { width, height } = this;
    this.laidOutWidth = width;
    this.laidOutHeight = height;
    this.world.pivot.set(width / 2, height / 2);
    this.world.position.set(width / 2, height / 2);

    const top = Math.max(HUD_MIN_TOP, readSafeInset('top') + HUD_SAFE_GAP);
    this.heightText.position.set(HUD_SIDE_MARGIN, top);
    this.multiplierText.position.set(width - HUD_SIDE_MARGIN, top + 8);
    this.scoreText.position.set(HUD_SIDE_MARGIN, top + HEIGHT_FONT_SIZE * 1.2);
    this.testTag.position.set(width / 2, top);
    this.bannerText.position.set(width / 2, top + BANNER_OFFSET);
    this.bannerDetail.position.x = width / 2;
    this.bannerDetail.wrapWidth = width - 2 * BANNER_SIDE_MARGIN;
  }

  /**
   * Silhouettes de ville : toits et antennes en contour très fin, sur les
   * côtés, hors de la largeur jouable, tout au fond. Elles défilent un peu moins
   * vite que le monde pour la profondeur, d'après la hauteur seule : la ville
   * est la même à chaque partie (voir city.ts).
   */
  private drawCity(camera: Camera, view: ViewBounds): void {
    const g = this.city.clear();
    // Dans le repère du décor lointain, l'ordonnée `y` s'affiche là où le monde afficherait `y` plus ce décalage.
    const shift = (1 - CITY_PARALLAX) * camera.centerY;
    const { first, last } = bandsInView(camera.worldYAt(view.bottom) - shift, camera.worldYAt(view.top) - shift);
    const rows: Vec2[][][] = CITY_ROW_ALPHA.map(() => []);
    for (let band = first; band <= last; band += 1) {
      for (const building of cityBand(band)) {
        for (const line of building.lines) {
          const drawn = line.map((point) => camera.worldToScreen({ x: point.x, y: point.y + shift }));
          // Hors de la vue de côté (les rangs lointains n'y entrent que caméra dézoomée), on ne trace rien.
          if (drawn.every((point) => point.x < view.left) || drawn.every((point) => point.x > view.right)) continue;
          rows[building.row]?.push(drawn);
        }
      }
    }
    rows.forEach((lines, row) => {
      if (lines.length === 0) return;
      for (const line of lines) {
        line.forEach((point, index) => (index === 0 ? g.moveTo(point.x, point.y) : g.lineTo(point.x, point.y)));
      }
      g.stroke({ width: CITY_WIDTH, color: this.palette.city, alpha: CITY_ROW_ALPHA[row] ?? 1, join: 'round' });
    });
  }

  /**
   * Les bords de la ville, à ± `WORLD_HALF_WIDTH` : deux traits verticaux de
   * néon rouge sombre, au-delà desquels le personnage tombe. On ne les voit que
   * lorsque la vue les atteint, caméra dézoomée ou monde basculé.
   */
  private drawCityEdges(camera: Camera, view: ViewBounds): void {
    const g = this.cityEdges.clear();
    for (const side of [-1, 1]) {
      const x = camera.worldToScreen({ x: side * WORLD_HALF_WIDTH, y: 0 }).x;
      if (x < view.left - EDGE_WIDTH * 4 || x > view.right + EDGE_WIDTH * 4) continue;
      // L'extérieur, très légèrement rougi : là, on ne revient pas.
      const outer = side < 0 ? view.left : view.right;
      g.rect(Math.min(x, outer), view.top, Math.abs(outer - x), view.bottom - view.top).fill({ color: COLOR.cityEdge, alpha: EDGE_TINT_ALPHA });
      neonLine(g, { x, y: view.top }, { x, y: view.bottom }, { color: COLOR.cityEdge, halo: COLOR.cityEdge, width: EDGE_WIDTH, strength: EDGE_STRENGTH });
    }
  }

  /**
   * Lignes fines tous les 10 m, avec leur altitude en petit texte à gauche. Un
   * niveau les compte depuis son toit de départ, comme l'interface ; la course
   * libre depuis le sol. Les textes tournent avec le monde pendant une bascule.
   */
  private drawAltitude(state: SimState, camera: Camera, view: ViewBounds): void {
    const lines = this.altitudeLines.clear();
    const origin = state.finishY === null ? 0 : state.groundY;
    const first = Math.max(1, Math.ceil((camera.worldYAt(view.bottom) - origin) / ALTITUDE_STEP));
    const last = Math.floor((camera.worldYAt(view.top) - origin) / ALTITUDE_STEP);

    for (let slot = 0; slot < Math.max(this.altitudeLabels.length, last - first + 1); slot += 1) {
      const level = first + slot;
      const label = this.altitudeLabel(slot);
      label.visible = level <= last;
      if (!label.visible) continue;
      const y = camera.worldToScreen({ x: 0, y: origin + level * ALTITUDE_STEP }).y;
      lines.moveTo(view.left, y).lineTo(view.right, y);
      label.text = `${level * ALTITUDE_STEP} m`;
      label.position.set(view.left + HUD_SIDE_MARGIN / 2, y - 2);
    }
    lines.stroke({ width: 1, color: this.palette.altitudeLine });
  }

  /**
   * Ligne d'arrivée d'un niveau : un tube pointillé de la palette (cœur pâle, halo de l'ambiance) sur toute la
   * largeur et « Arrivée » à droite. Elle est dessinée sous les accroches et les
   * dangers, qu'elle ne masque jamais. Rien en course libre.
   */
  private drawFinish(state: SimState, camera: Camera, view: ViewBounds): void {
    const g = this.finishLine.clear();
    const y = state.finishY === null ? null : camera.worldToScreen({ x: 0, y: state.finishY }).y;
    this.finishLabel.visible = y !== null && y >= view.top && y <= view.bottom;
    if (y === null || !this.finishLabel.visible) return;
    neonStroke(g, (target) => dashedLine(target, { x: view.left, y }, { x: view.right, y }, FINISH_DASH, FINISH_GAP), { color: this.palette.tube, halo: this.palette.halo, width: FINISH_WIDTH });
    this.finishLabel.position.set(view.right - HUD_SIDE_MARGIN / 2, y - FINISH_WIDTH - 2);
  }

  /**
   * Coup de vent : des traînées fines, d'une teinte pâle de la palette, qui filent dans le sens du
   * vent sur toute la vue, sous les points pour n'en masquer aucun. Rien sans vent.
   */
  private drawWind(effects: Effects, windX: number, view: ViewBounds): void {
    const g = this.windStreaks.clear();
    if (windX === 0) return;
    const width = view.right - view.left;
    const height = view.bottom - view.top;
    neonStroke(
      g,
      (target) => {
        for (const streak of effects.windStreaks) {
          const x = view.left + streak.x * width;
          const y = view.top + streak.y * height;
          const half = (streak.length * width) / 2;
          target.moveTo(x - half, y).lineTo(x + half, y);
        }
      },
      { color: this.palette.pale, halo: this.palette.pale, width: WIND_WIDTH, alpha: WIND_ALPHA, strength: 0.6, spread: 0.7, cap: 'round' },
    );
  }

  /** Étiquette numéro `slot` du réservoir ; le réservoir grandit seulement si l'écran montre plus de lignes. */
  private altitudeLabel(slot: number): Text {
    let label = this.altitudeLabels[slot];
    if (!label) {
      label = makeText('', 12, COLOR.white);
      label.tint = this.palette.altitudeLabel;
      label.anchor.set(0, 1);
      this.altitudeLabels[slot] = label;
      this.altitudeLabelLayer.addChild(label);
    }
    return label;
  }

  /** Obstacles : une masse sombre au contour néon rouge-magenta fin, sous les points et la corde. Un danger se lit comme tel. */
  private drawObstacles(state: SimState, camera: Camera, view: ViewBounds): void {
    const g = this.obstacles.clear();
    const scale = camera.scale;
    const boxes = state.obstacles
      .map((box) => {
        const topLeft = camera.worldToScreen({ x: box.x0, y: box.y1 });
        return { x: topLeft.x, y: topLeft.y, width: (box.x1 - box.x0) * scale, height: (box.y1 - box.y0) * scale };
      })
      // Hors de la vue, ni le tracé ni son halo ne servent : on ne dessine que ce que l'écran peut montrer.
      .filter((box) => box.x + box.width >= view.left - CULL_MARGIN && box.x <= view.right + CULL_MARGIN && box.y + box.height >= view.top - CULL_MARGIN && box.y <= view.bottom + CULL_MARGIN);
    if (boxes.length === 0) return;
    // Le halo d'abord, puis le corps sombre par-dessus (il ne reste du halo que ce qui déborde), puis le contour net.
    const tube = { color: COLOR.obstacleEdge, halo: COLOR.obstacleEdge, width: OBSTACLE_EDGE_WIDTH };
    neonRects(g, boxes, { ...tube, pass: 'halo' });
    for (const box of boxes) g.rect(box.x, box.y, box.width, box.height);
    g.fill(COLOR.obstacle);
    neonRects(g, boxes, { ...tube, pass: 'core' });
  }

  /**
   * Étoiles de la route haute : losange concave à quatre branches, jaune néon
   * au halo chaud, absent une fois pris. L'étoile garde sa taille ; si le rayon
   * de ramassage est plus grand (talisman Aimant à étoiles), un halo discret
   * montre la zone. Une étoile de la pluie, qui tombe, laisse derrière elle une
   * courte traînée.
   */
  private drawPickups(state: SimState, camera: Camera, view: ViewBounds, tuning: Tuning, effects: Effects): void {
    const g = this.pickups.clear();
    const outer = Math.max(STAR_RADIUS * camera.scale, STAR_MIN_RADIUS);
    const reach = tuning.pickupRadius > STAR_RADIUS + 1e-9 ? tuning.pickupRadius * camera.scale : 0;
    const shown = state.pickups.flatMap((pickup) => {
      const spot = camera.worldToScreen(pickup.pos);
      return !pickup.taken && inView(view, spot, CULL_MARGIN + reach) ? [{ pickup, spot }] : [];
    });
    if (shown.length === 0) return;
    const spots = shown.map((item) => item.spot);
    if (reach > 0) {
      for (const spot of spots) g.circle(spot.x, spot.y, reach);
      g.fill({ color: COLOR.starHalo, alpha: 0.08 });
    }
    neonFill(
      g,
      (target, grow) => {
        for (const spot of spots) target.poly(starPoints(spot.x, spot.y, outer + grow));
      },
      { color: COLOR.star, halo: COLOR.starHalo, strength: pulse(effects.clock, STAR_PULSE_HZ, STAR_PULSE_MIN) },
    );
    for (const { pickup, spot } of shown) {
      if (!pickup.vel) continue;
      // La traînée part à l'opposé du mouvement, en pixels : le repère d'écran a son y vers le bas.
      const speed = Math.hypot(pickup.vel.x, pickup.vel.y);
      if (speed === 0) continue;
      const behind = { x: -pickup.vel.x / speed, y: pickup.vel.y / speed };
      TRAIL.forEach((dot, i) => {
        const distance = outer + TRAIL_GAP + i * TRAIL_STEP;
        g.circle(spot.x + behind.x * distance, spot.y + behind.y * distance, dot.radius).fill({ color: COLOR.star, alpha: dot.alpha });
      });
    }
  }

  /** Le toit de départ : une dalle sombre à la hauteur du sol de la partie, de -5 à +5 m, dont l'arête haute est un tube de la palette. */
  private drawRoof(state: SimState, camera: Camera): void {
    const topLeft = camera.worldToScreen({ x: -ROOF_HALF_WIDTH, y: state.groundY });
    const scale = camera.scale;
    const width = 2 * ROOF_HALF_WIDTH * scale;
    const g = this.roof.clear().rect(topLeft.x, topLeft.y, width, ROOF_THICKNESS * scale).fill(this.palette.roofFill);
    neonLine(g, topLeft, { x: topLeft.x + width, y: topLeft.y }, { ...this.normalTube, width: ROOF_EDGE_WIDTH, alpha: 0.85, strength: 0.7 });
  }

  /**
   * Câbles : un rail tireté discret, au halo de la palette, sous chaque point qui glisse, de l'un
   * à l'autre de ses bouts, sur une lueur continue très pâle. Le point, lui, se
   * dessine à sa position du moment.
   */
  private drawCables(state: SimState, camera: Camera): void {
    const g = this.cables.clear();
    const ends = state.anchors.flatMap((anchor) => (anchor.cable && !anchor.broken ? [{ from: camera.worldToScreen(anchor.cable.from), to: camera.worldToScreen(anchor.cable.to) }] : []));
    if (ends.length === 0) return;
    for (const rail of ends) g.moveTo(rail.from.x, rail.from.y).lineTo(rail.to.x, rail.to.y);
    g.stroke({ width: CABLE_GLOW_WIDTH, color: this.palette.halo, alpha: CABLE_GLOW_ALPHA });
    for (const rail of ends) dashedLine(g, rail.from, rail.to, CABLE_DASH, CABLE_GAP);
    g.stroke({ width: CABLE_WIDTH, color: this.palette.halo, alpha: CABLE_ALPHA });
  }

  /**
   * Les points d'accroche, chacun un tube de néon. Normal : disque pâle,
   * au halo de la palette. Fragile : disque magenta, fêlure sombre, anneau en tirets, qui
   * grésille ; un anneau qui se vide pendant la tenue. Propulseur : disque cyan
   * vif dans un anneau, surmonté de chevrons qui scintillent. Prise électrique :
   * orange au calme, anneau qui grésille quand elle avertit, rouge à halo fort
   * et pointes quand elle est chargée. Prise à éclipse : anneau violet, plein de
   * lueur allumé. Un point éteint (panne) ou une éclipse hors cycle laisse la
   * trace très sombre d'un néon coupé ; un point cassé n'est plus dessiné du
   * tout. Le point tenu pulse.
   */
  private drawAnchors(state: SimState, camera: Camera, view: ViewBounds, tuning: Tuning, effects: Effects): void {
    const g = this.anchors.clear();
    const radius = ANCHOR_RADIUS * camera.scale;
    const paint: AnchorPaint = { scale: camera.scale, radius, ring: radius + KIND_RING_GAP, clock: effects.clock };
    const off: Anchor[] = [];
    const groups: LitGroups = { normal: [], fragile: [], booster: [], calm: [], warning: [], charged: [], eclipse: [], lanceur: [] };
    for (const anchor of state.anchors) {
      if (anchor.broken) continue;
      const p = camera.worldToScreen(anchor.pos);
      // Un point hors de la vue ne se dessine pas : le parcours engendré d'avance compte bien plus de points que l'écran n'en montre. La marge couvre halo, anneaux et chevrons.
      if (!inView(view, p, CULL_MARGIN + paint.ring)) continue;
      if (isOff(state, anchor, tuning)) {
        off.push(anchor);
        continue;
      }
      const spot = { id: anchor.id, x: p.x, y: p.y };
      if (anchor.kind === 'electrique') groups[ELECTRIC_GROUP[electricState(anchor.id, state.step, tuning)]].push(spot);
      else groups[anchor.kind].push(spot);
    }
    this.paintOff(g, camera, off, paint);
    // Tous les halos avant tous les cœurs : un halo ne passe jamais sur le cœur d'un point voisin.
    this.paintLit(g, groups, paint, 'halo');
    this.paintLit(g, groups, paint, 'core');

    const held = state.rope ? state.anchors.find((anchor) => anchor.id === state.rope?.anchorId) : undefined;
    if (held && held.kind !== 'fragile' && !held.broken && !isOff(state, held, tuning)) {
      // Le point tenu pulse : un anneau de plus, qui respire.
      const p = camera.worldToScreen(held.pos);
      const beat = pulse(paint.clock, HELD_PULSE_HZ, 0.3);
      if (held.kind === 'lanceur') {
        // La coupe elle-même respire, un peu plus large : un anneau de plus la brouillerait.
        const tube = { ...SPECIES_TUBE.lanceur, width: 1.5, alpha: 0.4 + 0.6 * beat, strength: beat, spread: 1.2, cap: 'round' as const, join: 'round' as const };
        neonStroke(g, (target) => traceCup(target, p.x, p.y, cupRadius(paint.radius) + HELD_RING_GAP), tube);
      } else {
        neonCircle(g, p.x, p.y, paint.ring + HELD_RING_GAP, { ...this.normalTube, width: 1.5, alpha: 0.4 + 0.6 * beat, strength: beat, spread: 1.2 });
      }
    }

    const gauge = fragileGauge(state, tuning);
    if (gauge) {
      const p = camera.worldToScreen(gauge.pos);
      const wearRing = paint.ring + WEAR_RING_GAP;
      const remaining = 1 - gauge.wear;
      g.circle(p.x, p.y, wearRing).stroke({ width: WEAR_RING_WIDTH, color: COLOR.wear, alpha: WEAR_TRACK_ALPHA });
      if (remaining > 0) {
        neonStroke(g, (target) => target.moveTo(p.x, p.y - wearRing).arc(p.x, p.y, wearRing, -Math.PI / 2, -Math.PI / 2 + remaining * TAU), { color: COLOR.wear, halo: COLOR.fragile, width: WEAR_RING_WIDTH });
      }
    }
  }

  /** Les traces sombres : un tube éteint n'a plus de halo, il ne reste que son dessin à très faible opacité. */
  private paintOff(g: Graphics, camera: Camera, off: readonly Anchor[], paint: AnchorPaint): void {
    for (const kind of KINDS) {
      const spots = off.filter((anchor) => anchor.kind === kind).map((anchor) => ({ id: anchor.id, ...camera.worldToScreen(anchor.pos) }));
      const tube = { ...this.tubeOf(kind), alpha: DARK_ALPHA, strength: 0 };
      // Même empreinte que le tube allumé : un disque, ou l'anneau de l'éclipse.
      if (kind === 'eclipse') neonRings(g, spots, () => paint.ring - 1, { ...tube, width: KIND_MARK_WIDTH + 0.5 });
      else neonDiscs(g, spots, paint.radius, tube);
    }
  }

  /** Dessine la passe `pass` (les halos, ou les cœurs) de toutes les accroches allumées. */
  private paintLit(g: Graphics, groups: LitGroups, paint: AnchorPaint, pass: 'halo' | 'core'): void {
    const { radius, ring, clock, scale } = paint;
    const core = pass === 'core';

    neonDiscs(g, groups.normal, radius, { ...this.normalTube, pass });

    // Lanceur : un disque vert d'eau au creux d'une coupe en « Y » ouverte vers le haut, sur un court pied : une fronde. Rien d'un propulseur, qui est un anneau fermé à chevrons.
    if (groups.lanceur.length > 0) {
      const cup = cupRadius(radius);
      neonDiscs(g, groups.lanceur, radius, { ...SPECIES_TUBE.lanceur, pass });
      neonStroke(
        g,
        (target) => {
          for (const spot of groups.lanceur) traceCup(target, spot.x, spot.y, cup);
        },
        { ...SPECIES_TUBE.lanceur, width: CUP_WIDTH, spread: MARK_SPREAD, cap: 'round', join: 'round', pass },
      );
    }

    // Fragile : le disque grésille, chacun à son rythme ; anneau en huit tirets ; fêlure sombre au cœur.
    if (groups.fragile.length > 0) {
      if (core) neonDiscs(g, groups.fragile, radius, { ...SPECIES_TUBE.fragile, pass });
      else for (const spot of groups.fragile) neonDiscs(g, [spot], radius, { ...SPECIES_TUBE.fragile, strength: flicker(clock, spot.id, 0.4) * 1.2, pass });
      neonStroke(
        g,
        (target) => {
          for (const spot of groups.fragile) {
            for (let dash = 0; dash < DASH_COUNT; dash += 1) {
              const start = (dash / DASH_COUNT) * TAU;
              const end = start + (DASH_FILL / DASH_COUNT) * TAU;
              target.moveTo(spot.x + ring * Math.cos(start), spot.y + ring * Math.sin(start)).lineTo(spot.x + ring * Math.cos(end), spot.y + ring * Math.sin(end));
            }
          }
        },
        { ...SPECIES_TUBE.fragile, width: KIND_MARK_WIDTH, spread: MARK_SPREAD, pass },
      );
      if (core) {
        glyph(g, groups.fragile, CRACK, radius);
        g.stroke({ width: Math.max(1, radius * 0.14), color: COLOR.crack });
      }
    }

    // Propulseur : disque cyan vif, anneau plein, chevrons qui scintillent l'un après l'autre.
    if (groups.booster.length > 0) {
      neonDiscs(g, groups.booster, radius, { ...SPECIES_TUBE.booster, pass });
      neonRings(g, groups.booster, () => ring, { ...SPECIES_TUBE.booster, width: KIND_MARK_WIDTH, spread: MARK_SPREAD, pass });
      const halfWidth = Math.max(CHEVRON_MIN_HALF_WIDTH, CHEVRON_HALF_WIDTH * scale);
      const rise = halfWidth * 0.75;
      for (let k = 0; k < CHEVRON_COUNT; k += 1) {
        neonStroke(
          g,
          (target) => {
            for (const spot of groups.booster) {
              const base = spot.y - ring - CHEVRON_GAP - k * (rise + CHEVRON_GAP);
              target.moveTo(spot.x - halfWidth, base).lineTo(spot.x, base - rise).lineTo(spot.x + halfWidth, base);
            }
          },
          { ...SPECIES_TUBE.booster, width: CHEVRON_WIDTH, alpha: 0.35 + 0.65 * pulse(clock - k * CHEVRON_LAG, CHEVRON_HZ, 0), spread: MARK_SPREAD, cap: 'round', join: 'round', pass },
        );
      }
    }

    // Prise électrique : un disque orange à l'éclair sombre. Au calme, un anneau pâle ; elle avertit : l'anneau grésille et tremble ; chargée : rouge, halo fort, pointes qui tournent.
    const electric = [...groups.calm, ...groups.warning, ...groups.charged];
    if (electric.length > 0) {
      const orange = SPECIES_TUBE.electrique;
      neonDiscs(g, groups.calm, radius, { ...orange, pass });
      neonDiscs(g, groups.warning, radius, { ...orange, strength: 1.3, pass });
      neonDiscs(g, groups.charged, radius, { ...CHARGED_TUBE, spread: 1.7, strength: 1.6 * pulse(clock, 6, 0.75), pass });
      neonRings(g, groups.calm, () => ring, { ...orange, width: 1.5, alpha: 0.45, strength: 0.5, spread: MARK_SPREAD, pass });
      // L'anneau qui avertit grésille : allumé par à-coups, et il tremble de quelques pixels.
      const sparking = groups.warning.filter((spot) => sizzle(clock, spot.id));
      neonRings(g, sparking, (spot) => ring + (flicker(clock, spot.id, 0) - 0.5) * SIZZLE_JITTER, { ...orange, width: KIND_MARK_WIDTH, strength: 1.4, spread: MARK_SPREAD, pass });
      neonRings(g, groups.charged, () => ring + 2, { ...CHARGED_TUBE, width: KIND_MARK_WIDTH + 1, spread: 1.1, strength: 1.6, pass });
      if (groups.charged.length > 0) {
        neonStroke(
          g,
          (target) => {
            for (const spot of groups.charged) {
              for (let spike = 0; spike < SPIKE_COUNT; spike += 1) {
                const angle = (spike / SPIKE_COUNT) * TAU + clock * SPIKE_TURN * TAU;
                const from = ring + 2 + SPIKE_GAP;
                const to = from + SPIKE_LENGTH;
                target.moveTo(spot.x + from * Math.cos(angle), spot.y + from * Math.sin(angle)).lineTo(spot.x + to * Math.cos(angle), spot.y + to * Math.sin(angle));
              }
            }
          },
          { ...CHARGED_TUBE, width: KIND_MARK_WIDTH, cap: 'round', strength: 1.2, pass },
        );
      }
      if (core) {
        glyph(g, electric, BOLT, radius);
        g.stroke({ width: Math.max(1, radius * 0.16), color: COLOR.crack, join: 'miter' });
      }
    }

    // Prise à éclipse allumée : un anneau violet creux et son point, en pleine lueur. Le halo, court, laisse le creux de l'anneau sombre.
    if (groups.eclipse.length > 0) {
      const tube = { ...SPECIES_TUBE.eclipse, spread: MARK_SPREAD, strength: 1.5, pass };
      neonRings(g, groups.eclipse, () => ring - 1, { ...tube, width: KIND_MARK_WIDTH + 0.5 });
      neonDiscs(g, groups.eclipse, radius * 0.35, tube);
    }
  }

  /**
   * Anneau autour du point visé : toujours plus large que le point, même très
   * dézoomé. Il s'allume en se resserrant quand la visée change de point. Absent
   * si le lampadaire du point est éteint : on vise de mémoire.
   */
  private drawTargetRing(state: SimState, camera: Camera, tuning: Tuning, effects: Effects): void {
    const g = this.targetRing.clear();
    const target = state.anchors.find((anchor) => anchor.id === state.targetId);
    if (!target || isDark(state, target.id, tuning)) {
      this.litTarget = null;
      return;
    }
    if (this.litTarget !== target.id) {
      this.litTarget = target.id;
      this.litSince = effects.clock;
    }
    const lit = clamp((effects.clock - this.litSince) / TARGET_IGNITE_SECONDS, 0, 1);
    const p = camera.worldToScreen(target.pos);
    const radius = Math.max(TARGET_RING_RADIUS * camera.scale, ANCHOR_RADIUS * camera.scale + 6) * (1 + TARGET_IGNITE_WIDEN * (1 - lit));
    neonCircle(g, p.x, p.y, radius, { ...this.normalTube, width: TARGET_RING_WIDTH, alpha: 0.4 + 0.6 * lit, strength: lit * (0.8 + 0.2 * pulse(effects.clock, 3, 0)) });
  }

  /**
   * Le trait part du personnage et se dessine vers le point pendant les
   * premiers centièmes de seconde : un tube de la palette. À un lanceur, il n'y a
   * pas de corde : l'élastique de la fronde prend sa place.
   */
  private drawRope(state: SimState, camera: Camera, tuning: Tuning, effects: Effects): void {
    const g = this.rope.clear();
    if (!state.rope) return;
    const { anchorId } = state.rope;
    const anchor = state.anchors.find((a) => a.id === anchorId);
    if (!anchor) return;
    if (anchor.kind === 'lanceur') {
      this.drawSling(g, state, camera, tuning, anchor, effects.clock);
      return;
    }
    const from = camera.worldToScreen(state.hero.pos);
    const to = camera.worldToScreen(anchor.pos);
    const drawn = effects.ropeDrawn;
    const tip = { x: from.x + (to.x - from.x) * drawn, y: from.y + (to.y - from.y) * drawn };
    // La vitesse se lit sur la corde : plus le treuil accélère le balancement, plus elle épaissit et brille, jusqu'au plafond du treuil.
    const speed = Math.hypot(state.hero.vel.x, state.hero.vel.y);
    const heat = Math.min(1, Math.max(0, (speed - ROPE_CALM_SPEED) / (tuning.reelMaxSpeed - ROPE_CALM_SPEED)));
    neonLine(g, from, tip, { ...this.normalTube, width: ROPE_WIDTH + ROPE_HEAT_WIDTH * heat, strength: 1 + ROPE_HEAT_GLOW * heat, spread: 1 + ROPE_HEAT_SPREAD * heat, cap: 'round' });
  }

  /**
   * La fronde du lanceur tenu : le cercle tireté qui borne la traction, un
   * élastique de chaque pointe de la coupe au personnage tiré, qui s'épaissit,
   * s'éclaircit et se tend avec la force, et un anneau de jauge autour du
   * personnage qui se ferme à pleine force. Le lanceur est libre de tout autour
   * de lui jusqu'à la limite de traction (voir `LANCEUR_CLEARANCE`) : rien de cela
   * ne masque une accroche ni un danger.
   */
  private drawSling(g: Graphics, state: SimState, camera: Camera, tuning: Tuning, anchor: Anchor, clock: number): void {
    const scale = camera.scale;
    const center = camera.worldToScreen(anchor.pos);
    const hero = camera.worldToScreen(state.hero.pos);
    const ratio = pullRatio(state.pull);
    const full = ratio >= 1;
    const beat = full ? pulse(clock, FULL_PULL_HZ, 0.6) : 1;

    // La limite de traction : un cercle de tirets pâles, de plus en plus net à mesure qu'on s'en approche.
    const limit = PULL_MAX * scale;
    for (let dash = 0; dash < LIMIT_DASHES; dash += 1) {
      const start = (dash / LIMIT_DASHES) * TAU;
      g.moveTo(center.x + limit * Math.cos(start), center.y + limit * Math.sin(start)).arc(center.x, center.y, limit, start, start + (LIMIT_DASH_FILL / LIMIT_DASHES) * TAU);
    }
    g.stroke({ width: LIMIT_WIDTH, color: COLOR.launcher, alpha: LIMIT_ALPHA_MIN + (LIMIT_ALPHA_MAX - LIMIT_ALPHA_MIN) * ratio * ratio });

    // L'élastique : des pointes de la coupe au personnage, plus gras, plus blanc, plus lumineux avec la force.
    const tips = cupTips(center.x, center.y, cupRadius(ANCHOR_RADIUS * scale));
    neonStroke(
      g,
      (target) => {
        target.moveTo(tips.left.x, tips.left.y).lineTo(hero.x, hero.y);
        target.moveTo(tips.right.x, tips.right.y).lineTo(hero.x, hero.y);
      },
      { color: mixColor(COLOR.launcher, COLOR.hot, ratio), halo: COLOR.launcher, width: bandWidth(ratio), strength: (0.7 + 0.9 * ratio) * beat, spread: 0.8 + 0.5 * ratio, cap: 'round', join: 'round' },
    );

    // La jauge : un anneau autour du personnage, qui se remplit depuis le haut avec la traction.
    if (ratio < GAUGE_MIN_RATIO) return;
    const gaugeRadius = tuning.heroRadius * scale + GAUGE_GAP;
    g.circle(hero.x, hero.y, gaugeRadius).stroke({ width: GAUGE_WIDTH, color: COLOR.launcher, alpha: GAUGE_TRACK_ALPHA });
    neonStroke(g, (target) => target.moveTo(hero.x, hero.y - gaugeRadius).arc(hero.x, hero.y, gaugeRadius, -Math.PI / 2, -Math.PI / 2 + ratio * TAU), {
      color: mixColor(COLOR.launcher, COLOR.hot, ratio * ratio),
      halo: COLOR.launcher,
      width: GAUGE_WIDTH + (full ? 1 : 0),
      strength: full ? 1.6 * beat : 1,
    });
  }

  /**
   * La brume : une nappe de la teinte de la palette, du niveau `fogY` jusqu'au bas de la vue,
   * deux bandes plus claires sous la crête pour la faire monter en lumière, et
   * une ligne de crête lumineuse, qui clignote tant que l'alerte accélère la
   * brume.
   */
  private drawFog(state: SimState, camera: Camera, view: ViewBounds, effects: Effects): void {
    const g = this.fog.clear();
    const top = camera.worldToScreen({ x: 0, y: state.fogY }).y;
    if (top >= view.bottom) return;
    const visibleTop = Math.max(view.top, top);
    const width = view.right - view.left;
    g.rect(view.left, visibleTop, width, view.bottom - visibleTop).fill({ color: this.palette.fog, alpha: FOG_ALPHA });
    if (top < view.top) return;
    for (const band of FOG_BANDS) g.rect(view.left, top, width, Math.min(band.depth, view.bottom - top)).fill({ color: this.palette.fogEdge, alpha: band.alpha });
    const blink = state.fogFactor > 1 ? alertAlpha(effects.clock) : 1;
    neonLine(g, { x: view.left, y: top }, { x: view.right, y: top }, { color: this.palette.fogEdge, halo: this.palette.fogEdge, width: FOG_EDGE_WIDTH, alpha: blink, spread: 1.6 });
  }

  /**
   * Ombre prédictive : quelques points pâles, discrets, qui montrent où irait
   * le personnage s'il lâchait maintenant. Tenu à un lanceur, elle est la visée :
   * plus longue, plus grosse, plus nette.
   */
  private drawShadow(state: SimState, camera: Camera, tuning: Tuning): void {
    const g = this.shadow.clear();
    const aiming = heldKind(state) === 'lanceur';
    for (const point of shadowPoints(state, tuning, aiming ? LAUNCH_SHADOW_SECONDS : tuning.shadowSeconds)) {
      const p = camera.worldToScreen(point);
      g.circle(p.x, p.y, aiming ? LAUNCH_SHADOW_DOT_RADIUS : SHADOW_DOT_RADIUS);
    }
    g.fill({ color: this.palette.pale, alpha: aiming ? LAUNCH_SHADOW_ALPHA : SHADOW_ALPHA });
  }

  /** Le personnage : un disque pâle, le plus lumineux du jeu, au halo de la palette plus large que celui des points. */
  private drawHero(state: SimState, camera: Camera, tuning: Tuning): void {
    const p = camera.worldToScreen(state.hero.pos);
    neonDiscs(this.hero.clear(), [p], tuning.heroRadius * camera.scale, { ...this.normalTube, spread: 1.4 });
  }

  /** Textes flottants près du personnage : ils montent un peu et s'effacent. Jamais coupés par le bord de l'écran. */
  private drawFloatingTexts(effects: Effects): void {
    const { texts } = effects;
    for (let slot = 0; slot < Math.max(this.floatLabels.length, texts.length); slot += 1) {
      const item = texts[slot];
      const label = this.floatLabel(slot);
      label.visible = item !== undefined;
      if (!item) continue;
      label.text = item.text;
      label.alpha = floatAlpha(item.age);
      const half = label.width / 2 + HUD_SIDE_MARGIN / 2;
      label.position.set(clamp(item.x, half, this.width - half), item.y - floatRise(item.age));
    }
  }

  /** Texte flottant numéro `slot` du réservoir ; il grandit seulement si plus d'effets sont à l'écran en même temps. */
  private floatLabel(slot: number): Text {
    let label = this.floatLabels[slot];
    if (!label) {
      label = makeText('', FLOAT_FONT_SIZE, COLOR.text, { bold: true, outlined: true });
      label.anchor.set(0.5, 1);
      this.floatLabels[slot] = label;
      this.floatLayer.addChild(label);
    }
    return label;
  }

  /**
   * Bannière au centre-haut, qui apparaît puis s'efface : nom et hauteur d'un
   * palier, ou, au départ d'un niveau, son titre et en dessous sa phrase d'intro.
   */
  private drawBanner(effects: Effects): void {
    const { banner } = effects;
    this.bannerText.visible = banner !== null;
    this.bannerDetail.visible = banner !== null && banner.detail !== null;
    if (!banner) return;
    const alpha = bannerAlpha(banner.age, banner.seconds);
    this.bannerText.text = banner.text;
    this.bannerText.alpha = alpha;
    if (banner.detail === null) return;
    this.bannerDetail.text = banner.detail;
    this.bannerDetail.alpha = alpha;
    this.bannerDetail.position.y = this.bannerText.y + this.bannerText.textHeight + BANNER_DETAIL_GAP;
  }

  /**
   * Hauteur en grand à gauche, multiplicateur à droite, score dessous ; seulement
   * en cours de partie, l'écran de fin redit hauteur et score. Dans un niveau,
   * la hauteur se compte depuis le toit et l'objectif la suit : « 32 / 70 m ».
   */
  private drawHud(state: SimState, frame: GameFrame, tuning: Tuning): void {
    this.hud.visible = frame.screen === 'playing';
    if (!this.hud.visible) return;
    this.testTag.visible = frame.testMode;
    this.goalText.visible = state.finishY !== null;
    if (state.finishY === null) {
      this.heightText.text = `${Math.floor(state.height)} m`;
    } else {
      this.heightText.text = String(Math.floor(shownHeight(state)));
      this.goalText.text = `/ ${state.finishY - state.groundY} m`;
      this.goalText.position.set(this.heightText.x + this.heightText.width + GOAL_GAP, this.heightText.y + this.heightText.height * 0.85);
    }
    this.multiplierText.text = `×${formatDecimal(multiplier(state.combo, tuning))}`;
    this.scoreText.text = Math.floor(state.score).toLocaleString('fr-FR');
  }

  /** Ce que les écrans posés sur le jeu doivent montrer : rien en cours de partie. */
  private drawOverlay(state: SimState, frame: GameFrame): void {
    this.screens.draw(this.overlayView(state, frame), this.width, this.height, frame.palette);
  }

  private overlayView(state: SimState, frame: GameFrame): OverlayView {
    switch (frame.screen) {
      case 'title':
        return { kind: 'title', profile: frame.profile, testMode: frame.testMode };
      case 'levels':
        return { kind: 'levels', profile: frame.profile, testMode: frame.testMode, page: frame.levelsPage };
      case 'talismans':
        return { kind: 'talismans', profile: frame.profile };
      case 'dead':
        // La fin de partie va toujours avec son bilan ; sans lui, il n'y a rien de vrai à afficher.
        if (!frame.outcome) return { kind: 'none' };
        return {
          kind: 'dead',
          height: shownHeight(state),
          goal: state.finishY === null ? null : state.finishY - state.groundY,
          score: state.score,
          cause: frame.deathCause ? DEATH_MESSAGES[frame.deathCause] : '',
          outcome: frame.outcome,
        };
      case 'won':
        // Une victoire n'existe que dans un niveau, avec son bilan et ce qui a fait ses étoiles.
        if (!frame.outcome || !('level' in frame.outcome) || !frame.result) return { kind: 'none' };
        return { kind: 'won', score: state.score, outcome: frame.outcome, result: frame.result };
      case 'playing':
        return { kind: 'none' };
    }
  }
}

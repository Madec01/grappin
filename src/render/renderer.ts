import { Application, Container, Graphics, type Text } from 'pixi.js';
import type { Vec2 } from '../core/math/vec2';
import type { LevelOutcome, Profile, RunOutcome } from '../meta/profile';
import type { LevelResult } from '../meta/traversee';
import { multiplier } from '../sim/rules';
import type { Anchor, AnchorKind, RuleEvent, SimState } from '../sim/state';
import type { Tuning } from '../sim/tuning';
import type { ButtonId, ButtonRect } from './buttons';
import type { Camera, ViewBounds } from './camera';
import { electricState, isLit } from '../sim/cycles';
import { fragileGauge, isDark, shadowPoints } from './cues';
import { alertAlpha, bannerAlpha, floatAlpha, floatRise, type Effects } from './effects';
import { formatDecimal } from './format';
import { Screens, type OverlayView } from './screens';
import { COLOR, makeText, readSafeInset, starPoints } from './style';

/**
 * Rendu PixiJS du prototype gris : formes et textes, aucun asset.
 *
 * Le rendu lit l'état de la simulation et la caméra, il ne décide rien. Toutes
 * les formes sont redessinées à chaque image à partir de coordonnées déjà
 * calculées par la caméra ; leur nombre reste de l'ordre de la cinquantaine,
 * ce qui ne coûte presque rien. Règle de lisibilité : rien de ce qui est
 * dessiné ici ne masque jamais une accroche ni un danger.
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
}

const TAU = Math.PI * 2;

/** Géométrie du monde, en mètres. */
const ALTITUDE_STEP = 10;
const ANCHOR_RADIUS = 0.25;
const TARGET_RING_RADIUS = 0.6;
const ROOF_HALF_WIDTH = 5;
const ROOF_THICKNESS = 0.4;

/** Épaisseurs de trait, en pixels CSS. */
const ROPE_WIDTH = 2;
const TARGET_RING_WIDTH = 3;
const FOG_EDGE_WIDTH = 2;
const OBSTACLE_EDGE_WIDTH = 3;
const KIND_MARK_WIDTH = 2;
const WEAR_RING_WIDTH = 3;
const CHEVRON_WIDTH = 2;
const CABLE_WIDTH = 1.5;
const WIND_WIDTH = 1.5;

/**
 * Marques des accroches spéciales, en pixels CSS. L'anneau de marque entoure
 * le disque de quatre pixels : il reste donc toujours plus petit que l'anneau
 * de visée, même très dézoomé.
 */
const KIND_RING_GAP = 4;
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
/** Propulseur : deux chevrons empilés au-dessus de l'anneau. Demi-largeur d'un chevron en mètres, au moins en pixels. */
const CHEVRON_HALF_WIDTH = 0.22;
const CHEVRON_MIN_HALF_WIDTH = 4;
const CHEVRON_COUNT = 2;
const CHEVRON_GAP = 2;

/** Panne : un point dont le lampadaire est éteint se devine à peine. */
const DARK_ALPHA = 0.12;
/** Câble : tirets et blancs en pixels, et opacité du trait. */
const CABLE_DASH = 6;
const CABLE_GAP = 5;
const CABLE_ALPHA = 0.7;
/** Coup de vent : opacité des traînées. */
const WIND_ALPHA = 0.35;

/** Étoile à quatre branches : rayon d'une pointe au moins en pixels. */
const STAR_MIN_RADIUS = 5;
/** Rayon dessiné d'une étoile, en mètres : constant, quel que soit le rayon de ramassage. */
const STAR_RADIUS = 0.35;
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
const SHADOW_ALPHA = 0.5;

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
  obstacle: "Un obstacle t'a arrêté",
  fall: 'Tombé hors de la ville',
  shock: 'Électrocuté par une prise piégée',
};

/** Hauteur à afficher : depuis le toit de départ dans un niveau, absolue en course libre. */
function shownHeight(state: SimState): number {
  return state.finishY === null ? state.height : Math.max(0, state.height - state.groundY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  private readonly multiplierText = makeText('', 30, COLOR.text, { bold: true });
  private readonly scoreText = makeText('', 20, COLOR.textDim);
  private readonly testTag = makeText('MODE TEST', 13, COLOR.textDim, { bold: true });
  private readonly bannerText = makeText('', BANNER_FONT_SIZE, COLOR.text, { bold: true, outlined: true });
  /** Seconde ligne de la bannière : sa largeur de retour à la ligne est fixée par `layout()`. */
  private readonly bannerDetail = makeText('', BANNER_DETAIL_FONT_SIZE, COLOR.text, { outlined: true, wrap: 0 });
  /** « Arrivée », petit, à droite de la ligne d'arrivée. */
  private readonly finishLabel = makeText('Arrivée', FINISH_FONT_SIZE, COLOR.finish, { bold: true });

  /** Titre, niveaux, fin de partie, victoire et talismans, par-dessus tout le reste. */
  private readonly screens = new Screens();

  /** Dimensions pour lesquelles la mise en page a été calculée. */
  private laidOutWidth = 0;
  private laidOutHeight = 0;

  private constructor(app: Application) {
    this.app = app;

    this.hud.addChild(this.heightText, this.goalText, this.multiplierText, this.scoreText, this.testTag);
    this.multiplierText.anchor.set(1, 0);
    this.testTag.anchor.set(0.5, 0);
    this.heightText.anchor.set(0, 0);
    this.goalText.anchor.set(0, 1);
    this.scoreText.anchor.set(0, 0);
    this.bannerText.anchor.set(0.5, 0);
    this.bannerDetail.anchor.set(0.5, 0);
    this.finishLabel.anchor.set(1, 1);
    this.world.addChild(
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
      background: COLOR.background,
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
    const { tuning, effects } = frame;
    const view = camera.viewBounds();
    this.world.rotation = camera.angle;
    this.drawAltitude(state, camera, view);
    this.drawWind(effects, state.env.wind.x, view);
    this.drawFinish(state, camera, view);
    this.drawObstacles(state, camera);
    this.drawPickups(state, camera, tuning);
    this.drawRoof(state, camera);
    this.drawCables(state, camera);
    this.drawAnchors(state, camera, tuning);
    this.drawTargetRing(state, camera, tuning);
    this.drawRope(state, camera, effects.ropeDrawn);
    this.drawFog(state, camera, view, effects);
    this.drawShadow(state, camera, tuning);
    this.drawHero(state, camera, tuning);
    this.drawFloatingTexts(effects);
    this.drawHud(state, frame, tuning);
    this.drawBanner(effects);
    this.drawOverlay(state, frame);
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
    this.bannerDetail.style.wordWrapWidth = width - 2 * BANNER_SIDE_MARGIN;
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
    lines.stroke({ width: 1, color: COLOR.altitudeLine });
  }

  /**
   * Ligne d'arrivée d'un niveau : pointillés clairs sur toute la largeur et
   * « Arrivée » à droite. Elle est dessinée sous les accroches et les dangers,
   * qu'elle ne masque jamais. Rien en course libre.
   */
  private drawFinish(state: SimState, camera: Camera, view: ViewBounds): void {
    const g = this.finishLine.clear();
    const y = state.finishY === null ? null : camera.worldToScreen({ x: 0, y: state.finishY }).y;
    this.finishLabel.visible = y !== null && y >= view.top && y <= view.bottom;
    if (y === null || !this.finishLabel.visible) return;
    dashedLine(g, { x: view.left, y }, { x: view.right, y }, FINISH_DASH, FINISH_GAP);
    g.stroke({ width: FINISH_WIDTH, color: COLOR.finish });
    this.finishLabel.position.set(view.right - HUD_SIDE_MARGIN / 2, y - FINISH_WIDTH - 2);
  }

  /**
   * Coup de vent : des traînées fines qui filent dans le sens du vent sur toute
   * la vue, sous les points pour n'en masquer aucun. Rien sans vent.
   */
  private drawWind(effects: Effects, windX: number, view: ViewBounds): void {
    const g = this.windStreaks.clear();
    if (windX === 0) return;
    const width = view.right - view.left;
    const height = view.bottom - view.top;
    for (const streak of effects.windStreaks) {
      const x = view.left + streak.x * width;
      const y = view.top + streak.y * height;
      const half = (streak.length * width) / 2;
      g.moveTo(x - half, y).lineTo(x + half, y);
    }
    g.stroke({ width: WIND_WIDTH, color: COLOR.wind, alpha: WIND_ALPHA, cap: 'round' });
  }

  /** Étiquette numéro `slot` du réservoir ; le réservoir grandit seulement si l'écran montre plus de lignes. */
  private altitudeLabel(slot: number): Text {
    let label = this.altitudeLabels[slot];
    if (!label) {
      label = makeText('', 12, COLOR.altitudeLabel);
      label.anchor.set(0, 1);
      this.altitudeLabels[slot] = label;
      this.altitudeLabelLayer.addChild(label);
    }
    return label;
  }

  /** Obstacles : dalles gris moyen au liseré clair sur le dessus, sous les points et la corde. */
  private drawObstacles(state: SimState, camera: Camera): void {
    const g = this.obstacles.clear();
    const scale = camera.scale;
    const boxes = state.obstacles.map((box) => {
      const topLeft = camera.worldToScreen({ x: box.x0, y: box.y1 });
      return { x: topLeft.x, y: topLeft.y, width: (box.x1 - box.x0) * scale, height: (box.y1 - box.y0) * scale };
    });
    for (const box of boxes) g.rect(box.x, box.y, box.width, box.height);
    g.fill(COLOR.obstacle);
    for (const box of boxes) g.rect(box.x, box.y, box.width, Math.min(OBSTACLE_EDGE_WIDTH, box.height));
    g.fill(COLOR.obstacleEdge);
  }

  /**
   * Étoiles de la route haute : losange concave à quatre branches, absent une
   * fois pris. L'étoile garde sa taille ; si le rayon de ramassage est plus
   * grand (talisman Aimant à étoiles), un halo discret montre la zone. Une
   * étoile de la pluie, qui tombe, laisse derrière elle une courte traînée.
   */
  private drawPickups(state: SimState, camera: Camera, tuning: Tuning): void {
    const g = this.pickups.clear();
    const outer = Math.max(STAR_RADIUS * camera.scale, STAR_MIN_RADIUS);
    const halo = tuning.pickupRadius > STAR_RADIUS + 1e-9 ? tuning.pickupRadius * camera.scale : 0;
    for (const pickup of state.pickups) {
      if (pickup.taken) continue;
      const { x, y } = camera.worldToScreen(pickup.pos);
      if (halo > 0) g.circle(x, y, halo).fill({ color: COLOR.star, alpha: 0.08 });
      g.poly(starPoints(x, y, outer)).fill(COLOR.star);
      if (!pickup.vel) continue;
      // La traînée part à l'opposé du mouvement, en pixels : le repère d'écran a son y vers le bas.
      const speed = Math.hypot(pickup.vel.x, pickup.vel.y);
      if (speed === 0) continue;
      const behind = { x: -pickup.vel.x / speed, y: pickup.vel.y / speed };
      TRAIL.forEach((dot, i) => {
        const distance = outer + TRAIL_GAP + i * TRAIL_STEP;
        g.circle(x + behind.x * distance, y + behind.y * distance, dot.radius).fill({ color: COLOR.star, alpha: dot.alpha });
      });
    }
  }

  /** Le toit de départ : dessus à la hauteur du sol de la partie, de -5 à +5 m. */
  private drawRoof(state: SimState, camera: Camera): void {
    const topLeft = camera.worldToScreen({ x: -ROOF_HALF_WIDTH, y: state.groundY });
    const scale = camera.scale;
    this.roof
      .clear()
      .rect(topLeft.x, topLeft.y, 2 * ROOF_HALF_WIDTH * scale, ROOF_THICKNESS * scale)
      .fill(COLOR.roof);
  }

  /** Câbles : un trait fin tireté sous chaque point qui glisse, de l'un à l'autre de ses bouts. Le point, lui, se dessine à sa position du moment. */
  private drawCables(state: SimState, camera: Camera): void {
    const g = this.cables.clear();
    for (const anchor of state.anchors) {
      if (!anchor.cable || anchor.broken) continue;
      dashedLine(g, camera.worldToScreen(anchor.cable.from), camera.worldToScreen(anchor.cable.to), CABLE_DASH, CABLE_GAP);
    }
    g.stroke({ width: CABLE_WIDTH, color: COLOR.cable, alpha: CABLE_ALPHA });
  }

  /**
   * Les points d'accroche. Normal : disque gris. Fragile : disque clair, anneau
   * en tirets et fissure, avec un anneau qui se vide pendant la tenue.
   * Propulseur : disque gris dans un anneau plein surmonté de chevrons. Un point
   * cassé n'est plus dessiné du tout, un point dont le lampadaire est éteint
   * (panne) se devine à peine.
   */
  private drawAnchors(state: SimState, camera: Camera, tuning: Tuning): void {
    const g = this.anchors.clear();
    const lit: Anchor[] = [];
    const dark: Anchor[] = [];
    for (const anchor of state.anchors) {
      if (anchor.broken) continue;
      // Une prise à éclipse éteinte se devine comme un lampadaire en panne.
      const off = isDark(state, anchor.id, tuning) || (anchor.kind === 'eclipse' && !isLit(anchor.id, state.step, tuning));
      (off ? dark : lit).push(anchor);
    }
    this.paintAnchors(g, camera, lit, 1, state.step, tuning);
    this.paintAnchors(g, camera, dark, DARK_ALPHA, state.step, tuning);

    const gauge = fragileGauge(state, tuning);
    if (gauge) {
      const p = camera.worldToScreen(gauge.pos);
      const wearRing = ANCHOR_RADIUS * camera.scale + KIND_RING_GAP + WEAR_RING_GAP;
      const remaining = 1 - gauge.wear;
      g.circle(p.x, p.y, wearRing).stroke({ width: WEAR_RING_WIDTH, color: COLOR.wear, alpha: WEAR_TRACK_ALPHA });
      if (remaining > 0) {
        g.moveTo(p.x, p.y - wearRing)
          .arc(p.x, p.y, wearRing, -Math.PI / 2, -Math.PI / 2 + remaining * TAU)
          .stroke({ width: WEAR_RING_WIDTH, color: COLOR.wear });
      }
    }
  }

  /** Dessine ces accroches, formes et marques de leur espèce, à l'opacité `alpha`. */
  private paintAnchors(g: Graphics, camera: Camera, anchors: readonly Anchor[], alpha: number, step: number, tuning: Tuning): void {
    const radius = ANCHOR_RADIUS * camera.scale;
    const ring = radius + KIND_RING_GAP;
    const positions = (kind: AnchorKind): Vec2[] => anchors.filter((anchor) => anchor.kind === kind).map((anchor) => camera.worldToScreen(anchor.pos));
    const fragile = positions('fragile');
    const boosters = positions('booster');

    for (const p of [...positions('normal'), ...boosters, ...positions('eclipse')]) g.circle(p.x, p.y, radius);
    g.fill({ color: COLOR.anchor, alpha });

    // Prise électrique : un point plus pâle, un anneau quand elle avertit, un anneau plein quand elle est chargée.
    for (const anchor of anchors) {
      if (anchor.kind !== 'electrique') continue;
      const p = camera.worldToScreen(anchor.pos);
      const electric = electricState(anchor.id, step, tuning);
      g.circle(p.x, p.y, radius).fill({ color: COLOR.electric, alpha });
      if (electric === 'avertit') g.circle(p.x, p.y, ring).stroke({ width: KIND_MARK_WIDTH, color: COLOR.electric, alpha: alpha * 0.6 });
      if (electric === 'chargee') g.circle(p.x, p.y, ring + 2).stroke({ width: KIND_MARK_WIDTH + 1, color: COLOR.electric, alpha });
    }
    // Prise à éclipse allumée : un anneau fin ; éteinte, elle est passée en sombre plus haut.
    for (const p of positions('eclipse')) g.circle(p.x, p.y, ring);
    g.stroke({ width: KIND_MARK_WIDTH, color: COLOR.kindMark, alpha: alpha * 0.8 });
    for (const p of fragile) g.circle(p.x, p.y, radius);
    g.fill({ color: COLOR.anchorFragile, alpha });

    for (const p of fragile) {
      for (let dash = 0; dash < DASH_COUNT; dash += 1) {
        const start = (dash / DASH_COUNT) * TAU;
        const end = start + (DASH_FILL / DASH_COUNT) * TAU;
        g.moveTo(p.x + ring * Math.cos(start), p.y + ring * Math.sin(start)).lineTo(p.x + ring * Math.cos(end), p.y + ring * Math.sin(end));
      }
    }
    g.stroke({ width: KIND_MARK_WIDTH, color: COLOR.kindMark, alpha });
    for (const p of fragile) {
      CRACK.forEach(([dx, dy], i) => {
        if (i === 0) g.moveTo(p.x + dx * radius, p.y + dy * radius);
        else g.lineTo(p.x + dx * radius, p.y + dy * radius);
      });
    }
    g.stroke({ width: Math.max(1, radius * 0.14), color: COLOR.crack, alpha });

    const halfWidth = Math.max(CHEVRON_MIN_HALF_WIDTH, CHEVRON_HALF_WIDTH * camera.scale);
    const rise = halfWidth * 0.75;
    for (const p of boosters) {
      g.circle(p.x, p.y, ring);
      for (let k = 0; k < CHEVRON_COUNT; k += 1) {
        const base = p.y - ring - CHEVRON_GAP - k * (rise + CHEVRON_GAP);
        g.moveTo(p.x - halfWidth, base).lineTo(p.x, base - rise).lineTo(p.x + halfWidth, base);
      }
    }
    g.stroke({ width: CHEVRON_WIDTH, color: COLOR.kindMark, alpha, cap: 'round', join: 'round' });
  }

  /** Anneau autour du point visé : toujours plus large que le point, même très dézoomé. Absent si le lampadaire du point est éteint : on vise de mémoire. */
  private drawTargetRing(state: SimState, camera: Camera, tuning: Tuning): void {
    const g = this.targetRing.clear();
    const target = state.anchors.find((anchor) => anchor.id === state.targetId);
    if (!target || isDark(state, target.id, tuning)) return;
    const p = camera.worldToScreen(target.pos);
    const radius = Math.max(TARGET_RING_RADIUS * camera.scale, ANCHOR_RADIUS * camera.scale + 6);
    g.circle(p.x, p.y, radius).stroke({ width: TARGET_RING_WIDTH, color: COLOR.target });
  }

  /** Le trait part du personnage et se dessine vers le point pendant les premiers centièmes de seconde. */
  private drawRope(state: SimState, camera: Camera, drawn: number): void {
    const g = this.rope.clear();
    if (!state.rope) return;
    const { anchorId } = state.rope;
    const anchor = state.anchors.find((a) => a.id === anchorId);
    if (!anchor) return;
    const from = camera.worldToScreen(state.hero.pos);
    const to = camera.worldToScreen(anchor.pos);
    const tip = { x: from.x + (to.x - from.x) * drawn, y: from.y + (to.y - from.y) * drawn };
    g.moveTo(from.x, from.y).lineTo(tip.x, tip.y).stroke({ width: ROPE_WIDTH, color: COLOR.rope });
  }

  /**
   * La brume : du niveau `fogY` jusqu'au bas de la vue, avec une ligne plus
   * claire au sommet, qui clignote tant que l'alerte accélère la brume.
   */
  private drawFog(state: SimState, camera: Camera, view: ViewBounds, effects: Effects): void {
    const g = this.fog.clear();
    const top = camera.worldToScreen({ x: 0, y: state.fogY }).y;
    if (top >= view.bottom) return;
    const visibleTop = Math.max(view.top, top);
    g.rect(view.left, visibleTop, view.right - view.left, view.bottom - visibleTop).fill({ color: COLOR.fog, alpha: 0.55 });
    if (top < view.top) return;
    const alpha = state.fogFactor > 1 ? alertAlpha(effects.clock) : 1;
    g.moveTo(view.left, top).lineTo(view.right, top).stroke({ width: FOG_EDGE_WIDTH, color: COLOR.fogEdge, alpha });
  }

  /** Ombre prédictive : quelques points discrets qui montrent où irait le personnage s'il lâchait maintenant. */
  private drawShadow(state: SimState, camera: Camera, tuning: Tuning): void {
    const g = this.shadow.clear();
    for (const point of shadowPoints(state, tuning)) {
      const p = camera.worldToScreen(point);
      g.circle(p.x, p.y, SHADOW_DOT_RADIUS);
    }
    g.fill({ color: COLOR.shadow, alpha: SHADOW_ALPHA });
  }

  private drawHero(state: SimState, camera: Camera, tuning: Tuning): void {
    const p = camera.worldToScreen(state.hero.pos);
    this.hero.clear().circle(p.x, p.y, tuning.heroRadius * camera.scale).fill(COLOR.hero);
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
    this.bannerDetail.position.y = this.bannerText.y + this.bannerText.height + BANNER_DETAIL_GAP;
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
    this.screens.draw(this.overlayView(state, frame), this.width, this.height);
  }

  private overlayView(state: SimState, frame: GameFrame): OverlayView {
    switch (frame.screen) {
      case 'title':
        return { kind: 'title', profile: frame.profile, testMode: frame.testMode };
      case 'levels':
        return { kind: 'levels', profile: frame.profile, testMode: frame.testMode };
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

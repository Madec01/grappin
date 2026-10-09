import { Application, Container, Graphics, Text } from 'pixi.js';
import type { Vec2 } from '../core/math/vec2';
import { multiplier } from '../sim/rules';
import type { AnchorKind, RuleEvent, SimState } from '../sim/state';
import type { Tuning } from '../sim/tuning';
import type { Camera } from './camera';
import { fragileGauge, shadowPoints } from './cues';
import { bannerAlpha, floatAlpha, floatRise, type Effects } from './effects';
import { formatDecimal } from './format';

/**
 * Rendu PixiJS du prototype gris : formes et textes, aucun asset.
 *
 * Le rendu lit l'état de la simulation et la caméra, il ne décide rien. Toutes
 * les formes sont redessinées à chaque image à partir de coordonnées d'écran
 * déjà calculées par la caméra ; leur nombre reste de l'ordre de la
 * cinquantaine, ce qui ne coûte presque rien. Règle de lisibilité : rien de ce
 * qui est dessiné ici ne masque jamais une accroche ni un danger.
 */

/** Écran du jeu à habiller : le rendu ne sait que l'afficher, c'est le jeu qui le choisit. */
export type GameScreen = 'title' | 'playing' | 'dead';

/** Ce qui a tué le personnage. */
export type DeathCause = Extract<RuleEvent, { type: 'death' }>['cause'];

/** Ce que le jeu ajoute à l'état de la simulation pour un dessin : l'écran à montrer, la cause de la mort et les effets de temps réel. */
export interface GameFrame {
  readonly screen: GameScreen;
  readonly deathCause: DeathCause | null;
  readonly effects: Effects;
}

const COLOR = {
  background: '#0b0f1e',
  altitudeLine: 0x1c2542,
  altitudeLabel: 0x6f7a96,
  roof: 0x58627a,
  obstacle: 0x3a4360,
  obstacleEdge: 0x8a94a6,
  anchor: 0x8a94a6,
  anchorFragile: 0xc9d1e3,
  crack: 0x0b0f1e,
  kindMark: 0xc9d1e3,
  wear: 0xf4f6fb,
  target: 0xe8eefc,
  rope: 0xc9d1e3,
  shadow: 0xc9d1e3,
  star: 0xf4f6fb,
  fog: 0x5b6b9a,
  fogEdge: 0xa9b8e6,
  hero: 0xf4f6fb,
  text: 0xf4f6fb,
  textDim: 0xb4bdd2,
  textOutline: 0x0b0f1e,
  shade: 0x0b0f1e,
} as const;

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

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

/** Étoile à quatre branches : rayon d'une pointe au moins en pixels, creux à cette part du rayon. */
const STAR_MIN_RADIUS = 5;
const STAR_PINCH = 0.28;

/** Ombre prédictive : rayon d'un point en pixels, opacité. */
const SHADOW_DOT_RADIUS = 1.8;
const SHADOW_ALPHA = 0.5;

/** Mise en page de l'interface, en pixels CSS. */
const HUD_SIDE_MARGIN = 16;
const HUD_MIN_TOP = 24;
const HUD_SAFE_GAP = 16;
const HEIGHT_FONT_SIZE = 44;
const OVERLAY_GAP = 18;
/** La bannière de palier, centrée, sous l'interface : distance sous le haut de l'interface. */
const BANNER_OFFSET = 88;
const FLOAT_FONT_SIZE = 20;
const BANNER_FONT_SIZE = 24;
const OUTLINE_WIDTH = 4;

const DEATH_MESSAGES: Record<DeathCause, string> = {
  fog: "La brume t'a rattrapé",
  obstacle: "Un obstacle t'a arrêté",
};

function makeText(text: string, size: number, color: number, weight: 'normal' | 'bold' = 'normal', outlined = false): Text {
  return new Text({
    text,
    style: {
      fontFamily: FONT,
      fontSize: size,
      fontWeight: weight,
      fill: color,
      align: 'center',
      // Les textes qui flottent sur le décor gardent un contour sombre : lisibles sur toutes les formes.
      ...(outlined ? { stroke: { color: COLOR.textOutline, width: OUTLINE_WIDTH, join: 'round' as const } } : {}),
    },
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Hauteur de l'encoche en pixels CSS, exposée par index.html dans `--safe-top`. */
function readSafeTop(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--safe-top');
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

/** Empile des textes centrés, séparés par `OVERLAY_GAP`, autour du centre de l'écran. */
function stackCentered(lines: readonly Text[], width: number, height: number): void {
  const total = lines.reduce((sum, line) => sum + line.height, 0) + OVERLAY_GAP * (lines.length - 1);
  let y = (height - total) / 2;
  for (const line of lines) {
    line.anchor.set(0.5, 0);
    line.position.set(width / 2, y);
    y += line.height + OVERLAY_GAP;
  }
}

export class Renderer {
  private readonly app: Application;
  private readonly tuning: Tuning;

  // Couches, du fond vers l'avant. L'ordre d'ajout à la scène dans le constructeur fait foi.
  private readonly altitudeLines = new Graphics();
  private readonly altitudeLabelLayer = new Container();
  private readonly obstacles = new Graphics();
  private readonly pickups = new Graphics();
  private readonly roof = new Graphics();
  private readonly anchors = new Graphics();
  private readonly targetRing = new Graphics();
  private readonly rope = new Graphics();
  private readonly fog = new Graphics();
  private readonly shadow = new Graphics();
  private readonly hero = new Graphics();
  private readonly floatLayer = new Container();

  private readonly altitudeLabels: Text[] = [];
  private readonly floatLabels: Text[] = [];

  private readonly hud = new Container();
  private readonly heightText = makeText('', HEIGHT_FONT_SIZE, COLOR.text, 'bold');
  private readonly multiplierText = makeText('', 30, COLOR.text, 'bold');
  private readonly scoreText = makeText('', 20, COLOR.textDim);
  private readonly bannerText = makeText('', BANNER_FONT_SIZE, COLOR.text, 'bold', true);

  private readonly shade = new Graphics();
  private readonly titleScreen = new Container();
  private readonly titleLines = [
    makeText('GRAPPIN', 56, COLOR.text, 'bold'),
    makeText('Toucher pour jouer', 24, COLOR.textDim),
  ];
  private readonly deadScreen = new Container();
  private readonly deadHeadline = makeText('', 38, COLOR.text, 'bold');
  private readonly deadCause = makeText('', 22, COLOR.textDim);
  private readonly deadScore = makeText('', 26, COLOR.text);
  private readonly deadLines = [
    this.deadHeadline,
    this.deadCause,
    this.deadScore,
    makeText('Toucher pour rejouer', 24, COLOR.textDim),
  ];

  /** Dimensions pour lesquelles la mise en page a été calculée. */
  private laidOutWidth = 0;
  private laidOutHeight = 0;

  private constructor(app: Application, tuning: Tuning) {
    this.app = app;
    this.tuning = tuning;

    this.hud.addChild(this.heightText, this.multiplierText, this.scoreText);
    this.multiplierText.anchor.set(1, 0);
    this.heightText.anchor.set(0, 0);
    this.scoreText.anchor.set(0, 0);
    this.bannerText.anchor.set(0.5, 0);
    this.titleScreen.addChild(...this.titleLines);
    this.deadScreen.addChild(...this.deadLines);
    app.stage.addChild(
      this.altitudeLines,
      this.altitudeLabelLayer,
      this.obstacles,
      this.pickups,
      this.roof,
      this.anchors,
      this.targetRing,
      this.rope,
      this.fog,
      this.shadow,
      this.hero,
      this.floatLayer,
      this.hud,
      this.bannerText,
      this.shade,
      this.titleScreen,
      this.deadScreen,
    );
  }

  /** Démarre PixiJS et attache son canvas à la page. Échoue si WebGL est indisponible. */
  static async create(tuning: Tuning): Promise<Renderer> {
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
    return new Renderer(app, tuning);
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

  /** Met la scène à jour pour l'état donné ; PixiJS la rend juste après. */
  draw(state: SimState, camera: Camera, frame: GameFrame): void {
    if (this.width !== this.laidOutWidth || this.height !== this.laidOutHeight) this.layout();
    this.drawAltitude(camera);
    this.drawObstacles(state, camera);
    this.drawPickups(state, camera);
    this.drawRoof(camera);
    this.drawAnchors(state, camera);
    this.drawTargetRing(state, camera);
    this.drawRope(state, camera, frame.effects.ropeDrawn);
    this.drawFog(state, camera);
    this.drawShadow(state, camera);
    this.drawHero(state, camera);
    this.drawFloatingTexts(frame.effects);
    this.drawHud(state, frame.screen);
    this.drawBanner(frame.effects);
    this.drawOverlay(state, frame);
  }

  /** Positions qui ne dépendent que de la taille de l'écran. */
  private layout(): void {
    const { width, height } = this;
    this.laidOutWidth = width;
    this.laidOutHeight = height;

    const top = Math.max(HUD_MIN_TOP, readSafeTop() + HUD_SAFE_GAP);
    this.heightText.position.set(HUD_SIDE_MARGIN, top);
    this.multiplierText.position.set(width - HUD_SIDE_MARGIN, top + 8);
    this.scoreText.position.set(HUD_SIDE_MARGIN, top + HEIGHT_FONT_SIZE * 1.2);
    this.bannerText.position.set(width / 2, top + BANNER_OFFSET);

    this.shade.clear().rect(0, 0, width, height).fill({ color: COLOR.shade, alpha: 0.62 });
    stackCentered(this.titleLines, width, height);
    stackCentered(this.deadLines, width, height);
  }

  /** Lignes fines tous les 10 m, avec leur altitude en petit texte à gauche. */
  private drawAltitude(camera: Camera): void {
    const lines = this.altitudeLines.clear();
    const first = Math.max(1, Math.ceil(camera.worldYAt(this.height) / ALTITUDE_STEP));
    const last = Math.floor(camera.worldYAt(0) / ALTITUDE_STEP);

    for (let slot = 0; slot < Math.max(this.altitudeLabels.length, last - first + 1); slot += 1) {
      const level = first + slot;
      const label = this.altitudeLabel(slot);
      label.visible = level <= last;
      if (!label.visible) continue;
      const y = camera.worldToScreen({ x: 0, y: level * ALTITUDE_STEP }).y;
      lines.moveTo(0, y).lineTo(this.width, y);
      label.text = `${level * ALTITUDE_STEP} m`;
      label.position.set(HUD_SIDE_MARGIN / 2, y - 2);
    }
    lines.stroke({ width: 1, color: COLOR.altitudeLine });
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

  /** Étoiles de la route haute : losange concave à quatre branches, absent une fois pris. */
  private drawPickups(state: SimState, camera: Camera): void {
    const g = this.pickups.clear();
    const outer = Math.max(this.tuning.pickupRadius * camera.scale, STAR_MIN_RADIUS);
    const inner = outer * STAR_PINCH;
    for (const pickup of state.pickups) {
      if (pickup.taken) continue;
      const { x, y } = camera.worldToScreen(pickup.pos);
      g.poly([x, y - outer, x + inner, y - inner, x + outer, y, x + inner, y + inner, x, y + outer, x - inner, y + inner, x - outer, y, x - inner, y - inner]);
    }
    g.fill(COLOR.star);
  }

  /** Le toit de départ : dessus en y = 0, de -5 à +5 m. */
  private drawRoof(camera: Camera): void {
    const topLeft = camera.worldToScreen({ x: -ROOF_HALF_WIDTH, y: 0 });
    const scale = camera.scale;
    this.roof
      .clear()
      .rect(topLeft.x, topLeft.y, 2 * ROOF_HALF_WIDTH * scale, ROOF_THICKNESS * scale)
      .fill(COLOR.roof);
  }

  /**
   * Les points d'accroche. Normal : disque gris. Fragile : disque clair, anneau
   * en tirets et fissure, avec un anneau qui se vide pendant la tenue.
   * Propulseur : disque gris dans un anneau plein surmonté de chevrons. Un point
   * cassé n'est plus dessiné du tout.
   */
  private drawAnchors(state: SimState, camera: Camera): void {
    const radius = ANCHOR_RADIUS * camera.scale;
    const ring = radius + KIND_RING_GAP;
    const g = this.anchors.clear();
    const positions = (kind: AnchorKind): Vec2[] =>
      state.anchors.filter((anchor) => anchor.kind === kind && !anchor.broken).map((anchor) => camera.worldToScreen(anchor.pos));
    const fragile = positions('fragile');
    const boosters = positions('booster');

    for (const p of [...positions('normal'), ...boosters]) g.circle(p.x, p.y, radius);
    g.fill(COLOR.anchor);
    for (const p of fragile) g.circle(p.x, p.y, radius);
    g.fill(COLOR.anchorFragile);

    for (const p of fragile) {
      for (let dash = 0; dash < DASH_COUNT; dash += 1) {
        const start = (dash / DASH_COUNT) * TAU;
        const end = start + (DASH_FILL / DASH_COUNT) * TAU;
        g.moveTo(p.x + ring * Math.cos(start), p.y + ring * Math.sin(start)).lineTo(p.x + ring * Math.cos(end), p.y + ring * Math.sin(end));
      }
    }
    g.stroke({ width: KIND_MARK_WIDTH, color: COLOR.kindMark });
    for (const p of fragile) {
      CRACK.forEach(([dx, dy], i) => {
        if (i === 0) g.moveTo(p.x + dx * radius, p.y + dy * radius);
        else g.lineTo(p.x + dx * radius, p.y + dy * radius);
      });
    }
    g.stroke({ width: Math.max(1, radius * 0.14), color: COLOR.crack });

    const halfWidth = Math.max(CHEVRON_MIN_HALF_WIDTH, CHEVRON_HALF_WIDTH * camera.scale);
    const rise = halfWidth * 0.75;
    for (const p of boosters) {
      g.circle(p.x, p.y, ring);
      for (let k = 0; k < CHEVRON_COUNT; k += 1) {
        const base = p.y - ring - CHEVRON_GAP - k * (rise + CHEVRON_GAP);
        g.moveTo(p.x - halfWidth, base).lineTo(p.x, base - rise).lineTo(p.x + halfWidth, base);
      }
    }
    g.stroke({ width: CHEVRON_WIDTH, color: COLOR.kindMark, cap: 'round', join: 'round' });

    const gauge = fragileGauge(state, this.tuning);
    if (gauge) {
      const p = camera.worldToScreen(gauge.pos);
      const wearRing = ring + WEAR_RING_GAP;
      const remaining = 1 - gauge.wear;
      g.circle(p.x, p.y, wearRing).stroke({ width: WEAR_RING_WIDTH, color: COLOR.wear, alpha: WEAR_TRACK_ALPHA });
      if (remaining > 0) {
        g.moveTo(p.x, p.y - wearRing)
          .arc(p.x, p.y, wearRing, -Math.PI / 2, -Math.PI / 2 + remaining * TAU)
          .stroke({ width: WEAR_RING_WIDTH, color: COLOR.wear });
      }
    }
  }

  /** Anneau autour du point visé : toujours plus large que le point, même très dézoomé. */
  private drawTargetRing(state: SimState, camera: Camera): void {
    const g = this.targetRing.clear();
    const target = state.anchors.find((anchor) => anchor.id === state.targetId);
    if (!target) return;
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

  /** La brume : du niveau `fogY` jusqu'au bas de l'écran, avec une ligne plus claire au sommet. */
  private drawFog(state: SimState, camera: Camera): void {
    const g = this.fog.clear();
    const top = camera.worldToScreen({ x: 0, y: state.fogY }).y;
    if (top >= this.height) return;
    const visibleTop = Math.max(0, top);
    g.rect(0, visibleTop, this.width, this.height - visibleTop).fill({ color: COLOR.fog, alpha: 0.55 });
    if (top >= 0) g.moveTo(0, top).lineTo(this.width, top).stroke({ width: FOG_EDGE_WIDTH, color: COLOR.fogEdge });
  }

  /** Ombre prédictive : quelques points discrets qui montrent où irait le personnage s'il lâchait maintenant. */
  private drawShadow(state: SimState, camera: Camera): void {
    const g = this.shadow.clear();
    for (const point of shadowPoints(state, this.tuning)) {
      const p = camera.worldToScreen(point);
      g.circle(p.x, p.y, SHADOW_DOT_RADIUS);
    }
    g.fill({ color: COLOR.shadow, alpha: SHADOW_ALPHA });
  }

  private drawHero(state: SimState, camera: Camera): void {
    const p = camera.worldToScreen(state.hero.pos);
    this.hero.clear().circle(p.x, p.y, this.tuning.heroRadius * camera.scale).fill(COLOR.hero);
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
      label = makeText('', FLOAT_FONT_SIZE, COLOR.text, 'bold', true);
      label.anchor.set(0.5, 1);
      this.floatLabels[slot] = label;
      this.floatLayer.addChild(label);
    }
    return label;
  }

  /** Bannière de palier : nom et hauteur, au centre-haut, qui apparaît puis s'efface. */
  private drawBanner(effects: Effects): void {
    const { banner } = effects;
    this.bannerText.visible = banner !== null;
    if (!banner) return;
    this.bannerText.text = banner.text;
    this.bannerText.alpha = bannerAlpha(banner.age);
  }

  /** Hauteur en grand à gauche, multiplicateur à droite, score dessous ; absents sur l'écran titre. */
  private drawHud(state: SimState, screen: GameScreen): void {
    this.hud.visible = screen !== 'title';
    if (!this.hud.visible) return;
    this.heightText.text = `${Math.floor(state.height)} m`;
    this.multiplierText.text = `×${formatDecimal(multiplier(state.combo, this.tuning))}`;
    this.scoreText.text = Math.floor(state.score).toLocaleString('fr-FR');
  }

  /** Voile et texte centré de l'écran titre ou de l'écran de fin ; rien en cours de partie. */
  private drawOverlay(state: SimState, frame: GameFrame): void {
    this.shade.visible = frame.screen !== 'playing';
    this.titleScreen.visible = frame.screen === 'title';
    this.deadScreen.visible = frame.screen === 'dead';
    if (frame.screen !== 'dead') return;

    const headline = `Perdu à ${Math.floor(state.height)} m`;
    const cause = frame.deathCause ? DEATH_MESSAGES[frame.deathCause] : '';
    const score = `Score ${Math.floor(state.score).toLocaleString('fr-FR')}`;
    // L'état est figé après la mort : on ne remet en page que si le texte a changé.
    if (this.deadHeadline.text === headline && this.deadCause.text === cause && this.deadScore.text === score) return;
    this.deadHeadline.text = headline;
    this.deadCause.text = cause;
    this.deadScore.text = score;
    stackCentered(this.deadLines, this.width, this.height);
  }
}

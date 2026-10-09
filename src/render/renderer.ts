import { Application, Container, Graphics, Text } from 'pixi.js';
import { multiplier } from '../sim/rules';
import type { SimState } from '../sim/state';
import type { Tuning } from '../sim/tuning';
import type { Camera } from './camera';

/**
 * Rendu PixiJS du prototype gris : formes et textes, aucun asset.
 *
 * Le rendu lit l'état de la simulation et la caméra, il ne décide rien. Toutes
 * les formes sont redessinées à chaque image à partir de coordonnées d'écran
 * déjà calculées par la caméra ; leur nombre reste de l'ordre de la
 * cinquantaine, ce qui ne coûte presque rien.
 */

/** Écran du jeu à habiller : le rendu ne sait que l'afficher, c'est le jeu qui le choisit. */
export type GameScreen = 'title' | 'playing' | 'dead';

const COLOR = {
  background: '#0b0f1e',
  altitudeLine: 0x1c2542,
  altitudeLabel: 0x6f7a96,
  roof: 0x58627a,
  anchor: 0x8a94a6,
  target: 0xe8eefc,
  rope: 0xc9d1e3,
  fog: 0x5b6b9a,
  fogEdge: 0xa9b8e6,
  hero: 0xf4f6fb,
  text: 0xf4f6fb,
  textDim: 0xb4bdd2,
  shade: 0x0b0f1e,
} as const;

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

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

/** Mise en page de l'interface, en pixels CSS. */
const HUD_SIDE_MARGIN = 16;
const HUD_MIN_TOP = 24;
const HUD_SAFE_GAP = 16;
const HEIGHT_FONT_SIZE = 44;
const OVERLAY_GAP = 18;

function makeText(text: string, size: number, color: number, weight: 'normal' | 'bold' = 'normal'): Text {
  return new Text({
    text,
    style: { fontFamily: FONT, fontSize: size, fontWeight: weight, fill: color, align: 'center' },
  });
}

/** Nombre à la française : virgule décimale, deux décimales au plus, sans zéros inutiles. */
function formatDecimal(value: number): string {
  return String(Number(value.toFixed(2))).replace('.', ',');
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
  private readonly roof = new Graphics();
  private readonly anchors = new Graphics();
  private readonly targetRing = new Graphics();
  private readonly rope = new Graphics();
  private readonly fog = new Graphics();
  private readonly hero = new Graphics();

  private readonly altitudeLabels: Text[] = [];

  private readonly hud = new Container();
  private readonly heightText = makeText('', HEIGHT_FONT_SIZE, COLOR.text, 'bold');
  private readonly multiplierText = makeText('', 30, COLOR.text, 'bold');
  private readonly scoreText = makeText('', 20, COLOR.textDim);

  private readonly shade = new Graphics();
  private readonly titleScreen = new Container();
  private readonly titleLines = [
    makeText('GRAPPIN', 56, COLOR.text, 'bold'),
    makeText('Toucher pour jouer', 24, COLOR.textDim),
  ];
  private readonly deadScreen = new Container();
  private readonly deadHeadline = makeText('', 38, COLOR.text, 'bold');
  private readonly deadScore = makeText('', 26, COLOR.text);
  private readonly deadLines = [
    this.deadHeadline,
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
    this.titleScreen.addChild(...this.titleLines);
    this.deadScreen.addChild(...this.deadLines);
    app.stage.addChild(
      this.altitudeLines,
      this.altitudeLabelLayer,
      this.roof,
      this.anchors,
      this.targetRing,
      this.rope,
      this.fog,
      this.hero,
      this.hud,
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

  /**
   * Met la scène à jour pour l'état donné ; PixiJS la rend juste après.
   * `ropeDrawn` est la part du trait du grappin déjà dessinée, de 0 à 1.
   */
  draw(state: SimState, camera: Camera, screen: GameScreen, ropeDrawn = 1): void {
    if (this.width !== this.laidOutWidth || this.height !== this.laidOutHeight) this.layout();
    this.drawAltitude(camera);
    this.drawRoof(camera);
    this.drawAnchors(state, camera);
    this.drawTargetRing(state, camera);
    this.drawRope(state, camera, ropeDrawn);
    this.drawFog(state, camera);
    this.drawHero(state, camera);
    this.drawHud(state, screen);
    this.drawOverlay(state, screen);
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

  /** Le toit de départ : dessus en y = 0, de -5 à +5 m. */
  private drawRoof(camera: Camera): void {
    const topLeft = camera.worldToScreen({ x: -ROOF_HALF_WIDTH, y: 0 });
    const scale = camera.scale;
    this.roof
      .clear()
      .rect(topLeft.x, topLeft.y, 2 * ROOF_HALF_WIDTH * scale, ROOF_THICKNESS * scale)
      .fill(COLOR.roof);
  }

  private drawAnchors(state: SimState, camera: Camera): void {
    const radius = ANCHOR_RADIUS * camera.scale;
    const g = this.anchors.clear();
    for (const anchor of state.anchors) {
      const p = camera.worldToScreen(anchor.pos);
      g.circle(p.x, p.y, radius);
    }
    g.fill(COLOR.anchor);
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

  private drawHero(state: SimState, camera: Camera): void {
    const p = camera.worldToScreen(state.hero.pos);
    this.hero.clear().circle(p.x, p.y, this.tuning.heroRadius * camera.scale).fill(COLOR.hero);
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
  private drawOverlay(state: SimState, screen: GameScreen): void {
    this.shade.visible = screen !== 'playing';
    this.titleScreen.visible = screen === 'title';
    this.deadScreen.visible = screen === 'dead';
    if (screen !== 'dead') return;

    const headline = `Perdu à ${Math.floor(state.height)} m`;
    const score = `Score ${Math.floor(state.score).toLocaleString('fr-FR')}`;
    // L'état est figé après la mort : on ne remet en page que si le texte a changé.
    if (this.deadHeadline.text === headline && this.deadScore.text === score) return;
    this.deadHeadline.text = headline;
    this.deadScore.text = score;
    stackCentered(this.deadLines, this.width, this.height);
  }
}

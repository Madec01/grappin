import { Application, Container, Graphics, type Text } from 'pixi.js';
import { SILENT_PULSE, type Pulse } from '../audio/rhythm';
import type { Vec2 } from '../core/math/vec2';
import type { LevelOutcome, Profile, RunOutcome } from '../meta/profile';
import type { LevelResult } from '../meta/traversee';
import { PULL_MAX } from '../sim/launcher';
import { obstacleKind } from '../sim/obstacles';
import { ZONE_RAMP, zoneAt } from '../sim/physics';
import { RING_CENTRE_RATIO, WORLD_HALF_WIDTH, canSmash, multiplier } from '../sim/rules';
import type { Anchor, AnchorKind, Obstacle, RuleEvent, SimState, Zone } from '../sim/state';
import type { Tuning } from '../sim/tuning';
import { pauseRect, type ButtonId, type ButtonRect } from './buttons';
import type { Camera, ViewBounds } from './camera';
import { bandsInView, cityBand } from './city';
import { electricState, type ElectricState } from '../sim/cycles';
import { fragileGauge, heldKind, inReleaseWindow, isDark, isOff, shadowPoints } from './cues';
import { alertAlpha, bannerAlpha, boostStreaks, flashAlpha, flashRadius, flicker, floatAlpha, floatRise, pulse, sizzle, type Banner, type Effects, type Flash } from './effects';
import { formatDecimal } from './format';
import { neonCircle, neonDiscs, neonFill, neonLine, neonRects, neonStroke, type NeonStrokeStyle } from './neon';
import { LAMP_COUNT, ambientHalo, cityLots, cityStroke, fogSheetAlpha, lampColor, lampOf, multiplierPop, pulsedPalette, rimBoost, speciesGlow, starSparkle, uiGlow, type HaloBoost } from './pulse';
import { Screens, type OverlayView } from './screens';
import { SKIN, crackPattern, doorLook, ringPhase, springTeeth, type Crack, type DoorLook } from './skins';
import { bandWidth, cupRadius, cupTips, mixColor, pullRatio, traceCup } from './sling';
import { COLOR, GlowText, PALETTES, makeText, readSafeInset, starPoints, type Palette } from './style';
import {
  CHEVRON_FADE,
  STREAK_TIERS,
  ZONE_CORE,
  ZONE_INSIDE_BOOST,
  ZONE_TONE,
  brakeLine,
  brakeLineCount,
  buildKit,
  chevronAlong,
  chevronCount,
  chevronShape,
  clipBox,
  edgeFade,
  frameBox,
  frameBreadth,
  frameLength,
  framePoint,
  levelOf,
  makeFrame,
  placeFrame,
  streakSpan,
  waveLight,
  type BrakeLine,
  type Box,
  type Point,
  type Span,
  type StreakKind,
  type ZoneFrame,
  type ZoneKit,
} from './zones';

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
 * le décor de structures abstraites est le plus discret des tracés, dessous tout le reste.
 *
 * Deux sortes de couleurs : le langage du jeu (espèces de prises, étoiles,
 * obstacles, bords de la zone jouable), fixe dans `COLOR`, et l'ambiance, que la
 * palette de l'image donne et qui change avec la musique (voir palette.ts).
 * Rien d'ambiant n'est figé à la construction : les dessins relisent la palette
 * à chaque image, et les textes que la palette teinte n'ont qu'une teinte à
 * changer, jamais un nouveau tracé.
 *
 * Le pouls de la musique (pulse.ts) pulse par-dessus : la palette de l'image est
 * celle de la famille, plongée dans le pouls. Il ne change que des intensités
 * et des teintes, jamais une forme, une taille ni une position, ni la couleur
 * d'une espèce de prise ; au silence, chaque facteur vaut 1 et chaque ajout 0,
 * et le rendu est celui d'avant.
 *
 * Les obstacles à comportement du lot 2 gardent la masse sombre des obstacles solides, chacun dans sa teinte et avec son signe, pour se
 * reconnaître d'un coup d'œil : la surface de rebond (contour double et ressort, orchidée), la paroi cassable (fissures, braise, qui
 * s'allume quand le personnage va assez vite pour la traverser), la porte (contour tireté ouvert, jauge qui se remplit, clignotement
 * avant la fermeture, masse pleine fermée, indigo). L'anneau de précision est un cercle fin vert vif, son centre marqué. Tout ce qui
 * s'anime se lit du pas de simulation (cycle d'une porte), de l'état (vitesse, traversée en cours) ou du numéro de l'obstacle
 * (fissures) : jamais de l'horloge de l'écran, pour que chaque capture soit reproductible. Les obstacles solides, eux, sont dessinés
 * exactement comme avant. Un rebond, un fracas ou un anneau laisse aussi un éclat bref au personnage, et un anneau traversé, qui accélère, quelques traits de vitesse derrière lui (voir `effects.ts`).
 *
 * Les zones qui modifient le mouvement (courant ascendant, dérive, couloir d'accélération, freinage) se dessinent comme des champs de
 * lumière plus que comme des objets, sous les obstacles et les anneaux, au-dessus du décor : un remplissage à peine visible, et dedans des
 * traits qui disent la direction, chaque espèce avec son motif et sa teinte (voir `zones.ts`). Le courant ascendant : des traînées qui montent
 * à trois vitesses et des flèches sur ses bords. La dérive : des traînées horizontales qui filent dans le sens de la poussée, seulement dans sa
 * bande, et un liseré net en haut et en bas (c'est lui qui la distingue du vent, dont les traînées couvrent tout l'écran). Le couloir
 * d'accélération : des chevrons serrés qui défilent vite, un contour net, une sortie barrée d'un trait lumineux et de chevrons qui s'ouvrent.
 * Le freinage : de fines bandes pâles, lentes, qui se resserrent vers le haut, rien qui pousse. Le défilement lit l'horloge des effets
 * (temps réel), comme les traînées du vent : purement visuel. Dans une zone, le personnage allume ses traits d'un cran.
 *
 * Deux aides du tutoriel se dessinent ici, discrètement. La fenêtre de lâcher
 * (`inReleaseWindow`) : tant que lâcher serait parfait, la corde et le halo du
 * personnage prennent la teinte chaude de `COLOR.release`, un cran plus lumineux,
 * et les points de l'ombre s'allument ; un état, pas une animation, et hors
 * fenêtre le rendu est exactement celui d'avant. Un conseil (bannière
 * `tone: 'tip'`) se dit plus bas et plus doucement qu'une annonce : texte pâle,
 * plus petit, sans halo.
 *
 * Tout le décor vit dans un conteneur, `world`, que la bascule fait tourner
 * autour du centre de l'écran : on y dessine donc en coordonnées de la caméra,
 * sur le rectangle `ViewBounds` qui déborde de l'écran quand le monde est de
 * travers. L'interface, les textes flottants, la bannière et les écrans restent
 * à l'écran, hors du conteneur.
 */

/** Écran du jeu à habiller : le rendu ne sait que l'afficher, c'est le jeu qui le choisit. */
export type GameScreen = 'title' | 'levels' | 'playing' | 'paused' | 'dead' | 'won' | 'talismans';

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
  /** Le pouls de la musique à cet instant ; `SILENT_PULSE` quand rien ne joue ou que le rythme de la piste est inconnu. */
  readonly pulse: Pulse;
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

/**
 * Obstacles à comportement (lot 2). Tous gardent la masse sombre et le contour néon des obstacles solides, chacun dans sa teinte (voir
 * `COLOR.bounce`, `smash`, `door`) et avec son signe propre. Épaisseurs en pixels CSS, opacités de 0 à 1, intensités de halo relatives
 * à celle du cerne des obstacles (`this.rim`).
 *
 * Surface de rebond : un second contour, plus fin, à l'intérieur du premier, et un ressort en zigzag au milieu. En dessous de
 * `BOUNCE_MIN_THICKNESS` pixels d'épaisseur (très dézoomé), elle n'a plus la place que du contour simple et du ressort.
 */
const BOUNCE_INNER_WIDTH = 1;
const BOUNCE_INNER_ALPHA = 0.55;
const BOUNCE_INSET_RATIO = 0.22;
const BOUNCE_INSET_MIN = 2;
const BOUNCE_INSET_MAX = 3.5;
const BOUNCE_MIN_THICKNESS = 8;
const SPRING_WIDTH = 1.5;
/** Le ressort laisse cet espace aux contours et aux extrémités, en pixels ; en dessous de cette amplitude il n'est plus dessiné. */
const SPRING_MARGIN = 1.5;
const SPRING_MIN_AMPLITUDE = 1.2;
/** Paroi cassable : le contour et les fissures d'une braise qui couve (trop lent : solide), puis allumés (assez vite pour la traverser). */
const SMASH_DIM_ALPHA = 0.7;
const SMASH_DIM_HALO = 0.35;
const SMASH_LIT_HALO = 1.1;
const CRACK_DIM_WIDTH = 1.5;
const CRACK_DIM_ALPHA = 0.85;
const CRACK_HOT_WIDTH = 2;
const CRACK_HOT_HALO = 0.7;
/** On garde en mémoire le motif de fissures de tant de parois à la fois ; au-delà, on les recalcule (il ne coûte qu'un bruit déterministe). */
const CRACK_CACHE_MAX = 64;
/** Porte : tirets du contour ouvert, opacité de ce contour, de la part remplie (la jauge) et de la masse fantôme d'une porte qui laisse passer. */
const DOOR_DASH = 7;
const DOOR_GAP = 5;
const DOOR_OPEN_ALPHA = 0.8;
const DOOR_DASH_WIDTH = 2;
/** Le contour tireté n'a pas de halo (celui de chaque tiret se confondrait en une herse de lueurs) ; le trait de front de la jauge, un peu. */
const DOOR_OPEN_HALO = 0.3;
const DOOR_FILL_ALPHA = 0.3;
const DOOR_FRONT_WIDTH = 2;
const DOOR_GHOST_ALPHA = 0.15;
/** Porte fermée : la jauge d'ouverture est une barre claire, en retrait de ce nombre de pixels du contour, et son opacité. */
const DOOR_BAR_INSET = 3;
const DOOR_BAR_ALPHA = 0.5;
/** Porte qui avertit : le clignotement fait varier ces grandeurs (plancher et plafond) du contour, de son halo et de la masse. */
const DOOR_WARN_ALPHA_MIN = 0.55;
const DOOR_WARN_HALO_MIN = 0.5;
const DOOR_WARN_HALO_MAX = 1.8;
const DOOR_WARN_FILL_MIN = 0.25;
const DOOR_WARN_FILL_MAX = 0.5;

/**
 * Anneau de précision : un cercle fin au rayon de l'anneau, et à l'intérieur le cercle du centre (`RING_CENTRE_RATIO`) qui dit où
 * viser, avec un point au milieu. Plus fin et plus grand que l'anneau de visée, d'une autre teinte. Traversé, il s'éclaire (le
 * centre aussi si le passage est près du centre), puis ne laisse que la trace d'un néon coupé.
 */
const RING_WIDTH = 2;
const RING_ACTIVE_WIDTH = 3;
const RING_INNER_WIDTH = 1.25;
const RING_INNER_ALPHA = 0.6;
const RING_DOT_RADIUS = 2.2;
const RING_HALO = 0.8;
const RING_ACTIVE_HALO = 1.8;
const RING_TRACE_WIDTH = 1.5;

/**
 * Zones qui modifient le mouvement. Épaisseurs en pixels CSS, opacités de 0 à 1, longueurs en mètres (elles suivent le zoom), intensités de
 * halo relatives à celle du tube ordinaire. Un remplissage très pâle (plus pâle à moins d'une rampe du bord, là où la poussée monte
 * en douceur : `ZONE_RAMP`), des traits qui défilent dedans, et un contour dont la netteté dit l'espèce : très discret pour un courant,
 * franc pour un couloir, tireté pour le freinage.
 */
const ZONE_FILL_EDGE = 0.035;
const ZONE_FILL_CORE = 0.085;
/** La rampe d'un courant se dessine en trois marches concentriques : la poussée monte en douceur vers l'intérieur. */
const ZONE_RAMP_STEPS = 3;
/** Contour très discret d'un courant ascendant. */
const UPDRAFT_OUTLINE_WIDTH = 1;
const UPDRAFT_OUTLINE_ALPHA = 0.4;
/** Halo des traînées les plus vives. */
const STREAK_HALO = 0.5;
/**
 * Flèches fixes d'un courant, que la lumière parcourt dans le sens de la poussée : opacité par niveau de lumière (du plus éteint au plus vif),
 * épaisseur, tours de la vague par seconde, halo du niveau le plus vif, et rapport de la profondeur de la pointe à la demi-largeur.
 */
const ARROW_ALPHAS: readonly number[] = [0.25, 0.55, 0.95];
const ARROW_WIDTH = 1.75;
const ARROW_HZ = 0.5;
const ARROW_HALO = 0.5;
const ARROW_DEPTH_RATIO = 1;
/** Courant ascendant : une flèche tous les 1,6 m sur chacun de ses bords, à 0,3 m du bord ; demi-largeur 0,13 m, au moins 3,5 pixels. */
const UPDRAFT_ARROW_SPACING = 1.6;
const UPDRAFT_ARROW_INSET = 0.3;
const UPDRAFT_ARROW_HALF = 0.17;
const UPDRAFT_ARROW_MIN_HALF = 4.5;
/** Dérive : une rangée de flèches au milieu de la bande, plus grandes ; liseré net sur les deux bords longs, et petits traits en travers à ses extrémités. */
const DRIFT_ARROW_SPACING = 1.6;
const DRIFT_ARROW_HALF = 0.2;
const DRIFT_ARROW_MIN_HALF = 4.5;
const DRIFT_EDGE_WIDTH = 2;
const DRIFT_EDGE_ALPHA = 0.85;
const DRIFT_EDGE_HALO = 0.6;
const DRIFT_CAP_ALPHA = 0.4;
/** Couloir d'accélération : le remplissage s'allume vers la sortie (quatre bandes), le contour est net, les chevrons ont quatre niveaux d'opacité (fondus aux deux bouts). */
const ROCKET_BANDS = 4;
const ROCKET_FILL_LOW = 0.035;
const ROCKET_FILL_HIGH = 0.11;
const ROCKET_EDGE_WIDTH = 1.75;
const ROCKET_EDGE_ALPHA = 0.9;
const ROCKET_EDGE_HALO = 0.6;
const ROCKET_CHEVRON_ALPHAS: readonly number[] = [0.12, 0.35, 0.65, 1];
const ROCKET_CHEVRON_WIDTH = 2;
const ROCKET_CHEVRON_HALO = 0.7;
const ROCKET_CHEVRON_INSET = 0.2;
const ROCKET_CHEVRON_DEPTH = 0.3;
/** La sortie du couloir : un trait épais et lumineux, et deux bras qui s'ouvrent au-delà, de chaque coin vers l'extérieur (longueur le long de la poussée et écart en travers, en mètres). */
const ROCKET_EXIT_WIDTH = 3;
const ROCKET_EXIT_HALO = 1.1;
const ROCKET_FLARE_RISE = 0.5;
const ROCKET_FLARE_OPEN = 0.45;
const ROCKET_FLARE_WIDTH = 2.25;
const ROCKET_FLARE_ALPHA = 0.85;
/** Freinage : le remplissage s'épaissit vers le haut (quatre bandes), contour tireté, fines bandes à trois niveaux d'opacité, en retrait des bords. */
const BRAKE_BANDS = 4;
const BRAKE_FILL_LOW = 0.025;
const BRAKE_FILL_HIGH = 0.085;
const BRAKE_OUTLINE_WIDTH = 1;
const BRAKE_OUTLINE_ALPHA = 0.4;
const BRAKE_DASH = 4;
const BRAKE_GAP = 5;
const BRAKE_LINE_ALPHAS: readonly number[] = [0.18, 0.38, 0.62];
const BRAKE_LINE_WIDTH = 1;
const BRAKE_LINE_INSET = 4;

/**
 * Éclats (rebond, fracas, anneau) : cercle qui s'élargit en s'effaçant à l'endroit du personnage. Épaisseur du trait, halo, et pour un fracas
 * les huit éclats qui partent en étoile, de quelle part du rayon et sur quelle longueur.
 */
const FLASH_WIDTH = 2.5;
const FLASH_HALO = 1.2;
const FLASH_SHARDS = 8;
const FLASH_SHARD_START = 0.55;
const FLASH_CENTRE_RATIO = 0.6;

/** Traits de vitesse d'un anneau traversé (voir `boostStreaks`) : épaisseur et halo, plus discrets qu'un éclat. */
const BOOST_WIDTH = 2.2;
const BOOST_HALO = 0.8;

/** Ombre prédictive : rayon d'un point en pixels, opacité. */
const SHADOW_DOT_RADIUS = 1.8;
const SHADOW_ALPHA = 0.55;
/** Tenu à un lanceur, l'ombre est la visée elle-même : plus longue (secondes de vol), plus grosse et plus nette. */
const LAUNCH_SHADOW_SECONDS = 0.6;
const LAUNCH_SHADOW_DOT_RADIUS = 2.6;
const LAUNCH_SHADOW_ALPHA = 0.9;
/**
 * Fenêtre de lâcher (voir `inReleaseWindow`) : un état, pas une animation. La corde et le halo du personnage passent à la teinte chaude de
 * `COLOR.release`, un peu plus lumineux (même taille, même forme), et les points de l'ombre s'allument d'un cran, de la même teinte.
 */
const READY_STRENGTH = 1.35;
const READY_SHADOW_ALPHA = 0.9;

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

/** Structures abstraites du décor : elles défilent à cette part de la vitesse du monde (de la profondeur), et s'éclaircissent vers l'avant : opacité par rang. */
const CITY_PARALLAX = 0.6;
const CITY_ROW_ALPHA: readonly number[] = [1, 0.8, 0.6];
/** Bords de la zone jouable : le néon rouge sombre est discret, et une très légère teinte rougit l'extérieur. */
const EDGE_STRENGTH = 0.7;
const EDGE_TINT_ALPHA = 0.05;

/**
 * Bouton de pause : deux barres de tube, centrées dans leur zone de toucher
 * (voir `pauseRect`). Largeur du trait, hauteur d'une barre et écart de leurs
 * axes, en pixels CSS ; et l'espace laissé entre la zone et le multiplicateur.
 */
const PAUSE_BAR_WIDTH = 4;
const PAUSE_BAR_HEIGHT = 20;
const PAUSE_BAR_STEP = 13;
const PAUSE_MULTIPLIER_GAP = 6;

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
/**
 * Un conseil du tutoriel (bannière `tone: 'tip'`) se dit plus doucement qu'une annonce : plus petit, en texte pâle sans halo, et posé sous
 * le personnage, à cette part de la hauteur de l'écran. Le personnage reste entre 45 % et 70 % de la hauteur et les prises à venir sont au-dessus
 * de lui : dessous, il n'y a que le toit et la brume, rien à cacher.
 */
const TIP_FONT_SIZE = 17;
const TIP_DETAIL_FONT_SIZE = 14;
const TIP_DETAIL_GAP = 3;
const TIP_TOP_RATIO = 0.75;
const TIP_ALPHA = 0.92;
/** Objectif d'un niveau à côté de la hauteur, plus petit. */
const GOAL_FONT_SIZE = 22;
const GOAL_GAP = 8;

const DEATH_MESSAGES: Record<DeathCause, string> = {
  fog: "La brume t'a rattrapé",
  fall: 'Tombé dans le vide',
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
/** Corde et halo du personnage dans la fenêtre de lâcher : la même teinte chaude sur toutes les ambiances. */
const READY_TUBE: Tube = { color: COLOR.release, halo: COLOR.releaseHalo };
/** Dans quel groupe tombe une prise électrique selon son cycle. */
const ELECTRIC_GROUP: Record<ElectricState, 'calm' | 'warning' | 'charged'> = { calme: 'calm', avertit: 'warning', chargee: 'charged' };
const KINDS: readonly AnchorKind[] = ['normal', 'fragile', 'booster', 'electrique', 'eclipse', 'lanceur'];

/** Un point à l'écran, avec le numéro de l'accroche : le grésillement le décale d'une prise à l'autre. */
interface Spot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** Un obstacle visible, en pixels de l'écran (coin haut gauche), avec l'obstacle de la simulation dont il vient. Réutilisé d'une image à l'autre. */
interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
  source: Obstacle;
}

/** Les obstacles visibles rangés par espèce, pour dessiner chaque espèce d'un seul lot. Réutilisé d'une image à l'autre. */
interface ObstacleLots {
  readonly solid: ScreenBox[];
  readonly bounce: ScreenBox[];
  readonly smash: ScreenBox[];
  readonly door: ScreenBox[];
}

/** Un anneau de précision visible : son centre et son rayon, en pixels. */
interface RingSpot {
  x: number;
  y: number;
  radius: number;
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

/**
 * Ce que le dessin d'une zone a besoin de savoir de l'image : le repère de la zone à l'écran, la vue, l'échelle, l'horloge des effets,
 * l'intensité (un cran de plus quand le personnage y est), ses dimensions en pixels, ses teintes et ce qu'on retient d'elle. Un seul
 * objet, réécrit pour chaque zone.
 */
interface ZonePaint {
  frame: ZoneFrame;
  view: ViewBounds;
  scale: number;
  clock: number;
  vivid: number;
  length: number;
  breadth: number;
  tone: number;
  core: number;
  kit: ZoneKit;
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
  private readonly zoneField = new Graphics();
  private readonly finishLine = new Graphics();
  private readonly rings = new Graphics();
  private readonly obstacles = new Graphics();
  private readonly pickups = new Graphics();
  private readonly roof = new Graphics();
  private readonly cables = new Graphics();
  private readonly anchors = new Graphics();
  private readonly targetRing = new Graphics();
  private readonly rope = new Graphics();
  private readonly fog = new Graphics();
  private readonly shadow = new Graphics();
  private readonly boostLines = new Graphics();
  private readonly hero = new Graphics();

  // Par-dessus le décor, à l'écran.
  private readonly flashLayer = new Graphics();
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
  /** Le bouton de pause : le halo, que l'accent de la palette teinte, sous le cœur des deux barres. Tracés une fois par taille d'écran. */
  private readonly pauseIcon = new Container();
  private readonly pauseHalo = new Graphics();
  private readonly pauseCore = new Graphics();
  /** Sa zone de toucher, et vrai tant qu'elle est montrée, c'est-à-dire pendant la partie seulement. */
  private pauseZone: ButtonRect = pauseRect(0, 0);
  private pauseShown = false;
  /** La bannière : texte blanc au léger halo de l'accent, qui change rarement (un palier, un événement), si bien que le flou ne coûte presque rien. */
  private readonly bannerText = new GlowText('', BANNER_FONT_SIZE, COLOR.text, PALETTES.menu.accent, { bold: true, outlined: true });
  /** Seconde ligne de la bannière : sa largeur de retour à la ligne est fixée par `layout()`. */
  private readonly bannerDetail = new GlowText('', BANNER_DETAIL_FONT_SIZE, COLOR.text, PALETTES.menu.accent, { outlined: true, wrap: 0 });
  /** Un conseil du tutoriel : deux lignes de texte pâle, sans halo, au contour sombre. Seconde ligne : sa largeur de retour à la ligne est fixée par `layout()`. */
  private readonly tipText = makeText('', TIP_FONT_SIZE, COLOR.textDim, { bold: true, outlined: true });
  private readonly tipDetail = makeText('', TIP_DETAIL_FONT_SIZE, COLOR.textDim, { outlined: true, wrap: 0 });
  /** « Arrivée », petit, à droite de la ligne d'arrivée, au halo du tube. */
  private readonly finishLabel = new GlowText('Arrivée', FINISH_FONT_SIZE, COLOR.hot, PALETTES.menu.halo, { bold: true });

  /** L'ambiance de la dernière image, plongée dans le pouls. Les tubes et les teintes qui en dépendent sont rafraîchis quand elle change. */
  private palette: Palette = PALETTES.menu;
  /** La palette de la famille, avant le pouls : les lots du décor en partent, chacun sous sa lampe. */
  private basePalette: Palette = PALETTES.menu;
  /** La couleur de chaque lampe à cette image (`lampColor`) : les halos des points normaux, chacun sous la sienne. */
  private lampHalos: readonly number[] = [PALETTES.menu.halo, PALETTES.menu.halo, PALETTES.menu.halo];
  /** Le halo des titres et de la bannière de la dernière image : l'accent, ou la couleur d'effet quand la musique bat. */
  private glow: number = PALETTES.menu.accent;
  /** Le pouls de la dernière image, et ce qu'il fait aux halos : tubes ambiants, espèces de prises, cerne des obstacles. */
  private pulse: Pulse = SILENT_PULSE;
  private halo: HaloBoost = ambientHalo(SILENT_PULSE);
  private species = speciesGlow(SILENT_PULSE);
  private rim = rimBoost(SILENT_PULSE);
  /** Tube du point normal : cœur et halo (couleur d'effet) de la palette. */
  private normalTube: Tube = { color: PALETTES.menu.tube, halo: PALETTES.menu.halo };

  /** Titre, niveaux, fin de partie, victoire, talismans et pause, par-dessus tout le reste. */
  private readonly screens = new Screens();

  /** Dimensions pour lesquelles la mise en page a été calculée. */
  private laidOutWidth = 0;
  private laidOutHeight = 0;

  /** Anneau de visée : le point qu'il entoure et l'instant, sur l'horloge des effets, où il s'est allumé. Du dessin seulement. */
  private litTarget: number | null = null;
  private litSince = 0;

  /** Réservoirs des obstacles et des anneaux visibles, vidés et remplis à chaque image : pas d'allocation par image une fois chauffés. */
  private readonly boxPool: ScreenBox[] = [];
  private readonly obstacleLots: ObstacleLots = { solid: [], bounce: [], smash: [], door: [] };
  private readonly ringPool: RingSpot[] = [];
  private readonly ringLots: Record<'libre' | 'traverse' | 'centre' | 'prise', RingSpot[]> = { libre: [], traverse: [], centre: [], prise: [] };
  /** Motif de fissures de chaque paroi cassable rencontrée, par numéro d'obstacle. */
  private readonly crackCache = new Map<number, Crack[]>();
  /** Ce que le rendu retient de chaque zone (sens, dimensions, traînées), par zone : il s'oublie avec elle. Et les objets de travail de leur dessin, réutilisés d'une image à l'autre. */
  private readonly zoneKits = new WeakMap<Zone, ZoneKit>();
  private readonly zonePaint: ZonePaint = {
    frame: makeFrame(),
    view: { left: 0, right: 0, top: 0, bottom: 0 },
    scale: 1,
    clock: 0,
    vivid: 1,
    length: 0,
    breadth: 0,
    tone: 0,
    core: 0,
    kit: buildKit({ id: 0, kind: 'ascendant', dir: { x: 0, y: 1 }, x0: 0, y0: 0, x1: 1, y1: 1 }),
  };
  private readonly zoneBox: Box = { x: 0, y: 0, width: 0, height: 0 };
  private readonly zoneSpan: Span = { from: 0, to: 0 };
  private readonly zoneLine: BrakeLine = { along: 0, light: 0 };
  private readonly zoneFrom: Point = { x: 0, y: 0 };
  private readonly zoneTo: Point = { x: 0, y: 0 };
  private readonly zoneChevron: readonly [Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];

  private constructor(app: Application) {
    this.app = app;

    this.tintTexts();
    this.pauseIcon.addChild(this.pauseHalo, this.pauseCore);
    this.hud.addChild(this.heightText, this.goalText, this.multiplierText, this.scoreText, this.testTag, this.pauseIcon);
    this.multiplierText.anchor.set(1, 0);
    this.testTag.anchor.set(0.5, 0);
    this.heightText.anchor.set(0, 0);
    this.goalText.anchor.set(0, 1);
    this.scoreText.anchor.set(0, 0);
    this.bannerText.anchorAt(0.5, 0);
    this.bannerDetail.anchorAt(0.5, 0);
    this.tipText.anchor.set(0.5, 0);
    this.tipDetail.anchor.set(0.5, 0);
    this.finishLabel.anchorAt(1, 1);
    this.world.addChild(
      this.city,
      this.cityEdges,
      this.altitudeLines,
      this.altitudeLabelLayer,
      this.windStreaks,
      this.zoneField,
      this.finishLine,
      this.finishLabel,
      this.rings,
      this.obstacles,
      this.pickups,
      this.roof,
      this.cables,
      this.anchors,
      this.targetRing,
      this.rope,
      this.fog,
      this.shadow,
      this.boostLines,
      this.hero,
    );
    app.stage.addChild(
      this.world,
      this.flashLayer,
      this.floatLayer,
      this.hud,
      this.bannerText,
      this.bannerDetail,
      this.tipText,
      this.tipDetail,
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

  /** Boutons de l'écran affiché, en pixels CSS : ceux que la dernière image a dessinés. Pendant la partie, le seul bouton est celui de la pause. */
  buttons(): readonly ButtonRect[] {
    return this.pauseShown ? [this.pauseZone] : this.screens.buttons();
  }

  /** Le bouton ou la ligne de talisman sous un point de l'écran, en pixels CSS, pour l'écran courant ; null ailleurs. */
  hitTest(x: number, y: number): ButtonId | null {
    if (!this.pauseShown) return this.screens.hitTest(x, y);
    const zone = this.pauseZone;
    return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height ? zone.id : null;
  }

  /** Met la scène à jour pour l'état donné ; PixiJS la rend juste après. */
  draw(state: SimState, camera: Camera, frame: GameFrame): void {
    if (this.width !== this.laidOutWidth || this.height !== this.laidOutHeight) this.layout();
    this.applyPalette(frame.palette, frame.pulse);
    const { tuning, effects } = frame;
    const view = camera.viewBounds();
    this.world.rotation = camera.angle;
    this.drawCity(camera, view);
    this.drawCityEdges(camera, view);
    this.drawAltitude(state, camera, view);
    this.drawWind(effects, state.env.wind.x, view);
    this.drawZones(state, camera, view, effects);
    this.drawFinish(state, camera, view);
    this.drawRings(state, camera, view);
    this.drawObstacles(state, camera, view, tuning);
    this.drawPickups(state, camera, view, tuning, effects);
    this.drawRoof(state, camera);
    this.drawCables(state, camera);
    this.drawAnchors(state, camera, view, tuning, effects);
    this.drawTargetRing(state, camera, tuning, effects);
    // La fenêtre de lâcher ne se montre que pendant la partie (et sous le voile de la pause, qui fige l'image) : jamais sur un écran de fin.
    const ready = (frame.screen === 'playing' || frame.screen === 'paused') && inReleaseWindow(state, tuning);
    this.drawRope(state, camera, tuning, effects, ready);
    this.drawFog(state, camera, view, effects);
    this.drawShadow(state, camera, tuning, ready);
    this.drawBoostLines(state, camera, tuning, effects);
    this.drawHero(state, camera, tuning, ready);
    this.drawFlashes(effects);
    this.drawFloatingTexts(effects);
    this.drawHud(state, frame, tuning);
    this.drawBanner(effects);
    this.drawOverlay(state, frame);
  }

  /**
   * Prend l'ambiance de l'image : la palette de la famille de musique, plongée
   * dans le pouls (voir pulse.ts), et ce que le pouls fait aux halos. Les dessins
   * relisent la palette d'eux-mêmes à chaque image ; ici, seulement ce qui vit
   * d'une image à l'autre : le fond de la scène et les teintes des textes. Une
   * teinte se change sans retracer le texte, même à chaque image d'un fondu. Au
   * silence, la palette du pouls est celle de la famille elle-même : une palette
   * identique à la précédente ne coûte rien.
   */
  private applyPalette(base: Palette, pulse: Pulse): void {
    this.pulse = pulse;
    this.halo = ambientHalo(pulse);
    this.species = speciesGlow(pulse);
    this.rim = rimBoost(pulse);
    const palette = pulsedPalette(base, pulse);
    const glow = uiGlow(base, pulse);
    this.basePalette = base;
    this.lampHalos = Array.from({ length: LAMP_COUNT }, (_, lamp) => lampColor(base, pulse, lamp));
    if (palette === this.palette && glow === this.glow) return;
    this.palette = palette;
    this.glow = glow;
    this.app.renderer.background.color = palette.background;
    this.normalTube = { color: palette.tube, halo: palette.halo };
    this.tintTexts();
  }

  /** Teintes des textes qui suivent la palette. */
  private tintTexts(): void {
    const { accent, halo, altitudeLabel } = this.palette;
    this.multiplierText.tint = accent;
    this.pauseHalo.tint = accent;
    this.bannerText.glow = this.glow;
    this.bannerDetail.glow = this.glow;
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
    this.pauseZone = pauseRect(width, top);
    this.drawPauseIcon(this.pauseZone);
    this.heightText.position.set(HUD_SIDE_MARGIN, top);
    // Le multiplicateur se tient à gauche du bouton de pause, qui a le coin.
    this.multiplierText.position.set(this.pauseZone.x - PAUSE_MULTIPLIER_GAP, top + 8);
    this.scoreText.position.set(HUD_SIDE_MARGIN, top + HEIGHT_FONT_SIZE * 1.2);
    this.testTag.position.set(width / 2, top);
    this.bannerText.position.set(width / 2, top + BANNER_OFFSET);
    this.bannerDetail.position.x = width / 2;
    this.bannerDetail.wrapWidth = width - 2 * BANNER_SIDE_MARGIN;
    this.tipText.position.set(width / 2, Math.round(height * TIP_TOP_RATIO));
    this.tipDetail.position.x = width / 2;
    this.tipDetail.style.wordWrapWidth = width - 2 * BANNER_SIDE_MARGIN;
  }

  /** Les deux barres du bouton de pause, au centre de sa zone : tracées une fois, quand la taille de l'écran change. */
  private drawPauseIcon(zone: ButtonRect): void {
    const centerX = zone.x + zone.width / 2;
    const centerY = zone.y + zone.height / 2;
    const bars = [-1, 1].map((side) => ({ x: centerX + (side * PAUSE_BAR_STEP) / 2, top: centerY - PAUSE_BAR_HEIGHT / 2, bottom: centerY + PAUSE_BAR_HEIGHT / 2 }));
    const tube = { color: COLOR.hot, halo: COLOR.white, width: PAUSE_BAR_WIDTH, cap: 'round' as const, spread: MARK_SPREAD };
    this.pauseHalo.clear();
    this.pauseCore.clear();
    for (const bar of bars) {
      neonLine(this.pauseHalo, { x: bar.x, y: bar.top }, { x: bar.x, y: bar.bottom }, { ...tube, pass: 'halo' });
      neonLine(this.pauseCore, { x: bar.x, y: bar.top }, { x: bar.x, y: bar.bottom }, { ...tube, pass: 'core' });
    }
  }

  /**
   * Structures abstraites : colonnes, cadres ouverts et rails en contour très
   * fin, sur les côtés, hors de la largeur jouable, tout au fond. Elles défilent
   * un peu moins vite que le monde pour la profondeur, d'après la hauteur seule :
   * le décor est le même à chaque partie (voir city.ts). Sur le temps, elles
   * dansent : celles d'index pair s'allument sur les temps pairs, les impaires
   * sur les autres, en deux lots de couleur par rang au plus ; sans temps, un seul ;
   * et leurs traits s'épaississent et s'opacifient sur le coup (`cityStroke`).
   */
  private drawCity(camera: Camera, view: ViewBounds): void {
    const g = this.city.clear();
    // Dans le repère du décor lointain, l'ordonnée `y` s'affiche là où le monde afficherait `y` plus ce décalage.
    const shift = (1 - CITY_PARALLAX) * camera.centerY;
    const { first, last } = bandsInView(camera.worldYAt(view.bottom) - shift, camera.worldYAt(view.top) - shift);
    const lots = cityLots(this.basePalette, this.pulse);
    // Sur le temps, les traits s'épaississent et s'opacifient : le seul endroit où le pouls touche une épaisseur, un décor, jamais une cible.
    const stroke = cityStroke(this.pulse);
    // Par rang, puis par lot de couleur : sans danse, tout est dans le premier lot, comme avant.
    const rows: Vec2[][][][] = CITY_ROW_ALPHA.map(() => [[], []]);
    for (let band = first; band <= last; band += 1) {
      cityBand(band).forEach((structure, index) => {
        const lot = lots === null ? 0 : (band + index) & 1;
        for (const line of structure.lines) {
          const drawn = line.map((point) => camera.worldToScreen({ x: point.x, y: point.y + shift }));
          // Hors de la vue de côté (les rangs lointains n'y entrent que caméra dézoomée), on ne trace rien.
          if (drawn.every((point) => point.x < view.left) || drawn.every((point) => point.x > view.right)) continue;
          rows[structure.row]?.[lot]?.push(drawn);
        }
      });
    }
    rows.forEach((lotLines, row) => {
      lotLines.forEach((lines, lot) => {
        if (lines.length === 0) return;
        for (const line of lines) {
          line.forEach((point, index) => (index === 0 ? g.moveTo(point.x, point.y) : g.lineTo(point.x, point.y)));
        }
        g.stroke({ width: CITY_WIDTH * stroke.width, color: lots?.[lot] ?? this.palette.city, alpha: Math.min(1, (CITY_ROW_ALPHA[row] ?? 1) * stroke.alpha), join: 'round' });
      });
    });
  }

  /**
   * Les bords de la zone jouable, à ± `WORLD_HALF_WIDTH` : deux traits verticaux de
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
    neonStroke(g, (target) => dashedLine(target, { x: view.left, y }, { x: view.right, y }, FINISH_DASH, FINISH_GAP), { color: this.palette.tube, halo: this.palette.halo, width: FINISH_WIDTH, spread: this.halo.spread, strength: this.halo.strength });
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

  /**
   * Zones qui modifient le mouvement : un seul tracé pour toutes, sous les obstacles et les anneaux. Chaque zone se dessine dans son
   * propre repère (voir `zones.ts`), rogné à ce que l'écran montre. Les zones hors de la vue ne coûtent rien. Le défilement lit l'horloge
   * des effets ; la zone où se trouve le personnage allume ses traits d'un cran.
   */
  private drawZones(state: SimState, camera: Camera, view: ViewBounds, effects: Effects): void {
    const g = this.zoneField.clear();
    if (state.zones.length === 0) return;
    const inside = zoneAt(state.zones, state.hero.pos);
    const scale = camera.scale;
    const p = this.zonePaint;
    p.view = view;
    p.scale = scale;
    p.clock = effects.clock;
    for (const zone of state.zones) {
      const topLeft = camera.worldToScreen({ x: zone.x0, y: zone.y1 });
      const width = (zone.x1 - zone.x0) * scale;
      const height = (zone.y1 - zone.y0) * scale;
      // Hors de la vue, ni le tracé ni son halo ne servent.
      if (topLeft.x + width < view.left - CULL_MARGIN || topLeft.x > view.right + CULL_MARGIN || topLeft.y + height < view.top - CULL_MARGIN || topLeft.y > view.bottom + CULL_MARGIN) continue;
      const kit = this.kitOf(zone);
      p.kit = kit;
      p.frame = placeFrame(p.frame, topLeft.x, topLeft.y, width, height, kit.flow);
      p.length = frameLength(p.frame);
      p.breadth = frameBreadth(p.frame);
      p.vivid = zone === inside ? ZONE_INSIDE_BOOST : 1;
      p.tone = ZONE_TONE[zone.kind];
      p.core = ZONE_CORE[zone.kind];
      switch (zone.kind) {
        case 'ascendant':
          this.paintUpdraft(g, p);
          break;
        case 'lateral':
          this.paintDrift(g, p);
          break;
        case 'acceleration':
          this.paintRocket(g, p);
          break;
        case 'freinage':
          this.paintBrake(g, p);
          break;
      }
    }
  }

  /** Ce que le rendu retient de la zone (sens, dimensions, traînées) : calculé une fois, tant que la zone existe. */
  private kitOf(zone: Zone): ZoneKit {
    let kit = this.zoneKits.get(zone);
    if (!kit) {
      kit = buildKit(zone);
      this.zoneKits.set(zone, kit);
    }
    return kit;
  }

  /** Remplit, d'une teinte très pâle, la bande de la zone entre `from` et `to` le long de sa poussée et `left` et `right` en travers, rognée à la vue. */
  private fillBand(g: Graphics, p: ZonePaint, from: number, to: number, left: number, right: number, alpha: number): void {
    const box = frameBox(p.frame, from, to, left, right, this.zoneBox);
    if (!clipBox(box, p.view, box)) return;
    g.rect(box.x, box.y, box.width, box.height).fill({ color: p.tone, alpha: Math.min(1, alpha * p.vivid) });
  }

  /** Remplissage d'un courant : très pâle, un peu plus franc à plus d'une rampe des bords, là où la poussée est pleine (voir `zoneAcceleration`). */
  private fillRamped(g: Graphics, p: ZonePaint): void {
    const ramp = Math.min(ZONE_RAMP * p.scale, p.breadth / 2, p.length / 2);
    this.fillBand(g, p, 0, p.length, 0, p.breadth, ZONE_FILL_EDGE);
    for (let step = 1; step <= ZONE_RAMP_STEPS; step += 1) {
      const inset = (ramp * step) / ZONE_RAMP_STEPS;
      this.fillBand(g, p, inset, p.length - inset, inset, p.breadth - inset, (ZONE_FILL_CORE - ZONE_FILL_EDGE) / ZONE_RAMP_STEPS);
    }
  }

  /** Ajoute au tracé le segment de la zone à la position `across` en travers, d'un bout à l'autre de sa poussée. */
  private traceLine(target: Graphics, p: ZonePaint, across: number): void {
    framePoint(p.frame, 0, across, this.zoneFrom);
    framePoint(p.frame, p.length, across, this.zoneTo);
    target.moveTo(this.zoneFrom.x, this.zoneFrom.y).lineTo(this.zoneTo.x, this.zoneTo.y);
  }

  /** Ajoute au tracé le segment en travers de la zone, à la distance `along` de son entrée. */
  private traceCross(target: Graphics, p: ZonePaint, along: number): void {
    framePoint(p.frame, along, 0, this.zoneFrom);
    framePoint(p.frame, along, p.breadth, this.zoneTo);
    target.moveTo(this.zoneFrom.x, this.zoneFrom.y).lineTo(this.zoneTo.x, this.zoneTo.y);
  }

  /** Ajoute au tracé le chevron de centre (`along`, `across`), pointe dans le sens de la poussée. */
  private traceChevron(target: Graphics, p: ZonePaint, along: number, across: number, depth: number, half: number): void {
    const points = this.zoneChevron;
    chevronShape(p.frame, along, across, depth, half, points);
    target.moveTo(points[0].x, points[0].y).lineTo(points[1].x, points[1].y).lineTo(points[2].x, points[2].y);
  }

  /** Traînées d'un courant, rang par rang : chaque rang a sa vitesse, sa longueur, son épaisseur ; le plus vif a un halo. Rognées aux limites de la zone. */
  private paintStreaks(g: Graphics, p: ZonePaint, kind: StreakKind): void {
    STREAK_TIERS[kind].forEach((tier, index) => {
      neonStroke(
        g,
        (target) => {
          for (const mote of p.kit.motes) {
            if (mote.tier !== index || !streakSpan(mote, tier, p.clock, p.kit.lengthMeters, this.zoneSpan)) continue;
            const across = mote.lane * p.breadth;
            framePoint(p.frame, this.zoneSpan.from * p.length, across, this.zoneFrom);
            framePoint(p.frame, this.zoneSpan.to * p.length, across, this.zoneTo);
            target.moveTo(this.zoneFrom.x, this.zoneFrom.y).lineTo(this.zoneTo.x, this.zoneTo.y);
          }
        },
        { color: tier.glow ? p.core : p.tone, halo: p.tone, width: tier.width, alpha: Math.min(1, tier.alpha * p.vivid), strength: tier.glow ? STREAK_HALO * this.species : 0, cap: 'round' },
      );
    });
  }

  /**
   * Flèches fixes, en une ou deux rangées le long de la poussée, que la lumière parcourt dans son sens (voir `waveLight`) : la direction se
   * lit même quand rien ne défile. `rows` à 1 : une rangée au milieu ; à 2 : une sur chaque bord, à `inset` pixels.
   */
  private paintArrows(g: Graphics, p: ZonePaint, rows: 1 | 2, inset: number, spacingMeters: number, halfMeters: number, minHalf: number): void {
    const count = Math.max(2, Math.round(p.kit.lengthMeters / spacingMeters));
    const step = p.length / count;
    const half = Math.max(minHalf, halfMeters * p.scale);
    const levels = ARROW_ALPHAS.length;
    ARROW_ALPHAS.forEach((alpha, level) => {
      neonStroke(
        g,
        (target) => {
          for (let row = 0; row < rows; row += 1) {
            const across = rows === 1 ? p.breadth / 2 : row === 0 ? inset : p.breadth - inset;
            for (let i = 0; i < count; i += 1) {
              if (levelOf(waveLight(i, count, p.clock, ARROW_HZ), levels) === level) this.traceChevron(target, p, (i + 0.5) * step, across, half * ARROW_DEPTH_RATIO, half);
            }
          }
        },
        { color: p.core, halo: p.tone, width: ARROW_WIDTH, alpha: Math.min(1, alpha * p.vivid), strength: level === levels - 1 ? ARROW_HALO * this.species : 0, cap: 'round', join: 'round' },
      );
    });
  }

  /**
   * Courant ascendant : une colonne à peine teintée au contour très discret, des traînées qui montent à trois vitesses (elles bouclent en
   * haut et renaissent en bas) et, sur chaque bord, des flèches vers le haut que la lumière parcourt de bas en haut.
   */
  private paintUpdraft(g: Graphics, p: ZonePaint): void {
    this.fillRamped(g, p);
    const box = frameBox(p.frame, 0, p.length, 0, p.breadth, this.zoneBox);
    g.rect(box.x, box.y, box.width, box.height).stroke({ width: UPDRAFT_OUTLINE_WIDTH, color: p.tone, alpha: Math.min(1, UPDRAFT_OUTLINE_ALPHA * p.vivid) });
    this.paintStreaks(g, p, 'ascendant');
    this.paintArrows(g, p, 2, Math.min(UPDRAFT_ARROW_INSET * p.scale, p.breadth * 0.2), UPDRAFT_ARROW_SPACING, UPDRAFT_ARROW_HALF, UPDRAFT_ARROW_MIN_HALF);
  }

  /**
   * Dérive : une bande dont les limites se voient (un liseré net en haut et en bas, un petit trait à chaque bout), des traînées plus
   * longues et plus rapides que celles du vent, seulement dans la bande, et une rangée de flèches qui pointent dans le sens de la
   * poussée. C'est la bande, pas l'écran entier, qui file : ce n'est pas le vent.
   */
  private paintDrift(g: Graphics, p: ZonePaint): void {
    this.fillRamped(g, p);
    this.paintStreaks(g, p, 'lateral');
    this.paintArrows(g, p, 1, 0, DRIFT_ARROW_SPACING, DRIFT_ARROW_HALF, DRIFT_ARROW_MIN_HALF);
    const edge = { color: p.core, halo: p.tone, width: DRIFT_EDGE_WIDTH, alpha: Math.min(1, DRIFT_EDGE_ALPHA * p.vivid), strength: DRIFT_EDGE_HALO * this.species, cap: 'round' as const };
    neonStroke(
      g,
      (target) => {
        this.traceLine(target, p, 0);
        this.traceLine(target, p, p.breadth);
      },
      edge,
    );
    neonStroke(
      g,
      (target) => {
        this.traceCross(target, p, 0);
        this.traceCross(target, p, p.length);
      },
      { color: p.tone, halo: p.tone, width: 1, alpha: Math.min(1, DRIFT_CAP_ALPHA * p.vivid), strength: 0 },
    );
  }

  /**
   * Couloir d'accélération : un remplissage qui s'allume vers la sortie, des chevrons serrés qui défilent vite dans le sens de la poussée
   * (fondus aux deux bouts), un contour net, et la sortie marquée d'un trait épais et lumineux, suivi de chevrons qui s'ouvrent : on
   * voit de loin où le couloir finit.
   */
  private paintRocket(g: Graphics, p: ZonePaint): void {
    const { length, breadth } = p;
    for (let band = 0; band < ROCKET_BANDS; band += 1) {
      const t = band / (ROCKET_BANDS - 1);
      this.fillBand(g, p, (length * band) / ROCKET_BANDS, (length * (band + 1)) / ROCKET_BANDS, 0, breadth, ROCKET_FILL_LOW + (ROCKET_FILL_HIGH - ROCKET_FILL_LOW) * t);
    }
    const inset = Math.min(ROCKET_CHEVRON_INSET * p.scale, breadth * 0.12);
    const half = breadth / 2 - inset;
    const depth = ROCKET_CHEVRON_DEPTH * p.scale;
    const count = chevronCount(p.kit.lengthMeters);
    const levels = ROCKET_CHEVRON_ALPHAS.length;
    ROCKET_CHEVRON_ALPHAS.forEach((alpha, level) => {
      neonStroke(
        g,
        (target) => {
          for (let k = 0; k < count; k += 1) {
            const meters = chevronAlong(k, p.clock);
            if (meters >= p.kit.lengthMeters) continue;
            const where = meters / p.kit.lengthMeters;
            if (levelOf(edgeFade(where, CHEVRON_FADE), levels) === level) this.traceChevron(target, p, where * length, breadth / 2, depth, half);
          }
        },
        { color: level === levels - 1 ? p.core : p.tone, halo: p.tone, width: ROCKET_CHEVRON_WIDTH, alpha: Math.min(1, alpha * p.vivid), strength: level === levels - 1 ? ROCKET_CHEVRON_HALO * this.species : 0, cap: 'round', join: 'round' },
      );
    });
    // Le contour net : les deux côtés et l'entrée ; la sortie a son propre trait.
    neonStroke(
      g,
      (target) => {
        this.traceLine(target, p, 0);
        this.traceLine(target, p, breadth);
        this.traceCross(target, p, 0);
      },
      { color: p.tone, halo: p.tone, width: ROCKET_EDGE_WIDTH, alpha: Math.min(1, ROCKET_EDGE_ALPHA * p.vivid), strength: ROCKET_EDGE_HALO * this.species, cap: 'round' },
    );
    neonStroke(g, (target) => this.traceCross(target, p, length), { color: p.core, halo: p.tone, width: ROCKET_EXIT_WIDTH, alpha: Math.min(1, p.vivid), strength: ROCKET_EXIT_HALO * this.species, cap: 'round' });
    neonStroke(
      g,
      (target) => {
        const rise = length + ROCKET_FLARE_RISE * p.scale;
        const open = ROCKET_FLARE_OPEN * p.scale;
        framePoint(p.frame, length, 0, this.zoneFrom);
        framePoint(p.frame, rise, -open, this.zoneTo);
        target.moveTo(this.zoneFrom.x, this.zoneFrom.y).lineTo(this.zoneTo.x, this.zoneTo.y);
        framePoint(p.frame, length, breadth, this.zoneFrom);
        framePoint(p.frame, rise, breadth + open, this.zoneTo);
        target.moveTo(this.zoneFrom.x, this.zoneFrom.y).lineTo(this.zoneTo.x, this.zoneTo.y);
      },
      { color: p.core, halo: p.tone, width: ROCKET_FLARE_WIDTH, alpha: Math.min(1, ROCKET_FLARE_ALPHA * p.vivid), strength: ROCKET_EXIT_HALO * this.species, cap: 'round' },
    );
  }

  /**
   * Freinage : une matière calme. Un remplissage qui s'épaissit vers le haut, un contour tireté à peine visible, de fines bandes pâles,
   * plus serrées en haut, qui descendent très lentement : à l'inverse de ce qui monte, rien n'y pousse, rien n'y file.
   */
  private paintBrake(g: Graphics, p: ZonePaint): void {
    const { length, breadth } = p;
    for (let band = 0; band < BRAKE_BANDS; band += 1) {
      const t = band / (BRAKE_BANDS - 1);
      this.fillBand(g, p, (length * band) / BRAKE_BANDS, (length * (band + 1)) / BRAKE_BANDS, 0, breadth, BRAKE_FILL_LOW + (BRAKE_FILL_HIGH - BRAKE_FILL_LOW) * t);
    }
    const box = frameBox(p.frame, 0, length, 0, breadth, this.zoneBox);
    const { x, y, width, height } = box;
    dashedLine(g, { x, y }, { x: x + width, y }, BRAKE_DASH, BRAKE_GAP);
    dashedLine(g, { x: x + width, y }, { x: x + width, y: y + height }, BRAKE_DASH, BRAKE_GAP);
    dashedLine(g, { x: x + width, y: y + height }, { x, y: y + height }, BRAKE_DASH, BRAKE_GAP);
    dashedLine(g, { x, y: y + height }, { x, y }, BRAKE_DASH, BRAKE_GAP);
    g.stroke({ width: BRAKE_OUTLINE_WIDTH, color: p.tone, alpha: Math.min(1, BRAKE_OUTLINE_ALPHA * p.vivid) });
    const inset = Math.min(BRAKE_LINE_INSET, breadth * 0.1);
    const count = brakeLineCount(p.kit.lengthMeters);
    const levels = BRAKE_LINE_ALPHAS.length;
    BRAKE_LINE_ALPHAS.forEach((alpha, level) => {
      neonStroke(
        g,
        (target) => {
          for (let k = 0; k < count; k += 1) {
            const line = brakeLine(k, count, p.clock, this.zoneLine);
            if (line.light < 0.02 || levelOf(line.light, levels) !== level) continue;
            framePoint(p.frame, line.along * length, inset, this.zoneFrom);
            framePoint(p.frame, line.along * length, breadth - inset, this.zoneTo);
            target.moveTo(this.zoneFrom.x, this.zoneFrom.y).lineTo(this.zoneTo.x, this.zoneTo.y);
          }
        },
        { color: level === levels - 1 ? p.core : p.tone, halo: p.tone, width: BRAKE_LINE_WIDTH, alpha: Math.min(1, alpha * p.vivid), strength: 0 },
      );
    });
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

  /**
   * Obstacles : une masse sombre au contour néon fin, sous les points et la corde. Un solide a le contour rouge-magenta : un danger se
   * lit comme tel, au rythme près (le pouls n'en change que l'intensité du halo). Les trois autres espèces (rebond, cassable, porte) gardent la masse
   * sombre, chacune dans sa teinte et avec son signe, dessinés dans cet ordre par-dessus les solides. Une paroi cassable déjà traversée n'est plus dessinée.
   */
  private drawObstacles(state: SimState, camera: Camera, view: ViewBounds, tuning: Tuning): void {
    const g = this.obstacles.clear();
    const scale = camera.scale;
    const lots = this.obstacleLots;
    lots.solid.length = 0;
    lots.bounce.length = 0;
    lots.smash.length = 0;
    lots.door.length = 0;
    let slot = 0;
    for (const box of state.obstacles) {
      if (box.broken) continue;
      const topLeft = camera.worldToScreen({ x: box.x0, y: box.y1 });
      const width = (box.x1 - box.x0) * scale;
      const height = (box.y1 - box.y0) * scale;
      // Hors de la vue, ni le tracé ni son halo ne servent : on ne dessine que ce que l'écran peut montrer.
      if (topLeft.x + width < view.left - CULL_MARGIN || topLeft.x > view.right + CULL_MARGIN || topLeft.y + height < view.top - CULL_MARGIN || topLeft.y > view.bottom + CULL_MARGIN) continue;
      const item = this.screenBox(slot, box, topLeft.x, topLeft.y, width, height);
      slot += 1;
      const kind = obstacleKind(box);
      (kind === 'rebond' ? lots.bounce : kind === 'cassable' ? lots.smash : kind === 'porte' ? lots.door : lots.solid).push(item);
    }
    if (slot === 0) return;
    this.paintSolids(g, lots.solid);
    this.paintBounces(g, lots.bounce);
    this.paintSmashables(g, lots.smash, canSmash(state, tuning));
    this.paintDoors(g, lots.door, state, tuning);
  }

  /** Le `slot`-ième obstacle visible de l'image, tiré du réservoir (il grandit seulement si plus d'obstacles sont à l'écran en même temps). */
  private screenBox(slot: number, source: Obstacle, x: number, y: number, width: number, height: number): ScreenBox {
    const item = this.boxPool[slot];
    if (!item) {
      const created = { x, y, width, height, source };
      this.boxPool[slot] = created;
      return created;
    }
    item.x = x;
    item.y = y;
    item.width = width;
    item.height = height;
    item.source = source;
    return item;
  }

  /** Obstacles solides : le halo d'abord, puis le corps sombre par-dessus (il ne reste du halo que ce qui déborde), puis le contour net. Le cerne bat avec les graves : son intensité seulement. */
  private paintSolids(g: Graphics, boxes: readonly ScreenBox[]): void {
    if (boxes.length === 0) return;
    const tube = { color: COLOR.obstacleEdge, halo: COLOR.obstacleEdge, width: OBSTACLE_EDGE_WIDTH, strength: this.rim };
    neonRects(g, boxes, { ...tube, pass: 'halo' });
    for (const box of boxes) g.rect(box.x, box.y, box.width, box.height);
    g.fill(COLOR.obstacle);
    neonRects(g, boxes, { ...tube, pass: 'core' });
  }

  /**
   * Surfaces de rebond : un second contour fin à l'intérieur du premier, orchidée, et au milieu un ressort en zigzag le long de la
   * plus grande dimension. Aucun obstacle solide n'a ni l'un ni l'autre : la surface se reconnaît même de loin, même sans la couleur.
   */
  private paintBounces(g: Graphics, boxes: readonly ScreenBox[]): void {
    if (boxes.length === 0) return;
    const tube = { color: COLOR.bounce, halo: COLOR.bounce, width: OBSTACLE_EDGE_WIDTH, strength: this.rim };
    neonRects(g, boxes, { ...tube, pass: 'halo' });
    for (const box of boxes) g.rect(box.x, box.y, box.width, box.height);
    g.fill(SKIN.bounceBody);
    neonRects(g, boxes, { ...tube, pass: 'core' });
    // Le second contour, en retrait ; trop mince, il n'y a plus la place.
    let inner = false;
    for (const box of boxes) {
      const thickness = Math.min(box.width, box.height);
      if (thickness < BOUNCE_MIN_THICKNESS) continue;
      const inset = clamp(thickness * BOUNCE_INSET_RATIO, BOUNCE_INSET_MIN, BOUNCE_INSET_MAX);
      g.rect(box.x + inset, box.y + inset, box.width - 2 * inset, box.height - 2 * inset);
      inner = true;
    }
    if (inner) g.stroke({ width: BOUNCE_INNER_WIDTH, color: COLOR.bounce, alpha: BOUNCE_INNER_ALPHA });
    neonStroke(
      g,
      (target) => {
        for (const box of boxes) this.traceSpring(target, box);
      },
      { color: COLOR.bounce, halo: COLOR.bounce, width: SPRING_WIDTH, spread: MARK_SPREAD, strength: this.species, cap: 'round', join: 'round' },
    );
  }

  /** Ajoute au tracé le ressort de la surface : un zigzag au milieu de son épaisseur, d'un bout à l'autre de sa longueur, ou rien si elle est trop mince. */
  private traceSpring(g: Graphics, box: ScreenBox): void {
    const horizontal = box.width >= box.height;
    const thickness = horizontal ? box.height : box.width;
    const length = horizontal ? box.width : box.height;
    const inset = clamp(thickness * BOUNCE_INSET_RATIO, BOUNCE_INSET_MIN, BOUNCE_INSET_MAX);
    const amplitude = thickness / 2 - inset - SPRING_MARGIN;
    if (amplitude < SPRING_MIN_AMPLITUDE) return;
    const margin = inset + SPRING_MARGIN;
    const teeth = springTeeth(length - 2 * margin);
    const centre = thickness / 2;
    for (let i = 0; i <= teeth; i += 1) {
      // Les deux bouts sont au milieu de l'épaisseur ; entre eux, le zigzag alterne un côté puis l'autre.
      const across = centre + (i === 0 || i === teeth ? 0 : i % 2 === 0 ? amplitude : -amplitude);
      const along = margin + ((length - 2 * margin) * i) / teeth;
      const px = horizontal ? box.x + along : box.x + across;
      const py = horizontal ? box.y + across : box.y + along;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
  }

  /**
   * Parois cassables : le corps sombre fissuré. Trop lent (`lit` faux), la paroi est un solide qui couve : contour braise atténué, fissures
   * éteintes. Assez vite pour la traverser (`lit` vrai), tout s'allume d'un cran : le contour et les fissures rougissent à blanc,
   * leur halo se gonfle, le corps se réchauffe. Le joueur sent sa vitesse sans chiffre : la paroi dit « tu peux ».
   */
  private paintSmashables(g: Graphics, boxes: readonly ScreenBox[], lit: boolean): void {
    if (boxes.length === 0) return;
    const tube = { color: COLOR.smash, halo: COLOR.smash, width: OBSTACLE_EDGE_WIDTH, alpha: lit ? 1 : SMASH_DIM_ALPHA, strength: this.rim * (lit ? SMASH_LIT_HALO : SMASH_DIM_HALO) };
    neonRects(g, boxes, { ...tube, pass: 'halo' });
    for (const box of boxes) g.rect(box.x, box.y, box.width, box.height);
    g.fill(lit ? SKIN.smashBodyLit : SKIN.smashBody);
    neonRects(g, boxes, { ...tube, pass: 'core' });
    neonStroke(
      g,
      (target) => {
        for (const box of boxes) {
          for (const crack of this.cracksOf(box.source)) this.traceCrack(target, box, crack);
        }
      },
      lit
        ? { color: SKIN.crackHot, halo: COLOR.smash, width: CRACK_HOT_WIDTH, strength: this.rim * CRACK_HOT_HALO, cap: 'round', join: 'round' }
        : { color: SKIN.crackDim, halo: COLOR.smash, width: CRACK_DIM_WIDTH, alpha: CRACK_DIM_ALPHA, strength: 0, cap: 'round', join: 'round' },
    );
  }

  /** Le motif de fissures de la paroi : calculé une fois par paroi (il ne dépend que de son numéro et de sa longueur). */
  private cracksOf(box: Obstacle): Crack[] {
    let cracks = this.crackCache.get(box.id);
    if (!cracks) {
      if (this.crackCache.size >= CRACK_CACHE_MAX) this.crackCache.clear();
      cracks = crackPattern(box.id, Math.max(box.x1 - box.x0, box.y1 - box.y0));
      this.crackCache.set(box.id, cracks);
    }
    return cracks;
  }

  /** Ajoute au tracé une fissure (en fractions de la paroi : `u` le long de sa plus grande dimension, `v` en travers) posée sur le rectangle à l'écran. */
  private traceCrack(g: Graphics, box: ScreenBox, crack: Crack): void {
    const horizontal = box.width >= box.height;
    for (let i = 0; i + 1 < crack.length; i += 2) {
      const u = crack[i]!;
      const v = crack[i + 1]!;
      const px = horizontal ? box.x + u * box.width : box.x + v * box.width;
      const py = horizontal ? box.y + v * box.height : box.y + u * box.height;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
  }

  /**
   * Portes. Le contour reste visible à tout moment du cycle, pour que la porte se retrouve même ouverte. Ouverte : contour tireté
   * pâle, pas de masse, et une jauge, la part déjà écoulée de l'ouverture, qui remplit la porte (de gauche à droite, ou de bas en haut
   * d'une porte debout) jusqu'à un trait de front. Elle avertit : le contour devient franc et clignote, la masse est presque pleine.
   * Fermée : masse pleine comme un solide, dans sa teinte de porte, et une barre claire qui se remplit jusqu'à l'ouverture. Fermée sur
   * le personnage qu'elle a surpris dedans : masse fantôme, il en sort. Tout se lit du pas de simulation.
   */
  private paintDoors(g: Graphics, boxes: readonly ScreenBox[], state: SimState, tuning: Tuning): void {
    for (const box of boxes) this.paintDoor(g, box, doorLook(box.source, state, tuning));
  }

  private paintDoor(g: Graphics, box: ScreenBox, look: DoorLook): void {
    const { x, y, width, height } = box;
    const horizontal = width >= height;
    // La part remplie d'une jauge de 0 à 1 : depuis la gauche d'une porte couchée, depuis le bas d'une porte debout.
    const fill = (inset: number): { x: number; y: number; width: number; height: number } =>
      horizontal
        ? { x: x + inset, y: y + inset, width: (width - 2 * inset) * look.gauge, height: height - 2 * inset }
        : { x: x + inset, y: y + inset + (height - 2 * inset) * (1 - look.gauge), width: width - 2 * inset, height: (height - 2 * inset) * look.gauge };
    const edge = { color: COLOR.door, halo: COLOR.door, width: OBSTACLE_EDGE_WIDTH };
    const alone = [box];
    switch (look.phase) {
      case 'ouverte': {
        const part = fill(0);
        g.rect(part.x, part.y, part.width, part.height).fill({ color: COLOR.door, alpha: DOOR_FILL_ALPHA });
        // Le trait de front de la jauge : la limite de la part remplie.
        const front = horizontal ? { from: { x: part.x + part.width, y }, to: { x: part.x + part.width, y: y + height } } : { from: { x, y: part.y }, to: { x: x + width, y: part.y } };
        neonLine(g, front.from, front.to, { ...edge, width: DOOR_FRONT_WIDTH, strength: DOOR_OPEN_HALO * this.rim });
        neonStroke(
          g,
          (target) => {
            dashedLine(target, { x, y }, { x: x + width, y }, DOOR_DASH, DOOR_GAP);
            dashedLine(target, { x: x + width, y }, { x: x + width, y: y + height }, DOOR_DASH, DOOR_GAP);
            dashedLine(target, { x: x + width, y: y + height }, { x, y: y + height }, DOOR_DASH, DOOR_GAP);
            dashedLine(target, { x, y: y + height }, { x, y }, DOOR_DASH, DOOR_GAP);
          },
          { ...edge, color: SKIN.doorPale, alpha: DOOR_OPEN_ALPHA, strength: 0, width: DOOR_DASH_WIDTH },
        );
        break;
      }
      case 'avertit': {
        // Le contour devient franc et clignote ; la masse, presque pleine, clignote avec lui.
        const strength = this.rim * (DOOR_WARN_HALO_MIN + (DOOR_WARN_HALO_MAX - DOOR_WARN_HALO_MIN) * look.beat);
        const tube = { ...edge, alpha: DOOR_WARN_ALPHA_MIN + (1 - DOOR_WARN_ALPHA_MIN) * look.beat, strength };
        neonRects(g, alone, { ...tube, pass: 'halo' });
        const part = fill(0);
        g.rect(part.x, part.y, part.width, part.height).fill({ color: COLOR.door, alpha: DOOR_WARN_FILL_MIN + (DOOR_WARN_FILL_MAX - DOOR_WARN_FILL_MIN) * look.beat });
        neonRects(g, alone, { ...tube, pass: 'core' });
        break;
      }
      case 'fermee': {
        const tube = { ...edge, strength: this.rim };
        neonRects(g, alone, { ...tube, pass: 'halo' });
        g.rect(x, y, width, height).fill(SKIN.doorBody);
        // La barre claire qui se remplit jusqu'à l'ouverture, en retrait du contour.
        const bar = fill(DOOR_BAR_INSET);
        if (bar.width > 0 && bar.height > 0 && Math.min(width, height) > 2 * DOOR_BAR_INSET) g.rect(bar.x, bar.y, bar.width, bar.height).fill({ color: SKIN.doorPale, alpha: DOOR_BAR_ALPHA });
        neonRects(g, alone, { ...tube, pass: 'core' });
        break;
      }
      case 'passage': {
        g.rect(x, y, width, height).fill({ color: COLOR.door, alpha: DOOR_GHOST_ALPHA });
        neonRects(g, alone, { ...edge, alpha: DOOR_OPEN_ALPHA, strength: DOOR_OPEN_HALO * this.rim });
        break;
      }
    }
  }

  /**
   * Anneaux de précision, sous les obstacles et les points : un cercle fin vert vif au rayon de l'anneau, dedans le cercle du centre et
   * son point, qui disent où viser. Le personnage qui le traverse l'allume (le centre aussi s'il passe près du milieu) ; une fois
   * traversé, il ne reste que la trace d'un néon coupé.
   */
  private drawRings(state: SimState, camera: Camera, view: ViewBounds): void {
    const g = this.rings.clear();
    if (state.rings.length === 0) return;
    const lots = this.ringLots;
    lots.libre.length = 0;
    lots.traverse.length = 0;
    lots.centre.length = 0;
    lots.prise.length = 0;
    let slot = 0;
    for (const ring of state.rings) {
      const p = camera.worldToScreen(ring.pos);
      const radius = ring.radius * camera.scale;
      if (!inView(view, p, CULL_MARGIN + radius)) continue;
      const spot = this.ringSpot(slot, p.x, p.y, radius);
      slot += 1;
      lots[ringPhase(ring)].push(spot);
    }
    if (slot === 0) return;
    // La trace éteinte d'abord : elle ne doit jamais couvrir un anneau vivant.
    this.paintRingCircles(g, lots.prise, 1, COLOR.ring, { width: RING_TRACE_WIDTH, alpha: DARK_ALPHA, strength: 0 });
    this.paintRing(g, lots.libre, false, false);
    this.paintRing(g, lots.traverse, true, false);
    this.paintRing(g, lots.centre, true, true);
  }

  /**
   * Un lot d'anneaux vivants : le cercle extérieur (plus épais et plus lumineux quand le personnage le traverse), puis le cercle du
   * centre et son point. Le centre est discret tant que le passage n'y est pas, et s'allume (cœur plus clair, halo) quand il y est.
   */
  private paintRing(g: Graphics, spots: readonly RingSpot[], crossing: boolean, centred: boolean): void {
    if (spots.length === 0) return;
    this.paintRingCircles(g, spots, 1, COLOR.ring, { width: crossing ? RING_ACTIVE_WIDTH : RING_WIDTH, alpha: 1, strength: this.species * (crossing ? RING_ACTIVE_HALO : RING_HALO) });
    const core = centred ? SKIN.ringHot : COLOR.ring;
    const strength = centred ? this.species * RING_ACTIVE_HALO : 0;
    const alpha = centred ? 1 : RING_INNER_ALPHA;
    this.paintRingCircles(g, spots, RING_CENTRE_RATIO, core, { width: RING_INNER_WIDTH, alpha, strength });
    neonDiscs(g, spots, RING_DOT_RADIUS, { color: core, halo: COLOR.ring, alpha, strength });
  }

  /** Cercles de tube du lot d'anneaux, d'un seul tracé : `ratio` est la part du rayon de chaque anneau où poser le cercle. */
  private paintRingCircles(g: Graphics, spots: readonly RingSpot[], ratio: number, color: number, style: { width: number; alpha: number; strength: number }): void {
    if (spots.length === 0) return;
    neonStroke(g, (target) => spots.forEach((spot) => target.circle(spot.x, spot.y, spot.radius * ratio)), { color, halo: COLOR.ring, ...style, spread: MARK_SPREAD });
  }

  /** L'anneau visible numéro `slot` de l'image, tiré du réservoir. */
  private ringSpot(slot: number, x: number, y: number, radius: number): RingSpot {
    const spot = this.ringPool[slot];
    if (!spot) {
      const created = { x, y, radius };
      this.ringPool[slot] = created;
      return created;
    }
    spot.x = x;
    spot.y = y;
    spot.radius = radius;
    return spot;
  }

  /**
   * Étoiles de la route haute : losange concave à quatre branches, jaune néon
   * au halo chaud, absent une fois pris. L'étoile garde sa taille ; si le rayon
   * de ramassage est plus grand (talisman Aimant à étoiles), un halo discret
   * montre la zone. Une étoile de la pluie, qui tombe, laisse derrière elle une
   * courte traînée. Avec les aigus, le halo de chaque étoile scintille (sa portée
   * seulement, jamais l'étoile), et il s'allume un peu plus sur le temps.
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
    // Le scintillement ne joue que sur la portée du halo (`grow`) : le cœur, lui, est tracé avec `grow` à 0.
    const sparkle = shown.map((item) => starSparkle(this.pulse, effects.clock, item.pickup.id));
    neonFill(
      g,
      (target, grow) => {
        spots.forEach((spot, i) => target.poly(starPoints(spot.x, spot.y, outer + grow * (sparkle[i] ?? 1))));
      },
      { color: COLOR.star, halo: COLOR.starHalo, strength: pulse(effects.clock, STAR_PULSE_HZ, STAR_PULSE_MIN) * this.species },
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
    neonLine(g, topLeft, { x: topLeft.x + width, y: topLeft.y }, { ...this.normalTube, width: ROOF_EDGE_WIDTH, alpha: 0.85, strength: 0.7 * this.halo.strength, spread: this.halo.spread });
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
    g.stroke({ width: CABLE_GLOW_WIDTH * this.halo.spread, color: this.palette.halo, alpha: CABLE_GLOW_ALPHA * this.halo.strength });
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
        neonCircle(g, p.x, p.y, paint.ring + HELD_RING_GAP, { ...this.normalTube, width: 1.5, alpha: 0.4 + 0.6 * beat, strength: beat * this.halo.strength, spread: 1.2 * this.halo.spread });
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

  /**
   * Dessine la passe `pass` (les halos, ou les cœurs) de toutes les accroches allumées.
   * Le pouls y joue deux rôles : le halo des points normaux gonfle et prend la couleur d'effet
   * (`halo`) ; celui des espèces s'allume un peu plus sur le temps (`glow`), leurs couleurs
   * restant celles de `COLOR`. Une prise électrique qui avertit ou qui est chargée garde son
   * propre halo : son état est un signal de jeu qui passe avant la musique.
   */
  private paintLit(g: Graphics, groups: LitGroups, paint: AnchorPaint, pass: 'halo' | 'core'): void {
    const { radius, ring, clock, scale } = paint;
    const core = pass === 'core';
    const { halo } = this;
    const glow = this.species;

    // Chaque point normal sous sa lampe : trois couleurs de halo à la fois, comme en discothèque ; le cœur reste celui du tube.
    const byLamp: (typeof groups.normal)[] = Array.from({ length: LAMP_COUNT }, () => []);
    for (const spot of groups.normal) byLamp[lampOf(spot.id)]!.push(spot);
    byLamp.forEach((spots, lamp) => {
      if (spots.length > 0) neonDiscs(g, spots, radius, { ...this.normalTube, halo: this.lampHalos[lamp] ?? this.normalTube.halo, spread: halo.spread, strength: halo.strength, pass });
    });

    // Lanceur : un disque vert d'eau au creux d'une coupe en « Y » ouverte vers le haut, sur un court pied : une fronde. Rien d'un propulseur, qui est un anneau fermé à chevrons.
    if (groups.lanceur.length > 0) {
      const cup = cupRadius(radius);
      neonDiscs(g, groups.lanceur, radius, { ...SPECIES_TUBE.lanceur, strength: glow, pass });
      neonStroke(
        g,
        (target) => {
          for (const spot of groups.lanceur) traceCup(target, spot.x, spot.y, cup);
        },
        { ...SPECIES_TUBE.lanceur, width: CUP_WIDTH, spread: MARK_SPREAD, strength: glow, cap: 'round', join: 'round', pass },
      );
    }

    // Fragile : le disque grésille, chacun à son rythme ; anneau en huit tirets ; fêlure sombre au cœur.
    if (groups.fragile.length > 0) {
      if (core) neonDiscs(g, groups.fragile, radius, { ...SPECIES_TUBE.fragile, pass });
      else for (const spot of groups.fragile) neonDiscs(g, [spot], radius, { ...SPECIES_TUBE.fragile, strength: flicker(clock, spot.id, 0.4) * 1.2 * glow, pass });
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
        { ...SPECIES_TUBE.fragile, width: KIND_MARK_WIDTH, spread: MARK_SPREAD, strength: glow, pass },
      );
      if (core) {
        glyph(g, groups.fragile, CRACK, radius);
        g.stroke({ width: Math.max(1, radius * 0.14), color: COLOR.crack });
      }
    }

    // Propulseur : disque cyan vif, anneau plein, chevrons qui scintillent l'un après l'autre.
    if (groups.booster.length > 0) {
      neonDiscs(g, groups.booster, radius, { ...SPECIES_TUBE.booster, strength: glow, pass });
      neonRings(g, groups.booster, () => ring, { ...SPECIES_TUBE.booster, width: KIND_MARK_WIDTH, spread: MARK_SPREAD, strength: glow, pass });
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
          { ...SPECIES_TUBE.booster, width: CHEVRON_WIDTH, alpha: 0.35 + 0.65 * pulse(clock - k * CHEVRON_LAG, CHEVRON_HZ, 0), spread: MARK_SPREAD, strength: glow, cap: 'round', join: 'round', pass },
        );
      }
    }

    // Prise électrique : un disque orange à l'éclair sombre. Au calme, un anneau pâle ; elle avertit : l'anneau grésille et tremble ; chargée : rouge, halo fort, pointes qui tournent.
    const electric = [...groups.calm, ...groups.warning, ...groups.charged];
    if (electric.length > 0) {
      const orange = SPECIES_TUBE.electrique;
      neonDiscs(g, groups.calm, radius, { ...orange, strength: glow, pass });
      neonDiscs(g, groups.warning, radius, { ...orange, strength: 1.3, pass });
      neonDiscs(g, groups.charged, radius, { ...CHARGED_TUBE, spread: 1.7, strength: 1.6 * pulse(clock, 6, 0.75), pass });
      neonRings(g, groups.calm, () => ring, { ...orange, width: 1.5, alpha: 0.45, strength: 0.5 * glow, spread: MARK_SPREAD, pass });
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
      const tube = { ...SPECIES_TUBE.eclipse, spread: MARK_SPREAD, strength: 1.5 * glow, pass };
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
    // Le rayon est une information de jeu : le pouls n'en change pas. Seul le halo suit la couleur d'effet et l'intensité.
    neonCircle(g, p.x, p.y, radius, { ...this.normalTube, width: TARGET_RING_WIDTH, alpha: 0.4 + 0.6 * lit, strength: lit * (0.8 + 0.2 * pulse(effects.clock, 3, 0)) * this.halo.strength, spread: this.halo.spread });
  }

  /**
   * Le trait part du personnage et se dessine vers le point pendant les
   * premiers centièmes de seconde : un tube de la palette. À un lanceur, il n'y a
   * pas de corde : l'élastique de la fronde prend sa place.
   */
  private drawRope(state: SimState, camera: Camera, tuning: Tuning, effects: Effects, ready: boolean): void {
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
    // Dans la fenêtre de lâcher, la corde prend la teinte chaude et brille un cran de plus ; hors fenêtre, rien ne change.
    const tube = ready ? READY_TUBE : this.normalTube;
    const glow = ready ? READY_STRENGTH : 1;
    neonLine(g, from, tip, { ...tube, width: ROPE_WIDTH + ROPE_HEAT_WIDTH * heat, strength: (1 + ROPE_HEAT_GLOW * heat) * this.halo.strength * glow, spread: (1 + ROPE_HEAT_SPREAD * heat) * this.halo.spread, cap: 'round' });
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
    g.rect(view.left, visibleTop, width, view.bottom - visibleTop).fill({ color: this.palette.fog, alpha: fogSheetAlpha(FOG_ALPHA, this.pulse) });
    if (top < view.top) return;
    for (const band of FOG_BANDS) g.rect(view.left, top, width, Math.min(band.depth, view.bottom - top)).fill({ color: this.palette.fogEdge, alpha: band.alpha });
    const blink = state.fogFactor > 1 ? alertAlpha(effects.clock) : 1;
    neonLine(g, { x: view.left, y: top }, { x: view.right, y: top }, { color: this.palette.fogEdge, halo: this.palette.fogEdge, width: FOG_EDGE_WIDTH, alpha: blink, spread: 1.6 });
  }

  /**
   * Ombre prédictive : quelques points pâles, discrets, qui montrent où irait
   * le personnage s'il lâchait maintenant. Tenu à un lanceur, elle est la visée :
   * plus longue, plus grosse, plus nette. Dans la fenêtre de lâcher, ses points
   * s'allument d'un cran et prennent la teinte chaude : même nombre, même taille.
   */
  private drawShadow(state: SimState, camera: Camera, tuning: Tuning, ready: boolean): void {
    const g = this.shadow.clear();
    const aiming = heldKind(state) === 'lanceur';
    for (const point of shadowPoints(state, tuning, aiming ? LAUNCH_SHADOW_SECONDS : tuning.shadowSeconds)) {
      const p = camera.worldToScreen(point);
      g.circle(p.x, p.y, aiming ? LAUNCH_SHADOW_DOT_RADIUS : SHADOW_DOT_RADIUS);
    }
    g.fill({ color: ready ? COLOR.release : this.palette.pale, alpha: aiming ? LAUNCH_SHADOW_ALPHA : ready ? READY_SHADOW_ALPHA : SHADOW_ALPHA });
  }

  /**
   * Le signe de vitesse d'un anneau traversé : deux ou trois traits dans l'axe de la vitesse, derrière le personnage, dans la teinte de
   * l'anneau (plus claire s'il a été pris au centre), pendant un peu moins d'un tiers de seconde. Dans le monde, sous le personnage : le monde
   * incliné les tourne avec lui.
   */
  private drawBoostLines(state: SimState, camera: Camera, tuning: Tuning, effects: Effects): void {
    const g = this.boostLines.clear();
    if (effects.ringBoosts.length === 0) return;
    const p = camera.worldToScreen(state.hero.pos);
    const radius = tuning.heroRadius * camera.scale;
    for (const boost of effects.ringBoosts) {
      const color = boost.centred ? SKIN.ringHot : COLOR.ring;
      // La vitesse du monde (y vers le haut) devient une direction d'écran (y vers le bas).
      for (const streak of boostStreaks(boost.age, state.hero.vel.x, -state.hero.vel.y, radius)) {
        neonStroke(g, (target) => target.moveTo(p.x + streak.x0, p.y + streak.y0).lineTo(p.x + streak.x1, p.y + streak.y1), { color, halo: COLOR.ring, width: BOOST_WIDTH, alpha: streak.alpha, strength: BOOST_HALO, cap: 'round' });
      }
    }
  }

  /** Le personnage : un disque pâle, le plus lumineux du jeu, au halo de la palette plus large que celui des points. Dans la fenêtre de lâcher, son halo prend la teinte chaude. */
  private drawHero(state: SimState, camera: Camera, tuning: Tuning, ready: boolean): void {
    const p = camera.worldToScreen(state.hero.pos);
    const tube = ready ? READY_TUBE : this.normalTube;
    neonDiscs(this.hero.clear(), [p], tuning.heroRadius * camera.scale, { ...tube, spread: 1.4 * this.halo.spread, strength: this.halo.strength * (ready ? READY_STRENGTH : 1) });
  }

  /**
   * Les éclats brefs qui accompagnent un rebond, un fracas ou un anneau : un cercle qui s'élargit en s'effaçant à l'endroit où le personnage a
   * franchi l'événement, dans la teinte de l'espèce. Un fracas y ajoute des éclats qui partent en étoile ; un anneau traversé au
   * centre, un second cercle plus clair. À l'écran, comme les textes flottants : le monde incliné ne les tourne pas.
   */
  private drawFlashes(effects: Effects): void {
    const g = this.flashLayer.clear();
    for (const flash of effects.flashes) this.paintFlash(g, flash);
  }

  private paintFlash(g: Graphics, flash: Flash): void {
    const radius = flashRadius(flash.kind, flash.age);
    const alpha = flashAlpha(flash.age);
    const color = flash.kind === 'bounce' ? COLOR.bounce : flash.kind === 'smash' ? SKIN.crackHot : flash.kind === 'centre' ? SKIN.ringHot : COLOR.ring;
    const halo = flash.kind === 'bounce' ? COLOR.bounce : flash.kind === 'smash' ? COLOR.smash : COLOR.ring;
    const tube = { color, halo, width: FLASH_WIDTH, alpha, strength: FLASH_HALO, cap: 'round' as const };
    if (flash.kind === 'smash') {
      neonStroke(
        g,
        (target) => {
          for (let shard = 0; shard < FLASH_SHARDS; shard += 1) {
            const angle = (shard / FLASH_SHARDS) * TAU;
            target.moveTo(flash.x + radius * FLASH_SHARD_START * Math.cos(angle), flash.y + radius * FLASH_SHARD_START * Math.sin(angle)).lineTo(flash.x + radius * Math.cos(angle), flash.y + radius * Math.sin(angle));
          }
        },
        tube,
      );
      return;
    }
    neonCircle(g, flash.x, flash.y, radius, tube);
    if (flash.kind === 'centre') neonCircle(g, flash.x, flash.y, radius * FLASH_CENTRE_RATIO, tube);
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
   * Un conseil du tutoriel (`tone: 'tip'`) prend la place d'une annonce, mais se
   * dessine à part, plus doucement : voir `drawTip`.
   */
  private drawBanner(effects: Effects): void {
    const { banner } = effects;
    const tip = banner?.tone === 'tip';
    this.bannerText.visible = banner !== null && !tip;
    this.bannerDetail.visible = banner !== null && !tip && banner.detail !== null;
    this.tipText.visible = banner !== null && tip;
    this.tipDetail.visible = banner !== null && tip && banner.detail !== null;
    if (!banner) return;
    const alpha = bannerAlpha(banner.age, banner.seconds);
    if (tip) {
      this.drawTip(banner, alpha);
      return;
    }
    this.bannerText.text = banner.text;
    this.bannerText.alpha = alpha;
    if (banner.detail === null) return;
    this.bannerDetail.text = banner.detail;
    this.bannerDetail.alpha = alpha;
    this.bannerDetail.position.y = this.bannerText.y + this.bannerText.textHeight + BANNER_DETAIL_GAP;
  }

  /** Le conseil : un titre court et sa phrase en texte pâle, sous le personnage, sans halo ; même fondu que les autres bannières, un peu transparent. */
  private drawTip(tip: Readonly<Banner>, alpha: number): void {
    this.tipText.text = tip.text;
    this.tipText.alpha = alpha * TIP_ALPHA;
    if (tip.detail === null) return;
    this.tipDetail.text = tip.detail;
    this.tipDetail.alpha = alpha * TIP_ALPHA;
    this.tipDetail.position.y = this.tipText.y + this.tipText.height + TIP_DETAIL_GAP;
  }

  /**
   * Hauteur en grand à gauche, multiplicateur à côté du bouton de pause, score
   * dessous ; seulement en cours de partie, et figés sous le voile de la pause :
   * l'écran de fin redit hauteur et score. Dans un niveau, la hauteur se
   * compte depuis le toit et l'objectif la suit : « 32 / 70 m ». Le bouton de
   * pause, lui, n'est là que pendant la partie.
   */
  private drawHud(state: SimState, frame: GameFrame, tuning: Tuning): void {
    this.pauseShown = frame.screen === 'playing';
    this.pauseIcon.visible = this.pauseShown;
    this.hud.visible = this.pauseShown || frame.screen === 'paused';
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
    // Le multiplicateur grossit un peu sur le temps, depuis son coin haut droit ; les autres textes de l'interface ne bougent pas.
    this.multiplierText.scale.set(multiplierPop(this.pulse));
    this.scoreText.text = Math.floor(state.score).toLocaleString('fr-FR');
  }

  /** Ce que les écrans posés sur le jeu doivent montrer : rien en cours de partie. */
  private drawOverlay(state: SimState, frame: GameFrame): void {
    this.screens.draw(this.overlayView(state, frame), this.width, this.height, this.palette, this.glow);
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
      case 'paused':
        // La partie reste visible, figée, sous le voile.
        return { kind: 'paused' };
    }
  }
}

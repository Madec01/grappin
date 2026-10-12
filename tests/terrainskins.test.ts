import { describe, expect, it } from 'vitest';
import { buildScene } from '../src/data/scenes';
import { FAULT_PITCH, cueFor } from '../src/audio/sfx';
import {
  CROWN_STUD,
  HINGE_RING_RADIUS,
  RIFT_EDGE_INSET,
  RIFT_JAG,
  RIFT_JAG_STEP,
  RIFT_TAPER,
  SKIN,
  SKY_ALPHAS,
  SKY_BANDS,
  SKY_FIELD,
  SKY_GLOW_ALPHA,
  SKY_MOTES,
  SKY_RADII,
  SKY_STREAK,
  carouselViews,
  ceilingOf,
  hingeArc,
  hingePoint,
  isConveyorAnchor,
  isCrownStud,
  isPlatformSlab,
  panelLook,
  platformSlab,
  riftEdge,
  riftHalfWidth,
  riftViews,
  skyGlowAlpha,
  skyLook,
  skyMoteRow,
  skyMoteSway,
  skyStreak,
  slabHeading,
  type RiftView,
} from '../src/render/skins';
import { COLOR, PALETTES } from '../src/render/style';
import { CAROUSEL_ANCHORS, CAROUSEL_RADIUS, CAROUSEL_SHELL, CEILING_HOOK_BELOW, CONVEYOR_ANCHOR_BELOW, CONVEYOR_PERIOD, FAULT_SECONDS, FAULT_TRAVEL, carousel, ceilingRun, conveyor, fault, unfolding } from '../src/sim/generator';
import { SWITCH_HOLD_SECONDS } from '../src/sim/holds';
import { orbitPosition, rotorEnds } from '../src/sim/moving';
import type { Obstacle } from '../src/sim/state';
import { DEFAULT_TUNING as T } from '../src/sim/tuning';

/** L'habillage du terrain avancé du lot 5 B (0.16.0) : plafond, faille, carrousel, structure dépliante, convoyeur. Du pur, lu de l'état. */

const SECOND = Math.round(1 / T.stepSeconds);
const ids = (): { anchor: number; obstacle: number; pickup: number; ring: number; zone: number } => ({ anchor: 1, obstacle: 1, pickup: 1, ring: 1, zone: 1 });

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}
function distance(a: number, b: number): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

describe('le fond du plafond', () => {
  it('n\'existe pas hors de l\'inversion, apparaît quand la gravité s\'amollit, flotte à l\'apesanteur et monte quand elle est inversée', () => {
    expect(skyLook(-1, false)).toEqual({ show: 0, lift: 0, float: 0 });
    // Gravité d'avant, juste inversée : tout juste là, qui tombe vers le bas.
    expect(skyLook(-1, true)).toEqual({ show: 0, lift: -1, float: 0 });
    const early = skyLook(-0.7, true);
    expect(early.show).toBeGreaterThan(0);
    expect(early.show).toBeLessThan(1);
    expect(early.lift).toBe(-0.7);
    // À l'apesanteur : pleinement là, qui flotte, sans chute.
    expect(skyLook(0, true)).toEqual({ show: 1, lift: 0, float: 1 });
    // Inversée : pleinement là, qui monte, sans flottement.
    expect(skyLook(1, true)).toEqual({ show: 1, lift: 1, float: 0 });
    // Plus la gravité s'amollit, plus le fond se montre, sans jamais reculer.
    let last = -1;
    for (let y = -1; y <= 1; y += 0.05) {
      const look = skyLook(y, true);
      expect(look.show).toBeGreaterThanOrEqual(last);
      last = look.show;
    }
    // Hors bornes : la gravité est bornée.
    expect(skyLook(3, true).lift).toBe(1);
  });

  it('dérive vers le haut quand la gravité est inversée, vers le bas sinon, et reboucle de l\'autre côté', () => {
    const mote = SKY_FIELD[0]!;
    expect(skyMoteRow(mote, 0)).toBeCloseTo(mote.y, 12);
    // Dérivé vers le haut : la ligne diminue (de bas en haut, 0 est le haut) ; vers le bas, elle augmente.
    const up = skyMoteRow(mote, 0.05);
    const down = skyMoteRow(mote, -0.05);
    const wrap = (delta: number): number => ((delta % 1) + 1.5) % 1 - 0.5;
    expect(wrap(up - mote.y)).toBeLessThan(0);
    expect(wrap(down - mote.y)).toBeGreaterThan(0);
    for (const m of SKY_FIELD) for (const drift of [-3.7, -0.2, 0, 0.4, 12.3]) {
      const row = skyMoteRow(m, drift);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(1);
    }
  });

  it('garde un champ fixe et varié de particules : toujours les mêmes, de trois rangs, aux rapidités distinctes', () => {
    expect(SKY_FIELD).toHaveLength(SKY_MOTES);
    expect(new Set(SKY_FIELD.map((m) => m.tier)).size).toBe(3);
    expect(new Set(SKY_FIELD.map((m) => m.pace.toFixed(3))).size).toBeGreaterThan(SKY_MOTES / 2);
    for (const m of SKY_FIELD) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThan(1);
      expect(m.pace).toBeGreaterThanOrEqual(0.6);
      expect(m.pace).toBeLessThanOrEqual(1.4);
    }
    expect(SKY_RADII).toHaveLength(3);
    expect(SKY_ALPHAS).toHaveLength(3);
  });

  it('flotte à l\'apesanteur seulement, et laisse une traînée d\'autant plus longue que la chute est forte, dans un sens comme dans l\'autre', () => {
    const mote = SKY_FIELD[3]!;
    const still = skyMoteSway(mote, 1.3, 0);
    expect(Math.abs(still.x) + Math.abs(still.y)).toBe(0);
    const floaty = skyMoteSway(mote, 1.3, 1);
    expect(Math.hypot(floaty.x, floaty.y)).toBeGreaterThan(0.5);
    expect(Math.hypot(floaty.x, floaty.y)).toBeLessThanOrEqual(10);
    expect(skyStreak(mote, 0)).toBe(0);
    expect(skyStreak(mote, 0.15)).toBe(0);
    expect(skyStreak(mote, 0.6)).toBeGreaterThan(0);
    expect(skyStreak(mote, 1)).toBeGreaterThan(skyStreak(mote, 0.6));
    expect(skyStreak(mote, -1)).toBe(skyStreak(mote, 1));
    expect(skyStreak(mote, 1)).toBeLessThanOrEqual(SKY_STREAK * 1.4 * 1.0);
  });

  it('allume un halo qui s\'éteint en s\'éloignant du bord haut, et n\'allume rien quand le fond est absent', () => {
    expect(skyGlowAlpha(0, 1)).toBeLessThanOrEqual(SKY_GLOW_ALPHA);
    for (let band = 1; band < SKY_BANDS; band += 1) expect(skyGlowAlpha(band, 1)).toBeLessThan(skyGlowAlpha(band - 1, 1));
    expect(skyGlowAlpha(0, 0)).toBe(0);
    expect(skyGlowAlpha(0, 0.5)).toBeCloseTo(skyGlowAlpha(0, 1) / 2, 12);
  });

  it('reconnaît le crochet sous chaque plafond, et lui seul', () => {
    const run = ceilingRun(ids(), { x: 0, y: 4 }, 5, 40);
    expect(run.walls.length).toBeGreaterThanOrEqual(4);
    const hooks = run.anchors.filter((a) => ceilingOf(a, run.walls) !== null);
    // Un crochet par plafond, jamais la prise qui est au-dessus d'un trou.
    expect(hooks).toHaveLength(run.walls.length / 2);
    for (const hook of hooks) {
      const ceiling = ceilingOf(hook, run.walls)!;
      expect(ceiling.y0 - hook.pos.y).toBeCloseTo(CEILING_HOOK_BELOW, 9);
      expect(hook.pos.x).toBeGreaterThanOrEqual(ceiling.x0);
      expect(hook.pos.x).toBeLessThanOrEqual(ceiling.x1);
    }
    // Une prise qui bouge, ou d'une autre espèce, n'est pas un crochet, même à cette distance d'un plafond.
    const hook = hooks[0]!;
    expect(ceilingOf({ ...hook, kind: 'fragile' }, run.walls)).toBeNull();
    expect(ceilingOf({ ...hook, cable: { from: hook.pos, to: hook.pos, period: 3 } }, run.walls)).toBeNull();
    expect(ceilingOf({ ...hook, pos: { x: hook.pos.x, y: hook.pos.y + 1 } }, run.walls)).toBeNull();
  });
});

describe('la faille', () => {
  const build = () => {
    const f = fault(ids(), { x: 0, y: 4 }, 5);
    return { anchors: f.anchors, walls: f.walls };
  };
  const trigger = (box: { riftStep?: number }, step: number): void => {
    box.riftStep = step;
  };

  it('est une seule faille, de la base à la cime de ses surfaces, au milieu des deux ensembles, fermée et non déclenchée au départ', () => {
    const { anchors, walls } = build();
    const [view, ...others] = riftViews(walls, anchors, 0, T);
    expect(others).toHaveLength(0);
    expect(view).toMatchObject({ triggered: false, progress: 0, midX: 0 });
    expect(view!.bottom).toBe(Math.min(...walls.map((w) => w.y0)));
    expect(view!.top).toBe(Math.max(...walls.map((w) => w.y1)));
    expect(view!.travel).toBe(FAULT_TRAVEL);
    // Le vide ouvert en grand finit à une prise de la prise la plus proche du milieu, une fois les deux ensembles écartés.
    const innerAnchors = Math.min(...anchors.map((a) => Math.abs(a.pos.x)));
    expect(view!.innerHalf).toBeCloseTo(innerAnchors, 9);
    expect(view!.reach).toBeCloseTo(innerAnchors + FAULT_TRAVEL - RIFT_EDGE_INSET, 9);
    expect(riftViews([], [], 0, T)).toEqual([]);
  });

  it('s\'ouvre avec les surfaces et les prises, de 0 à 1 en `FAULT_SECONDS`, et reste ouverte', () => {
    const { anchors, walls } = build();
    for (const box of [...walls, ...anchors]) trigger(box, 100);
    const at = (seconds: number): RiftView => riftViews(walls, anchors, 100 + Math.round(seconds * SECOND), T)[0]!;
    expect(at(0)).toMatchObject({ triggered: true, progress: 0 });
    expect(at(FAULT_SECONDS / 2).progress).toBeCloseTo(0.5, 2);
    expect(at(FAULT_SECONDS).progress).toBe(1);
    expect(at(FAULT_SECONDS * 3).progress).toBe(1);
  });

  it('pince le vide aux deux bouts, nul fermé, plein au milieu, et déchiquette ses bords sans les croiser', () => {
    const { anchors, walls } = build();
    for (const box of [...walls, ...anchors]) trigger(box, 0);
    const closed = riftViews(walls, anchors, 0, T)[0]!;
    const open = riftViews(walls, anchors, FAULT_SECONDS * SECOND, T)[0]!;
    expect(riftHalfWidth(closed, (closed.bottom + closed.top) / 2)).toBe(0);
    expect(riftHalfWidth(open, open.bottom)).toBe(0);
    expect(riftHalfWidth(open, open.top)).toBe(0);
    const middle = (open.bottom + open.top) / 2;
    expect(riftHalfWidth(open, middle)).toBeCloseTo(open.reach, 9);
    expect(riftHalfWidth(open, open.bottom + RIFT_TAPER / 2)).toBeLessThan(open.reach);
    expect(riftHalfWidth(open, open.bottom + RIFT_TAPER / 2)).toBeGreaterThan(0);
    const left = riftEdge(open, -1);
    const right = riftEdge(open, 1);
    expect(left).toHaveLength(right.length);
    expect(left[0]!.y).toBe(open.bottom);
    expect(left.at(-1)!.y).toBe(open.top);
    left.forEach((point, i) => {
      // Chaque bord reste de son côté, déchiqueté d'au plus `RIFT_JAG` autour de la lentille ; et jamais deux fois pareil d'une image à l'autre.
      expect(point.x).toBeLessThanOrEqual(right[i]!.x);
      expect(Math.abs(point.x + riftHalfWidth(open, point.y))).toBeLessThanOrEqual(RIFT_JAG + 1e-9);
      if (i > 0) expect(point.y - left[i - 1]!.y).toBeLessThanOrEqual(RIFT_JAG_STEP + 1e-9);
    });
    expect(riftEdge(open, -1)).toEqual(left);
    // Fermée, les deux bords se confondent avec la fente.
    expect(riftEdge(closed, -1).every((p) => p.x === 0)).toBe(true);
    expect(riftEdge(closed, 1).every((p) => p.x === 0)).toBe(true);
  });

  it('le vide ouvert ne passe jamais sous une prise de la faille, à aucun moment de l\'écartement', () => {
    const { anchors, walls } = build();
    for (const box of [...walls, ...anchors]) trigger(box, 0);
    for (let seconds = 0; seconds <= FAULT_SECONDS; seconds += 0.5) {
      const step = Math.round(seconds * SECOND);
      const view = riftViews(walls, anchors, step, T)[0]!;
      for (const anchor of anchors) {
        // La prise est là où la simulation la met : sa position de repos, glissée de son écartement.
        const x = anchor.rift!.rest.x + anchor.rift!.dx * (view.progress);
        const reach = Math.max(riftHalfWidth(view, anchor.pos.y), 0) + RIFT_JAG;
        expect(Math.abs(x - view.midX), `prise ${anchor.id} à ${seconds} s`).toBeGreaterThanOrEqual(reach - 1e-9);
      }
    }
  });
});

describe('le carrousel', () => {
  const build = (spin: -1 | 1 = 1) => carousel(ids(), { x: -2, y: 4 }, 5, spin);

  it('regroupe ses trois prises en une couronne, son pivot, son rayon et son sens', () => {
    const { anchors } = build();
    const crowns = carouselViews([...anchors, { id: 99, pos: { x: 1, y: 1 }, kind: 'normal', broken: false }]);
    expect(crowns).toHaveLength(1);
    expect(crowns[0]!.anchors).toHaveLength(CAROUSEL_ANCHORS);
    expect(crowns[0]!.radius).toBe(CAROUSEL_RADIUS);
    expect(crowns[0]!.spin).toBe(1);
    expect(crowns[0]!.pivot).toEqual(anchors[0]!.orbit!.pivot);
    expect(carouselViews(build(-1).anchors)[0]!.spin).toBe(-1);
    expect(carouselViews([])).toEqual([]);
    // Une prise cassée n'est plus de la couronne.
    expect(carouselViews(anchors.map((a, i) => (i === 0 ? { ...a, broken: true } : a)))[0]!.anchors).toHaveLength(CAROUSEL_ANCHORS - 1);
  });

  it('tourne : à chaque pas, ses prises sont sur le cercle, à un tiers de tour l\'une de l\'autre', () => {
    const { anchors } = build();
    const [crown] = carouselViews(anchors);
    for (const step of [0, 77, 400]) {
      const spots = anchors.map((a) => orbitPosition(a.orbit!, step, T));
      for (const p of spots) expect(Math.hypot(p.x - crown!.pivot.x, p.y - crown!.pivot.y)).toBeCloseTo(CAROUSEL_RADIUS, 2);
    }
  });

  it('reconnaît les plots de sa coque, et eux seuls : des solides carrés de 0,5 m', () => {
    const { shell } = build();
    expect(shell.length).toBeGreaterThan(10);
    expect(shell.every((box) => isCrownStud(box))).toBe(true);
    // Ils sont sur un cercle de `CAROUSEL_SHELL` autour du pivot.
    const pivot = carouselViews(build().anchors)[0]!.pivot;
    for (const box of shell) expect(Math.hypot((box.x0 + box.x1) / 2 - pivot.x, (box.y0 + box.y1) / 2 - pivot.y)).toBeCloseTo(CAROUSEL_SHELL, 2);
    expect(CROWN_STUD).toBeCloseTo(shell[0]!.x1 - shell[0]!.x0, 9);
    // Aucune autre dalle, ni aucun autre obstacle d'aucune scène, n'a cette taille.
    const stud: Obstacle = shell[0]!;
    expect(isCrownStud({ ...stud, x1: stud.x1 + 0.1 })).toBe(false);
    expect(isCrownStud({ ...stud, kind: 'rebond' })).toBe(false);
    expect(isCrownStud({ ...stud, broken: true })).toBe(false);
    expect(isCrownStud({ ...stud, rotor: { pivot: { x: 0, y: 0 }, length: 1, spin: 0, phase: 0 } })).toBe(false);
    for (const scene of ['rebond', 'cassable', 'porte', 'anneau', 'tournant', 'glissiere', 'aimant', 'interrupteur', 'rail', 'elastique', 'evasion', 'plafond', 'faille', 'depliante', 'convoyeur'] as const) {
      for (const box of buildScene(scene, ids(), { x: 0, y: 0 }).obstacles) expect(isCrownStud(box), `${scene} ${box.id}`).toBe(false);
    }
    for (const box of buildScene('carrousel', ids(), { x: 0, y: 0 }).obstacles) expect(isCrownStud(box)).toBe(true);
  });
});

describe('la structure dépliante', () => {
  const build = (next = { x: 2, y: 8 }) => unfolding(ids(), { x: -1, y: 3 }, next);
  const state = (box: Obstacle, step: number, held: boolean) => ({ step, rope: held ? { anchorId: box.switchedBy!, length: 2 } : null });

  it('au repos est fermée, immobile, sans jauge, ni clignotement', () => {
    const { panel } = build();
    expect(panelLook(panel, state(panel, 0, false), T)).toEqual({ progress: 0, commanded: false, held: false, moving: 0, gauge: 1, beat: 1 });
  });

  it('se déplie quand la prise est tenue, reste ouverte le délai, clignote la dernière seconde, puis se replie', () => {
    const { panel } = build();
    // Tenue, la prise commande : le panneau s'ouvre à mi-chemin.
    panel.openUntilStep = 10 + SWITCH_HOLD_SECONDS * SECOND;
    panel.hingeProgress = 0.4;
    const opening = panelLook(panel, state(panel, 10, true), T);
    expect(opening).toMatchObject({ progress: 0.4, commanded: true, held: true, moving: 1, beat: 1 });
    // Déplié et tenu : il ne bouge plus, et la jauge du délai n'avance pas.
    panel.hingeProgress = 1;
    expect(panelLook(panel, state(panel, 10, true), T)).toMatchObject({ moving: 0, held: true, gauge: 0 });
    // Lâché depuis deux secondes : ouvert, immobile, la jauge à moitié.
    const released = panelLook(panel, state(panel, 10 + 2 * SECOND, false), T);
    expect(released).toMatchObject({ commanded: true, held: false, moving: 0, beat: 1 });
    expect(released.gauge).toBeCloseTo(0.5, 6);
    // La dernière seconde : il clignote, la jauge est presque pleine.
    const warning = panelLook(panel, state(panel, 10 + Math.round(3.4 * SECOND), false), T);
    expect(warning.gauge).toBeGreaterThan(0.8);
    expect(warning.beat).toBeLessThan(1 + 1e-9);
    const beats = new Set(Array.from({ length: 40 }, (_, k) => panelLook(panel, state(panel, 10 + Math.round(3.1 * SECOND) + k * 3, false), T).beat.toFixed(3)));
    expect(beats.size).toBeGreaterThan(3);
    // Le délai fini : il se replie.
    panel.hingeProgress = 0.7;
    expect(panelLook(panel, state(panel, 10 + Math.round(5 * SECOND), false), T)).toMatchObject({ commanded: false, moving: -1, gauge: 1, progress: 0.7 });
  });

  it('balaie un demi-tour par le haut, de l\'angle fermé à l\'angle déplié, du côté où est la prise suivante comme de l\'autre', () => {
    for (const next of [{ x: 2, y: 8 }, { x: -4, y: 8 }]) {
      const { panel } = build(next);
      const hinge = panel.hinge!;
      const arc = hingeArc(hinge, 100, 18);
      expect(arc).toHaveLength(19);
      // Les deux bouts sont ceux du panneau fermé et déplié, sur le cercle.
      expect(arc[0]).toEqual(hingePoint(hinge, 0, 100));
      expect(arc[18]!.x).toBeCloseTo(-arc[0]!.x, 9);
      expect(arc[18]!.y).toBeCloseTo(arc[0]!.y, 9);
      // Par le haut : au milieu, le point est au-dessus de la charnière (y de l'écran négatif).
      expect(arc[9]!.y).toBeCloseTo(-100, 6);
      for (const p of arc) expect(Math.hypot(p.x, p.y)).toBeCloseTo(100, 6);
      // Un arc partiel va du quotient de départ à celui d'arrivée, dans cet ordre.
      const part = hingeArc(hinge, 100, 4, 0.5, 1);
      expect(part[0]!.x).toBeCloseTo(arc[9]!.x, 9);
      expect(part[4]!.x).toBeCloseTo(arc[18]!.x, 9);
      // Et c'est bien le bout du panneau qui passe par là : fermé, il est à `arc[0]` ; déplié, à `arc[18]` (depuis la charnière).
      const first = rotorEnds({ ...panel, hingeProgress: 0 }, 0, T)!;
      const last = rotorEnds({ ...panel, hingeProgress: 1 }, 0, T)!;
      expect((first.b.x - first.a.x) * Math.sign(arc[0]!.x)).toBeGreaterThan(0);
      expect((last.b.x - last.a.x) * Math.sign(arc[18]!.x)).toBeGreaterThan(0);
    }
    expect(HINGE_RING_RADIUS).toBeGreaterThan(0.3);
  });
});

describe('le convoyeur', () => {
  const build = () => conveyor(ids(), { x: 0, y: 4 }, 5);

  it('reconnaît la surface de chaque plateforme, et sa prise : la plateforme du lanceur, elle, n\'en a pas', () => {
    const { anchors, slabs, walls } = build();
    expect(slabs.every((slab) => isPlatformSlab(slab))).toBe(true);
    expect(walls.some((wall) => isPlatformSlab(wall))).toBe(false);
    const normal = anchors.filter((a) => a.kind === 'normal');
    expect(normal).toHaveLength(slabs.length);
    for (const anchor of normal) {
      const slab = platformSlab(anchor, slabs)!;
      expect(slab).toBeDefined();
      expect(slab.y0 - anchor.pos.y).toBeCloseTo(CONVEYOR_ANCHOR_BELOW, 6);
      expect(isConveyorAnchor(anchor, slabs)).toBe(true);
    }
    const launcher = anchors.find((a) => a.kind === 'lanceur')!;
    expect(platformSlab(launcher, slabs)).toBeNull();
    expect(isConveyorAnchor(launcher, slabs)).toBe(true);
    // Un câble ordinaire (le coup de câble d'un niveau), une bande d'accordéon, une prise fixe : pas des plateformes.
    const plain = { ...normal[0]!, id: 90, cable: { from: { x: -1, y: 20 }, to: { x: 1, y: 20 }, period: 3 } };
    expect(isConveyorAnchor(plain, slabs)).toBe(false);
    expect(isConveyorAnchor({ ...normal[0]!, band: 1 }, slabs)).toBe(false);
    expect(isConveyorAnchor({ id: 91, pos: { x: 0, y: 5 }, kind: 'normal', broken: false }, slabs)).toBe(false);
    // Un panneau qui glisse mais que le vérificateur ne joue pas (un mur de glissière) n'est pas une surface de plateforme.
    expect(isPlatformSlab({ id: 7, x0: 0, y0: 0, x1: 1, y1: 1, slide: { amplitude: 1, period: 4, phase: 0 } })).toBe(false);
  });

  it('dit le sens où va chaque surface à ce pas : l\'une à contresens de l\'autre, et qui se renverse à chaque bout', () => {
    const { slabs } = build();
    const [first, second] = slabs;
    expect(slabs.length).toBeGreaterThanOrEqual(2);
    const half = Math.round((CONVEYOR_PERIOD / 2) * SECOND);
    for (const step of [3, 90, 200, 500]) {
      expect(slabHeading(first!.slide!, step, T) * slabHeading(second!.slide!, step, T), `pas ${step}`).toBe(-1);
    }
    // Au bout d'une demi-période, le sens est inversé.
    expect(slabHeading(first!.slide!, 10, T)).toBe(-slabHeading(first!.slide!, 10 + half, T));
  });
});

describe('les couleurs du lot 5 B et le son de la faille', () => {
  it('sont loin de toute couleur d\'espèce, de zone, d\'obstacle et d\'ambiance', () => {
    const language = Object.entries(COLOR).filter(([name]) => !['text', 'textDim', 'textFaint', 'textLocked', 'textOutline', 'panel', 'panelEquipped', 'panelEdge', 'barTrack', 'obstacle', 'crack', 'white', 'hot', 'rift', 'crown', 'conveyor', 'release', 'releaseHalo'].includes(name));
    for (const [tone, color] of Object.entries({ rift: COLOR.rift, crown: COLOR.crown, conveyor: COLOR.conveyor })) {
      for (const [name, other] of language) expect(distance(color, other), `${tone} / ${name}`).toBeGreaterThan(40);
      for (const family of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
        for (const field of ['halo', 'accent', 'effectA', 'effectB', 'effectC'] as const) expect(distance(color, PALETTES[family][field]), `${tone} / ${family}.${field}`).toBeGreaterThan(25);
      }
    }
    for (const [a, b] of [[COLOR.rift, COLOR.crown], [COLOR.rift, COLOR.conveyor], [COLOR.crown, COLOR.conveyor]] as const) expect(distance(a, b)).toBeGreaterThan(60);
    // Les teintes dérivées restent dans leur famille : le cœur de la faille est plus clair que sa lumière, le vide plus sombre que tout fond.
    const light = (color: number): number => channels(color).reduce((sum, c) => sum + c, 0);
    expect(light(SKIN.riftCore)).toBeGreaterThan(light(COLOR.rift));
    expect(light(SKIN.riftVoid)).toBeLessThan(Math.min(...Object.values(PALETTES).map((p) => light(p.background))));
    expect(light(SKIN.crownCore)).toBeGreaterThan(light(COLOR.crown));
    expect(light(SKIN.conveyorCore)).toBeGreaterThan(light(COLOR.conveyor));
  });

  it('la faille qui s\'ouvre craque : la casse, une octave plus bas', () => {
    expect(cueFor({ type: 'faille' })).toEqual({ id: 'break', pitch: FAULT_PITCH });
    expect(FAULT_PITCH).toBeGreaterThan(0.4);
    expect(FAULT_PITCH).toBeLessThan(0.7);
  });
});

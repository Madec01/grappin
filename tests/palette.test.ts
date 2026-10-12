import { describe, expect, it } from 'vitest';
import type { MusicFamily } from '../src/data/musique';
import { COLOR, PALETTES, mixPalette, paletteFor, type Palette } from '../src/render/style';

/** Les cinq ambiances ; le menu reprend la première. */
const FAMILIES: readonly MusicFamily[] = ['biome1', 'biome2', 'biome3', 'biome4', 'boss'];

/** Les couleurs qui portent un sens, jamais ambiantes : cœur et halo de chaque espèce de prise, étoiles, obstacles, bords de la ville. */
const SPECIES: Record<string, number> = {
  star: COLOR.star,
  starHalo: COLOR.starHalo,
  fragile: COLOR.fragile,
  wear: COLOR.wear,
  booster: COLOR.booster,
  launcher: COLOR.launcher,
  // La roue motorisée (0.13.0) : un bleu sarcelle entre le cyan du propulseur et le vert d'eau du lanceur.
  wheel: COLOR.wheel,
  electric: COLOR.electric,
  electricCharged: COLOR.electricCharged,
  eclipse: COLOR.eclipse,
  obstacleEdge: COLOR.obstacleEdge,
  cityEdge: COLOR.cityEdge,
  // Les espèces d'obstacles du lot 2 et l'anneau de précision : des couleurs de sens, elles aussi hors de portée de l'ambiance.
  bounce: COLOR.bounce,
  smash: COLOR.smash,
  door: COLOR.door,
  ring: COLOR.ring,
  // Les quatre zones qui modifient le mouvement (0.12.0) : des couleurs de sens, elles aussi hors de portée de l'ambiance.
  updraft: COLOR.updraft,
  drift: COLOR.drift,
  rocket: COLOR.rocket,
  brake: COLOR.brake,
  // Les bandes de l'accordéon (0.14.0) : un bleu électrique, lui aussi hors de portée de l'ambiance.
  accordion: COLOR.accordion,
};

/** Les quatre teintes nouvelles du lot 2 : surface de rebond, paroi cassable, porte, anneau de précision. */
const LOT2: Record<string, number> = { bounce: COLOR.bounce, smash: COLOR.smash, door: COLOR.door, ring: COLOR.ring };

/** Les quatre teintes des zones : courant ascendant, dérive, couloir d'accélération, freinage. */
const ZONES: Record<string, number> = { updraft: COLOR.updraft, drift: COLOR.drift, rocket: COLOR.rocket, brake: COLOR.brake };

const FIELDS = Object.keys(PALETTES.biome1) as (keyof Palette)[];

/** Les trois canaux d'une couleur 0xRRGGBB. */
function channels(color: number): number[] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function distance(a: number, b: number): number {
  const [ar = 0, ag = 0, ab = 0] = channels(a);
  const [br = 0, bg = 0, bb = 0] = channels(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

describe('palettes', () => {
  it('chaque famille a la sienne, et le menu reprend celle du premier biome', () => {
    for (const family of [...FAMILIES, 'menu'] as const) expect(paletteFor(family)).toBe(PALETTES[family]);
    expect(PALETTES.menu).toBe(PALETTES.biome1);
    // Le fond du premier biome est celui d'origine du jeu.
    expect(PALETTES.biome1.background).toBe(0x070b16);
    expect(PALETTES.biome1.halo).toBe(0x38e8ff);
  });

  it('les cinq ambiances sont toutes différentes : fond, halo, brume et ville', () => {
    for (let i = 0; i < FAMILIES.length; i += 1) {
      for (let j = i + 1; j < FAMILIES.length; j += 1) {
        const a = PALETTES[FAMILIES[i]!];
        const b = PALETTES[FAMILIES[j]!];
        expect(a).not.toEqual(b);
        for (const field of ['background', 'halo', 'tube', 'fog', 'fogEdge', 'city', 'accent'] as const) expect(a[field], `${FAMILIES[i]} / ${FAMILIES[j]} : ${field}`).not.toBe(b[field]);
        // Les halos se distinguent à l'œil, pas seulement au bit près.
        expect(distance(a.halo, b.halo), `${FAMILIES[i]} / ${FAMILIES[j]}`).toBeGreaterThan(60);
      }
    }
  });

  it('chaque couleur est un 0xRRGGBB, et le fond reste nuit : sombre, bien plus que le halo', () => {
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      for (const field of FIELDS) {
        expect(Number.isInteger(palette[field]), `${family}.${field}`).toBe(true);
        expect(palette[field]).toBeGreaterThanOrEqual(0);
        expect(palette[field]).toBeLessThanOrEqual(0xffffff);
      }
      expect(Math.max(...channels(palette.background)), family).toBeLessThan(0x20);
      expect(Math.max(...channels(palette.halo)), family).toBeGreaterThan(0xb0);
    }
  });

  it('plage sûre : aucune couleur ambiante ne se confond avec une espèce de prise, une étoile ou un obstacle', () => {
    for (const family of FAMILIES) {
      for (const field of FIELDS) {
        for (const [name, color] of Object.entries(SPECIES)) expect(PALETTES[family][field], `${family}.${field} / ${name}`).not.toBe(color);
      }
    }
  });
});

describe('les couleurs d\'effet', () => {
  it('sont trois par ambiance, franchement distinctes entre elles, et loin de toute couleur d\'espèce', () => {
    for (const family of FAMILIES) {
      const { effectA, effectB, effectC } = PALETTES[family];
      expect(distance(effectA, effectB), `${family} A/B`).toBeGreaterThan(50);
      expect(distance(effectB, effectC), `${family} B/C`).toBeGreaterThan(40);
      expect(distance(effectA, effectC), `${family} A/C`).toBeGreaterThan(50);
      for (const [name, color] of Object.entries(SPECIES)) {
        for (const effect of [effectA, effectB, effectC]) expect(distance(effect, color), `${family} / ${name}`).toBeGreaterThan(40);
      }
    }
  });
});

describe('la teinte de la fenêtre de lâcher', () => {
  const TONES = { release: COLOR.release, releaseHalo: COLOR.releaseHalo };

  it('est chaude : le rouge domine, puis le vert, puis le bleu', () => {
    for (const [name, color] of Object.entries(TONES)) {
      const [red = 0, green = 0, blue = 0] = channels(color);
      expect(red, name).toBeGreaterThanOrEqual(green);
      expect(green, name).toBeGreaterThan(blue);
    }
  });

  it('est loin de toute couleur d\'espèce, comme les couleurs d\'effet : un halo de personnage ne passe pour aucune prise', () => {
    for (const [tone, color] of Object.entries(TONES)) {
      for (const [name, species] of Object.entries(SPECIES)) {
        expect(color, `${tone} / ${name}`).not.toBe(species);
        expect(distance(color, species), `${tone} / ${name}`).toBeGreaterThan(40);
      }
    }
  });

  it('se voit sur chaque ambiance : son halo n\'a rien de celui de la palette, froide ou blanc chaud', () => {
    for (const family of FAMILIES) expect(distance(COLOR.releaseHalo, PALETTES[family].halo), family).toBeGreaterThan(100);
  });
});

describe('les teintes des obstacles à comportement et des anneaux', () => {
  /** Les couleurs qui portent un sens depuis avant le lot 2 : tout `SPECIES` sauf ses quatre nouvelles et les zones. */
  const OLD = Object.entries(SPECIES).filter(([name]) => !(name in LOT2) && !(name in ZONES));

  it('sont à plus de 40 de toute couleur d\'espèce de prise, d\'étoile et d\'obstacle solide : un coup d\'œil les distingue', () => {
    expect(OLD.length).toBeGreaterThan(8);
    for (const [tone, color] of Object.entries(LOT2)) {
      for (const [name, species] of OLD) {
        expect(color, `${tone} / ${name}`).not.toBe(species);
        expect(distance(color, species), `${tone} / ${name}`).toBeGreaterThan(40);
      }
    }
  });

  it('sont franchement distinctes entre elles : une surface de rebond ne passe pas pour une porte, ni un anneau pour une paroi', () => {
    const entries = Object.entries(LOT2);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) expect(distance(entries[i]![1], entries[j]![1]), `${entries[i]![0]} / ${entries[j]![0]}`).toBeGreaterThan(60);
    }
  });

  it('sont loin des teintes chaudes du lâcher parfait, qui se posent sur le personnage et sa corde', () => {
    for (const [tone, color] of Object.entries(LOT2)) {
      for (const warm of [COLOR.release, COLOR.releaseHalo]) expect(distance(color, warm), tone).toBeGreaterThan(40);
    }
  });

  it('se voient sur chaque ambiance : ni le halo, ni le cœur, ni la couleur d\'effet d\'une famille ne leur ressemble', () => {
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      for (const [tone, color] of Object.entries(LOT2)) {
        for (const field of ['halo', 'tube', 'pale', 'accent', 'effectA', 'effectB', 'effectC'] as const) expect(distance(palette[field], color), `${family}.${field} / ${tone}`).toBeGreaterThan(40);
      }
    }
  });

  it('sont des 0xRRGGBB vifs : un néon, pas une teinte éteinte (au moins un canal à 0xe0)', () => {
    for (const [tone, color] of Object.entries(LOT2)) {
      expect(Number.isInteger(color), tone).toBe(true);
      expect(Math.max(...channels(color)), tone).toBeGreaterThanOrEqual(0xe0);
    }
  });
});

describe('les teintes des zones qui modifient le mouvement', () => {
  /** Tout ce qui porte un sens avant elles : les espèces de prises, les étoiles, les obstacles, et les teintes du lot 2. */
  const BEFORE = Object.entries(SPECIES).filter(([name]) => !(name in ZONES));

  it('sont à plus de 40 de toute couleur d\'espèce de prise, d\'étoile, d\'obstacle et d\'anneau : un coup d\'œil les distingue', () => {
    expect(BEFORE.length).toBeGreaterThan(12);
    for (const [tone, color] of Object.entries(ZONES)) {
      for (const [name, species] of BEFORE) {
        expect(color, `${tone} / ${name}`).not.toBe(species);
        expect(distance(color, species), `${tone} / ${name}`).toBeGreaterThan(40);
      }
    }
  });

  it('sont franchement distinctes entre elles : un courant ne passe pas pour une dérive, ni un couloir pour un freinage', () => {
    const entries = Object.entries(ZONES);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) expect(distance(entries[i]![1], entries[j]![1]), `${entries[i]![0]} / ${entries[j]![0]}`).toBeGreaterThan(60);
    }
  });

  it('sont loin des teintes chaudes du lâcher parfait, qui se posent sur le personnage et sa corde', () => {
    for (const [tone, color] of Object.entries(ZONES)) {
      for (const warm of [COLOR.release, COLOR.releaseHalo]) expect(distance(color, warm), tone).toBeGreaterThan(40);
    }
  });

  it('se voient sur chaque ambiance : ni le halo, ni le cœur, ni la couleur d\'effet d\'une famille ne leur ressemble', () => {
    for (const family of FAMILIES) {
      const palette = PALETTES[family];
      for (const [tone, color] of Object.entries(ZONES)) {
        for (const field of ['halo', 'tube', 'pale', 'accent', 'effectA', 'effectB', 'effectC'] as const) expect(distance(palette[field], color), `${family}.${field} / ${tone}`).toBeGreaterThan(40);
      }
    }
  });

  it('sont des 0xRRGGBB vifs ou lumineux : un néon, pas une teinte éteinte (au moins un canal à 0xe0)', () => {
    for (const [tone, color] of Object.entries(ZONES)) {
      expect(Number.isInteger(color), tone).toBe(true);
      expect(Math.max(...channels(color)), tone).toBeGreaterThanOrEqual(0xe0);
    }
  });

  it('disent la nature de la zone : le courant est froid et clair, la dérive verte, le couloir chaud, le freinage froid et pâle', () => {
    const [ur = 0, ug = 0, ub = 0] = channels(COLOR.updraft);
    // Froid : le rouge est le canal le plus faible ; clair : les deux autres sont hauts.
    expect(ur).toBeLessThan(Math.min(ug, ub));
    expect(Math.min(ug, ub)).toBeGreaterThan(0xc0);
    const [dr = 0, dg = 0, db = 0] = channels(COLOR.drift);
    expect(dg).toBeGreaterThan(Math.max(dr, db));
    const [rr = 0, rg = 0, rb = 0] = channels(COLOR.rocket);
    expect(rr).toBeGreaterThanOrEqual(rg);
    expect(rg).toBeGreaterThan(rb);
    // Chaud et vif : loin du cyan du propulseur et du vert d'eau du lanceur, qui sont les teintes du « ça pousse » d'avant.
    for (const cool of [COLOR.booster, COLOR.launcher]) expect(distance(COLOR.rocket, cool)).toBeGreaterThan(150);
    const [br = 0, bg = 0, bb = 0] = channels(COLOR.brake);
    // Pâle : le canal le plus faible est déjà haut ; froid : le bleu domine.
    expect(Math.min(br, bg, bb)).toBeGreaterThan(0x80);
    expect(bb).toBeGreaterThanOrEqual(Math.max(br, bg));
  });
});

describe('la teinte de la roue motorisée (0.13.0)', () => {
  it('est un bleu sarcelle : ni le cyan du propulseur ni le vert d\'eau du lanceur, dont elle est voisine, ni l\'obstacle tournant qui la côtoie', () => {
    const [r = 0, g = 0, b = 0] = channels(COLOR.wheel);
    // Sarcelle : le rouge est le canal le plus faible, le bleu domine et le vert le suit de près.
    expect(r).toBeLessThan(Math.min(g, b));
    expect(b).toBeGreaterThanOrEqual(g);
    expect(distance(COLOR.wheel, COLOR.booster)).toBeGreaterThan(60);
    expect(distance(COLOR.wheel, COLOR.launcher)).toBeGreaterThan(60);
    expect(distance(COLOR.wheel, COLOR.obstacleEdge)).toBeGreaterThan(150);
  });

  it('est à plus de 40 de toute autre couleur de sens, zones comprises', () => {
    for (const [name, color] of Object.entries({ ...SPECIES, ...ZONES })) {
      if (name === 'wheel') continue;
      expect(distance(COLOR.wheel, color), name).toBeGreaterThan(40);
    }
  });
});

describe('mixPalette', () => {
  const a = PALETTES.biome1;
  const b = PALETTES.boss;

  it('aux extrémités, c\'est la palette donnée elle-même', () => {
    expect(mixPalette(a, b, 0)).toBe(a);
    expect(mixPalette(a, b, 1)).toBe(b);
    expect(mixPalette(a, b, -3)).toBe(a);
    expect(mixPalette(a, b, 7)).toBe(b);
  });

  it('mélange canal par canal : à mi-chemin, la moyenne de chaque champ', () => {
    const half = mixPalette(a, b, 0.5);
    for (const field of FIELDS) {
      const expected = channels(a[field]).map((channel, index) => Math.round((channel + channels(b[field])[index]!) / 2));
      expect(channels(half[field]), field).toEqual(expected);
    }
    expect(half.background).toBe(0x0d0910);
  });

  it('chaque canal reste entre les deux palettes, et s\'éloigne de la première à mesure que t grandit', () => {
    let before = a;
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const mixed = mixPalette(a, b, t);
      for (const field of FIELDS) {
        channels(mixed[field]).forEach((channel, index) => {
          const low = Math.min(channels(a[field])[index]!, channels(b[field])[index]!);
          const high = Math.max(channels(a[field])[index]!, channels(b[field])[index]!);
          expect(channel).toBeGreaterThanOrEqual(low);
          expect(channel).toBeLessThanOrEqual(high);
        });
      }
      expect(distance(mixed.halo, a.halo)).toBeGreaterThan(distance(before.halo, a.halo));
      before = mixed;
    }
  });

  it('est pure : les palettes données ne bougent pas, deux appels donnent la même chose, et mélanger deux palettes égales ne change rien', () => {
    const snapshot = JSON.stringify([a, b]);
    expect(mixPalette(a, b, 0.3)).toEqual(mixPalette(a, b, 0.3));
    expect(mixPalette(a, b, 0.3)).not.toBe(mixPalette(a, b, 0.3));
    expect(JSON.stringify([a, b])).toBe(snapshot);
    expect(mixPalette(b, b, 0.4)).toEqual(b);
  });
});

describe('la teinte des bandes de l\'accordéon (0.14.0)', () => {
  it('est un bleu électrique : le bleu domine nettement, le rouge est le canal le plus faible', () => {
    const [r = 0, g = 0, b = 0] = channels(COLOR.accordion);
    expect(b).toBeGreaterThan(g);
    expect(b).toBeGreaterThan(r);
    expect(r).toBeLessThan(g);
    expect(b).toBeGreaterThanOrEqual(0xe0);
  });

  it('est à plus de 40 de toute autre couleur de sens, zones et poche comprises, et de toute couleur d\'effet d\'ambiance', () => {
    for (const [name, color] of Object.entries({ ...SPECIES, ...ZONES, pocket: COLOR.pocket })) {
      if (name === 'accordion') continue;
      expect(distance(COLOR.accordion, color), name).toBeGreaterThan(40);
    }
    for (const family of FAMILIES) {
      for (const field of ['effectA', 'effectB', 'effectC'] as const) expect(distance(COLOR.accordion, PALETTES[family][field]), `${family}.${field}`).toBeGreaterThan(40);
    }
  });

  it('se lit sur le fond nuit : bien plus clair que le fond de chaque ambiance', () => {
    const light = (color: number): number => channels(color).reduce((sum, channel) => sum + channel, 0);
    for (const family of FAMILIES) expect(light(COLOR.accordion), family).toBeGreaterThan(2 * light(PALETTES[family].background));
  });
});

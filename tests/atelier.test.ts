import { describe, expect, it } from 'vitest';
import { ATELIER_ELEMENTS, ATELIER_GROUPS, atelierEvents, atelierProfile, isAtelierId, parseAtelier, toggleAtelier, type AtelierId } from '../src/data/atelier';
import { REASONABLE, playRobot } from '../src/sim/robot';
import { Simulation } from '../src/sim/simulation';
import { DEFAULT_TUNING as T } from '../src/sim/tuning';

/** L'atelier (0.13.0) : « un vrai mode test où je peux choisir à quelles prises ou autres éléments je veux être confronté ». */
describe('le catalogue de l\'atelier', () => {
  it('a trente et un éléments, tous dans un groupe du catalogue, aux identifiants uniques', () => {
    expect(ATELIER_ELEMENTS).toHaveLength(31);
    const ids = new Set(ATELIER_ELEMENTS.map((element) => element.id));
    expect(ids.size).toBe(ATELIER_ELEMENTS.length);
    const groups = new Set(ATELIER_GROUPS.map((group) => group.id));
    for (const element of ATELIER_ELEMENTS) expect(groups.has(element.group), element.id).toBe(true);
    for (const group of ATELIER_GROUPS) expect(ATELIER_ELEMENTS.some((element) => element.group === group.id), group.id).toBe(true);
  });

  it('relit une liste d\'adresse ou de profil : inconnus ignorés, doublons fondus, ordre du catalogue', () => {
    expect(parseAtelier('tournant, roue,roue,machin,fragile')).toEqual(['fragile', 'roue', 'tournant']);
    expect(parseAtelier(null)).toEqual([]);
    expect(parseAtelier('')).toEqual([]);
    expect(isAtelierId('porte')).toBe(true);
    expect(isAtelierId('portes')).toBe(false);
    expect(toggleAtelier(['roue'], 'fragile')).toEqual(['fragile', 'roue']);
    expect(toggleAtelier(['fragile', 'roue'], 'roue')).toEqual(['fragile']);
  });

  it('donne un profil qui ne porte que les éléments choisis, et une chaîne simple si rien n\'en demande', () => {
    const plain = atelierProfile([]);
    expect(plain.archetypes).toEqual(['chaine', 'couloir']);
    expect(plain).toMatchObject({ obstacles: 0, fragileChance: 0, boosters: 0, electric: 0, eclipse: 0, bouncers: 0, breakables: 0, doors: 0, rings: 0, rotors: 0 });
    const chosen = atelierProfile(['roue', 'tournant', 'porte', 'fragile', 'courant']);
    expect(chosen.archetypes).toEqual(['fragiles', 'roue', 'tournant', 'courant']);
    expect(chosen).toMatchObject({ fragileChance: 0.4, doors: 1, rotors: 1, obstacles: 0 });
    expect(atelierProfile(['dalles', 'propulseur', 'anneau']).archetypes).toEqual(['dalles', 'rafale', 'saut']);
    expect(atelierProfile(['dalles', 'propulseur', 'anneau'])).toMatchObject({ obstacles: 2, boosters: 1, rings: 1 });
    expect(atelierEvents(['vent', 'roue', 'bascule'])).toEqual(['bascule', 'vent']);
  });
});

describe('une partie d\'atelier', () => {
  it('n\'engendre que les éléments choisis, à chaque segment, et le robot y survit', () => {
    const selection: AtelierId[] = ['roue', 'porte'];
    const sim = new Simulation(3, T, { kind: 'atelier', startY: 0, selection });
    const wheels = sim.state.anchors.filter((a) => a.kind === 'roue').length;
    const doors = sim.state.obstacles.filter((o) => o.kind === 'porte').length;
    expect(wheels, 'roues').toBeGreaterThan(0);
    expect(doors, 'portes').toBeGreaterThan(0);
    expect(sim.state.anchors.some((a) => a.kind === 'fragile' || a.kind === 'booster' || a.kind === 'electrique')).toBe(false);
    expect(sim.state.obstacles.some((o) => o.kind === 'tournant' || o.kind === 'cassable')).toBe(false);
    expect(sim.state.zones).toHaveLength(0);
    expect(sim.state.schedule).toHaveLength(0);
    const report = playRobot(3, T, 30, REASONABLE, { kind: 'atelier', startY: 0, selection });
    expect(report.height).toBeGreaterThan(20);
  });

  it('les événements choisis se succèdent, et sans sélection la partie est une chaîne nue', () => {
    const windy = new Simulation(4, T, { kind: 'atelier', startY: 0, selection: ['vent', 'panne'] });
    expect(windy.state.schedule.length).toBeGreaterThan(0);
    expect(windy.state.schedule.every((e) => e.kind === 'vent' || e.kind === 'panne')).toBe(true);
    const bare = new Simulation(4, T, { kind: 'atelier', startY: 0, selection: [] });
    expect(bare.state.anchors.every((a) => a.kind === 'normal')).toBe(true);
    expect(bare.state.obstacles).toHaveLength(0);
    expect(bare.state.schedule).toHaveLength(0);
  });
});

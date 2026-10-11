import { heldKind } from '../render/cues';
import type { RuleEvent, SimState } from '../sim/state';

/**
 * Le tutoriel par l'action (brief du 11 octobre 2026) : pas d'écran
 * d'explications, des conseils courts au moment même du geste, chacun une seule
 * fois par profil, qui s'effacent donc d'eux-mêmes une fois compris. Les
 * conseils déjà vus sont gardés dans le profil (`profile.tips`).
 *
 * Pur : `observe` lit l'état de la simulation et les événements de l'image,
 * et rend le conseil à montrer, ou null. Le jeu l'affiche par la bannière des
 * conseils (`effects.tip`) et le note dans le profil.
 */

export type TipId = 'grab' | 'window' | 'catch' | 'launcher' | 'perfect';

export interface Tip {
  readonly id: TipId;
  readonly title: string;
  readonly detail: string | null;
}

export const TIPS: Record<TipId, Tip> = {
  grab: { id: 'grab', title: 'Garde le doigt posé', detail: "Tu prends de l'élan" },
  window: { id: 'window', title: 'Lâche en montant !', detail: null },
  catch: { id: 'catch', title: 'Appuie pour rattraper', detail: null },
  launcher: { id: 'launcher', title: 'Tire le doigt vers le bas', detail: 'Lâche pour partir' },
  perfect: { id: 'perfect', title: 'Parfait !', detail: 'Enchaîne pour monter le multiplicateur' },
};

/** Tenue minimale avant de conseiller de lâcher, en secondes : le temps de voir que l'élan monte. */
export const WINDOW_TIP_AFTER_SECONDS = 0.3;

/** Vrai pour un identifiant de conseil connu. */
export function isTipId(id: string): id is TipId {
  return id in TIPS;
}

export class Coach {
  private readonly seen: Set<TipId>;
  /** Une corde a été lâchée dans cette partie : le prochain vol avec une cible appelle le conseil « rattrape ». */
  private released = false;

  constructor(seen: readonly string[] = []) {
    this.seen = new Set(seen.filter(isTipId));
  }

  /** Les identifiants des conseils déjà donnés, pour le profil. */
  get ids(): TipId[] {
    return [...this.seen];
  }

  /**
   * Une image de partie : l'état après ses pas, les événements de règles de
   * l'image, la fenêtre de lâcher, et depuis combien de secondes la corde est
   * tenue. Un conseil au plus par image, jamais deux fois le même.
   */
  observe(state: SimState, events: readonly RuleEvent[], inWindow: boolean, heldSeconds: number): Tip | null {
    for (const event of events) {
      if (event.type === 'release') this.released = true;
      if (event.type === 'release' && event.perfect && !event.forced) return this.show('perfect');
    }
    if (heldKind(state) === 'lanceur') return this.show('launcher');
    if (events.some((event) => event.type === 'attach')) return this.show('grab');
    if (state.rope && inWindow && heldSeconds >= WINDOW_TIP_AFTER_SECONDS && this.seen.has('grab')) return this.show('window');
    if (!state.rope && this.released && state.targetId !== null) return this.show('catch');
    return null;
  }

  /** Le conseil n'a pas pu être montré (une bannière de niveau ou d'événement était en cours) : il reste à donner. */
  forget(id: TipId): void {
    this.seen.delete(id);
  }

  private show(id: TipId): Tip | null {
    if (this.seen.has(id)) return null;
    this.seen.add(id);
    return TIPS[id];
  }
}

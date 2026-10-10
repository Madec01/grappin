import type { RuleEvent, SimState } from '../sim/state';
import type { Tuning } from '../sim/tuning';
import type { RunStats } from './missions';

/**
 * Suiveur de partie : relève, au fil des événements de règles, ce dont les
 * missions ont besoin. Sans temps réel ni rendu ; il lit l'état final pour la
 * hauteur et la durée.
 */
export class RunTracker {
  private holds = 0;
  private perfectStreak = 0;
  private bestPerfectStreak = 0;
  private grazes = 0;
  private pickups = 0;
  private bestCombo = 0;
  private fragileReleases = 0;
  private boosters = 0;

  handle(event: RuleEvent): void {
    switch (event.type) {
      case 'release':
        if (!event.forced && event.held >= 1) this.holds += 1;
        if (!event.forced && event.kind === 'fragile') this.fragileReleases += 1;
        if (!event.forced && event.kind === 'booster') this.boosters += 1;
        this.perfectStreak = event.perfect ? this.perfectStreak + 1 : 0;
        this.bestPerfectStreak = Math.max(this.bestPerfectStreak, this.perfectStreak);
        this.bestCombo = Math.max(this.bestCombo, event.combo);
        break;
      case 'graze':
        this.grazes += 1;
        break;
      case 'pickup':
        this.pickups += 1;
        break;
      default:
        break;
    }
  }

  /** Bilan de la partie, à sa fin. La hauteur est celle grimpée depuis le toit de départ, dans tous les modes. */
  stats(state: SimState, tuning: Tuning): RunStats {
    return {
      holds: this.holds,
      perfectStreak: this.bestPerfectStreak,
      grazes: this.grazes,
      height: state.height - state.groundY,
      pickups: this.pickups,
      combo: this.bestCombo,
      fragileReleases: this.fragileReleases,
      boosters: this.boosters,
      seconds: state.step * tuning.stepSeconds,
    };
  }
}

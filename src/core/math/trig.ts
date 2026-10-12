/**
 * Sinus et cosinus déterministes, en tours (1 tour = un cercle entier), pour
 * la simulation, où la trigonométrie du moteur JavaScript est interdite : ses
 * derniers chiffres changent d'une machine à l'autre, et un rejeu diffèrerait.
 * Ici, quatre opérations seulement : une parabole redressée par une petite
 * correction (l'approximation classique des jeux), juste à 0,001 près, ce qui
 * suffit à une barre qui tourne ou à une roue que l'on dessine.
 */

/** La partie fractionnaire de `t`, ramenée dans [-0,5 ; 0,5). */
function wrapTurns(t: number): number {
  const x = t - Math.floor(t);
  return x >= 0.5 ? x - 1 : x;
}

/** sin(2πt), pour `t` en tours. */
export function sinTurns(t: number): number {
  const x = wrapTurns(t);
  // La parabole 8x - 16x|x| vaut 0 en 0 et ±0,5, et ±1 en ±0,25, comme le sinus ; la correction rabote son erreur (0,056) à 0,001.
  const y = 8 * x - 16 * x * (x < 0 ? -x : x);
  return 0.225 * (y * (y < 0 ? -y : y) - y) + y;
}

/** cos(2πt), pour `t` en tours. */
export function cosTurns(t: number): number {
  return sinTurns(t + 0.25);
}

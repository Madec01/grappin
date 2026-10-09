/**
 * Paliers de hauteur nommés, un tous les `tierHeight` mètres. Les noms
 * suivent l'ascension nocturne d'une ville ; ils sont proposés au propriétaire
 * et se changent ici sans toucher au code.
 */
export const TIER_NAMES: readonly string[] = [
  'Les toits',
  'Les gouttières',
  'Les enseignes',
  'Les clochers',
  'Les antennes',
  'Les grues',
  'Les nuages',
];

export function tierName(tier: number): string {
  return TIER_NAMES[Math.min(tier, TIER_NAMES.length - 1)] ?? TIER_NAMES[0]!;
}

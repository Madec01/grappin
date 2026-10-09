/** Nombre à la française : virgule décimale, deux décimales au plus, sans zéros inutiles. */
export function formatDecimal(value: number): string {
  return String(Number(value.toFixed(2))).replace('.', ',');
}

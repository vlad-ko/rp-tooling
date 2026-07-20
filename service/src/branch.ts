/**
 * Strictly below the threshold — a verdict AT the threshold is accepted
 * as-is (0.6 vs 0.6 does not enrich; tests pin 0.59/0.6/0.61).
 */
export function shouldEnrich(confidence: number, threshold: number): boolean {
  return confidence < threshold;
}

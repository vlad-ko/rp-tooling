export function shouldEnrich(confidence: number, threshold: number): boolean {
  return confidence < threshold;
}

/**
 * Strictly below the threshold — a verdict AT the threshold is accepted
 * as-is (0.6 vs 0.6 does not enrich; tests pin 0.59/0.6/0.61).
 */
export function shouldEnrich(confidence: number, threshold: number): boolean {
  return confidence < threshold;
}

/**
 * A revert's comment describes the edit BEING UNDONE, not the acting edit —
 * for reverts the metadata is misleading by construction, so the pipeline
 * forces enrichment regardless of pass-1 confidence (issue #31: the model
 * labeled an anti-vandalism repair `vandalism` at 0.9 off the quoted
 * comment). Prefix-only matching; a false positive costs one diff fetch,
 * never a wrong verdict.
 */
export function isRevert(comment: string): boolean {
  const c = comment.trim().toLowerCase();
  return c.startsWith('undid revision') || c.startsWith('revert') || /^rvv?\b/.test(c);
}

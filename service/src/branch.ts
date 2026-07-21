import type { Label } from './types.js';

/**
 * Strictly below the threshold — a verdict AT the threshold is accepted
 * as-is (0.6 vs 0.6 does not enrich; tests pin 0.59/0.6/0.61).
 */
export function shouldEnrich(confidence: number, threshold: number): boolean {
  return confidence < threshold;
}

/**
 * Byte count owns the MAGNITUDE axis (trivia = small change, substantive =
 * large change) exactly; the LLM owns the QUALITY axis (vandalism / unclear),
 * which is size-independent. So a verdict whose magnitude label is impossible
 * for its byte delta is corrected to the opposite magnitude label — the byte
 * count ELIMINATES the wrong label rather than the LLM guessing it (issue #39):
 *   |delta| < substantiveMinBytes  ⇒ 'substantive' impossible → 'trivia'
 *   |delta| >= triviaMaxBytes      ⇒ 'trivia' impossible      → 'substantive'
 * Between the bounds both are plausible, so the LLM's verdict stands.
 * 'vandalism' / 'unclear' are never touched (quality axis). Null delta (both
 * lengths absent) is unprovable, so the label is left unchanged.
 */
export function reconcileLabelWithSize(
  label: Label,
  byteDelta: number | null,
  substantiveMinBytes: number,
  triviaMaxBytes: number,
): Label {
  if (byteDelta === null) return label;
  const magnitude = Math.abs(byteDelta);
  if (label === 'substantive' && magnitude < substantiveMinBytes) return 'trivia';
  if (label === 'trivia' && magnitude >= triviaMaxBytes) return 'substantive';
  return label;
}

/**
 * A revert's comment describes the edit BEING UNDONE, not the acting edit —
 * for reverts the metadata is misleading by construction, so the pipeline
 * forces enrichment regardless of pass-1 confidence (issue #31: the model
 * labeled an anti-vandalism repair `vandalism` at 0.9 off the quoted
 * comment). Prefix matching against the known MediaWiki revert-summary forms
 * (undo / rollback / restore-to-revision / rv shorthand); the recentchange
 * SSE stream carries no change-tags, so the comment is the only zero-cost
 * signal (issue #35). A false positive costs one diff fetch, never a wrong
 * verdict, so the prefixes are deliberately generous.
 */
export function isRevert(comment: string): boolean {
  // MediaWiki prepends "/* Section name */" on section edits — the revert
  // syntax follows the marker (live escape: issue #33).
  const c = comment.replace(/^\/\*.*?\*\/\s*/, '').trim().toLowerCase();
  return (
    c.startsWith('undid revision') ||
    c.startsWith('revert') ||
    c.startsWith('restore') ||
    /^rvv?\b/.test(c)
  );
}

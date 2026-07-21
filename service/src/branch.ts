import type { Label } from './types.js';

/**
 * Strictly below the threshold — a verdict AT the threshold is accepted
 * as-is (0.6 vs 0.6 does not enrich; tests pin 0.59/0.6/0.61).
 */
export function shouldEnrich(confidence: number, threshold: number): boolean {
  return confidence < threshold;
}

/**
 * Hard coherence gate (issue #37): 'trivia' means a negligible change, so an
 * LLM trivia verdict cannot coexist with a byte delta beyond the gate. The
 * mirror of the heuristic-gate trivia FLOOR. Only meaningful for LLM verdicts
 * — heuristic-assigned trivia (bot / tiny-minor) is policy and exempt. Null
 * delta (both lengths absent) is unprovable, so not flagged.
 */
export function exceedsTriviaGate(label: Label, byteDelta: number | null, gate: number): boolean {
  return label === 'trivia' && byteDelta !== null && Math.abs(byteDelta) > gate;
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

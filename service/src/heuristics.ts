import type { Classification, FilteredEdit } from './types.js';

export type HeuristicResult =
  | { skip: true; classification: Classification }
  | { skip: false };

/**
 * Null only when BOTH lengths are absent (delta unknowable); one missing
 * side is treated as 0 so a page creation still yields a magnitude.
 */
export function byteDelta(edit: FilteredEdit): number | null {
  if (edit.length_old === null && edit.length_new === null) return null;
  return (edit.length_new ?? 0) - (edit.length_old ?? 0);
}

/**
 * Zero-LLM short-circuit for the obvious cases. Bot check is
 * defense-in-depth: Connect already filters bots, but the service does not
 * trust its upstream (replays, other producers). Tiny-minor check is
 * inclusive (<= tinyDelta) and requires the delta to be known.
 */
export function heuristicGate(edit: FilteredEdit, tinyDelta: number): HeuristicResult {
  if (edit.bot) {
    return {
      skip: true,
      classification: { label: 'trivia', confidence: 1.0, reason: 'bot-flagged edit' },
    };
  }
  const delta = byteDelta(edit);
  if (edit.minor && delta !== null && Math.abs(delta) <= tinyDelta) {
    return {
      skip: true,
      classification: {
        label: 'trivia',
        confidence: 0.9,
        reason: `minor edit with tiny byte delta (${delta})`,
      },
    };
  }
  return { skip: false };
}

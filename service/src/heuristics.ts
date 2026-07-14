import type { Classification, FilteredEdit } from './types.js';

export type HeuristicResult =
  | { skip: true; classification: Classification }
  | { skip: false };

export function byteDelta(edit: FilteredEdit): number | null {
  if (edit.length_old === null && edit.length_new === null) return null;
  return (edit.length_new ?? 0) - (edit.length_old ?? 0);
}

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

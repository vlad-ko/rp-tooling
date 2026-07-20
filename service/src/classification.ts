import { LABELS, type Classification, type Label } from './types.js';

/**
 * Forgives formatting (case, whitespace, surrounding quotes, trailing
 * punctuation) but never meaning: anything outside the closed enum returns
 * null — no fuzzy mapping of near-misses like "vandal" or "spam".
 */
export function normalizeLabel(raw: unknown): Label | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^["'`]+/, '').replace(/["'`]+$/, '');
  s = s.replace(/[.,;:!?]+$/, '');
  s = s.trim();
  return (LABELS as readonly string[]).includes(s) ? (s as Label) : null;
}

/** Accepts numbers and numeric strings; clamps into [0, 1]; null otherwise. */
function toConfidence(raw: unknown): number | null {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    n = Number(raw);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/**
 * Null (never a partial result) when label or confidence is unusable;
 * a missing reason alone does not reject — it defaults to ''.
 */
export function parseClassification(value: unknown): Classification | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const label = normalizeLabel(o['label']);
  if (label === null) return null;
  const confidence = toConfidence(o['confidence']);
  if (confidence === null) return null;
  const reason = typeof o['reason'] === 'string' ? o['reason'] : '';
  return { label, confidence, reason };
}

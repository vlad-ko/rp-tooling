import type { FilteredEdit } from './types.js';

function toNumberOrNull(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toStringOr(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw : fallback;
}

export function decodeFilteredEdit(value: Buffer | string | null | undefined): FilteredEdit | null {
  if (value == null) return null;
  const text = typeof value === 'string' ? value : value.toString('utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const rcId = toNumberOrNull(o['rc_id']);
  if (rcId === null) return null;
  return {
    rc_id: rcId,
    title: toStringOr(o['title'], ''),
    title_url: toStringOr(o['title_url'], ''),
    comment: toStringOr(o['comment'], ''),
    user: toStringOr(o['user'], ''),
    bot: o['bot'] === true,
    minor: o['minor'] === true,
    length_old: toNumberOrNull(o['length_old']),
    length_new: toNumberOrNull(o['length_new']),
    rev_old: toNumberOrNull(o['rev_old']),
    rev_new: toNumberOrNull(o['rev_new']),
    server_url: toStringOr(o['server_url'], ''),
    notify_url: toStringOr(o['notify_url'], ''),
    domain: toStringOr(o['domain'], ''),
    event_time: toStringOr(o['event_time'], ''),
  };
}

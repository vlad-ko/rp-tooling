import { describe, expect, it } from 'vitest';
import { decodeFilteredEdit } from '../src/decode.js';

const validPayload = {
  rc_id: 144234786,
  title: 'Example Page',
  title_url: 'https://en.wikipedia.org/wiki/Example_Page',
  comment: 'fixed typo',
  user: 'SomeUser',
  bot: false,
  minor: true,
  length_old: 100,
  length_new: 104,
  rev_old: 500,
  rev_new: 501,
  server_url: 'https://en.wikipedia.org',
  notify_url: 'https://en.wikipedia.org/w/index.php?diff=501&oldid=500',
  domain: 'en.wikipedia.org',
  event_time: '2026-07-13T12:00:00Z',
};

describe('decodeFilteredEdit', () => {
  it('returns null for malformed JSON (poison pill)', () => {
    expect(decodeFilteredEdit('{"rc_id": 1,')).toBeNull();
  });

  it('returns null for valid JSON with no rc_id', () => {
    expect(decodeFilteredEdit(JSON.stringify({ title: 'X', user: 'Y' }))).toBeNull();
  });

  it('coerces a numeric-string rc_id to a number', () => {
    const decoded = decodeFilteredEdit(JSON.stringify({ ...validPayload, rc_id: '144234786' }));
    expect(decoded).not.toBeNull();
    expect(decoded?.rc_id).toBe(144234786);
    expect(typeof decoded?.rc_id).toBe('number');
  });

  it("defaults a missing comment to ''", () => {
    const { comment: _omit, ...rest } = validPayload;
    const decoded = decodeFilteredEdit(JSON.stringify(rest));
    expect(decoded?.comment).toBe('');
  });

  it('defaults missing lengths to null', () => {
    const { length_old: _a, length_new: _b, ...rest } = validPayload;
    const decoded = decodeFilteredEdit(JSON.stringify(rest));
    expect(decoded?.length_old).toBeNull();
    expect(decoded?.length_new).toBeNull();
  });

  it('ignores unknown extra fields', () => {
    const decoded = decodeFilteredEdit(JSON.stringify({ ...validPayload, wombat: true, extra: 'x' }));
    expect(decoded).not.toBeNull();
    expect(decoded && 'wombat' in decoded).toBe(false);
    expect(decoded?.rc_id).toBe(144234786);
  });

  it('returns null for a null message value', () => {
    expect(decodeFilteredEdit(null)).toBeNull();
  });
});

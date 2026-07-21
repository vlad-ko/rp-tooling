import { describe, expect, it } from 'vitest';
import { formatDecision } from '../src/consumer.js';
import type { EditRow } from '../src/types.js';

function makeRow(overrides: Partial<EditRow> = {}): EditRow {
  return {
    rc_id: 12345,
    title: 'Belgrade',
    title_url: 'https://en.wikipedia.org/wiki/Belgrade',
    editor: 'Alice',
    comment: 'expanded history',
    is_bot: false,
    is_minor: false,
    byte_delta: 110,
    rev_old: 500,
    rev_new: 501,
    notify_url: null,
    domain: 'en.wikipedia.org',
    event_time: '2026-07-13T12:00:00Z',
    label: 'substantive',
    confidence: 0.9,
    reason: 'adds sourced content',
    pass: 'llm-1',
    enriched: false,
    error: null,
    model: 'llama3.2:3b',
    processed_at: '2026-07-13T12:34:56.000Z',
    ...overrides,
  };
}

describe('formatDecision', () => {
  it('formats a clean llm-1 verdict on one greppable line', () => {
    expect(formatDecision(makeRow())).toBe(
      '[triage] substantive 0.90 pass=llm-1 delta=+110 rc=12345 "Belgrade"',
    );
  });

  it('marks an enriched llm-2 verdict', () => {
    expect(
      formatDecision(makeRow({ label: 'vandalism', confidence: 0.95, pass: 'llm-2', enriched: true })),
    ).toBe('[triage] vandalism 0.95 pass=llm-2 +enriched delta=+110 rc=12345 "Belgrade"');
  });

  it('shows a negative delta with its sign', () => {
    expect(formatDecision(makeRow({ byte_delta: -3082 }))).toContain('delta=-3082');
  });

  it('renders an unknown delta as ?', () => {
    expect(formatDecision(makeRow({ byte_delta: null }))).toContain('delta=?');
  });

  it('appends the error/override note after a pipe', () => {
    expect(
      formatDecision(
        makeRow({
          label: 'substantive',
          error: 'size_label_override: trivia -> substantive (|byte_delta| out of range for trivia)',
        }),
      ),
    ).toBe(
      '[triage] substantive 0.90 pass=llm-1 delta=+110 rc=12345 "Belgrade" | size_label_override: trivia -> substantive (|byte_delta| out of range for trivia)',
    );
  });

  it('quotes the title so odd characters stay on one field', () => {
    expect(formatDecision(makeRow({ title: 'AC/DC "Back in Black"' }))).toContain(
      'rc=12345 "AC/DC \\"Back in Black\\""',
    );
  });
});

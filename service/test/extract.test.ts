import { describe, expect, it } from 'vitest';
import { extractJsonObject } from '../src/extract.js';
import { fixture } from './helpers.js';

describe('extractJsonObject', () => {
  it('accepts a bare JSON object', () => {
    const result = extractJsonObject('{"label":"trivia","confidence":0.9,"reason":"typo"}');
    expect(result).toEqual({ ok: true, value: { label: 'trivia', confidence: 0.9, reason: 'typo' } });
  });

  it('extracts from a ```json fenced block', () => {
    const result = extractJsonObject(fixture('fenced.txt'));
    expect(result).toEqual({
      ok: true,
      value: { label: 'vandalism', confidence: 0.92, reason: 'Blanked a section and inserted profanity.' },
    });
  });

  it('extracts from a fenced block without a language tag', () => {
    const result = extractJsonObject(fixture('fenced-no-lang.txt'));
    expect(result).toEqual({
      ok: true,
      value: { label: 'trivia', confidence: 0.7, reason: 'Fixed a spelling mistake.' },
    });
  });

  it('extracts the exact object from prose-wrapped output', () => {
    const result = extractJsonObject(fixture('prose-wrapped.txt'));
    expect(result).toEqual({
      ok: true,
      value: { label: 'substantive', confidence: 0.75, reason: 'Adds sourced content about the topic.' },
    });
  });

  it('returns the FIRST object when two complete objects are present', () => {
    const result = extractJsonObject(fixture('double-object.txt'));
    expect(result).toEqual({ ok: true, value: { label: 'trivia', confidence: 0.8, reason: 'first' } });
  });

  it('preserves triple-backtick sequences inside string values byte-for-byte', () => {
    const result = extractJsonObject(
      '{"label":"unclear","confidence":0.5,"reason":"see ```code``` block"}',
    );
    expect(result).toEqual({
      ok: true,
      value: { label: 'unclear', confidence: 0.5, reason: 'see ```code``` block' },
    });
  });

  it('keeps braces inside string values intact', () => {
    const result = extractJsonObject(fixture('nested-braces-in-string.txt'));
    expect(result).toEqual({
      ok: true,
      value: {
        label: 'unclear',
        confidence: 0.4,
        reason: 'The comment contains {curly} braces and even a stray } inside the string.',
      },
    });
  });

  it.each([
    'truncated.txt',
    'truncated-string.txt',
    'empty.txt',
    'whitespace.txt',
    'refusal.txt',
    'array-not-object.txt',
  ])('rejects %s with a non-empty reason', (name) => {
    const result = extractJsonObject(fixture(name));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

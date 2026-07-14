import { describe, expect, it } from 'vitest';
import { normalizeLabel, parseClassification } from '../src/classification.js';
import { extractJsonObject } from '../src/extract.js';
import { fixture } from './helpers.js';

function extracted(name: string): unknown {
  const result = extractJsonObject(fixture(name));
  if (!result.ok) throw new Error(`fixture ${name} did not extract: ${result.reason}`);
  return result.value;
}

describe('normalizeLabel', () => {
  it.each(['vandalism', 'substantive', 'trivia', 'unclear'])('accepts exact enum value %s', (label) => {
    expect(normalizeLabel(label)).toBe(label);
  });

  it("normalizes 'Vandalism' casing", () => {
    expect(normalizeLabel('Vandalism')).toBe('vandalism');
  });

  it("normalizes 'SUBSTANTIVE' casing", () => {
    expect(normalizeLabel('SUBSTANTIVE')).toBe('substantive');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeLabel('  trivia  ')).toBe('trivia');
  });

  it('strips trailing period', () => {
    expect(normalizeLabel('vandalism.')).toBe('vandalism');
  });

  it('strips trailing exclamation mark', () => {
    expect(normalizeLabel('trivia!')).toBe('trivia');
  });

  it('strips surrounding quotes', () => {
    expect(normalizeLabel('"unclear"')).toBe('unclear');
  });

  it("rejects 'spam' (no fuzzy mapping)", () => {
    expect(normalizeLabel('spam')).toBeNull();
  });

  it("rejects 'minor'", () => {
    expect(normalizeLabel('minor')).toBeNull();
  });

  it("rejects 'substantive edit'", () => {
    expect(normalizeLabel('substantive edit')).toBeNull();
  });

  it("rejects 'vandal'", () => {
    expect(normalizeLabel('vandal')).toBeNull();
  });

  it('rejects a number', () => {
    expect(normalizeLabel(7)).toBeNull();
  });

  it('rejects null', () => {
    expect(normalizeLabel(null)).toBeNull();
  });

  it('rejects an object', () => {
    expect(normalizeLabel({})).toBeNull();
  });
});

describe('parseClassification', () => {
  it('parses a well-formed classification exactly', () => {
    expect(
      parseClassification({ label: 'vandalism', confidence: 0.92, reason: 'Blanked a section.' }),
    ).toEqual({ label: 'vandalism', confidence: 0.92, reason: 'Blanked a section.' });
  });

  it('coerces a numeric-string confidence ("0.8")', () => {
    expect(parseClassification(extracted('confidence-string.txt'))).toEqual({
      label: 'trivia',
      confidence: 0.8,
      reason: 'Typo fix only.',
    });
  });

  it('clamps confidence 1.4 down to 1', () => {
    const result = parseClassification(extracted('confidence-out-of-range.txt'));
    expect(result?.confidence).toBe(1);
  });

  it('clamps confidence -0.2 up to 0', () => {
    const result = parseClassification({ label: 'trivia', confidence: -0.2, reason: 'r' });
    expect(result?.confidence).toBe(0);
  });

  it('rejects NaN confidence', () => {
    expect(parseClassification({ label: 'trivia', confidence: Number.NaN, reason: 'r' })).toBeNull();
  });

  it('rejects missing confidence', () => {
    expect(parseClassification({ label: 'trivia', reason: 'r' })).toBeNull();
  });

  it('rejects non-numeric confidence', () => {
    expect(parseClassification({ label: 'trivia', confidence: 'high', reason: 'r' })).toBeNull();
  });

  it('rejects missing label', () => {
    expect(parseClassification({ confidence: 0.9, reason: 'r' })).toBeNull();
  });

  it('rejects an off-enum label in well-formed JSON', () => {
    expect(parseClassification(extracted('off-enum-label.txt'))).toBeNull();
  });

  it('normalizes label casing from a real fixture', () => {
    expect(parseClassification(extracted('label-casing.txt'))).toEqual({
      label: 'vandalism',
      confidence: 0.85,
      reason: 'Obvious page defacement.',
    });
  });

  it("defaults missing reason to ''", () => {
    expect(parseClassification({ label: 'unclear', confidence: 0.5 })).toEqual({
      label: 'unclear',
      confidence: 0.5,
      reason: '',
    });
  });
});

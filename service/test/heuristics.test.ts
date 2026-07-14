import { describe, expect, it } from 'vitest';
import { heuristicGate } from '../src/heuristics.js';
import { makeEdit } from './helpers.js';

const TINY_DELTA = 5;

describe('heuristicGate', () => {
  it('skips bot edits as trivia with confidence exactly 1.0', () => {
    const result = heuristicGate(makeEdit({ bot: true }), TINY_DELTA);
    expect(result.skip).toBe(true);
    if (!result.skip) throw new Error('expected skip');
    expect(result.classification.label).toBe('trivia');
    expect(result.classification.confidence).toBe(1.0);
  });

  it('skips a minor edit with byte delta +5 (boundary) as trivia confidence 0.9', () => {
    const result = heuristicGate(makeEdit({ minor: true, length_old: 100, length_new: 105 }), TINY_DELTA);
    expect(result.skip).toBe(true);
    if (!result.skip) throw new Error('expected skip');
    expect(result.classification.label).toBe('trivia');
    expect(result.classification.confidence).toBe(0.9);
  });

  it('skips a minor edit with byte delta -5 (boundary)', () => {
    const result = heuristicGate(makeEdit({ minor: true, length_old: 105, length_new: 100 }), TINY_DELTA);
    expect(result.skip).toBe(true);
  });

  it('classifies a minor edit with byte delta 6 (just past boundary)', () => {
    const result = heuristicGate(makeEdit({ minor: true, length_old: 100, length_new: 106 }), TINY_DELTA);
    expect(result.skip).toBe(false);
  });

  it('classifies a non-minor edit even with byte delta 1', () => {
    const result = heuristicGate(makeEdit({ minor: false, length_old: 100, length_new: 101 }), TINY_DELTA);
    expect(result.skip).toBe(false);
  });

  it('classifies a minor edit whose byte delta is underivable (both lengths null)', () => {
    const result = heuristicGate(makeEdit({ minor: true, length_old: null, length_new: null }), TINY_DELTA);
    expect(result.skip).toBe(false);
  });

  it('never skips with a label other than trivia (never vandalism)', () => {
    const edits = [
      makeEdit({ bot: true }),
      makeEdit({ minor: true, length_old: 100, length_new: 100 }),
      makeEdit({ bot: true, minor: true, length_old: null, length_new: null }),
    ];
    for (const edit of edits) {
      const result = heuristicGate(edit, TINY_DELTA);
      if (result.skip) {
        expect(result.classification.label).toBe('trivia');
      }
    }
  });
});

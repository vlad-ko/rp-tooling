import { describe, expect, it } from 'vitest';
import { shouldEnrich } from '../src/branch.js';

describe('shouldEnrich', () => {
  it('enriches just below the threshold (0.59 vs 0.6)', () => {
    expect(shouldEnrich(0.59, 0.6)).toBe(true);
  });

  it('does NOT enrich exactly at the threshold (0.60 vs 0.6)', () => {
    expect(shouldEnrich(0.6, 0.6)).toBe(false);
  });

  it('does NOT enrich just above the threshold (0.61 vs 0.6)', () => {
    expect(shouldEnrich(0.61, 0.6)).toBe(false);
  });

  it('enriches at confidence 0', () => {
    expect(shouldEnrich(0, 0.6)).toBe(true);
  });

  it('does NOT enrich at confidence 1', () => {
    expect(shouldEnrich(1, 0.6)).toBe(false);
  });

  it('respects a different threshold parameter (0.7 vs 0.8)', () => {
    expect(shouldEnrich(0.7, 0.8)).toBe(true);
  });
});

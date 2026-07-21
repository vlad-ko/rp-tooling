import { describe, expect, it } from 'vitest';
import { isRevert, shouldEnrich } from '../src/branch.js';

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

describe('isRevert', () => {
  it('detects the live specimen: manual undo comment (rc_id 2046560908)', () => {
    expect(
      isRevert(
        'Undid revision [[Special:Diff/1364133786|1364133786]] by [[Special:Contributions/~2026-28226-33|~2026-28226-33]] ([[User talk:~2026-28226-33|talk]]) unexplained removal of source',
      ),
    ).toBe(true);
  });

  it('detects MediaWiki rollback phrasing', () => {
    expect(
      isRevert('Reverted edits by [[Special:Contributions/1.2.3.4|1.2.3.4]] to last version by Alice'),
    ).toBe(true);
  });

  it("detects 'rv' shorthand", () => {
    expect(isRevert('rv vandalism')).toBe(true);
  });

  it("detects 'rvv' shorthand", () => {
    expect(isRevert('rvv')).toBe(true);
  });

  it('is case-insensitive and trims leading whitespace', () => {
    expect(isRevert('  REVERTING unsourced changes')).toBe(true);
  });

  it('rejects an ordinary edit comment', () => {
    expect(isRevert('expanded the history section')).toBe(false);
  });

  it("rejects a comment merely mentioning reverts mid-sentence", () => {
    expect(isRevert('please discuss before reverting again')).toBe(false);
  });

  it('rejects the empty comment', () => {
    expect(isRevert('')).toBe(false);
  });

  it("accepts the known cost-only false positive: comments starting with 'RV '", () => {
    // "RV park" etc. — costs one diff fetch, never a wrong verdict.
    expect(isRevert('RV park section updated')).toBe(true);
  });

  it('detects the live escape: rv behind a section-edit marker (rc_id 2046561136)', () => {
    expect(isRevert('/* External links */ rv spammy external links')).toBe(true);
  });

  it('detects Undid revision behind a section-edit marker', () => {
    expect(isRevert('/* Early life */ Undid revision [[Special:Diff/123|123]] by [[Special:Contributions/X|X]]')).toBe(true);
  });

  it('rejects a plain section edit without revert syntax', () => {
    expect(isRevert('/* Career */ added dates')).toBe(false);
  });

  it('rejects a bare section marker', () => {
    expect(isRevert('/* External links */')).toBe(false);
  });
});

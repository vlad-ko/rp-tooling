import { describe, expect, it } from 'vitest';
import { exceedsTriviaGate, isRevert, shouldEnrich } from '../src/branch.js';

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

  it('detects the live "Restored revision" form (rc_id 2046560718)', () => {
    expect(
      isRevert(
        'Restored revision 1363988987 by [[Special:Contributions/~2026-39713-82|~2026-39713-82]] ([[User talk:~2026-39713-82|talk]]): Reversion of Vandalism and unexplained Removal of Sourced material',
      ),
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

  // Named regression anchor: the exact live comment that escaped the first
  // revert fix because MediaWiki prepends a section-edit marker (issue #33).
  it('detects the live escape: rv behind a section-edit marker (rc_id 2046561136)', () => {
    expect(isRevert('/* External links */ rv spammy external links')).toBe(true);
  });

  // The section-edit marker MUST be transparent to revert detection: for any
  // comment, prepending "/* Section */ " never changes the verdict. This
  // tests the strip-then-match MECHANISM, not the specimens — a hardcoded
  // section name or a dropped strip fails it, and it covers combinations no
  // specimen exercised (e.g. a section-scoped Huggle "Reverted edits by…").
  const MARKERS = ['/* External links */ ', '/* Early life */ ', '/* References & notes */ '];
  const COMMENTS = [
    'Undid revision [[Special:Diff/1|1]] by [[Special:Contributions/X|X]]',
    'Reverted edits by [[Special:Contributions/X|X]] to last version by Alice',
    'Reverted 2 edits by [[Special:Contributions/X|X]] (HG) (3.4.14)',
    'Restored revision 123 by [[Special:Contributions/X|X]]: Reversion of Vandalism',
    'rv spammy external links',
    'rvv',
    'expanded the career section', // non-revert
    'added two citations', // non-revert
    '', // empty
  ];
  for (const marker of MARKERS) {
    for (const comment of COMMENTS) {
      it(`section marker is transparent: "${marker}" + "${comment}"`, () => {
        expect(isRevert(marker + comment)).toBe(isRevert(comment));
      });
    }
  }

  it('rejects a bare section marker (no revert syntax follows)', () => {
    expect(isRevert('/* External links */')).toBe(false);
  });
});

describe('exceedsTriviaGate', () => {
  it('flags a trivia verdict whose |delta| exceeds the gate (live specimen +2076)', () => {
    expect(exceedsTriviaGate('trivia', 2076, 10)).toBe(true);
  });

  it('allows trivia exactly at the gate, flags one above', () => {
    expect(exceedsTriviaGate('trivia', 10, 10)).toBe(false);
    expect(exceedsTriviaGate('trivia', 11, 10)).toBe(true);
  });

  it('uses absolute value — a large negative delta is flagged too', () => {
    expect(exceedsTriviaGate('trivia', -3082, 10)).toBe(true);
  });

  it('never flags non-trivia labels', () => {
    expect(exceedsTriviaGate('substantive', 9999, 10)).toBe(false);
    expect(exceedsTriviaGate('vandalism', 9999, 10)).toBe(false);
    expect(exceedsTriviaGate('unclear', 9999, 10)).toBe(false);
  });

  it('does not flag when the delta is unknown (null)', () => {
    expect(exceedsTriviaGate('trivia', null, 10)).toBe(false);
  });
});

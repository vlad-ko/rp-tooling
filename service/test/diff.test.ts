import { describe, expect, it } from 'vitest';
import { extractCompareHtml, htmlToText, truncateDiff } from '../src/diff.js';

describe('extractCompareHtml', () => {
  it('returns the html string from a well-formed compare response', () => {
    expect(extractCompareHtml({ compare: { '*': '<td>x</td>' } })).toBe('<td>x</td>');
  });

  it('returns null when compare is missing', () => {
    expect(extractCompareHtml({ warnings: {} })).toBeNull();
  });

  it("returns null when compare has no '*' key", () => {
    expect(extractCompareHtml({ compare: { fromrevid: 1 } })).toBeNull();
  });

  it("returns null when '*' is not a string", () => {
    expect(extractCompareHtml({ compare: { '*': 42 } })).toBeNull();
  });

  it('returns null when the top-level response is not an object', () => {
    expect(extractCompareHtml('nope')).toBeNull();
  });
});

describe('truncateDiff', () => {
  it('does not truncate at exactly maxChars', () => {
    const result = truncateDiff('a'.repeat(4000), 4000);
    expect(result.truncated).toBe(false);
    expect(result.text.length).toBe(4000);
  });

  it('truncates at maxChars+1 to exactly maxChars', () => {
    const result = truncateDiff('a'.repeat(4001), 4000);
    expect(result.text.length).toBe(4000);
    expect(result.truncated).toBe(true);
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes basic entities', () => {
    expect(htmlToText('<td class="diff-addedline">foo &amp; bar &lt;3 &quot;q&quot;</td>')).toBe(
      'foo & bar <3 "q"',
    );
  });
});

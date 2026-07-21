import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { directionalDiff } from '../src/diff.js';

const here = dirname(fileURLToPath(import.meta.url));
const removalHtml = readFileSync(join(here, 'fixtures', 'compare-removal.html'), 'utf8');

describe('directionalDiff', () => {
  it('labels removed content as REMOVED (real Rolex spam-removal fixture)', () => {
    const out = directionalDiff(removalHtml);
    expect(out).toContain('REMOVED');
    expect(out.toLowerCase()).toContain('aandewatches'); // a removed spam link
    // it must NOT present the removed spam as if it were added — the whole bug
    expect(out).not.toMatch(/ADDED[\s\S]*aandewatches/);
  });

  it('labels added content as ADDED', () => {
    const html =
      '<td class="diff-marker" data-marker="+"></td>' +
      '<td class="diff-addedline diff-side-added"><div>The Eiffel Tower is in Paris.</div></td>';
    const out = directionalDiff(html);
    expect(out).toContain('ADDED');
    expect(out).toContain('Eiffel Tower is in Paris');
    expect(out).not.toContain('REMOVED');
  });

  it('distinguishes a modification: old value under REMOVED, new value under ADDED', () => {
    const html =
      '<td class="diff-deletedline diff-side-deleted"><div>born 1945</div></td>' +
      '<td class="diff-addedline diff-side-added"><div>born 1954</div></td>';
    const out = directionalDiff(html);
    expect(out).toMatch(/REMOVED[\s\S]*1945/);
    expect(out).toMatch(/ADDED[\s\S]*1954/);
  });

  it('decodes entities inside changed lines', () => {
    const html = '<td class="diff-addedline diff-side-added"><div>A &amp; B &lt;tag&gt;</div></td>';
    expect(directionalDiff(html)).toContain('A & B <tag>');
  });

  it('reports no textual changes when only context/unchanged lines are present', () => {
    const html = '<td class="diff-context diff-side-added"><div>unchanged line</div></td>';
    expect(directionalDiff(html)).toMatch(/no textual changes/i);
  });
});

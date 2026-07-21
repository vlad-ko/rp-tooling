/**
 * Pulls compare["*"] (the diff-HTML field in MediaWiki's legacy JSON shape)
 * out of an action=compare response; null on any shape surprise.
 */
export function extractCompareHtml(resp: unknown): string | null {
  if (typeof resp !== 'object' || resp === null || Array.isArray(resp)) return null;
  const compare = (resp as Record<string, unknown>)['compare'];
  if (typeof compare !== 'object' || compare === null || Array.isArray(compare)) return null;
  const html = (compare as Record<string, unknown>)['*'];
  return typeof html === 'string' ? html : null;
}

/**
 * Good-enough tag stripping + entity decoding for prompt text — NOT a
 * sanitizer (output goes to the LLM, never to a browser). &amp; is decoded
 * last so double-encoded entities cannot smuggle new ones in.
 */
export function htmlToText(html: string): string {
  const noTags = html.replace(/<[^>]*>/g, ' ');
  const decoded = noTags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return decoded.replace(/\s+/g, ' ').trim();
}

function extractCells(html: string, lineClass: string): string[] {
  const re = new RegExp(`<td[^>]*class="[^"]*${lineClass}[^"]*"[^>]*>([\\s\\S]*?)</td>`, 'g');
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    const text = htmlToText(m[1] ?? '');
    if (text) out.push(text);
  }
  return out;
}

/**
 * Turns the MediaWiki compare HTML into a DIRECTION-PRESERVING summary. The
 * add/remove direction lives in the `diff-deletedline` / `diff-addedline`
 * classes; flattening all tags (as htmlToText alone does) throws that away and
 * duplicates context, so the model can't tell a removal from an addition
 * (issue #50 — a spam REMOVAL read as "added excessive external links"). Here
 * removed and added lines are grouped and labelled so the model judges what
 * the edit actually did; pure context is dropped.
 */
export function directionalDiff(html: string): string {
  const removed = extractCells(html, 'diff-deletedline');
  const added = extractCells(html, 'diff-addedline');
  const parts: string[] = [];
  if (removed.length > 0) parts.push('REMOVED lines:', ...removed);
  if (added.length > 0) parts.push('ADDED lines:', ...added);
  return parts.length > 0 ? parts.join('\n') : '(no textual changes in this diff)';
}

/** Hard cap on prompt size; the flag records that context was cut. */
export function truncateDiff(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

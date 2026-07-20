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

/** Hard cap on prompt size; the flag records that context was cut. */
export function truncateDiff(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

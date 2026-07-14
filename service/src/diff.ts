export function extractCompareHtml(resp: unknown): string | null {
  if (typeof resp !== 'object' || resp === null || Array.isArray(resp)) return null;
  const compare = (resp as Record<string, unknown>)['compare'];
  if (typeof compare !== 'object' || compare === null || Array.isArray(compare)) return null;
  const html = (compare as Record<string, unknown>)['*'];
  return typeof html === 'string' ? html : null;
}

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

export function truncateDiff(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

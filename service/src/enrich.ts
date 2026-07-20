import { extractCompareHtml, htmlToText, truncateDiff } from './diff.js';
import type { EnrichmentContext } from './types.js';

export type FetchDiffResult = EnrichmentContext | { error: string };

export type FetchDiffFn = (serverUrl: string, revOld: number, revNew: number) => Promise<FetchDiffResult>;

const USER_AGENT = 'rp-tooling-triage/0.1 (local exercise; contact: repo owner)';

/**
 * Fetches the real diff via MediaWiki action=compare. Never throws — every
 * failure (network, timeout, HTTP status, shape) returns { error } so the
 * pipeline can keep the pass-1 verdict and record the reason. One retry,
 * immediate (enrichment is optional; not worth stalling the partition).
 */
export function createDiffFetcher(opts: { timeoutMs: number; maxChars: number }): FetchDiffFn {
  async function attempt(url: string): Promise<FetchDiffResult> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      return { error: `compare request failed: ${String(err)}` };
    }
    if (!res.ok) return { error: `compare request returned HTTP ${res.status}` };
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      return { error: `compare response is not JSON: ${String(err)}` };
    }
    const html = extractCompareHtml(body);
    if (html === null) return { error: 'unexpected compare response shape' };
    const { text, truncated } = truncateDiff(htmlToText(html), opts.maxChars);
    return { diffText: text, truncated, sourceUrl: url };
  }

  return async function fetchDiff(serverUrl, revOld, revNew) {
    const url = `${serverUrl}/w/api.php?action=compare&fromrev=${revOld}&torev=${revNew}&format=json`;
    const first = await attempt(url);
    if (!('error' in first)) return first;
    return attempt(url);
  };
}

export type ExtractResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Digs the FIRST balanced {...} object out of dirty model output (prose,
 * fences, trailing junk). String- and escape-aware, so braces inside string
 * values never fool the scan. Rejects (with a reason, for the error column):
 * empty output, top-level arrays, truncated objects, candidates that fail
 * JSON.parse. No fence-stripping preprocessing: fences sit outside the
 * braces anyway, and a stripping regex corrupted backticks INSIDE string
 * values (issue #20).
 */
export function extractJsonObject(text: string): ExtractResult {
  if (text.trim().length === 0) {
    return { ok: false, reason: 'empty or whitespace-only output' };
  }
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    return { ok: false, reason: 'top-level JSON array; a single object is required' };
  }
  if (objStart === -1) {
    return { ok: false, reason: 'no JSON object found in output' };
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = objStart; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(objStart, i + 1);
        try {
          return { ok: true, value: JSON.parse(candidate) as Record<string, unknown> };
        } catch (err) {
          return { ok: false, reason: `extracted candidate is not valid JSON: ${String(err)}` };
        }
      }
    }
  }
  return { ok: false, reason: 'truncated JSON object (braces never balanced)' };
}

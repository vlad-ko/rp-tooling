export type ExtractResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string };

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, '');
}

export function extractJsonObject(text: string): ExtractResult {
  const stripped = stripFences(text);
  if (stripped.trim().length === 0) {
    return { ok: false, reason: 'empty or whitespace-only output' };
  }
  const objStart = stripped.indexOf('{');
  const arrStart = stripped.indexOf('[');
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    return { ok: false, reason: 'top-level JSON array; a single object is required' };
  }
  if (objStart === -1) {
    return { ok: false, reason: 'no JSON object found in output' };
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = objStart; i < stripped.length; i++) {
    const ch = stripped.charAt(i);
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
        const candidate = stripped.slice(objStart, i + 1);
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

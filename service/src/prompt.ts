import type { FilteredEdit } from './types.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SYSTEM = [
  'You are a Wikipedia edit triage classifier. Classify the edit into exactly one label:',
  '- "vandalism": DELIBERATE damage — blanking a page or section, profanity or slurs, gibberish or nonsense, an obvious hoax, or spam/promotion. NOT vandalism: an edit that merely lacks a source, has no edit summary, removes content in good faith, or concerns a subject you do not recognize.',
  '- "substantive": a meaningful good-faith content change (adding, rewriting, or removing real information).',
  '- "trivia": a minor or cosmetic change (typos, formatting, small wording tweaks).',
  '- "unclear": you genuinely cannot tell from the information given.',
  'Two rules you MUST follow:',
  '1. Do NOT judge whether the subject or event is real, notable, or plausible — your knowledge may be out of date, and the article existing means it is on Wikipedia. Judge ONLY whether this specific edit damages the article.',
  '2. An edit whose summary says it reverts, undoes, or restores a revision is a REPAIR: the editor is removing someone else\'s damage, not causing it. Such an edit is not vandalism.',
  'Respond with ONLY one JSON object — no prose, no markdown fences — matching exactly this schema:',
  '{"label": "vandalism" | "substantive" | "trivia" | "unclear", "confidence": <number between 0 and 1>, "reason": "<one short sentence>"}',
].join('\n');

/**
 * The diffText parameter is the ONLY difference between pass llm-1 and
 * llm-2 — enrichment is the same prompt plus the fetched diff. Missing
 * comment renders as '(none)': absence is a signal, and a blank would
 * invite the model to hallucinate one.
 */
export function buildClassifyMessages(edit: FilteredEdit, diffText?: string): ChatMessage[] {
  const delta =
    edit.length_old === null && edit.length_new === null
      ? 'unknown'
      : String((edit.length_new ?? 0) - (edit.length_old ?? 0));
  const lines = [
    'Classify this Wikipedia recent change.',
    `Page title: ${edit.title}`,
    `Wiki domain: ${edit.domain}`,
    `Editor: ${edit.user}`,
    `Edit comment: ${edit.comment === '' ? '(none)' : edit.comment}`,
    `Bot account: ${edit.bot}`,
    `Marked as minor: ${edit.minor}`,
    `Byte delta: ${delta}`,
  ];
  if (diffText !== undefined) {
    lines.push('', 'Actual diff of the change (extracted text):', diffText);
  }
  lines.push('', 'Respond with only the JSON object.');
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: lines.join('\n') },
  ];
}

/**
 * Cheapest self-correction: quote the model its own broken reply and demand
 * a re-emit. No new evidence — this repairs FORMAT, never judgment.
 */
export function buildRepairMessages(dirtyOutput: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        'Your previous reply was not a single valid JSON object. This was your previous reply:',
        dirtyOutput,
        '',
        'Re-emit the same classification as ONE valid JSON object exactly matching the schema',
        '{"label": "vandalism" | "substantive" | "trivia" | "unclear", "confidence": <number between 0 and 1>, "reason": "<one short sentence>"}.',
        'Output nothing else.',
      ].join('\n'),
    },
  ];
}

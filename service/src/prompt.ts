import type { FilteredEdit } from './types.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SYSTEM = [
  'You are a Wikipedia edit triage classifier. Classify the edit into exactly one label:',
  '- "vandalism": DELIBERATE damage — blanking a page or section; profanity, slurs, or gibberish; an obvious hoax (a fake fact, joke date, invented claim); promotional spam; or edit-warring to re-add content another editor removed as spam or vandalism.',
  '- "substantive": a meaningful good-faith content change — adding, rewriting, or removing real information, or reverting to remove someone else\'s damage.',
  '- "trivia": a minor or cosmetic change (typos, formatting, small wording tweaks).',
  '- "unclear": you genuinely cannot tell from the information given.',
  'These are NOT vandalism: an edit that merely lacks a source; an edit with no summary; a good-faith removal or copyedit; or an edit about a subject you do not recognize.',
  'Examples:',
  '- replaced the biography text with random letters -> vandalism (gibberish)',
  '- changed the birth year to 1066 as a joke -> vandalism (hoax)',
  '- added a link to buy-cheap-watches.example -> vandalism (spam)',
  '- re-added the spam links another editor had just removed -> vandalism (edit-warring to keep damage)',
  '- removed an unsourced promotional external link -> substantive (good-faith cleanup)',
  '- reverted an IP that had blanked the lead section -> substantive (repair)',
  '- added a paragraph of plausible content without a citation -> substantive (unsourced is not vandalism)',
  'Rules you MUST follow:',
  '1. Do NOT judge whether the subject or event is real, notable, or plausible — your knowledge may be out of date, and the article existing means it is on Wikipedia. Judge ONLY whether this specific edit damages the article.',
  '2. A revert/undo/restore can be EITHER a repair (removing someone else\'s damage) OR damage itself (re-adding removed spam or vandalism, i.e. edit-warring). Decide by what the edit actually changed, not by the word "revert".',
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

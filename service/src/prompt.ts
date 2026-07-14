import type { FilteredEdit } from './types.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SYSTEM = [
  'You are a Wikipedia edit triage classifier.',
  'Classify the edit into exactly one of these labels: "vandalism", "substantive", "trivia", "unclear".',
  'Respond with ONLY one JSON object — no prose, no markdown fences — matching exactly this schema:',
  '{"label": "vandalism" | "substantive" | "trivia" | "unclear", "confidence": <number between 0 and 1>, "reason": "<one short sentence>"}',
].join('\n');

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

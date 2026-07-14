export const LABELS = ['vandalism', 'substantive', 'trivia', 'unclear'] as const;
export type Label = typeof LABELS[number];

export const PASSES = ['heuristic', 'llm-1', 'llm-2'] as const;
export type Pass = typeof PASSES[number];

export interface FilteredEdit {
  rc_id: number;
  title: string;
  title_url: string;
  comment: string;
  user: string;
  bot: boolean;
  minor: boolean;
  length_old: number | null;
  length_new: number | null;
  rev_old: number | null;
  rev_new: number | null;
  server_url: string;
  notify_url: string;
  domain: string;
  event_time: string;
}

export interface Classification {
  label: Label;
  confidence: number;
  reason: string;
}

export interface EnrichmentContext {
  diffText: string;
  truncated: boolean;
  sourceUrl: string;
}

export interface EditRow {
  rc_id: number;
  title: string;
  title_url: string | null;
  editor: string;
  comment: string;
  is_bot: boolean;
  is_minor: boolean;
  byte_delta: number | null;
  rev_old: number | null;
  rev_new: number | null;
  notify_url: string | null;
  domain: string | null;
  event_time: string | null;
  label: Label;
  confidence: number;
  reason: string;
  pass: Pass;
  enriched: boolean;
  error: string | null;
  model: string;
  processed_at: string;
}

export interface ClassifiedMessage {
  rc_id: number;
  title: string;
  label: Label;
  confidence: number;
  reason: string;
  pass: Pass;
  enriched: boolean;
  error: string | null;
  model: string;
  event_time: string;
  processed_at: string;
}

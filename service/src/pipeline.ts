import { shouldEnrich } from './branch.js';
import { parseClassification } from './classification.js';
import type { Config } from './config.js';
import type { FetchDiffFn } from './enrich.js';
import { extractJsonObject } from './extract.js';
import { byteDelta, heuristicGate } from './heuristics.js';
import { buildClassifyMessages, buildRepairMessages, type ChatMessage } from './prompt.js';
import { withRetry } from './retry.js';
import type { Classification, EditRow, FilteredEdit, Pass } from './types.js';

export interface PipelineDeps {
  chat: (messages: ChatMessage[]) => Promise<string>;
  fetchDiff: FetchDiffFn;
  now: () => string;
  heartbeat: () => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

interface RowMeta {
  pass: Pass;
  enriched: boolean;
  error: string | null;
  model: string;
  now: () => string;
}

type RoundResult =
  | { ok: true; classification: Classification }
  | { ok: false; lastRaw: string };

function tryParse(raw: string): Classification | null {
  const extracted = extractJsonObject(raw);
  return extracted.ok ? parseClassification(extracted.value) : null;
}

async function chatWithRetry(messages: ChatMessage[], deps: PipelineDeps, cfg: Config): Promise<string> {
  return withRetry(
    async () => {
      await deps.heartbeat();
      return deps.chat(messages);
    },
    {
      attempts: cfg.ollamaRetries,
      baseMs: 1000,
      capMs: 30_000,
      onAttempt: () => deps.heartbeat(),
      sleep: deps.sleep,
    },
  );
}

// One classify round = one classify call plus AT MOST one repair round-trip.
async function classifyRound(messages: ChatMessage[], deps: PipelineDeps, cfg: Config): Promise<RoundResult> {
  const raw = await chatWithRetry(messages, deps, cfg);
  const first = tryParse(raw);
  if (first !== null) return { ok: true, classification: first };
  const repaired = await chatWithRetry(buildRepairMessages(raw), deps, cfg);
  const second = tryParse(repaired);
  if (second !== null) return { ok: true, classification: second };
  return { ok: false, lastRaw: repaired };
}

function toRow(edit: FilteredEdit, c: Classification, meta: RowMeta): EditRow {
  return {
    rc_id: edit.rc_id,
    title: edit.title,
    title_url: edit.title_url === '' ? null : edit.title_url,
    editor: edit.user,
    comment: edit.comment,
    is_bot: edit.bot,
    is_minor: edit.minor,
    byte_delta: byteDelta(edit),
    rev_old: edit.rev_old,
    rev_new: edit.rev_new,
    notify_url: edit.notify_url === '' ? null : edit.notify_url,
    domain: edit.domain === '' ? null : edit.domain,
    event_time: edit.event_time === '' ? null : edit.event_time,
    label: c.label,
    confidence: c.confidence,
    reason: c.reason,
    pass: meta.pass,
    enriched: meta.enriched,
    error: meta.error,
    model: meta.model,
    processed_at: meta.now(),
  };
}

export async function processEdit(edit: FilteredEdit, deps: PipelineDeps, cfg: Config): Promise<EditRow> {
  const gate = heuristicGate(edit, cfg.heuristicTinyDelta);
  if (gate.skip) {
    return toRow(edit, gate.classification, {
      pass: 'heuristic',
      enriched: false,
      error: null,
      model: '',
      now: deps.now,
    });
  }

  const pass1 = await classifyRound(buildClassifyMessages(edit), deps, cfg);
  if (!pass1.ok) {
    return toRow(
      edit,
      { label: 'unclear', confidence: 0, reason: '' },
      {
        pass: 'llm-1',
        enriched: false,
        error: `unparseable_after_repair: ${pass1.lastRaw.slice(0, cfg.maxErrorSnippet)}`,
        model: cfg.ollamaModel,
        now: deps.now,
      },
    );
  }

  let result = pass1.classification;
  let pass: Pass = 'llm-1';
  let enriched = false;
  let error: string | null = null;

  if (shouldEnrich(result.confidence, cfg.confidenceThreshold)) {
    if (edit.rev_old === null || edit.rev_new === null) {
      error = 'enrichment_skipped_no_revs';
    } else {
      await deps.heartbeat();
      const diff = await deps.fetchDiff(edit.server_url, edit.rev_old, edit.rev_new);
      if ('error' in diff) {
        error = `enrichment_fetch_failed: ${diff.error}`;
      } else {
        const pass2 = await classifyRound(buildClassifyMessages(edit, diff.diffText), deps, cfg);
        if (pass2.ok) {
          // Pass-2 wins unconditionally; its confidence never triggers a pass-3.
          result = pass2.classification;
          pass = 'llm-2';
          enriched = true;
        } else {
          error = 'enrichment_reclassify_unparseable';
        }
      }
    }
  }

  return toRow(edit, result, { pass, enriched, error, model: cfg.ollamaModel, now: deps.now });
}

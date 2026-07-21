import { isRevert, shouldEnrich } from './branch.js';
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

/** Extraction + schema validation collapsed to one nullable: any failure at either layer is null. */
function tryParse(raw: string): Classification | null {
  const extracted = extractJsonObject(raw);
  return extracted.ok ? parseClassification(extracted.value) : null;
}

/**
 * Retries transport failures only (heartbeating before/between attempts so
 * the group doesn't evict us during slow inference); dirty CONTENT is not
 * retried here — that's classifyRound's repair step.
 */
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

/**
 * Merges the original edit with the verdict — the row keeps BOTH (never
 * let a response destroy its request). ''-valued optional fields become
 * SQL NULLs here.
 */
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

/**
 * The reasoning loop: heuristic gate -> classify (llm-1) -> parse/repair ->
 * confidence < threshold ? one enrichment reclassify (llm-2) -> row.
 * ALWAYS returns exactly one EditRow for content-level failures (label
 * 'unclear' + error taxonomy: unparseable_after_repair,
 * enrichment_skipped_no_revs, enrichment_fetch_failed,
 * enrichment_reclassify_unparseable); throws ONLY on infra errors
 * (OllamaUnreachableError) after retries exhaust — the consumer's cue to
 * pause rather than record. Cost is capped: no pass-3 exists, so worst
 * case is 4 chat calls (classify+repair, twice).
 */
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

  // Reverts enrich unconditionally: their comment describes the edit being
  // undone, so pass-1 confidence is grounded in the WRONG edit's story.
  if (shouldEnrich(result.confidence, cfg.confidenceThreshold) || isRevert(edit.comment)) {
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

import { describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../src/config.js';
import type { FetchDiffResult } from '../src/enrich.js';
import { OllamaUnreachableError } from '../src/ollama.js';
import { processEdit, type PipelineDeps } from '../src/pipeline.js';
import type { ChatMessage } from '../src/prompt.js';
import { makeEdit } from './helpers.js';

const cfg: Config = {
  ...loadConfig({}),
  confidenceThreshold: 0.6,
  heuristicTinyDelta: 5,
  ollamaRetries: 2,
  maxErrorSnippet: 500,
};

const NOW = '2026-07-13T12:34:56.000Z';

function clean(label: string, confidence: number, reason = 'stub reason'): string {
  return JSON.stringify({ label, confidence, reason });
}

function makeDeps(
  chatOutputs: Array<string | Error>,
  diffResults: FetchDiffResult[] = [],
): { deps: PipelineDeps; chatCalls: ChatMessage[][]; diffCalls: Array<[string, number, number]> } {
  const chatCalls: ChatMessage[][] = [];
  const diffCalls: Array<[string, number, number]> = [];
  const deps: PipelineDeps = {
    chat: async (messages) => {
      chatCalls.push(messages);
      const next = chatOutputs[Math.min(chatCalls.length - 1, chatOutputs.length - 1)];
      if (next === undefined) throw new Error('no chat output stubbed');
      if (next instanceof Error) throw next;
      return next;
    },
    fetchDiff: async (serverUrl, revOld, revNew) => {
      diffCalls.push([serverUrl, revOld, revNew]);
      return diffResults[diffCalls.length - 1] ?? { error: 'no diff stubbed' };
    },
    now: () => NOW,
    heartbeat: () => {},
    sleep: async () => {},
  };
  return { deps, chatCalls, diffCalls };
}

const diffOk: FetchDiffResult = {
  diffText: 'DIFF_CONTEXT added sourced paragraph, removed nothing',
  truncated: false,
  sourceUrl: 'https://en.wikipedia.org/w/api.php?action=compare&fromrev=500&torev=501&format=json',
};

describe('processEdit', () => {
  it('heuristic skip: 0 chat calls, pass heuristic, empty model, null error', async () => {
    const { deps, chatCalls } = makeDeps([]);
    const row = await processEdit(makeEdit({ bot: true }), deps, cfg);
    expect(chatCalls.length).toBe(0);
    expect(row.pass).toBe('heuristic');
    expect(row.label).toBe('trivia');
    expect(row.confidence).toBe(1);
    expect(row.model).toBe('');
    expect(row.error).toBeNull();
    expect(row.enriched).toBe(false);
    expect(row.processed_at).toBe(NOW);
  });

  it('clean high-confidence output: pass llm-1, exactly 1 chat call, null error', async () => {
    const { deps, chatCalls } = makeDeps([clean('substantive', 0.9)]);
    const row = await processEdit(makeEdit(), deps, cfg);
    expect(chatCalls.length).toBe(1);
    expect(row.pass).toBe('llm-1');
    expect(row.label).toBe('substantive');
    expect(row.confidence).toBe(0.9);
    expect(row.error).toBeNull();
    expect(row.enriched).toBe(false);
    expect(row.model).toBe(cfg.ollamaModel);
  });

  it('dirty then clean: 2 chat calls, second uses the repair prompt', async () => {
    const dirty = 'I cannot really commit to a structured answer here, sorry.';
    const { deps, chatCalls } = makeDeps([dirty, clean('vandalism', 0.8)]);
    const row = await processEdit(makeEdit(), deps, cfg);
    expect(chatCalls.length).toBe(2);
    expect(JSON.stringify(chatCalls[1])).toContain(dirty);
    expect(row.label).toBe('vandalism');
    expect(row.pass).toBe('llm-1');
    expect(row.error).toBeNull();
  });

  it('dirty twice: falls back to unclear/0 with unparseable_after_repair error, exactly 2 calls', async () => {
    const { deps, chatCalls } = makeDeps(['total garbage', 'still total garbage']);
    const row = await processEdit(makeEdit(), deps, cfg);
    expect(chatCalls.length).toBe(2);
    expect(row.label).toBe('unclear');
    expect(row.confidence).toBe(0);
    expect(row.pass).toBe('llm-1');
    expect(row.error).toMatch(/^unparseable_after_repair/);
  });

  it('confidence 0.59: one fetchDiff, diff text in second prompt, pass llm-2, enriched', async () => {
    const { deps, chatCalls, diffCalls } = makeDeps(
      [clean('unclear', 0.59), clean('substantive', 0.9)],
      [diffOk],
    );
    const row = await processEdit(makeEdit(), deps, cfg);
    expect(diffCalls.length).toBe(1);
    expect(diffCalls[0]).toEqual(['https://en.wikipedia.org', 500, 501]);
    expect(JSON.stringify(chatCalls[1])).toContain('DIFF_CONTEXT');
    expect(row.pass).toBe('llm-2');
    expect(row.enriched).toBe(true);
    expect(row.label).toBe('substantive');
    expect(row.confidence).toBe(0.9);
    expect(row.error).toBeNull();
  });

  it('revert comment forces enrichment even at confidence 0.9 (metadata describes the WRONG edit)', async () => {
    const { deps, chatCalls, diffCalls } = makeDeps(
      [clean('vandalism', 0.9), clean('substantive', 0.95)],
      [diffOk],
    );
    const revert = makeEdit({
      comment:
        'Undid revision [[Special:Diff/1364133786|1364133786]] by [[Special:Contributions/~2026-28226-33|~2026-28226-33]] ([[User talk:~2026-28226-33|talk]]) unexplained removal of source',
    });
    const row = await processEdit(revert, deps, cfg);
    expect(diffCalls.length).toBe(1);
    expect(chatCalls.length).toBe(2);
    expect(row.pass).toBe('llm-2');
    expect(row.enriched).toBe(true);
    expect(row.label).toBe('substantive');
    expect(row.confidence).toBe(0.95);
    expect(row.error).toBeNull();
  });

  it('revert with missing revs keeps pass-1 verdict with enrichment_skipped_no_revs', async () => {
    const { deps, diffCalls } = makeDeps([clean('vandalism', 0.9)]);
    const row = await processEdit(
      makeEdit({ comment: 'rv unsourced additions', rev_old: null }),
      deps,
      cfg,
    );
    expect(diffCalls.length).toBe(0);
    expect(row.pass).toBe('llm-1');
    expect(row.label).toBe('vandalism');
    expect(row.error).toBe('enrichment_skipped_no_revs');
    expect(row.enriched).toBe(false);
  });

  it('confidence 0.60 (at threshold): zero fetchDiff calls, stays llm-1', async () => {
    const { deps, diffCalls } = makeDeps([clean('substantive', 0.6)]);
    const row = await processEdit(makeEdit(), deps, cfg);
    expect(diffCalls.length).toBe(0);
    expect(row.pass).toBe('llm-1');
    expect(row.enriched).toBe(false);
    expect(row.error).toBeNull();
  });

  it('LLM trivia + large byte delta is hard-overridden to substantive (no extra fetch)', async () => {
    const { deps, diffCalls } = makeDeps([clean('trivia', 0.9)]);
    const bigEdit = makeEdit({ length_old: 1000, length_new: 3076 }); // +2076
    const row = await processEdit(bigEdit, deps, cfg);
    expect(diffCalls.length).toBe(0); // hard gate — deterministic, no model re-call
    expect(row.label).toBe('substantive');
    expect(row.pass).toBe('llm-1');
    expect(row.error).toMatch(/^trivia_gate_override/);
  });

  it('LLM trivia within the gate is left untouched', async () => {
    const { deps, diffCalls } = makeDeps([clean('trivia', 0.9)]);
    const smallEdit = makeEdit({ length_old: 1000, length_new: 1050 }); // +50, within the 100 gate
    const row = await processEdit(smallEdit, deps, cfg);
    expect(diffCalls.length).toBe(0);
    expect(row.label).toBe('trivia');
    expect(row.error).toBeNull();
  });

  it('bot-heuristic trivia is exempt from the byte gate', async () => {
    const { deps, chatCalls } = makeDeps([]);
    const row = await processEdit(
      makeEdit({ bot: true, length_old: 1000, length_new: 3000 }), // +2000
      deps,
      cfg,
    );
    expect(chatCalls.length).toBe(0);
    expect(row.pass).toBe('heuristic');
    expect(row.label).toBe('trivia'); // policy trivia survives the gate
  });

  it('pass-2 wins unconditionally even at lower confidence', async () => {
    const { deps } = makeDeps([clean('trivia', 0.5), clean('vandalism', 0.3)], [diffOk]);
    const row = await processEdit(makeEdit(), deps, cfg);
    expect(row.label).toBe('vandalism');
    expect(row.confidence).toBe(0.3);
    expect(row.pass).toBe('llm-2');
    expect(row.enriched).toBe(true);
  });

  it('pass-2 low confidence never triggers a pass-3 (hard cap)', async () => {
    const { deps, chatCalls, diffCalls } = makeDeps(
      [clean('unclear', 0.5), clean('unclear', 0.1)],
      [diffOk],
    );
    const row = await processEdit(makeEdit(), deps, cfg);
    expect(chatCalls.length).toBe(2);
    expect(diffCalls.length).toBe(1);
    expect(row.pass).toBe('llm-2');
    expect(row.confidence).toBe(0.1);
  });

  it('fetch failure keeps the pass-1 result with enrichment_fetch_failed error', async () => {
    const { deps, chatCalls } = makeDeps([clean('substantive', 0.4)], [{ error: 'timeout after 5000ms' }]);
    const row = await processEdit(makeEdit(), deps, cfg);
    expect(chatCalls.length).toBe(1);
    expect(row.pass).toBe('llm-1');
    expect(row.label).toBe('substantive');
    expect(row.confidence).toBe(0.4);
    expect(row.enriched).toBe(false);
    expect(row.error).toMatch(/^enrichment_fetch_failed/);
    expect(row.error).toContain('timeout after 5000ms');
  });

  it('missing revs skips enrichment with enrichment_skipped_no_revs error', async () => {
    const { deps, diffCalls } = makeDeps([clean('substantive', 0.4)]);
    const row = await processEdit(makeEdit({ rev_old: null }), deps, cfg);
    expect(diffCalls.length).toBe(0);
    expect(row.pass).toBe('llm-1');
    expect(row.error).toBe('enrichment_skipped_no_revs');
    expect(row.enriched).toBe(false);
  });

  it('unparseable pass-2 keeps pass-1 with enrichment_reclassify_unparseable error', async () => {
    const { deps, chatCalls } = makeDeps(
      [clean('substantive', 0.5), 'garbage', 'more garbage'],
      [diffOk],
    );
    const row = await processEdit(makeEdit(), deps, cfg);
    expect(chatCalls.length).toBe(3);
    expect(row.pass).toBe('llm-1');
    expect(row.label).toBe('substantive');
    expect(row.confidence).toBe(0.5);
    expect(row.enriched).toBe(false);
    expect(row.error).toBe('enrichment_reclassify_unparseable');
  });

  it('rethrows OllamaUnreachableError after retries exhaust', async () => {
    const { deps, chatCalls } = makeDeps([new OllamaUnreachableError('connection refused')]);
    await expect(processEdit(makeEdit(), deps, cfg)).rejects.toBeInstanceOf(OllamaUnreachableError);
    expect(chatCalls.length).toBe(cfg.ollamaRetries);
  });

  it('caps the recorded error snippet for huge dirty output', async () => {
    const huge = 'x'.repeat(10_000);
    const { deps } = makeDeps([huge, huge]);
    const row = await processEdit(makeEdit(), deps, cfg);
    expect(row.label).toBe('unclear');
    expect(row.error).not.toBeNull();
    expect(row.error!.length).toBeLessThanOrEqual(
      cfg.maxErrorSnippet + 'unparseable_after_repair: '.length,
    );
  });
});

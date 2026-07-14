import type { Consumer } from 'kafkajs';
import type { Config } from './config.js';
import { PgUnavailableError } from './db.js';
import { decodeFilteredEdit } from './decode.js';
import type { FetchDiffFn } from './enrich.js';
import { OllamaUnreachableError } from './ollama.js';
import { processEdit, type PipelineDeps } from './pipeline.js';
import type { ClassifiedMessage, EditRow } from './types.js';

const READINESS_POLL_MS = 5000;

export interface ConsumerDeps {
  consumer: Consumer;
  cfg: Config;
  chat: PipelineDeps['chat'];
  fetchDiff: FetchDiffFn;
  upsertEdit: (row: EditRow) => Promise<void>;
  publishClassified: (msg: ClassifiedMessage) => Promise<void>;
  isOllamaReady: () => Promise<boolean>;
  isDbReady: () => Promise<boolean>;
}

export function toClassifiedMessage(row: EditRow): ClassifiedMessage {
  return {
    rc_id: row.rc_id,
    title: row.title,
    label: row.label,
    confidence: row.confidence,
    reason: row.reason,
    pass: row.pass,
    enriched: row.enriched,
    error: row.error,
    model: row.model,
    event_time: row.event_time ?? '',
    processed_at: row.processed_at,
  };
}

async function resumeWhenReady(isReady: () => Promise<boolean>, resume: () => void): Promise<void> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, READINESS_POLL_MS));
    if (await isReady().catch(() => false)) {
      resume();
      return;
    }
  }
}

export async function startConsumer(d: ConsumerDeps): Promise<void> {
  await d.consumer.subscribe({ topic: d.cfg.topicFiltered, fromBeginning: true });
  await d.consumer.run({
    eachMessage: async ({ message, heartbeat, pause }) => {
      const edit = decodeFilteredEdit(message.value);
      if (edit === null) {
        console.warn(`[consumer] skipping undecodable message at offset ${message.offset}`);
        return;
      }
      try {
        const row = await processEdit(
          edit,
          { chat: d.chat, fetchDiff: d.fetchDiff, now: () => new Date().toISOString(), heartbeat },
          d.cfg,
        );
        await heartbeat();
        await d.upsertEdit(row);
        await d.publishClassified(toClassifiedMessage(row));
      } catch (err) {
        if (err instanceof OllamaUnreachableError || err instanceof PgUnavailableError) {
          console.warn(`[consumer] ${err.name}; pausing partition until dependency recovers`);
          const resume = pause();
          const isReady = err instanceof OllamaUnreachableError ? d.isOllamaReady : d.isDbReady;
          void resumeWhenReady(isReady, resume);
        }
        // Rethrow so the offset is NOT committed: the message is redelivered
        // once the partition resumes (at-least-once + idempotent UPSERT).
        throw err;
      }
    },
  });
}

import pg from 'pg';
import { withRetry } from './retry.js';
import type { EditRow } from './types.js';

export class PgUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PgUnavailableError';
  }
}

const UPSERT_SQL = `
INSERT INTO edits (
  rc_id, title, title_url, editor, comment, is_bot, is_minor, byte_delta,
  rev_old, rev_new, notify_url, domain, event_time, label, confidence,
  reason, pass, enriched, error, model, processed_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
  $16, $17, $18, $19, $20, $21
)
ON CONFLICT (rc_id) DO UPDATE SET
  title = EXCLUDED.title,
  title_url = EXCLUDED.title_url,
  editor = EXCLUDED.editor,
  comment = EXCLUDED.comment,
  is_bot = EXCLUDED.is_bot,
  is_minor = EXCLUDED.is_minor,
  byte_delta = EXCLUDED.byte_delta,
  rev_old = EXCLUDED.rev_old,
  rev_new = EXCLUDED.rev_new,
  notify_url = EXCLUDED.notify_url,
  domain = EXCLUDED.domain,
  event_time = EXCLUDED.event_time,
  label = EXCLUDED.label,
  confidence = EXCLUDED.confidence,
  reason = EXCLUDED.reason,
  pass = EXCLUDED.pass,
  enriched = EXCLUDED.enriched,
  error = EXCLUDED.error,
  model = EXCLUDED.model,
  processed_at = now()
`;

export interface Db {
  upsertEdit: (row: EditRow) => Promise<void>;
  isReady: () => Promise<boolean>;
  waitUntilReady: (timeoutMs: number) => Promise<void>;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl });

  async function upsertEdit(row: EditRow): Promise<void> {
    const params = [
      row.rc_id, row.title, row.title_url, row.editor, row.comment, row.is_bot,
      row.is_minor, row.byte_delta, row.rev_old, row.rev_new, row.notify_url,
      row.domain, row.event_time, row.label, row.confidence, row.reason,
      row.pass, row.enriched, row.error, row.model, row.processed_at,
    ];
    try {
      await withRetry(() => pool.query(UPSERT_SQL, params), {
        attempts: 3,
        baseMs: 500,
        capMs: 5000,
      });
    } catch (err) {
      throw new PgUnavailableError(`upsert failed for rc_id=${row.rc_id}: ${String(err)}`, {
        cause: err,
      });
    }
  }

  async function isReady(): Promise<boolean> {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async function waitUntilReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await isReady()) return;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new PgUnavailableError(`postgres not ready after ${timeoutMs}ms`);
  }

  async function close(): Promise<void> {
    await pool.end();
  }

  return { upsertEdit, isReady, waitUntilReady, close };
}

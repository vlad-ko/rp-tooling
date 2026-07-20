import pg from "pg";
import { config } from "./config.js";

export const LABELS = ["vandalism", "substantive", "trivia", "unclear"] as const;
export type Label = (typeof LABELS)[number];

/** Type guard against the closed enum — gates the ?label= query param before it reaches SQL. */
export function isLabel(value: string): value is Label {
  return (LABELS as readonly string[]).includes(value);
}

const pool = new pg.Pool({ connectionString: config.databaseUrl });

// pg.Pool emits "error" for idle clients (e.g. Postgres restart); an
// unhandled "error" event would crash the process.
pool.on("error", (err) => console.error("pg pool error (idle client):", err));

export interface EditRow {
  rc_id: string;
  title: string | null;
  title_url: string | null;
  editor: string | null;
  comment: string | null;
  is_bot: boolean | null;
  is_minor: boolean | null;
  byte_delta: number | null;
  notify_url: string | null;
  domain: string | null;
  event_time: Date | null;
  label: string | null;
  confidence: number | null;
  reason: string | null;
  pass: string | null;
  processed_at: Date | null;
}

/**
 * Newest-first by processed_at. label null = all labels (the $1 IS NULL OR
 * trick keeps it one query/plan). Caller validates limit; SELECT-only.
 */
export async function recentEdits(
  label: Label | null,
  limit: number,
): Promise<EditRow[]> {
  const { rows } = await pool.query<EditRow>(
    `SELECT rc_id, title, title_url, editor, comment, is_bot, is_minor,
            byte_delta, notify_url, domain, event_time,
            label, confidence, reason, pass, processed_at
       FROM edits
      WHERE $1::text IS NULL OR label = $1
      ORDER BY processed_at DESC
      LIMIT $2`,
    [label, limit],
  );
  return rows;
}

export interface Stats {
  total: number;
  labels: Record<string, { count: number; avg_confidence: number | null }>;
  passes: Record<string, number>;
  last_processed_at: Date | null;
}

/** Label/pass counts + avg confidence in three concurrent aggregates; empty table yields total 0, empty maps. */
export async function stats(): Promise<Stats> {
  const [totals, byLabel, byPass] = await Promise.all([
    pool.query<{ total: number; last_processed_at: Date | null }>(
      `SELECT count(*)::int AS total, max(processed_at) AS last_processed_at
         FROM edits`,
    ),
    pool.query<{ label: string; count: number; avg_confidence: number | null }>(
      `SELECT label, count(*)::int AS count, avg(confidence) AS avg_confidence
         FROM edits
        WHERE label IS NOT NULL
        GROUP BY label`,
    ),
    pool.query<{ pass: string; count: number }>(
      `SELECT pass, count(*)::int AS count
         FROM edits
        WHERE pass IS NOT NULL
        GROUP BY pass`,
    ),
  ]);

  const labels: Stats["labels"] = {};
  for (const row of byLabel.rows) {
    labels[row.label] = {
      count: row.count,
      avg_confidence: row.avg_confidence,
    };
  }
  const passes: Stats["passes"] = {};
  for (const row of byPass.rows) {
    passes[row.pass] = row.count;
  }

  return {
    total: totals.rows[0]?.total ?? 0,
    labels,
    passes,
    last_processed_at: totals.rows[0]?.last_processed_at ?? null,
  };
}

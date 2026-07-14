-- Read model for the reasoning service. All service writes are UPSERTs keyed
-- on rc_id (at-least-once delivery + idempotent writes).
CREATE TABLE IF NOT EXISTS edits (
  rc_id        BIGINT PRIMARY KEY,
  title        TEXT NOT NULL,
  title_url    TEXT,
  editor       TEXT NOT NULL,
  comment      TEXT NOT NULL DEFAULT '',
  is_bot       BOOLEAN NOT NULL,
  is_minor     BOOLEAN NOT NULL,
  byte_delta   INTEGER,
  rev_old      BIGINT,
  rev_new      BIGINT,
  notify_url   TEXT,
  domain       TEXT,
  event_time   TIMESTAMPTZ,
  label        TEXT NOT NULL CHECK (label IN ('vandalism', 'substantive', 'trivia', 'unclear')),
  confidence   REAL NOT NULL,
  reason       TEXT NOT NULL DEFAULT '',
  pass         TEXT NOT NULL CHECK (pass IN ('heuristic', 'llm-1', 'llm-2')),
  enriched     BOOLEAN NOT NULL DEFAULT FALSE,
  error        TEXT,
  model        TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edits_label ON edits (label);
CREATE INDEX IF NOT EXISTS idx_edits_processed_at ON edits (processed_at DESC);

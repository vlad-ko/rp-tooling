-- PROVISIONAL: schema finalized by the service PR (issue #4)
--
-- Read model for classified Wikipedia edits. All writes are UPSERTs keyed on
-- rc_id (at-least-once delivery + idempotent writes).

CREATE TABLE IF NOT EXISTS edits (
    rc_id         BIGINT PRIMARY KEY,          -- Wikipedia recent-change id
    title         TEXT NOT NULL,               -- page title
    editor        TEXT,
    comment       TEXT,
    byte_delta    INTEGER,
    minor         BOOLEAN,
    label         TEXT,                        -- vandalism | substantive | trivia | unclear
    confidence    REAL,
    reason        TEXT,                        -- model rationale / error reason for `unclear`
    pass          TEXT,                        -- which reasoning pass produced the label
    diff_url      TEXT,
    event_at      TIMESTAMPTZ,                 -- when the edit happened
    classified_at TIMESTAMPTZ DEFAULT now()
);

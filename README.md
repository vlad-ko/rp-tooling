# rp-tooling

Streaming triage of live Wikipedia edits, entirely on your machine. The
Wikimedia recent-changes SSE firehose flows into Redpanda Connect, which
filters and projects the events (plumbing only) into a Redpanda topic. A
TypeScript reasoning service consumes that topic and classifies each edit with
a local Ollama LLM — a heuristic gate skips the obvious cases, dirty model
output gets one repair retry, and low-confidence verdicts trigger one
enrichment pass over the real diff — then UPSERTs the result into Postgres and
publishes an audit record to a second topic. A small read-only web page sits
on top. No cloud, no signup, no API keys.

## Quickstart

```sh
git clone https://github.com/vlad-ko/rp-tooling && cd rp-tooling
docker compose up -d --build
```

No `.env` file or environment variables are needed — every knob has a default.
On one measured first boot (fast connection), the stack reached all-healthy in
about 2.5 minutes: image builds dominate; the 2.0 GB `llama3.2:3b` pull took
29 seconds. Subsequent boots are much faster (the model lives in a volume).

Then open <http://localhost:8080> (change with `WEB_PORT`).

Classification is CPU-LLM-bound: expect the first classified rows within a
couple of minutes of the stack going healthy, then a steady trickle — the
post-filter stream runs at roughly 12 events/min with the default
`FILTER_MIN_DELTA=25`.

## Architecture

![Architecture diagram](docs/architecture.svg)

<details>
<summary>Text version</summary>

```
Wikimedia SSE firehose (stream.wikimedia.org/v2/stream/recentchange)
        │
        ▼
Redpanda Connect ── filter: human en.wikipedia article edits,
        │           |byte delta| >= FILTER_MIN_DELTA; project to a lean record
        ├──▶ topic wiki.edits.deadletter   (structural anomalies: unparseable /
        ▼                                   malformed events, reason in headers)
topic wiki.edits.filtered            (keyed by page title)
        │
        ▼
reasoning service                    (consumer group: triage)
  heuristic gate → Ollama classify → repair retry → confidence branch → enrich
        │
        ├──▶ topic wiki.edits.classified   (audit trail, keyed by rc_id)
        └──▶ Postgres table edits          (UPSERT on rc_id)
                    │
                    ▼
              web: read-only page + JSON API on http://localhost:8080
```

</details>

| Component | Image / build | Role |
|---|---|---|
| `redpanda` | `redpandadata/redpanda:latest` | Single-node broker (`--mode=dev-container`) |
| `topic-init` | same image, one-shot | Creates the three topics, exits |
| `connect` | `redpandadata/connect:latest` | SSE ingest, filter + projection — no reasoning; structural anomalies → `wiki.edits.deadletter` |
| `ollama` + `ollama-init` | `ollama/ollama` | Local LLM server; init pulls `OLLAMA_MODEL`, exits |
| `postgres` | `postgres:16` | Read model; `sql/schema.sql` auto-applied on first boot (initdb mount) |
| `service` | built from `./service` | Reasoning worker (TypeScript, kafkajs, pg) |
| `web` | built from `./web` | Read-only HTML page + `/api/edits`, `/api/stats` |

## The reasoning loop

Every consumed edit becomes exactly one row in `edits` with a label from the
closed enum `vandalism | substantive | trivia | unclear`. Rows are never
dropped and bad data never crashes the pipeline.

- A **heuristic gate** (no LLM call) short-circuits the obvious: bot-flagged
  edits and minor edits with a tiny byte delta (≤ 5 bytes) land as `trivia`
  with `pass = 'heuristic'`.
- Everything else goes to Ollama. **Strict JSON extraction** digs the verdict
  out of dirty model output — markdown fences, prose wrapping, truncated
  JSON — via a balanced-brace scan, not a naive `JSON.parse`.
- Unparseable output gets **exactly one repair retry** (the model is shown its
  own broken output and asked for bare JSON). Still unparseable → the row
  lands as `unclear` with the raw snippet recorded in `error`.
- **Confidence below 0.6** (`CONFIDENCE_THRESHOLD`) triggers one enrichment
  pass: the service fetches the real diff from the MediaWiki compare API and
  re-classifies with that context. The pass-2 verdict wins unconditionally —
  its confidence never triggers a pass-3.
- **Revert edits enrich unconditionally**, whatever pass-1's confidence: a
  revert's comment ("Undid revision …") describes the edit *being undone*,
  so metadata-only classification attributes the quoted misbehavior to the
  wrong actor — the model once labeled an anti-vandalism repair `vandalism`
  at 0.9. Known-unreliable metadata is routed to evidence, same as low
  confidence.
- All writes are **UPSERTs keyed on `rc_id`**, so the broker's at-least-once
  delivery is safe: redelivery just rewrites the same row.
- **Infra failure ≠ crash**: if Ollama or Postgres goes down, the consumer
  pauses the partition and polls until the dependency recovers. Non-retriable
  kafkajs client errors exit the process non-zero so the container restart
  policy takes over instead of leaving a zombie.
- An **error taxonomy** is recorded per row (`unparseable_after_repair`,
  `enrichment_skipped_no_revs`, `enrichment_fetch_failed`,
  `enrichment_reclassify_unparseable`), alongside which pass produced the
  verdict (`heuristic | llm-1 | llm-2`) and whether it was enriched.

## Observing it

The web page at <http://localhost:8080> shows recent classified edits and
label/pass counts, backed by `/api/edits` and `/api/stats`.

From the repo root, with the stack up:

```sh
# what Connect is feeding the service
docker compose exec redpanda rpk topic consume wiki.edits.filtered --num 3

# the service's audit trail
docker compose exec redpanda rpk topic consume wiki.edits.classified --num 3

# dead-lettered structural anomalies (normally empty — traffic here means
# upstream schema drift; the reason is in the dlq_reason header)
docker compose exec redpanda rpk topic consume wiki.edits.deadletter --num 3

# the read model
docker compose exec postgres psql -U rp -d wiki -c "SELECT label, count(*) FROM edits GROUP BY label;"

# stats as JSON
curl localhost:8080/api/stats
```

## Tests

```sh
cd service && npm install && npm test
```

96 tests, all pure-function — no Docker, no broker, no network required. They
cover dirty-model-output parsing, label normalization, the confidence
boundary (0.59 / 0.6 / 0.61), the pipeline state machine driven with fakes,
and the crash-exit wiring.

The Connect mappings have their own unit tests (framing drops, policy drops,
dead-letter routing, the projection), run via the Connect image:

```sh
docker run --rm -v $PWD/connect:/connect docker.redpanda.com/redpandadata/connect:latest test /connect/pipeline_test.yaml
```

## Configuration

Compose runs with zero configuration; copy `.env.example` to `.env` to
override. Knobs read by `docker-compose.yml`:

| Variable | Default | What it does |
|---|---|---|
| `OLLAMA_MODEL` | `llama3.2:3b` | Model pulled by `ollama-init` and used for classification |
| `FILTER_MIN_DELTA` | `25` | Minimum absolute byte delta an edit needs to pass the Connect filter |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `rp` / `rp` / `wiki` | Postgres credentials/database |
| `WEB_PORT` | `8080` | Host port for the web page + API |
| `REDPANDA_KAFKA_PORT` | `19092` | Host port for the external Kafka listener (debugging) |
| `POSTGRES_PORT` | `5432` | Host port for Postgres |
| `OLLAMA_PORT` | `11434` | Host port for the Ollama API |

The service reads further knobs from its own environment with defaults in
`service/src/config.ts` (set them on the `service` container in
`docker-compose.yml` to override): `CONFIDENCE_THRESHOLD` (0.6),
`HEURISTIC_TINY_DELTA` (5), `OLLAMA_RETRIES` (5),
`OLLAMA_STARTUP_TIMEOUT_MS` (180000), `DIFF_MAX_CHARS` (4000),
`COMPARE_TIMEOUT_MS` (5000), `MAX_ERROR_SNIPPET` (500).

Troubleshooting: if port 8080 is already taken, set `WEB_PORT` (e.g.
`WEB_PORT=8081 docker compose up -d`) and browse to that port instead.

## Tradeoffs

<!-- HUMAN-WRITTEN: intentionally left for the author. Two pairs, one paragraph each:
     what was chosen, the alternative, when the decision would flip. -->
_To be written._

## Surprises & where this breaks in production

<!-- HUMAN-WRITTEN: intentionally left for the author. -->
_To be written._

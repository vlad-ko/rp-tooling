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

- A **heuristic gate** (no LLM call) can send an edit straight to `trivia`
  with `pass = 'heuristic'`: bot-flagged edits, or minor edits with a tiny
  byte delta (≤ `HEURISTIC_TINY_DELTA`, 5). This is **defense-in-depth**, not
  the common path — the Connect filter already drops bots and anything with
  `|delta| < FILTER_MIN_DELTA` (25), so under the default config almost
  nothing reaches this gate. It exists so the service never trusts its
  upstream: a topic replay, a relaxed filter, or another producer could
  deliver an edit the filter would otherwise have caught.
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
- **Byte count settles the `trivia`↔`substantive` magnitude axis.** That
  distinction is about *size*, which the byte delta measures exactly, so the
  model isn't trusted with it at the extremes — a verdict whose magnitude
  label is impossible for its delta is corrected to the opposite one, with
  `size_label_override` recorded in `error`. `|delta| < SUBSTANTIVE_MIN_BYTES`
  (100) can't be `substantive` → `trivia`; `|delta| >= TRIVIA_MAX_BYTES`
  (2000) can't be `trivia` → `substantive`. Between the bounds both are
  plausible and the model's call stands. `vandalism` and `unclear` are
  size-independent (the quality axis) and never touched; heuristic trivia is
  exempt. (With `FILTER_MIN_DELTA` at 25, `substantive` effectively requires
  ≥ 100 bytes — small edits, however meaningful, triage as `trivia`.)
- **Revert edits enrich unconditionally**, whatever pass-1's confidence: a
  revert's comment ("Undid revision …") describes the edit *being undone*,
  so metadata-only classification attributes the quoted misbehavior to the
  wrong actor — the model once labeled an anti-vandalism repair `vandalism`
  at 0.9. Known-unreliable metadata is routed to evidence, same as low
  confidence.
- **`vandalism` verdicts always enrich**, whatever the confidence: vandalism
  is a judgment about *content*, but pass-1 sees only metadata — measured
  against Wikipedia's own reverts, metadata-only `vandalism` was right only
  ~6% of the time, so the service never accuses without fetching the real
  diff first. The system prompt also defines vandalism narrowly (deliberate
  damage — not unsourced additions, missing summaries, or unfamiliar
  subjects) and forbids judging whether a topic is "real" (the model's
  knowledge may predate the event).
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

**Logs** go to stdout and are read through Docker (no log files — the app
follows the 12-factor "logs as event streams" convention). The reasoning
service prints one line per triage decision, so you can watch the pipeline
work live:

```sh
docker compose logs -f service
# [triage] substantive 0.95 pass=llm-2 +enriched delta=+168 rc=2046560718 "Christianity in Pakistan"
# [triage] trivia 0.90 pass=llm-1 delta=+44 rc=2046562895 "2026 in American soccer"
# [triage] substantive 0.90 pass=llm-1 delta=+2076 rc=… "…" | size_label_override: trivia -> substantive
```

The line leads with the label (scan the left edge for `vandalism`), then
confidence, which `pass` produced it, whether it was `+enriched`, the byte
delta, the `rc_id`, and the page title; a trailing `| …` carries the error
or override note when there is one.

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

160 tests, all pure-function — no Docker, no broker, no network required. They
cover dirty-model-output parsing, label normalization, the confidence boundary
(0.59 / 0.6 / 0.61), the byte-magnitude reconciliation, the revert/vandalism
enrichment triggers, direction-aware diff extraction, the pipeline state
machine driven with fakes, and the crash-exit wiring.

The Connect mappings (8 tests: framing drops, policy drops, dead-letter
routing, the projection) run via the Connect image, and the web API's param
parsers have their own suite (`cd web && npm test`, 7 tests):

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
`HEURISTIC_TINY_DELTA` (5), `SUBSTANTIVE_MIN_BYTES` (100),
`TRIVIA_MAX_BYTES` (2000), `OLLAMA_RETRIES` (5),
`OLLAMA_STARTUP_TIMEOUT_MS` (180000), `OLLAMA_REQUEST_TIMEOUT_MS` (120000),
`DIFF_MAX_CHARS` (4000),
`COMPARE_TIMEOUT_MS` (5000), `MAX_ERROR_SNIPPET` (500).

Troubleshooting: if port 8080 is already taken, set `WEB_PORT` (e.g.
`WEB_PORT=8081 docker compose up -d`) and browse to that port instead.

## Sections below weren't touched by AI. Human written.

## Surprises + why it breaks in prod.

- Building a moderation system relying purely on byte delta and user comments does not yield accurate results. The models are wildly inaccurate using metadata alone. Some data from my notes: ground-truthed against Wikipedia's own revert tags, vandalism precision was 46% and recall just 4% — of 135 community-reverted bad edits, the system caught 6.
- With the focus on the vandalism label, as it is the most damaging, I've added an external call to enrich the prompt with the actual edit data (i.e. if label is vandalism always reach out to the diff API). While the labeling was improved somewhat, I would not trust the system to auto-moderate data in production.
- The model struggled with reverts, couldn't figure out that suspicious Facebook links and an affiliate-link in a Rolex Milgauss article were actual examples of vandalism. The previous flaw was that the revert (i.e. removal of the malicious content) was actually a positive, rather than vandalism.
- The model was confidently wrong more often than not.
- Enriching the prompts when confidence was below 0.6 seemed like a sound idea to improve the verdicts, but in reality it didn't pan out. Even with additional context the model got a lot of things wrong.
- The next thought was to consider using a more powerful model. I started with llama 3B and upgraded to qwen 2, 7B ... to my surprise that made pretty much no difference. Either model was confidently wrong most of the time.
- The decision was made to treat "trivia" and "substantive" on the edit size at first, so a meaningful edit less than 100 bytes would still be classified as trivia and a pointless edit of 2,000 bytes or more was classified as substantive, signaling the size rather than merit.
- Tweaking prompts and improving logic such as "not" treating reverts as vandalism or vice versa did not yield the desired results. It is a useful magnitude sorter, but a weak judge of the substance.

## Why it breaks in production.

- Based on the surprises above, the biggest "break" is the fact that the system is unreliable without a human in the middle. It is a good system for categorizing generics, but it is nowhere near production quality for actual moderation with accuracy.
- Beyond that we have a single docker container with no failover or proper orchestration. Single instance of each service, no replication/failover, one Redpanda node, one Postgres, one service consumer. "Massive amounts of data" would be handled by partitions + more consumer instances, which the single-node setup can't do.
- SSE disconnect / reconnect gaps are lost forever; we don't track something like the "last event ID" to correctly restore the stream.
- No human-in-the-middle, which is how true moderation works per the brief research that I've done.
- Lack of a training pipeline, which would help the system become smarter over time, goes beyond the specifics of this assignment. Without it the system has a reliability ceiling.
- Inability to call out to an external, powerful model like Opus, which can meaningfully judge things like affiliate links, hinders the production system. Although this was part of the assignment criteria, in production I'd probably add a secondary pipeline to leverage an LLM which was much more accurate when I actually asked it to look at specific examples, when looking at the incorrect labeling during my manual testing.

## Tradeoffs - this section is based on the discoveries from the items above

- I decided to classify on metadata first; fetch the real diff only when confidence < 0.6, revert, or vandalism. Why not always reach out to the diff API? Calling out to an external API has the potential to get rate limited. I tried to find a happy middle, where I felt the external API call truly made sense. Given the fact that targeted enrichment only helped in some cases, calling out to the external API on every record didn't make sense.
- Size-based labeling, i.e. trivia vs substantive, because model judgement and confidence here weren't yielding the desired results. A hard gate, which can be tweaked in the settings, seemed like a more reliable approach.
- Smaller model over the larger one — llama3.2:3b vs qwen2.5:7b — no noticeable improvement; OOM on relatively solid hardware, had to shut down other services just to be able to run Qwen 2. The larger model was not worth it.
- Send structural anomalies to the DLQ, rather than simply dropping them. The DLQ can potentially be re-tried, inspected for errors, or used as training data.
- Firehose has no content. While storing it in Postgres could be valuable for further introspection, it went beyond the requirements of the assignment and would require an additional fetch from the diff API. Kept things true to the original schema.
- TypeScript over Python: types are very helpful for schema structures and data shapes; otherwise I'd probably need external libs.



# rp-tooling — project rules

## What this is

A streaming triage system: Wikipedia recent-changes (SSE firehose) → Redpanda
Connect (filter/project) → Redpanda topic → a TypeScript **reasoning service**
(LLM classification with retries, confidence branching, enrichment) → Postgres
→ a small read-only web/API layer. Everything runs locally via
`docker compose up`. Built as a Field Deployed Engineer exercise — the code
must be simple enough to defend line-by-line in a walkthrough.

## Hard constraints (from the exercise brief — violating these fails the exercise)

- **Local only.** Single-node Redpanda (`--mode=dev-container`). NEVER Redpanda
  Cloud, cloud URLs, or cloud auth. No enterprise/licensed Connect connectors.
- **LLM = local Ollama** (`ollama/ollama`), model configurable via
  `OLLAMA_MODEL` (default `llama3.2:3b`). No hosted-LLM keys required to run.
- **All reasoning lives in the service code** (`service/`) — never in a Connect
  `branch` processor. Connect does plumbing only: filter, project, route.
- **`docker compose up` must bring up everything** with no manual steps.
- The README Tradeoffs/surprises sections are written BY THE HUMAN — leave
  `<!-- HUMAN-WRITTEN: ... -->` placeholders; never generate their content.

## Architecture invariants

- Topic `wiki.edits.filtered`: lean projected records, keyed by page title.
- Topic `wiki.edits.classified`: the service's output audit trail.
- Postgres table `edits` is the read model; ALL writes are UPSERTs keyed on
  the recent-change id (`rc_id`) — at-least-once delivery + idempotent writes.
- Labels are a closed enum: `vandalism | substantive | trivia | unclear`.
  `unclear` is the fallback on unparseable/invalid model output — rows are
  never dropped, never fail the pipeline.
- The reasoning loop order: heuristic gate (no LLM) → classify → parse/repair
  retry (max 1) → confidence < 0.6 triggers ONE enrichment pass (fetch the
  real diff, re-classify) → UPSERT. Every stage must be a small, named,
  separately testable function.
- Config via environment variables with sane defaults, read in ONE module
  (`service/src/config.ts`). Never hard-code hosts, ports, model names,
  thresholds, or topic names at call sites.

## Code standards

- TypeScript, strict mode, ESM (`"type": "module"`, NodeNext). Node 22.
- Kafka client: `kafkajs`. Postgres: `pg`. HTTP: built-in `fetch`. Keep the
  dependency list minimal — every dependency must be justifiable in review.
- Small pure functions for logic; side effects (Kafka, HTTP, DB) at the edges.
  The riskiest logic (model-output parsing, label normalization, confidence
  branching) must be pure functions importable by tests without any I/O.
- Errors: external calls (Ollama, Wikipedia API, Postgres) get bounded retries
  with backoff where transient; a permanently failing item lands as `unclear`
  with the error reason recorded — the consumer NEVER crashes on bad data
  (poison-pill safety: `JSON.parse` of message values is always guarded).
- Comments only for constraints the code can't express. No narration.

## Testing rules (TDD is mandatory)

- Vitest. RED first: the failing test is written and observed failing before
  implementation. Mutation-testing mindset: assert exact values and boundary
  cases (a confidence check at `>= 0.6` gets tests at 0.59, 0.6, 0.61).
- Unit tests import pure functions only — no Kafka, no Docker, no network.
  Deterministic fixtures: real captured examples of dirty model output
  (markdown fences, prose wrapping, off-enum labels, truncated JSON).
- The test suite runs with `npm test` inside `service/` and must pass before
  every commit.

## Commit / PR rules

- Conventional-commit titles (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- **No AI-attribution trailers** — strip any `Co-Authored-By: Claude` or
  "Generated with" lines from commits and PR bodies.
- Branch per concern; PR references its issue (`Closes #N`).
- Workers commit ONLY their explicitly owned files (`git add <paths>`,
  never `git add -A`). Never commit with failing tests.

## Issue standard

- Labels: exactly one of `type:feature|bug|chore`, at most one
  `priority:high|normal`, smallest correct set of `area:infra|pipeline|service|web|docs`.
- Features carry Acceptance Criteria checkboxes; the epic links sub-issues
  natively. AC boxes are flipped at merge-time, not close-time.

## Layout

```
docker-compose.yml     everything: redpanda, connect, ollama(+model init), postgres, service, web
connect/               Redpanda Connect pipeline YAML
service/               reasoning worker (TypeScript) + its tests
web/                   read-only API + single HTML page over Postgres
sql/                   schema.sql (auto-applied via postgres image initdb)
.env.example           documented knobs; compose runs with zero env vars set
```

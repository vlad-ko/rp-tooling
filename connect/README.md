# connect/ — Wikimedia SSE -> `wiki.edits.filtered`

`pipeline.yaml` consumes the Wikimedia recent-changes SSE stream, keeps only
English-Wikipedia (`en.wikipedia.org`) mainspace (`namespace == 0`) human
(`bot == false`) edits with an absolute byte delta >= `FILTER_MIN_DELTA`,
projects each event to a lean 15-field record, and publishes to Redpanda topic
`wiki.edits.filtered` keyed by page title. No reasoning logic — plumbing only.

Error policy: expected drops (SSE framing noise like heartbeats/`event:`
lines, and policy rejects like bot edits or tiny deltas) are deleted.
**Structural anomalies** — unparseable `data:` lines, non-object payloads,
payloads missing a field the filter needs — are published to
`wiki.edits.deadletter` with the offending payload preserved and the reason in
a `dlq_reason` record header, so upstream schema drift shows up as messages
you can inspect and replay instead of silent data loss.

Knobs (env): `REDPANDA_BROKERS` (default `redpanda:9092`), `FILTER_MIN_DELTA`
(default `25`, keeps post-filter rate at roughly <= 1 event/s). Run standalone:
`docker run --rm -v $PWD/connect:/connect -e REDPANDA_BROKERS=<broker> docker.redpanda.com/redpandadata/connect:latest run /connect/pipeline.yaml`

Unit tests for the mappings live in `pipeline_test.yaml` (framing drops,
policy drops, dead-letter routing, the happy-path projection):
`docker run --rm -v $PWD/connect:/connect docker.redpanda.com/redpandadata/connect:latest test /connect/pipeline_test.yaml`

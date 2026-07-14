# connect/ — Wikimedia SSE -> `wiki.edits.filtered`

`pipeline.yaml` consumes the Wikimedia recent-changes SSE stream, keeps only
English-Wikipedia (`en.wikipedia.org`) mainspace (`namespace == 0`) human
(`bot == false`) edits with an absolute byte delta >= `FILTER_MIN_DELTA`,
projects each event to a lean 15-field record, and publishes to Redpanda topic
`wiki.edits.filtered` keyed by page title. No reasoning logic — plumbing only.

Knobs (env): `REDPANDA_BROKERS` (default `redpanda:9092`), `FILTER_MIN_DELTA`
(default `25`, keeps post-filter rate at roughly <= 1 event/s). Run standalone:
`docker run --rm -v $PWD/connect:/connect -e REDPANDA_BROKERS=<broker> docker.redpanda.com/redpandadata/connect:latest run /connect/pipeline.yaml`

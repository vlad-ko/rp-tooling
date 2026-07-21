export interface Config {
  brokers: string[];
  topicFiltered: string;
  topicClassified: string;
  groupId: string;
  ollamaUrl: string;
  ollamaModel: string;
  ollamaRetries: number;
  ollamaStartupTimeoutMs: number;
  ollamaRequestTimeoutMs: number;
  confidenceThreshold: number;
  diffMaxChars: number;
  heuristicTinyDelta: number;
  substantiveMinBytes: number;
  triviaMaxBytes: number;
  compareTimeoutMs: number;
  maxErrorSnippet: number;
  databaseUrl: string;
}

type Env = Record<string, string | undefined>;

/** Fallback on unset, empty, or non-finite input — never NaN into config. */
function numberOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The ONLY place env vars are read (CLAUDE.md); call sites take Config.
 * Every knob has a default — loading never throws, result is frozen.
 */
export function loadConfig(env: Env = process.env): Readonly<Config> {
  return Object.freeze({
    brokers: (env['REDPANDA_BROKERS'] ?? 'redpanda:9092')
      .split(',')
      .map((b) => b.trim())
      .filter((b) => b !== ''),
    topicFiltered: env['TOPIC_FILTERED'] ?? 'wiki.edits.filtered',
    topicClassified: env['TOPIC_CLASSIFIED'] ?? 'wiki.edits.classified',
    groupId: env['GROUP_ID'] ?? 'triage',
    ollamaUrl: env['OLLAMA_URL'] ?? 'http://ollama:11434',
    ollamaModel: env['OLLAMA_MODEL'] ?? 'llama3.2:3b',
    ollamaRetries: numberOr(env['OLLAMA_RETRIES'], 5),
    ollamaStartupTimeoutMs: numberOr(env['OLLAMA_STARTUP_TIMEOUT_MS'], 180_000),
    // Generous: CPU inference of a 4000-char enrichment prompt can take
    // tens of seconds; too low would false-abort legitimate slow work.
    ollamaRequestTimeoutMs: numberOr(env['OLLAMA_REQUEST_TIMEOUT_MS'], 120_000),
    confidenceThreshold: numberOr(env['CONFIDENCE_THRESHOLD'], 0.6),
    diffMaxChars: numberOr(env['DIFF_MAX_CHARS'], 4000),
    heuristicTinyDelta: numberOr(env['HEURISTIC_TINY_DELTA'], 5),
    substantiveMinBytes: numberOr(env['SUBSTANTIVE_MIN_BYTES'], 100),
    triviaMaxBytes: numberOr(env['TRIVIA_MAX_BYTES'], 2000),
    compareTimeoutMs: numberOr(env['COMPARE_TIMEOUT_MS'], 5000),
    maxErrorSnippet: numberOr(env['MAX_ERROR_SNIPPET'], 500),
    databaseUrl: env['DATABASE_URL'] ?? 'postgres://postgres:postgres@postgres:5432/triage',
  });
}

import type { ChatMessage } from './prompt.js';

/**
 * Infra failure (server down/unresponsive), as distinct from content
 * failure (dirty output). The consumer pauses on this; it never becomes
 * an `unclear` row.
 */
export class OllamaUnreachableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OllamaUnreachableError';
  }
}

export interface OllamaClient {
  chat: (messages: ChatMessage[]) => Promise<string>;
  isReady: () => Promise<boolean>;
  waitUntilReady: (timeoutMs: number) => Promise<void>;
}

// A readiness probe is a health check, not inference — it must fail fast so
// the recovery poll (resumeWhenReady) can't itself hang on a wedged Ollama.
const READINESS_PROBE_MS = 5000;

/**
 * chat() posts to the native /api/chat with format:'json' (constrained
 * decoding — guarantees JSON syntax, NOT our schema) and returns the raw
 * content string, '' on shape surprises; throws OllamaUnreachableError on
 * transport/HTTP failures AND on request timeout (requestTimeoutMs) — a
 * wedged Ollama that never responds becomes an infra failure the consumer
 * pauses on, rather than hanging forever. Single-attempt by design — retries
 * are the caller's policy (pipeline.chatWithRetry). `fetchImpl` is injectable
 * for tests; production uses the global fetch.
 */
export function createOllamaClient(opts: {
  url: string;
  model: string;
  requestTimeoutMs: number;
  fetchImpl?: typeof fetch;
}): OllamaClient {
  const doFetch = opts.fetchImpl ?? fetch;

  async function chat(messages: ChatMessage[]): Promise<string> {
    let res: Response;
    try {
      res = await doFetch(`${opts.url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: opts.model, messages, stream: false, format: 'json' }),
        signal: AbortSignal.timeout(opts.requestTimeoutMs),
      });
    } catch (err) {
      throw new OllamaUnreachableError(`ollama unreachable at ${opts.url}: ${String(err)}`, {
        cause: err,
      });
    }
    if (!res.ok) {
      throw new OllamaUnreachableError(`ollama responded HTTP ${res.status}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new OllamaUnreachableError(`ollama returned a non-JSON body: ${String(err)}`, {
        cause: err,
      });
    }
    const content = (body as { message?: { content?: unknown } } | null)?.message?.content;
    return typeof content === 'string' ? content : '';
  }

  async function isReady(): Promise<boolean> {
    try {
      const res = await doFetch(`${opts.url}/api/tags`, {
        signal: AbortSignal.timeout(READINESS_PROBE_MS),
      });
      return res.ok;
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
    throw new OllamaUnreachableError(`ollama not ready at ${opts.url} after ${timeoutMs}ms`);
  }

  return { chat, isReady, waitUntilReady };
}

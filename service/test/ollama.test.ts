import { describe, expect, it } from 'vitest';
import { createOllamaClient, OllamaUnreachableError } from '../src/ollama.js';

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const base = { url: 'http://ollama', model: 'm', requestTimeoutMs: 1000 };

describe('createOllamaClient.chat', () => {
  it('passes an abort signal so a hung request cannot block the consumer forever', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = init;
      return fakeResponse({ message: { content: '{"label":"trivia"}' } });
    }) as unknown as typeof fetch;
    await createOllamaClient({ ...base, fetchImpl }).chat([{ role: 'user', content: 'hi' }]);
    expect(captured?.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a request timeout/abort to OllamaUnreachableError (→ pause/retry)', async () => {
    const fetchImpl = (async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as unknown as typeof fetch;
    await expect(
      createOllamaClient({ ...base, fetchImpl }).chat([{ role: 'user', content: 'hi' }]),
    ).rejects.toBeInstanceOf(OllamaUnreachableError);
  });

  it('returns the message content on success (via the injected fetch)', async () => {
    const fetchImpl = (async () =>
      fakeResponse({ message: { content: 'VERDICT' } })) as unknown as typeof fetch;
    expect(await createOllamaClient({ ...base, fetchImpl }).chat([{ role: 'user', content: 'hi' }])).toBe(
      'VERDICT',
    );
  });
});

describe('createOllamaClient.isReady', () => {
  it('is false when the readiness probe times out — the recovery poll must not hang', async () => {
    const fetchImpl = (async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as unknown as typeof fetch;
    expect(await createOllamaClient({ ...base, fetchImpl }).isReady()).toBe(false);
  });

  it('is true when the tags probe responds ok', async () => {
    const fetchImpl = (async () => fakeResponse({}, true)) as unknown as typeof fetch;
    expect(await createOllamaClient({ ...base, fetchImpl }).isReady()).toBe(true);
  });
});

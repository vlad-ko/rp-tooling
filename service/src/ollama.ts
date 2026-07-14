import type { ChatMessage } from './prompt.js';

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

export function createOllamaClient(opts: { url: string; model: string }): OllamaClient {
  async function chat(messages: ChatMessage[]): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${opts.url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: opts.model, messages, stream: false, format: 'json' }),
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
      const res = await fetch(`${opts.url}/api/tags`);
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

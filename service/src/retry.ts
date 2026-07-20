export interface RetryOptions {
  attempts: number;
  baseMs: number;
  capMs: number;
  onAttempt?: (attempt: number, err: unknown) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff: baseMs * 2^(attempt-1), capped at capMs, no jitter
 * (single consumer — no thundering herd to break up). Rethrows the LAST
 * error once attempts are exhausted; onAttempt fires between tries, not
 * after the final failure.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === opts.attempts) break;
      await opts.onAttempt?.(attempt, err);
      await sleep(Math.min(opts.capMs, opts.baseMs * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

import pino from 'pino';

const logger = pino({ name: 'withRetry' });

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms before exponential scaling (default: 1000) */
  baseDelayMs?: number;
  /** Maximum cap for any single delay in ms (default: 30000) */
  maxDelayMs?: number;
  /** Predicate that decides whether a given error is retryable. Default: no retries. */
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Execute an async function with exponential backoff and full jitter.
 *
 * Delay formula: min(maxDelayMs, random() * baseDelayMs * 2^attempt)
 *
 * By default, nothing retries — callers must provide `shouldRetry` to opt in.
 * If all retries are exhausted, throws the last error encountered.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 30000;
  const shouldRetry = options?.shouldRetry ?? ((_err: unknown) => false);

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < maxRetries && shouldRetry(err)) {
        const delay = Math.min(
          maxDelayMs,
          Math.random() * baseDelayMs * Math.pow(2, attempt),
        );
        logger.warn(
          {
            attempt: attempt + 1,
            maxRetries,
            delayMs: Math.round(delay),
            errorMessage: err instanceof Error ? err.message : String(err),
          },
          'Retry attempt — will retry after delay',
        );
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }

  // Should be unreachable, but satisfies TypeScript
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

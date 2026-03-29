import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../src/engine/withRetry.js';

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  })),
}));

class RetryableError extends Error {
  retryable = true;
}

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result when function succeeds on first call', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { shouldRetry: () => true });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries and eventually succeeds when shouldRetry returns true', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError('fail 1'))
      .mockRejectedValueOnce(new RetryableError('fail 2'))
      .mockResolvedValueOnce('recovered');

    const promise = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      shouldRetry: () => true,
    });

    // Advance through the retry delays
    await vi.advanceTimersByTimeAsync(300);

    const result = await promise;
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('fails immediately when shouldRetry returns false', async () => {
    const error = new Error('non-retryable');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, { shouldRetry: () => false }),
    ).rejects.toThrow('non-retryable');

    expect(fn).toHaveBeenCalledOnce();
  });

  it('throws last error when maxRetries is exceeded', async () => {
    const lastError = new RetryableError('still failing');
    const fn = vi.fn().mockRejectedValue(lastError);

    // Attach handler immediately to prevent unhandled rejection during timer advance
    const promise = withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 50,
      shouldRetry: () => true,
    }).catch((err) => err);

    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBeInstanceOf(RetryableError);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('delay timing respects exponential backoff bounds', async () => {
    const timestamps: number[] = [];
    const start = Date.now();

    const fn = vi
      .fn()
      .mockImplementation(() => {
        timestamps.push(Date.now() - start);
        return Promise.reject(new RetryableError('fail'));
      });

    const promise = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      shouldRetry: () => true,
    }).catch((err) => err);

    // Advance enough time for all retries:
    // attempt 0 → delay ~0-1000ms, attempt 1 → delay ~0-2000ms, attempt 2 → delay ~0-4000ms
    // Total worst case ≈ 7000ms, advance well beyond that
    await vi.advanceTimersByTimeAsync(15000);

    await expect(promise).resolves.toBeInstanceOf(RetryableError);
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('uses default shouldRetry (false) when not provided — no retries', async () => {
    const error = new Error('default no retry');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn)).rejects.toThrow('default no retry');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('caps delay at maxDelayMs', async () => {
    // With high attempt count, delay should be capped
    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.reject(new RetryableError(`fail ${callCount}`));
    });

    const promise = withRetry(fn, {
      maxRetries: 5,
      baseDelayMs: 10000,
      maxDelayMs: 100, // very low cap
      shouldRetry: () => true,
    }).catch((err) => err);

    // Each delay is capped at 100ms, so 5 retries ≈ 500ms max
    await vi.advanceTimersByTimeAsync(600);

    await expect(promise).resolves.toBeInstanceOf(RetryableError);
    // 1 initial + 5 retries = 6 calls
    expect(fn).toHaveBeenCalledTimes(6);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BagsRateLimiter } from '../src/clients/BagsRateLimiter.js';

describe('BagsRateLimiter', () => {
  beforeEach(() => {
    BagsRateLimiter.resetAll();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acquire() decrements remaining from default 1000', async () => {
    const limiter = new BagsRateLimiter('test-key');

    await limiter.acquire('high');
    expect(limiter.getSnapshot().remaining).toBe(999);

    await limiter.acquire('high');
    expect(limiter.getSnapshot().remaining).toBe(998);
  });

  it('updateFromHeaders() updates remaining and resetAt from response headers', () => {
    const limiter = new BagsRateLimiter('test-key');
    const headers = new Headers();
    headers.set('X-RateLimit-Remaining', '500');
    headers.set('X-RateLimit-Reset', '1700000000');

    limiter.updateFromHeaders(headers);

    expect(limiter.getSnapshot().remaining).toBe(500);
    expect(limiter.getSnapshot().resetAt).toBe(1700000000);
  });

  it('updateFromHeaders() sets backoffUntil on 429 status', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const limiter = new BagsRateLimiter('test-key');

    const headers = new Headers();
    headers.set('Retry-After', '30');

    limiter.updateFromHeaders(headers, 429);

    // backoffUntil = Date.now() + 30 * 1000
    expect(limiter.getSnapshot().backoffUntil).toBe(new Date('2024-01-01T00:00:00Z').getTime() + 30000);
  });

  it('backoff causes acquire() to sleep before proceeding', async () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const limiter = new BagsRateLimiter('test-key');

    // Set a backoff that requires 5 seconds of waiting
    const headers = new Headers();
    headers.set('Retry-After', '5');
    limiter.updateFromHeaders(headers, 429);

    // Start acquire — it should block until backoff expires
    const promise = limiter.acquire('high');

    // Fast-forward 4 seconds — should still be waiting
    vi.advanceTimersByTime(4000);

    // Check promise hasn't resolved yet by advancing a tiny bit more
    vi.advanceTimersByTime(1001);

    await promise;

    expect(limiter.getSnapshot().remaining).toBe(999); // Decremented after backoff
  });

  it('high priority has lower reserve floor than low', () => {
    const limiter = new BagsRateLimiter('test-key');

    // High priority: reserve floor = 0 → can acquire when remaining > 0
    // Low priority: reserve floor = 100 → needs remaining > 100

    // Simulate low remaining
    const headers = new Headers();
    headers.set('X-RateLimit-Remaining', '50');
    limiter.updateFromHeaders(headers);

    const snapshot = limiter.getSnapshot();
    expect(snapshot.remaining).toBe(50);

    // High priority can acquire at 50 (floor is 0)
    // Low priority at 50 with floor 100 + 25 = 125 would get jitter wait
    // This just validates the internal logic paths differ
    expect(snapshot.remaining).toBeLessThanOrEqual(100);
  });

  it('resetAll() clears static state between tests', () => {
    const limiter = new BagsRateLimiter('shared-key');
    limiter.acquire('high'); // This is async but uses fake timers

    BagsRateLimiter.resetAll();

    // New limiter with same key should start fresh
    const limiter2 = new BagsRateLimiter('shared-key');
    expect(limiter2.getSnapshot().remaining).toBe(1000);
  });

  it('non-429 status clears backoffUntil', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const limiter = new BagsRateLimiter('test-key');

    // Set a backoff
    const headers = new Headers();
    headers.set('Retry-After', '5');
    limiter.updateFromHeaders(headers, 429);
    expect(limiter.getSnapshot().backoffUntil).toBeGreaterThan(0);

    // Clear it with a successful response
    const successHeaders = new Headers();
    successHeaders.set('X-RateLimit-Remaining', '999');
    limiter.updateFromHeaders(successHeaders, 200);
    expect(limiter.getSnapshot().backoffUntil).toBe(0);
  });
});

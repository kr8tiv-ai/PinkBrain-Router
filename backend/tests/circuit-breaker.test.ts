import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerOpenError } from '../src/clients/CircuitBreaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000, name: 'test' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in CLOSED state', () => {
    const state = breaker.getState();
    expect(state.state).toBe('CLOSED');
    expect(state.failures).toBe(0);
  });

  it('execute() passes through when CLOSED', async () => {
    const result = await breaker.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
    expect(breaker.getState().state).toBe('CLOSED');
  });

  it('transitions CLOSED→OPEN after failureThreshold failures', async () => {
    const fail = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    expect(breaker.getState().state).toBe('OPEN');
    expect(breaker.getState().failures).toBe(3);
  });

  it('execute() throws CircuitBreakerOpenError when OPEN', async () => {
    // Trip the breaker
    const fail = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    await expect(breaker.execute(() => Promise.resolve(1))).rejects.toThrow(
      CircuitBreakerOpenError,
    );
    await expect(breaker.execute(() => Promise.resolve(1))).rejects.toMatchObject({
      message: expect.stringContaining('test'),
    });
  });

  it('transitions OPEN→HALF_OPEN after resetTimeoutMs', async () => {
    const fail = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    expect(breaker.getState().state).toBe('OPEN');

    // Advance past resetTimeoutMs
    vi.advanceTimersByTime(1001);

    // Next execute should try HALF_OPEN
    const result = await breaker.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    expect(breaker.getState().state).toBe('CLOSED');
  });

  it('HALF_OPEN→CLOSED on success, OPEN on failure', async () => {
    const fail = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    vi.advanceTimersByTime(1001);

    // Failure in HALF_OPEN goes back to OPEN
    await breaker.execute(fail).catch(() => {});
    expect(breaker.getState().state).toBe('OPEN');

    // Advance and succeed → CLOSED
    vi.advanceTimersByTime(1001);
    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.getState().state).toBe('CLOSED');
  });

  it('getState() returns current state and counters', async () => {
    const fail = () => Promise.reject(new Error('fail'));
    await breaker.execute(fail).catch(() => {});
    await breaker.execute(fail).catch(() => {});

    const state = breaker.getState();
    expect(state.state).toBe('CLOSED'); // Not yet at threshold
    expect(state.failures).toBe(2);
    expect(typeof state.lastFailureAt).toBe('number');
    expect(state.lastFailureAt).toBeGreaterThan(0);
  });

  it('reset() returns to CLOSED', async () => {
    const fail = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }
    expect(breaker.getState().state).toBe('OPEN');

    breaker.reset();
    const state = breaker.getState();
    expect(state.state).toBe('CLOSED');
    expect(state.failures).toBe(0);
    expect(state.lastFailureAt).toBe(0);
  });
});

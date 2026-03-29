import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunLock } from '../src/engine/RunLock.js';

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

describe('RunLock', () => {
  let lock: RunLock;

  beforeEach(() => {
    lock = new RunLock();
  });

  it('acquire returns true on first call for a strategy', () => {
    expect(lock.acquire('strat-1')).toBe(true);
  });

  it('acquire returns false on second call for same strategy', () => {
    lock.acquire('strat-1');
    expect(lock.acquire('strat-1')).toBe(false);
  });

  it('acquire for different strategies succeeds independently', () => {
    expect(lock.acquire('strat-1')).toBe(true);
    expect(lock.acquire('strat-2')).toBe(true);
    expect(lock.acquire('strat-1')).toBe(false);
    expect(lock.acquire('strat-2')).toBe(false);
  });

  it('release allows re-acquire', () => {
    lock.acquire('strat-1');
    lock.release('strat-1');
    expect(lock.acquire('strat-1')).toBe(true);
  });

  it('releaseAll clears all locks', () => {
    lock.acquire('strat-1');
    lock.acquire('strat-2');
    lock.acquire('strat-3');

    lock.releaseAll();

    expect(lock.isLocked('strat-1')).toBe(false);
    expect(lock.isLocked('strat-2')).toBe(false);
    expect(lock.isLocked('strat-3')).toBe(false);
  });

  it('release on non-held lock is a safe no-op', () => {
    expect(() => lock.release('strat-never-locked')).not.toThrow();
  });

  it('isLocked returns correct state', () => {
    expect(lock.isLocked('strat-1')).toBe(false);
    lock.acquire('strat-1');
    expect(lock.isLocked('strat-1')).toBe(true);
    lock.release('strat-1');
    expect(lock.isLocked('strat-1')).toBe(false);
  });
});

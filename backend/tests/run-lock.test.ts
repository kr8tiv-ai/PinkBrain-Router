import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunLock } from '../src/engine/RunLock.js';
import type { DatabaseConnection } from '../src/services/Database.js';

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

/**
 * Creates a mock DatabaseConnection that simulates the run_locks table
 * using an in-memory Set, matching the INSERT OR IGNORE / DELETE semantics.
 */
function createMockDb(): DatabaseConnection {
  const locks = new Set<string>();

  const makeStatement = (sql: string) => ({
    run: vi.fn((...args: unknown[]) => {
      if (sql.startsWith('INSERT OR IGNORE')) {
        const strategyId = args[0] as string;
        if (locks.has(strategyId)) {
          return { changes: 0 };
        }
        locks.add(strategyId);
        return { changes: 1 };
      }
      if (sql === 'DELETE FROM run_locks WHERE strategy_id = ?') {
        const strategyId = args[0] as string;
        const had = locks.has(strategyId);
        locks.delete(strategyId);
        return { changes: had ? 1 : 0 };
      }
      if (sql === 'DELETE FROM run_locks') {
        const size = locks.size;
        locks.clear();
        return { changes: size };
      }
      // cleanStaleLocks — no-op in tests (no real timestamps)
      if (sql.includes("datetime('now'")) {
        return { changes: 0 };
      }
      return { changes: 0 };
    }),
    get: vi.fn((...args: unknown[]) => {
      if (sql.startsWith('SELECT 1')) {
        const strategyId = args[0] as string;
        return locks.has(strategyId) ? { '1': 1 } : undefined;
      }
      return undefined;
    }),
    all: vi.fn().mockReturnValue([]),
  });

  return {
    prepare: vi.fn((sql: string) => makeStatement(sql)),
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn(<T>(fn: () => T): T => fn()) as <T>(fn: () => T) => T,
    close: vi.fn(),
  } as unknown as DatabaseConnection;
}

describe('RunLock', () => {
  let lock: RunLock;

  beforeEach(() => {
    lock = new RunLock(createMockDb());
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

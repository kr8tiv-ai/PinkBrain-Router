import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UsageTrackingService } from '../src/services/UsageTrackingService.js';
import type { KeyData } from '../src/clients/OpenRouterClient.js';
import type { DatabaseConnection } from '../src/services/Database.js';

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2)),
}));

// ─── Test fixtures ──────────────────────────────────────────────

function makeKeyData(overrides: Partial<KeyData> & { hash: string } = { hash: 'hash-1' }): KeyData {
  return {
    name: 'test-key',
    disabled: false,
    limit: 10.0,
    limit_remaining: 7.5,
    usage: 2.5,
    usage_daily: 0.5,
    usage_weekly: 1.0,
    usage_monthly: 2.0,
    created_at: '2025-01-15T00:00:00Z',
    updated_at: '2025-01-20T12:00:00Z',
    expires_at: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

// ─── Mock DB ────────────────────────────────────────────────────

interface MockDatabase extends DatabaseConnection {
  _rows: Array<Record<string, unknown>>;
  _mockGetKeysResult: Array<{ openrouterKeyHash: string; strategyId: string }>;
}

function createMockDb(): MockDatabase {
  const rows: Array<Record<string, unknown>> = [];

  const mockGetKeysResult: Array<{ openrouterKeyHash: string; strategyId: string }> = [
    { openrouterKeyHash: 'hash-1', strategyId: 'strat-1' },
    { openrouterKeyHash: 'hash-2', strategyId: 'strat-1' },
  ];

  return {
    _rows: rows,
    _mockGetKeysResult: mockGetKeysResult,
    prepare: (sql: string) => {
      // INSERT into usage_snapshots
      if (sql.includes('INSERT') && sql.includes('usage_snapshots')) {
        return {
          run: (...params: unknown[]) => {
            rows.push({
              id: params[0],
              key_hash: params[1],
              strategy_id: params[2],
              usage: params[3],
              usage_daily: params[4],
              usage_weekly: params[5],
              usage_monthly: params[6],
              limit_remaining: params[7],
              limit: params[8],
              polled_at: params[9],
            });
            return { changes: 1 };
          },
          get: () => null,
          all: () => [],
        };
      }

      // SELECT active keys
      if (sql.includes('SELECT') && sql.includes('user_keys') && sql.includes('ACTIVE')) {
        return {
          run: () => ({ changes: 0 }),
          get: () => null,
          all: () => mockGetKeysResult,
        };
      }

      // SELECT from usage_snapshots by key_hash
      if (sql.includes('SELECT') && sql.includes('usage_snapshots') && sql.includes('key_hash = ?') && !sql.includes('strategy_id = ?')) {
        return {
          run: () => ({ changes: 0 }),
          get: () => null,
          all: (...p: unknown[]) => {
            const hash = p[0] as string;
            const limit = (p[1] as number) ?? 100;
            return rows
              .filter((r) => r.key_hash === hash)
              .sort((a, b) => (b.polled_at as string).localeCompare(a.polled_at as string))
              .slice(0, limit);
          },
        };
      }

      // SELECT from usage_snapshots by strategy_id
      if (sql.includes('SELECT') && sql.includes('usage_snapshots') && sql.includes('strategy_id = ?')) {
        return {
          run: () => ({ changes: 0 }),
          get: () => null,
          all: (...p: unknown[]) => {
            const strategyId = p[0] as string;
            const limit = (p[1] as number) ?? 100;
            return rows
              .filter((r) => r.strategy_id === strategyId)
              .sort((a, b) => (b.polled_at as string).localeCompare(a.polled_at as string))
              .slice(0, limit);
          },
        };
      }

      return { run: () => ({ changes: 0 }), get: () => null, all: () => [] };
    },
    exec: () => {},
    pragma: () => {},
    transaction: (fn: () => unknown) => fn(),
    close: () => {},
  } as MockDatabase;
}

// ─── Mock OpenRouterClient ─────────────────────────────────────

function createMockClient() {
  return {
    getKey: vi.fn(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('UsageTrackingService', () => {
  let service: UsageTrackingService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockDb = createMockDb();
    mockClient = createMockClient();
    mockClient.getKey.mockResolvedValue(makeKeyData({ hash: 'hash-1' }));
    mockClient.getKey.mockResolvedValueOnce(makeKeyData({ hash: 'hash-1', usage: 2.5 }));
    mockClient.getKey.mockResolvedValueOnce(makeKeyData({ hash: 'hash-2', usage: 5.0 }));
    service = new UsageTrackingService(mockClient as any, mockDb);
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  describe('pollAllKeys', () => {
    it('fetches usage for all active keys and persists snapshots', async () => {
      await service.pollAllKeys();

      expect(mockClient.getKey).toHaveBeenCalledTimes(2);
      expect(mockClient.getKey).toHaveBeenCalledWith('hash-1');
      expect(mockClient.getKey).toHaveBeenCalledWith('hash-2');
      expect(mockDb._rows).toHaveLength(2);
      expect(mockDb._rows[0].key_hash).toBe('hash-1');
      expect(mockDb._rows[0].usage).toBe(2.5);
      expect(mockDb._rows[1].key_hash).toBe('hash-2');
      expect(mockDb._rows[1].usage).toBe(5.0);
    });

    it('continues polling remaining keys when one key fetch fails', async () => {
      mockClient.getKey.mockReset();
      mockClient.getKey
        .mockRejectedValueOnce(new Error('API 500'))
        .mockResolvedValueOnce(makeKeyData({ hash: 'hash-2', usage: 5.0 }));

      await service.pollAllKeys();

      expect(mockClient.getKey).toHaveBeenCalledTimes(2);
      // Only hash-2's snapshot should be persisted
      expect(mockDb._rows).toHaveLength(1);
      expect(mockDb._rows[0].key_hash).toBe('hash-2');
    });

    it('continues polling when DB INSERT fails for one key', async () => {
      // Track how many times INSERT prepare is called
      let insertCallCount = 0;
      const originalPrepare = mockDb.prepare.bind(mockDb);
      mockDb.prepare = (sql: string) => {
        if (sql.includes('INSERT') && sql.includes('usage_snapshots')) {
          insertCallCount++;
          const stmt = originalPrepare(sql);
          return {
            ...stmt,
            run: (...params: unknown[]) => {
              // Fail on the second INSERT call
              if (insertCallCount === 2) {
                throw new Error('DB write failed');
              }
              return stmt.run(...params);
            },
          };
        }
        return originalPrepare(sql);
      };

      await service.pollAllKeys();

      // Both keys were fetched, but only one was persisted
      expect(mockClient.getKey).toHaveBeenCalledTimes(2);
      expect(mockDb._rows).toHaveLength(1);
    });

    it('handles OpenRouter 404 for deleted key gracefully', async () => {
      mockClient.getKey.mockReset();
      const { OpenRouterError } = await import('../src/clients/OpenRouterClient.js');
      mockClient.getKey
        .mockRejectedValueOnce(new OpenRouterError('Not found', 404, 'NOT_FOUND'))
        .mockResolvedValueOnce(makeKeyData({ hash: 'hash-2', usage: 5.0 }));

      await service.pollAllKeys();

      expect(mockDb._rows).toHaveLength(1);
      expect(mockDb._rows[0].key_hash).toBe('hash-2');
    });

    it('handles OpenRouter 429 rate limit gracefully', async () => {
      mockClient.getKey.mockReset();
      const { OpenRouterError } = await import('../src/clients/OpenRouterClient.js');
      mockClient.getKey
        .mockRejectedValueOnce(new OpenRouterError('Rate limited', 429, 'RATE_LIMITED'))
        .mockResolvedValueOnce(makeKeyData({ hash: 'hash-2', usage: 5.0 }));

      await service.pollAllKeys();

      expect(mockDb._rows).toHaveLength(1);
      expect(mockDb._rows[0].key_hash).toBe('hash-2');
    });

    it('returns early when no active keys exist', async () => {
      mockDb._mockGetKeysResult.length = 0;

      await service.pollAllKeys();

      expect(mockClient.getKey).not.toHaveBeenCalled();
      expect(mockDb._rows).toHaveLength(0);
    });

    it('works with a single active key', async () => {
      mockDb._mockGetKeysResult.length = 0;
      mockDb._mockGetKeysResult.push({ openrouterKeyHash: 'solo-hash', strategyId: 'strat-1' });
      mockClient.getKey.mockReset();
      mockClient.getKey.mockResolvedValueOnce(makeKeyData({ hash: 'solo-hash', usage: 3.0 }));

      await service.pollAllKeys();

      expect(mockDb._rows).toHaveLength(1);
      expect(mockDb._rows[0].key_hash).toBe('solo-hash');
      expect(mockDb._rows[0].usage).toBe(3.0);
    });

    it('handles DB query failure for user_keys gracefully', async () => {
      mockDb.prepare = () => {
        throw new Error('DB connection lost');
      };

      // Should not throw
      await service.pollAllKeys();

      expect(mockClient.getKey).not.toHaveBeenCalled();
      expect(mockDb._rows).toHaveLength(0);
    });

    it('persists all usage fields correctly', async () => {
      mockClient.getKey.mockReset();
      const keyData = makeKeyData({
        hash: 'hash-1',
        usage: 10.0,
        usage_daily: 1.0,
        usage_weekly: 5.0,
        usage_monthly: 8.0,
        limit_remaining: 2.0,
        limit: 12.0,
      });
      mockClient.getKey
        .mockResolvedValueOnce(keyData)
        .mockResolvedValueOnce(makeKeyData({ hash: 'hash-2' }));

      await service.pollAllKeys();

      expect(mockDb._rows.length).toBeGreaterThanOrEqual(1);
      const row = mockDb._rows.find((r) => r.key_hash === 'hash-1');
      expect(row).toBeDefined();
      expect(row!.usage).toBe(10.0);
      expect(row!.usage_daily).toBe(1.0);
      expect(row!.usage_weekly).toBe(5.0);
      expect(row!.usage_monthly).toBe(8.0);
      expect(row!.limit_remaining).toBe(2.0);
      expect(row!.limit).toBe(12.0);
      expect(row!.polled_at).toBeTruthy();
    });
  });

  describe('start / stop', () => {
    it('starts polling on a timer and can be stopped', async () => {
      mockClient.getKey.mockReset();
      mockClient.getKey.mockResolvedValue(makeKeyData({ hash: 'hash-1' }));

      service.start(60_000);

      // pollAllKeys is called immediately in start() but not awaited — flush the microtask queue
      await vi.advanceTimersByTimeAsync(0);

      expect(mockDb._rows.length).toBeGreaterThanOrEqual(1);

      // Advance timer to trigger second poll
      await vi.advanceTimersByTimeAsync(60_000);

      const countBefore = mockClient.getKey.mock.calls.length;
      service.stop();

      // After stop, no more polls
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockClient.getKey.mock.calls.length).toBe(countBefore);
    });

    it('ignores duplicate start calls', () => {
      service.start(60_000);
      service.start(60_000); // should be ignored, no error

      service.stop();
    });
  });

  describe('getKeyUsage', () => {
    it('returns snapshots for a specific key hash ordered by polled_at DESC', () => {
      // Seed some data directly
      mockDb._rows.push(
        { id: '1', key_hash: 'hash-1', strategy_id: 'strat-1', usage: 1.0, usage_daily: 0.1, usage_weekly: 0.5, usage_monthly: 1.0, limit_remaining: 9, limit: 10, polled_at: '2025-01-01T00:00:00Z' },
        { id: '2', key_hash: 'hash-1', strategy_id: 'strat-1', usage: 2.0, usage_daily: 0.2, usage_weekly: 1.0, usage_monthly: 2.0, limit_remaining: 8, limit: 10, polled_at: '2025-01-02T00:00:00Z' },
        { id: '3', key_hash: 'hash-2', strategy_id: 'strat-1', usage: 5.0, usage_daily: 0.5, usage_weekly: 2.0, usage_monthly: 5.0, limit_remaining: 5, limit: 10, polled_at: '2025-01-02T00:00:00Z' },
      );

      const result = service.getKeyUsage('hash-1');

      expect(result).toHaveLength(2);
      expect(result[0].polled_at).toBe('2025-01-02T00:00:00Z'); // newest first
      expect(result[1].polled_at).toBe('2025-01-01T00:00:00Z');
    });

    it('respects the limit parameter', () => {
      mockDb._rows.push(
        { id: '1', key_hash: 'hash-1', strategy_id: 'strat-1', usage: 1.0, usage_daily: 0.1, usage_weekly: 0.5, usage_monthly: 1.0, limit_remaining: 9, limit: 10, polled_at: '2025-01-01T00:00:00Z' },
        { id: '2', key_hash: 'hash-1', strategy_id: 'strat-1', usage: 2.0, usage_daily: 0.2, usage_weekly: 1.0, usage_monthly: 2.0, limit_remaining: 8, limit: 10, polled_at: '2025-01-02T00:00:00Z' },
      );

      const result = service.getKeyUsage('hash-1', 1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2'); // newest
    });
  });

  describe('getStrategyUsage', () => {
    it('returns snapshots for a strategy across all keys', () => {
      mockDb._rows.push(
        { id: '1', key_hash: 'hash-1', strategy_id: 'strat-1', usage: 1.0, usage_daily: 0.1, usage_weekly: 0.5, usage_monthly: 1.0, limit_remaining: 9, limit: 10, polled_at: '2025-01-01T00:00:00Z' },
        { id: '2', key_hash: 'hash-2', strategy_id: 'strat-1', usage: 5.0, usage_daily: 0.5, usage_weekly: 2.0, usage_monthly: 5.0, limit_remaining: 5, limit: 10, polled_at: '2025-01-01T01:00:00Z' },
        { id: '3', key_hash: 'hash-3', strategy_id: 'strat-2', usage: 3.0, usage_daily: 0.3, usage_weekly: 1.5, usage_monthly: 3.0, limit_remaining: 7, limit: 10, polled_at: '2025-01-01T02:00:00Z' },
      );

      const result = service.getStrategyUsage('strat-1');

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.strategy_id === 'strat-1')).toBe(true);
    });

    it('returns empty array for strategy with no snapshots', () => {
      const result = service.getStrategyUsage('nonexistent-strat');

      expect(result).toHaveLength(0);
    });
  });

  // ─── Coverage gap tests ─────────────────────────────────────────

  describe('stop', () => {
    it('no-ops when service is not running (timer is null)', () => {
      // Service was just created, never started
      expect(() => service.stop()).not.toThrow();
    });
  });

  describe('pollAllKeys', () => {
    it('counts all errors when every key fetch fails', async () => {
      mockClient.getKey.mockReset();
      mockClient.getKey
        .mockRejectedValueOnce(new Error('API 500'))
        .mockRejectedValueOnce(new Error('API 500'));

      await service.pollAllKeys();

      expect(mockClient.getKey).toHaveBeenCalledTimes(2);
      expect(mockDb._rows).toHaveLength(0);
    });

    it('counts all errors when every DB INSERT fails', async () => {
      // Make ALL INSERT calls fail
      const originalPrepare = mockDb.prepare.bind(mockDb);
      mockDb.prepare = (sql: string) => {
        if (sql.includes('INSERT') && sql.includes('usage_snapshots')) {
          const stmt = originalPrepare(sql);
          return {
            ...stmt,
            run: () => {
              throw new Error('DB write failed');
            },
          };
        }
        return originalPrepare(sql);
      };

      await service.pollAllKeys();

      expect(mockClient.getKey).toHaveBeenCalledTimes(2);
      expect(mockDb._rows).toHaveLength(0);
    });
  });
});

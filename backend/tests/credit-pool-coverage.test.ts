import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB factory ─────────────────────────────────────────────

function createMockDb(overrides: Record<string, unknown> = {}) {
  const allocations: Array<{ id: string; run_id: string; amount_usd: number; created_at: string }> = [];
  let insertShouldFail = false;

  const db: Record<string, unknown> = {
    _allocations: allocations,
    _insertShouldFail: false,

    prepare: (sql: string) => {
      // INSERT into credit_pool_allocations
      if (sql.includes('INSERT')) {
        return {
          run: (...args: unknown[]) => {
            if (db._insertShouldFail) {
              throw new Error('UNIQUE constraint failed: id');
            }
            allocations.push({
              id: args[0] as string,
              run_id: args[1] as string,
              amount_usd: args[2] as number,
              created_at: args[3] as string,
            });
            return { changes: 1 };
          },
          get: () => null,
          all: () => [],
        };
      }

      // SUM(amount_usd)
      if (sql.includes('SUM(amount_usdc)')) {
        return {
          run: () => ({ changes: 0 }),
          get: () => ({
            total: allocations.reduce((sum: number, row) => sum + (row.amount_usd || 0), 0),
          }),
          all: () => [{
            total: allocations.reduce((sum: number, row) => sum + (row.amount_usd || 0), 0),
          }],
        };
      }

      // SELECT for pool history
      if (sql.includes('SELECT') && sql.includes('credit_pool_allocations')) {
        return {
          run: () => ({ changes: 0 }),
          get: () => null,
          all: (...p: unknown[]) => {
            const limit = (p[0] as number) ?? 100;
            return allocations
              .slice()
              .reverse()
              .slice(0, limit)
              .map((a) => ({
                id: a.id,
                runId: a.run_id,
                amountUsd: a.amount_usd,
                createdAt: a.created_at,
              }));
          },
        };
      }

      return {
        run: () => ({ changes: 0 }),
        get: () => null,
        all: () => [],
      };
    },

    exec: () => {},
    pragma: () => {},
    transaction: (fn: () => unknown) => fn(),
    close: () => {},
  };

  return Object.assign(db, overrides) as ReturnType<typeof createMockDb>;
}

// ─── Mock OpenRouterClient ───────────────────────────────────────

function createMockOpenRouter(balance = 1000) {
  return {
    getAccountCredits: vi.fn().mockResolvedValue({
      total_credits: balance,
      total_usage: 0,
    }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('CreditPoolService — coverage gaps', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockOpenRouter: ReturnType<typeof createMockOpenRouter>;
  let service: import('../src/services/CreditPoolService.js').CreditPoolService;

  beforeEach(async () => {
    mockDb = createMockDb();
    mockOpenRouter = createMockOpenRouter();
    const { CreditPoolService } = await import('../src/services/CreditPoolService.js');
    service = new CreditPoolService(mockOpenRouter as any, mockDb as any, 10);
  });

  describe('recordAllocation', () => {
    it('re-throws error when DB INSERT fails', () => {
      mockDb._insertShouldFail = true;

      expect(() => service.recordAllocation('run-fail', 100))
        .toThrow('UNIQUE constraint failed: id');
    });
  });

  describe('setReservePct', () => {
    it('throws when pct is negative', () => {
      expect(() => service.setReservePct(-1))
        .toThrow('Reserve percentage must be between 0 and 50');
    });

    it('throws when pct exceeds 50', () => {
      expect(() => service.setReservePct(51))
        .toThrow('Reserve percentage must be between 0 and 50');
    });

    it('accepts pct of 0', () => {
      service.setReservePct(0);
      // Should not throw; verify by checking allocation uses 0% reserve
      // (1000 * 0 = 0 reserved, so available = 1000)
    });

    it('accepts pct of 50', () => {
      service.setReservePct(50);
    });

    it('accepts boundary values and updates allocation math', async () => {
      service.setReservePct(25);

      const check = await service.checkAllocation(500);
      // 1000 balance, 25% reserve = 250 reserved
      // available = 1000 - 0 (no prior allocations) - 250 = 750
      expect(check.availableAfterReserve).toBe(750);
      expect(check.remainingAfterAllocation).toBe(250);
    });
  });

  describe('getPoolState cache', () => {
    it('returns cached state on second call within TTL', async () => {
      // First call — fetches from API
      const state1 = await service.getPoolState();
      expect(mockOpenRouter.getAccountCredits).toHaveBeenCalledTimes(1);

      // Second call — should use cache
      const state2 = await service.getPoolState();
      expect(mockOpenRouter.getAccountCredits).toHaveBeenCalledTimes(1); // still 1, not 2
      expect(state2).toBe(state1); // same object reference
    });

    it('fetches fresh data after cache is invalidated', async () => {
      // First call
      await service.getPoolState();
      expect(mockOpenRouter.getAccountCredits).toHaveBeenCalledTimes(1);

      // Invalidate and call again
      service.invalidateCache();
      const state2 = await service.getPoolState();
      expect(mockOpenRouter.getAccountCredits).toHaveBeenCalledTimes(2);
    });
  });

  describe('getPoolHistory', () => {
    it('returns allocation history from DB', () => {
      // Seed some allocations directly
      mockDb._allocations.push(
        { id: 'alloc-1', run_id: 'run-1', amount_usd: 100, created_at: '2025-01-01T00:00:00Z' },
        { id: 'alloc-2', run_id: 'run-2', amount_usd: 200, created_at: '2025-01-02T00:00:00Z' },
      );

      const history = service.getPoolHistory();

      expect(history).toHaveLength(2);
      // Ordered by created_at DESC (reversed in mock)
      expect(history[0].runId).toBe('run-2');
      expect(history[1].runId).toBe('run-1');
    });

    it('respects the limit parameter', () => {
      mockDb._allocations.push(
        { id: 'alloc-1', run_id: 'run-1', amount_usd: 100, created_at: '2025-01-01T00:00:00Z' },
        { id: 'alloc-2', run_id: 'run-2', amount_usd: 200, created_at: '2025-01-02T00:00:00Z' },
        { id: 'alloc-3', run_id: 'run-3', amount_usd: 300, created_at: '2025-01-03T00:00:00Z' },
      );

      const history = service.getPoolHistory(2);
      expect(history).toHaveLength(2);
    });

    it('returns empty array when no allocations exist', () => {
      const history = service.getPoolHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe('invalidateCache', () => {
    it('clears cached state so next getPoolState fetches fresh data', async () => {
      // Populate cache
      await service.getPoolState();
      expect(mockOpenRouter.getAccountCredits).toHaveBeenCalledTimes(1);

      // Invalidate
      service.invalidateCache();

      // Next call should hit the API again
      mockOpenRouter.getAccountCredits.mockResolvedValueOnce({
        total_credits: 2000,
        total_usage: 0,
      });
      const fresh = await service.getPoolState();
      expect(mockOpenRouter.getAccountCredits).toHaveBeenCalledTimes(2);
      expect(fresh.totalBalanceUsd).toBe(2000);
    });
  });
});

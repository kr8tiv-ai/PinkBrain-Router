import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionPolicy } from '../src/engine/ExecutionPolicy.js';
import type { Config } from '../src/config/index.js';
import type { DatabaseConnection } from '../src/services/Database.js';

// ─── Helpers ────────────────────────────────────────────────────

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

function createTestConfig(overrides?: Partial<Config>): Config {
  return {
    bagsApiKey: 'test-bags-key',
    bagsApiBaseUrl: 'https://test.bags.fm/api/v1',
    heliusApiKey: 'test-helius-key',
    heliusRpcUrl: 'https://mainnet.helius-rpc.com/?api-key=test',
    solanaNetwork: 'devnet',
    openrouterManagementKey: 'test-mgmt-key',
    evmPrivateKey: undefined,
    evmChainId: 8453,
    apiAuthToken: 'test-token',
    port: 3001,
    feeThresholdSol: 5,
    feeSource: 'CLAIMABLE_POSITIONS',
    swapSlippageBps: 50,
    defaultKeyLimitUsd: 10,
    keyLimitReset: 'monthly',
    keyExpiryDays: 365,
    creditPoolReservePct: 10,
    distributionMode: 'TOP_N_HOLDERS',
    distributionTopN: 100,
    distributionTokenMint: undefined,
    cronExpression: '0 */6 * * *',
    minCronIntervalHours: 1,
    dryRun: false,
    executionKillSwitch: false,
    maxDailyRuns: 4,
    maxClaimableSolPerRun: 100,
    maxKeyLimitUsd: 100,
    keyRotationDays: 90,
    usagePollIntervalMin: 15,
    signerPrivateKey: undefined,
    bagsAgentUsername: undefined,
    bagsAgentJwt: undefined,
    bagsAgentWalletAddress: undefined,
    databasePath: ':memory:',
    logLevel: 'info',
    nodeEnv: 'test',
    ...overrides,
  };
}

function createMockDb(
  overrides?: Partial<{
    allRows: Array<{ strategy_id: string; count: number }>;
    runCalls: Array<{ sql: string; params: unknown[] }>;
  }>,
) {
  const allRows = overrides?.allRows ?? [];
  const runCalls: Array<{ sql: string; params: unknown[] }> = [];

  const mockDb = {
    _allRows: allRows,
    _runCalls: runCalls,
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT')) {
        return {
          run: vi.fn(),
          get: vi.fn(),
          all: () => allRows, // closure over mutable array reference
        };
      }
      if (sql.includes('INSERT') || sql.includes('UPDATE')) {
        return {
          run: vi.fn().mockImplementation((...params: unknown[]) => {
            runCalls.push({ sql, params });
            return { changes: 1 };
          }),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        };
      }
      return {
        run: vi.fn().mockReturnValue({ changes: 0 }),
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([]),
      };
    }),
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn((fn: () => unknown) => fn),
    close: vi.fn(),
  } as unknown as DatabaseConnection;

  return mockDb;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ExecutionPolicy DB persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates daily run counts from DB on construction', () => {
    const mockDb = createMockDb({
      allRows: [
        { strategy_id: 'strat-1', count: 2 },
        { strategy_id: 'strat-2', count: 1 },
      ],
    });

    const policy = new ExecutionPolicy(createTestConfig(), mockDb);
    const state = policy.getState();

    expect(state.dailyRunCount).toEqual({ 'strat-1': 2, 'strat-2': 1 });
    expect(state.lastRunDate).toBe('2026-03-29');
  });

  it('returns empty counts when DB has no rows for today', () => {
    const mockDb = createMockDb({ allRows: [] });
    const policy = new ExecutionPolicy(createTestConfig(), mockDb);

    expect(policy.getState().dailyRunCount).toEqual({});
  });

  it('persists increments to DB on recordRunStart', () => {
    const mockDb = createMockDb({ allRows: [] });
    const policy = new ExecutionPolicy(createTestConfig(), mockDb);

    policy.recordRunStart('strat-1');

    // In-memory should show the increment
    expect(policy.getState().dailyRunCount).toEqual({ 'strat-1': 1 });

    // DB should have received an UPSERT
    const db = mockDb as any;
    const insertCalls = db._runCalls.filter((c: { sql: string }) => c.sql.includes('INSERT'));
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].params).toEqual(['strat-1', '2026-03-29', 1]);

    // Second call increments
    policy.recordRunStart('strat-1');
    const insertCalls2 = db._runCalls.filter((c: { sql: string }) => c.sql.includes('INSERT'));
    expect(insertCalls2).toHaveLength(2);
    expect(insertCalls2[1].params).toEqual(['strat-1', '2026-03-29', 2]);
  });

  it('re-hydrates from DB on date rollover', () => {
    // Day 1: record some runs
    const allRows: Array<{ strategy_id: string; count: number }> = [];
    const mockDb = createMockDb({ allRows });
    const policy = new ExecutionPolicy(createTestConfig(), mockDb);

    policy.recordRunStart('strat-1');
    policy.recordRunStart('strat-1');
    expect(policy.getState().dailyRunCount).toEqual({ 'strat-1': 2 });

    // Advance to next day — update the rows the mock will return for the new date
    vi.setSystemTime(new Date('2026-03-30T12:00:00Z'));
    allRows.length = 0;
    allRows.push({ strategy_id: 'strat-1', count: 5 });

    // Trigger date rollover by recording a run
    policy.recordRunStart('strat-2');

    // After rollover, strat-1 should have the hydrated count from DB, strat-2 incremented
    const state = policy.getState();
    expect(state.dailyRunCount['strat-1']).toBe(5);
    expect(state.dailyRunCount['strat-2']).toBe(1);
  });

  it('works without db parameter — backward compat (D004)', () => {
    // No db parameter at all
    const policy = new ExecutionPolicy(createTestConfig());

    expect(policy.getState().dailyRunCount).toEqual({});
    policy.recordRunStart('strat-1');
    expect(policy.getState().dailyRunCount).toEqual({ 'strat-1': 1 });
  });

  it('works with explicit undefined db parameter', () => {
    const policy = new ExecutionPolicy(createTestConfig(), undefined);

    expect(policy.getState().dailyRunCount).toEqual({});
    policy.recordRunStart('strat-1');
    expect(policy.getState().dailyRunCount).toEqual({ 'strat-1': 1 });
  });

  it('falls back to in-memory when DB query fails during hydration', () => {
    const mockDb = createMockDb();
    // Make SELECT throw
    (mockDb as any).prepare.mockImplementation((sql: string) => {
      if (sql.includes('SELECT')) {
        return {
          run: vi.fn(),
          get: vi.fn(),
          all: vi.fn().mockImplementation(() => {
            throw new Error('DB locked');
          }),
        };
      }
      return {
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([]),
      };
    });

    // Should not throw — falls back to empty counts
    const policy = new ExecutionPolicy(createTestConfig(), mockDb);
    expect(policy.getState().dailyRunCount).toEqual({});

    // recordRunStart should still work in-memory
    policy.recordRunStart('strat-1');
    expect(policy.getState().dailyRunCount).toEqual({ 'strat-1': 1 });
  });

  it('falls back to in-memory when DB persist fails', () => {
    const mockDb = createMockDb({ allRows: [] });
    // Make INSERT/UPDATE throw
    const db = mockDb as any;
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes('SELECT')) {
        return {
          run: vi.fn(),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        };
      }
      if (sql.includes('INSERT') || sql.includes('UPDATE')) {
        return {
          run: vi.fn().mockImplementation(() => {
            throw new Error('disk full');
          }),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        };
      }
      return {
        run: vi.fn().mockReturnValue({ changes: 0 }),
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([]),
      };
    });

    const policy = new ExecutionPolicy(createTestConfig(), mockDb);
    policy.recordRunStart('strat-1');

    // In-memory count still incremented despite DB failure
    expect(policy.getState().dailyRunCount).toEqual({ 'strat-1': 1 });
  });
});

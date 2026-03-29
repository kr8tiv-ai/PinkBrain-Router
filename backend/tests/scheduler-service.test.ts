import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SchedulerService } from '../src/services/SchedulerService.js';
import type { Config } from '../src/config/index.js';
import type { Strategy } from '../src/types/index.js';
import type { ScheduledTask } from 'node-cron';

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

vi.mock('node-cron', () => ({
  __esModule: true,
  default: {
    validate: vi.fn((expr: string) => {
      // Simple validation: reject obviously broken expressions
      if (!expr || expr.trim() === '') return false;
      const parts = expr.trim().split(/\s+/);
      return parts.length >= 5;
    }),
    schedule: vi.fn((_expr: string, callback: () => void) => {
      const mockTask = { stop: vi.fn(), start: vi.fn() };
      // Store callback for direct invocation in tests
      (mockTask as any).__callback = callback;
      return mockTask;
    }),
  },
}));

// Import the mocked cron module to get refs
import cron from 'node-cron';

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

function createTestStrategy(overrides?: Partial<Strategy>): Strategy {
  return {
    strategyId: 'test-strategy-1',
    ownerWallet: 'test-wallet',
    source: 'CLAIMABLE_POSITIONS',
    distributionToken: 'So11111111111111111111111111111111111111112',
    swapConfig: { slippageBps: 50, maxPriceImpactBps: 300 },
    distribution: 'TOP_N_HOLDERS',
    distributionTopN: 100,
    keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly', expiryDays: 365 },
    creditPoolReservePct: 10,
    exclusionList: [],
    schedule: '0 */6 * * *',
    minClaimThreshold: 5,
    status: 'ACTIVE',
    lastRunId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createMockDeps(config?: Partial<Config>) {
  return {
    strategyService: {
      getAll: vi.fn(() => []),
    },
    runService: {
      create: vi.fn(() => ({
        runId: 'test-run-1',
        strategyId: 'test-strategy-1',
        state: 'PENDING' as const,
        startedAt: '2026-01-01T00:00:00Z',
        finishedAt: null,
        claimedSol: null,
        claimedTxSignature: null,
        swappedUsdc: null,
        swapTxSignature: null,
        swapQuoteSnapshot: null,
        bridgedUsdc: null,
        bridgeTxHash: null,
        fundedUsdc: null,
        fundingTxHash: null,
        allocatedUsd: null,
        keysProvisioned: null,
        keysUpdated: null,
        error: null,
      })),
    },
    stateMachine: {
      execute: vi.fn(() => Promise.resolve({})),
    },
    executionPolicy: {
      canStartRun: vi.fn(() => ({ allowed: true })),
      recordRunStart: vi.fn(),
    },
    runLock: {
      acquire: vi.fn(() => true),
      release: vi.fn(),
    },
    config: createTestConfig(config),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('SchedulerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('start()', () => {
    it('schedules all ACTIVE strategies with valid cron', async () => {
      const deps = createMockDeps();
      const strategy1 = createTestStrategy({ strategyId: 's1', schedule: '0 */6 * * *' });
      const strategy2 = createTestStrategy({ strategyId: 's2', schedule: '0 */12 * * *' });
      deps.strategyService.getAll.mockReturnValue([strategy1, strategy2]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      expect(scheduler.getScheduledCount()).toBe(2);
      expect(cron.schedule).toHaveBeenCalledTimes(2);
    });

    it('skips PAUSED strategies', async () => {
      const deps = createMockDeps();
      const active = createTestStrategy({ strategyId: 's1', status: 'ACTIVE', schedule: '0 */6 * * *' });
      const paused = createTestStrategy({ strategyId: 's2', status: 'PAUSED', schedule: '0 */6 * * *' });
      deps.strategyService.getAll.mockReturnValue([active, paused]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      expect(scheduler.getScheduledCount()).toBe(1);
      expect(cron.schedule).toHaveBeenCalledTimes(1);
    });

    it('skips strategies with invalid cron expressions', async () => {
      const deps = createMockDeps();
      const invalidStrategy = createTestStrategy({ strategyId: 's1', schedule: 'invalid' });
      deps.strategyService.getAll.mockReturnValue([invalidStrategy]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      expect(scheduler.getScheduledCount()).toBe(0);
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it('skips strategies with cron interval below minimum', async () => {
      const deps = createMockDeps({ minCronIntervalHours: 4 });
      // */1 hour = every hour, which is < 4 hours
      const tooFrequent = createTestStrategy({ strategyId: 's1', schedule: '0 */1 * * *' });
      deps.strategyService.getAll.mockReturnValue([tooFrequent]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      expect(scheduler.getScheduledCount()).toBe(0);
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it('starts with zero jobs when no ACTIVE strategies exist', async () => {
      const deps = createMockDeps();
      const paused1 = createTestStrategy({ strategyId: 's1', status: 'PAUSED', schedule: '0 */6 * * *' });
      const paused2 = createTestStrategy({ strategyId: 's2', status: 'PAUSED', schedule: '0 */6 * * *' });
      deps.strategyService.getAll.mockReturnValue([paused1, paused2]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      expect(scheduler.getScheduledCount()).toBe(0);
    });

    it('starts with zero jobs when StrategyService throws', async () => {
      const deps = createMockDeps();
      deps.strategyService.getAll.mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      const scheduler = new SchedulerService(deps as any);
      // Should not throw — just log and return
      await scheduler.start();

      expect(scheduler.getScheduledCount()).toBe(0);
    });

    it('skips strategy with empty schedule string', async () => {
      const deps = createMockDeps();
      const emptySchedule = createTestStrategy({ strategyId: 's1', schedule: '' });
      deps.strategyService.getAll.mockReturnValue([emptySchedule]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      expect(scheduler.getScheduledCount()).toBe(0);
      expect(cron.schedule).not.toHaveBeenCalled();
    });
  });

  describe('executeStrategyRun (via cron callback)', () => {
    it('calls ExecutionPolicy, RunLock, RunService, and StateMachine in order', async () => {
      const deps = createMockDeps();
      const strategy = createTestStrategy({ strategyId: 's1', schedule: '0 */6 * * *' });
      deps.strategyService.getAll.mockReturnValue([strategy]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      // Grab the callback from the scheduled task
      const mockTask = (cron.schedule as any).mock.calls[0][1] as () => void;
      await mockTask();

      expect(deps.executionPolicy.canStartRun).toHaveBeenCalledWith('s1');
      expect(deps.runLock.acquire).toHaveBeenCalledWith('s1');
      expect(deps.runService.create).toHaveBeenCalledWith('s1');
      expect(deps.executionPolicy.recordRunStart).toHaveBeenCalledWith('s1');
      expect(deps.stateMachine.execute).toHaveBeenCalled();
      expect(deps.runLock.release).toHaveBeenCalledWith('s1');
    });

    it('releases lock in finally block even on execution failure', async () => {
      const deps = createMockDeps();
      const strategy = createTestStrategy({ strategyId: 's1', schedule: '0 */6 * * *' });
      deps.strategyService.getAll.mockReturnValue([strategy]);
      deps.stateMachine.execute.mockRejectedValue(new Error('phase blew up'));

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      const mockTask = (cron.schedule as any).mock.calls[0][1] as () => void;
      await mockTask();

      expect(deps.stateMachine.execute).toHaveBeenCalled();
      expect(deps.runLock.release).toHaveBeenCalledWith('s1');
    });

    it('skips run when execution policy blocks', async () => {
      const deps = createMockDeps();
      deps.executionPolicy.canStartRun.mockReturnValue({ allowed: false, reason: 'Daily limit reached' });
      const strategy = createTestStrategy({ strategyId: 's1', schedule: '0 */6 * * *' });
      deps.strategyService.getAll.mockReturnValue([strategy]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      const mockTask = (cron.schedule as any).mock.calls[0][1] as () => void;
      await mockTask();

      expect(deps.runLock.acquire).not.toHaveBeenCalled();
      expect(deps.runService.create).not.toHaveBeenCalled();
      expect(deps.stateMachine.execute).not.toHaveBeenCalled();
    });

    it('skips run when run lock is already held', async () => {
      const deps = createMockDeps();
      deps.runLock.acquire.mockReturnValue(false);
      const strategy = createTestStrategy({ strategyId: 's1', schedule: '0 */6 * * *' });
      deps.strategyService.getAll.mockReturnValue([strategy]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      const mockTask = (cron.schedule as any).mock.calls[0][1] as () => void;
      await mockTask();

      expect(deps.runService.create).not.toHaveBeenCalled();
      expect(deps.stateMachine.execute).not.toHaveBeenCalled();
      // Release should NOT be called when acquire returned false
      expect(deps.runLock.release).not.toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('stops all scheduled jobs and clears the map', async () => {
      const deps = createMockDeps();
      const strategy = createTestStrategy({ strategyId: 's1', schedule: '0 */6 * * *' });
      deps.strategyService.getAll.mockReturnValue([strategy]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();
      expect(scheduler.getScheduledCount()).toBe(1);

      scheduler.stop();

      expect(scheduler.getScheduledCount()).toBe(0);
      // Verify task.stop() was called on the mock task
      const mockTask = (cron.schedule as any).mock.results[0].value;
      expect(mockTask.stop).toHaveBeenCalled();
    });
  });

  describe('minCronIntervalHours validation', () => {
    it('allows cron interval equal to minimum', async () => {
      const deps = createMockDeps({ minCronIntervalHours: 6 });
      const strategy = createTestStrategy({ strategyId: 's1', schedule: '0 */6 * * *' });
      deps.strategyService.getAll.mockReturnValue([strategy]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      expect(scheduler.getScheduledCount()).toBe(1);
    });

    it('allows daily schedule (24h) when minimum is 1h', async () => {
      const deps = createMockDeps({ minCronIntervalHours: 1 });
      const strategy = createTestStrategy({ strategyId: 's1', schedule: '0 0 * * *' });
      deps.strategyService.getAll.mockReturnValue([strategy]);

      const scheduler = new SchedulerService(deps as any);
      await scheduler.start();

      expect(scheduler.getScheduledCount()).toBe(1);
    });
  });
});

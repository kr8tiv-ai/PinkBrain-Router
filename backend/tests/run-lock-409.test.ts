import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerAllRoutes } from '../src/routes/index.js';

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

const TEST_TOKEN = 'test-bearer-token-12345';
const AUTH_HEADER = { authorization: `Bearer ${TEST_TOKEN}` };

const mockRun = {
  runId: 'run-0001',
  strategyId: 'strat-0001',
  state: 'COMPLETE' as const,
  startedAt: '2025-01-01T00:00:00Z',
  finishedAt: '2025-01-01T01:00:00Z',
  claimedSol: 10.5,
  claimedTxSignature: null,
  swappedUsdc: 100.0,
  swapTxSignature: null,
  swapQuoteSnapshot: null,
  bridgedUsdc: 100.0,
  bridgeTxHash: null,
  fundedUsdc: 100.0,
  fundingTxHash: null,
  allocatedUsd: 100.0,
  keysProvisioned: 5,
  keysUpdated: 0,
  error: null,
};

function createMockRunLock() {
  return {
    acquire: vi.fn().mockReturnValue(true),
    release: vi.fn(),
    isLocked: vi.fn().mockReturnValue(false),
    releaseAll: vi.fn(),
  };
}

function createAllDeps() {
  return {
    apiAuthToken: TEST_TOKEN,
    db: {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue(1),
        all: vi.fn().mockReturnValue([]),
      }),
      exec: vi.fn(),
      pragma: vi.fn(),
      transaction: vi.fn(<T>(fn: () => T): T => fn()) as <T>(fn: () => T) => T,
      close: vi.fn(),
    },
    openRouterClient: {
      listKeys: vi.fn().mockResolvedValue([]),
      getKey: vi.fn().mockResolvedValue(null),
      createKey: vi.fn(),
      updateKey: vi.fn(),
      deleteKey: vi.fn(),
      getAccountCredits: vi.fn().mockResolvedValue({ total_credits: 1000, total_usage: 250 }),
    },
    strategyService: {
      getAll: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    runService: {
      create: vi.fn().mockReturnValue(mockRun),
      getById: vi.fn().mockReturnValue(null),
      getByStrategyId: vi.fn().mockReturnValue([]),
      getLatestByStrategy: vi.fn().mockReturnValue(null),
      updateState: vi.fn(),
      markFailed: vi.fn(),
    },
    stateMachine: {
      execute: vi.fn().mockResolvedValue({ ...mockRun, state: 'COMPLETE' }),
      resume: vi.fn().mockResolvedValue({ ...mockRun, state: 'CLAIMING' }),
    },
    keyManagerService: {
      getKeysByStrategy: vi.fn().mockReturnValue([]),
      getActiveKey: vi.fn().mockReturnValue(null),
      getActiveKeyByWallet: vi.fn().mockReturnValue(null),
      revokeKey: vi.fn().mockResolvedValue(false),
      provisionKeys: vi.fn(),
    },
    creditPoolService: {
      getStatus: vi.fn().mockResolvedValue({ balance: 1000, allocated: 250, available: 750, reserve: 100, runway: '120 days' }),
      getPoolState: vi.fn().mockResolvedValue({ totalBalanceUsd: 1000, totalAllocatedUsd: 250, availableUsd: 750, reservePct: 10, reservedUsd: 100, lastUpdated: '' }),
      checkAllocation: vi.fn().mockResolvedValue({ allowed: true }),
      recordAllocation: vi.fn(),
      invalidateCache: vi.fn(),
    },
    usageTrackingService: {
      getKeyUsage: vi.fn().mockReturnValue([]),
      getStrategyUsage: vi.fn().mockReturnValue([]),
      start: vi.fn(),
      stop: vi.fn(),
      pollAllKeys: vi.fn(),
    },
    runLock: createMockRunLock(),
  };
}

describe('RunLock 409 guard on POST /runs', () => {
  it('POST /runs succeeds when lock is available', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: AUTH_HEADER,
      payload: { strategyId: 'strat-0001' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runId).toBe('run-0001');
    expect(deps.runLock.acquire).toHaveBeenCalledWith('strat-0001');
    expect(deps.runService.create).toHaveBeenCalledWith('strat-0001');
    expect(deps.stateMachine.execute).toHaveBeenCalled();
    expect(deps.runLock.release).toHaveBeenCalledWith('strat-0001');
    await app.close();
  });

  it('POST /runs returns 409 when lock is already held', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.runLock.acquire = vi.fn().mockReturnValue(false);
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: AUTH_HEADER,
      payload: { strategyId: 'strat-0001' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('A run is already in progress for this strategy');
    expect(body.statusCode).toBe(409);

    // Run should NOT be created when lock fails
    expect(deps.runService.create).not.toHaveBeenCalled();
    expect(deps.stateMachine.execute).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /runs releases lock in finally block on success', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    await registerAllRoutes(app, deps);

    await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: AUTH_HEADER,
      payload: { strategyId: 'strat-0001' },
    });

    expect(deps.runLock.release).toHaveBeenCalledWith('strat-0001');
    expect(deps.runLock.release).toHaveBeenCalledOnce();
    await app.close();
  });

  it('POST /runs releases lock in finally block even when execution fails', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.stateMachine.execute = vi.fn().mockRejectedValue(new Error('Phase execution failed'));
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: AUTH_HEADER,
      payload: { strategyId: 'strat-0001' },
    });

    // Error is propagated (500 from Fastify error handler)
    expect(res.statusCode).toBe(500);

    // Lock MUST be released despite the error
    expect(deps.runLock.release).toHaveBeenCalledWith('strat-0001');
    expect(deps.runLock.release).toHaveBeenCalledOnce();
    await app.close();
  });

  it('POST /runs returns 400 when strategyId is missing (existing validation)', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: AUTH_HEADER,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    // Lock should not be touched when validation fails before acquire
    expect(deps.runLock.acquire).not.toHaveBeenCalled();
    await app.close();
  });
});

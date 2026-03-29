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

// ─── Helpers ────────────────────────────────────────────────────

function createMockDb() {
  return {
    prepare: vi.fn().mockReturnValue({
      run: vi.fn().mockReturnValue({ changes: 1 }),
      get: vi.fn().mockReturnValue(1),
      all: vi.fn().mockReturnValue([]),
    }),
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn(<T>(fn: () => T): T => fn()) as <T>(fn: () => T) => T,
    close: vi.fn(),
  };
}

const mockStrategy = {
  strategyId: 'strat-0001',
  ownerWallet: 'WalletA',
  source: 'CLAIMABLE_POSITIONS' as const,
  distributionToken: '',
  swapConfig: { slippageBps: 50, maxPriceImpactBps: 300 },
  distribution: 'TOP_N_HOLDERS' as const,
  distributionTopN: 100,
  keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly' as const, expiryDays: 365 },
  creditPoolReservePct: 10,
  exclusionList: [],
  schedule: '0 */6 * * *',
  minClaimThreshold: 5,
  status: 'ACTIVE' as const,
  lastRunId: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

function createMockStrategyService() {
  return {
    getAll: vi.fn().mockReturnValue([mockStrategy]),
    getById: vi.fn().mockImplementation((id: string) =>
      id === mockStrategy.strategyId ? { ...mockStrategy } : null,
    ),
    create: vi.fn().mockImplementation((input: Record<string, unknown>) => ({
      ...mockStrategy,
      strategyId: 'strat-new-001',
      ownerWallet: input.ownerWallet,
    })),
    update: vi.fn().mockImplementation((id: string, input: Record<string, unknown>) =>
      id === mockStrategy.strategyId ? { ...mockStrategy, ...input } : null,
    ),
    delete: vi.fn().mockImplementation((id: string) =>
      id === mockStrategy.strategyId ? true : false,
    ),
  };
}

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

function createMockRunService() {
  return {
    create: vi.fn().mockReturnValue(mockRun),
    getById: vi.fn().mockImplementation((id: string) =>
      id === mockRun.runId ? { ...mockRun } : null,
    ),
    getByStrategyId: vi.fn().mockReturnValue([mockRun]),
    getLatestByStrategy: vi.fn().mockReturnValue(mockRun),
    getAll: vi.fn().mockReturnValue([mockRun]),
    updateState: vi.fn().mockReturnValue(mockRun),
    markFailed: vi.fn(),
    getAggregateStats: vi.fn().mockReturnValue({
      totalRuns: 10,
      completedRuns: 8,
      failedRuns: 2,
      totalClaimedSol: 50.5,
      totalSwappedUsdc: 500.0,
      totalAllocatedUsd: 400.0,
      totalKeysProvisioned: 25,
      totalKeysUpdated: 5,
    }),
  };
}

function createMockStateMachine() {
  return {
    execute: vi.fn().mockResolvedValue({ ...mockRun, state: 'COMPLETE' }),
    resume: vi.fn().mockResolvedValue({ ...mockRun, state: 'CLAIMING' }),
  };
}

const mockKeyData = {
  hash: 'key-hash-001',
  name: 'test-key',
  disabled: false,
  limit: 100,
  limit_remaining: 75,
  usage: 25,
  usage_daily: 5,
  usage_weekly: 15,
  usage_monthly: 25,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  expires_at: '2026-01-01T00:00:00Z',
};

function createMockOpenRouterClient() {
  return {
    listKeys: vi.fn().mockResolvedValue([mockKeyData]),
    getKey: vi.fn().mockResolvedValue(mockKeyData),
    createKey: vi.fn(),
    updateKey: vi.fn(),
    deleteKey: vi.fn(),
    getAccountCredits: vi.fn().mockResolvedValue({
      total_credits: 1000,
      total_usage: 250,
    }),
  };
}

const mockUserKey = {
  keyId: 'uk-0001',
  strategyId: 'strat-0001',
  holderWallet: 'WalletA',
  openrouterKeyHash: 'key-hash-001',
  spendingLimitUsd: 10,
  currentUsageUsd: 2.5,
  status: 'ACTIVE' as const,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  expiresAt: '2026-01-01T00:00:00Z',
};

function createMockKeyManagerService() {
  return {
    getKeysByStrategy: vi.fn().mockReturnValue([mockUserKey]),
    getActiveKey: vi.fn().mockReturnValue(mockUserKey),
    getActiveKeyByWallet: vi.fn().mockReturnValue(mockUserKey),
    revokeKey: vi.fn().mockResolvedValue(true),
    provisionKeys: vi.fn(),
  };
}

function createMockCreditPoolService() {
  return {
    getStatus: vi.fn().mockResolvedValue({
      balance: 1000,
      allocated: 250,
      available: 750,
      reserve: 100,
      runway: '120 days',
    }),
    getPoolState: vi.fn().mockResolvedValue({
      totalBalanceUsd: 1000,
      totalAllocatedUsd: 250,
      availableUsd: 750,
      reservePct: 10,
      reservedUsd: 100,
      lastUpdated: '2025-01-01T00:00:00Z',
    }),
    checkAllocation: vi.fn().mockResolvedValue({ allowed: true }),
    getPoolHistory: vi.fn().mockReturnValue([{
      id: 'alloc-001',
      runId: 'run-0001',
      amountUsd: 100,
      createdAt: '2025-01-01T00:00:00Z',
    }]),
    recordAllocation: vi.fn(),
    invalidateCache: vi.fn(),
  };
}

const mockUsageSnapshot = {
  id: 'snap-001',
  key_hash: 'key-hash-001',
  strategy_id: 'strat-0001',
  usage: 25,
  usage_daily: 5,
  usage_weekly: 15,
  usage_monthly: 25,
  limit_remaining: 75,
  limit: 100,
  polled_at: '2025-01-01T00:00:00Z',
};

function createMockUsageTrackingService() {
  return {
    getKeyUsage: vi.fn().mockReturnValue([mockUsageSnapshot]),
    getStrategyUsage: vi.fn().mockReturnValue([mockUsageSnapshot]),
    start: vi.fn(),
    stop: vi.fn(),
    pollAllKeys: vi.fn(),
  };
}

function createAllDeps() {
  return {
    db: createMockDb(),
    openRouterClient: createMockOpenRouterClient(),
    strategyService: createMockStrategyService(),
    runService: createMockRunService(),
    stateMachine: createMockStateMachine(),
    keyManagerService: createMockKeyManagerService(),
    creditPoolService: createMockCreditPoolService(),
    usageTrackingService: createMockUsageTrackingService(),
  };
}

async function createApp() {
  const app = Fastify({ logger: false });
  const deps = createAllDeps();
  await registerAllRoutes(app, deps);
  return { app, deps };
}

// ─── Strategy Routes ────────────────────────────────────────────

describe('Strategy Routes', () => {
  it('GET /strategies returns all strategies', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/strategies', headers: AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].strategyId).toBe('strat-0001');
    expect(deps.strategyService.getAll).toHaveBeenCalledOnce();
    await app.close();
  });

  it('POST /strategies creates a strategy with required ownerWallet', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/strategies',
      headers: AUTH_HEADER,
      payload: { ownerWallet: 'NewWallet' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().strategyId).toBe('strat-new-001');
    expect(res.json().ownerWallet).toBe('NewWallet');
    expect(deps.strategyService.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerWallet: 'NewWallet' }),
    );
    await app.close();
  });

  it('POST /strategies returns 400 when ownerWallet is missing', async () => {
    const { app } = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/strategies',
      headers: AUTH_HEADER,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /strategies/:id returns a strategy', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/strategies/strat-0001',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().strategyId).toBe('strat-0001');
    expect(deps.strategyService.getById).toHaveBeenCalledWith('strat-0001');
    await app.close();
  });

  it('GET /strategies/:id returns 404 for non-existent strategy', async () => {
    const { app } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/strategies/non-existent',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Strategy not found');
    await app.close();
  });

  it('PATCH /strategies/:id updates a strategy', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/strategies/strat-0001',
      headers: AUTH_HEADER,
      payload: { status: 'PAUSED' },
    });
    expect(res.statusCode).toBe(200);
    expect(deps.strategyService.update).toHaveBeenCalledWith('strat-0001', expect.objectContaining({ status: 'PAUSED' }));
    await app.close();
  });

  it('PATCH /strategies/:id returns 404 for non-existent strategy', async () => {
    const { app } = await createApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/strategies/non-existent',
      headers: AUTH_HEADER,
      payload: { status: 'PAUSED' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('DELETE /strategies/:id deletes a strategy', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/strategies/strat-0001',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
    expect(deps.strategyService.delete).toHaveBeenCalledWith('strat-0001');
    await app.close();
  });

  it('DELETE /strategies/:id returns 404 for non-existent strategy', async () => {
    const { app } = await createApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/strategies/non-existent',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// ─── Strategy Enable/Disable ───────────────────────────────────

describe('Strategy enable/disable', () => {
  it('POST /strategies/:id/enable returns 200 and updated strategy', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/strategies/strat-0001/enable',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ACTIVE');
    expect(deps.strategyService.update).toHaveBeenCalledWith('strat-0001', { status: 'ACTIVE' });
    await app.close();
  });

  it('POST /strategies/:id/disable returns 200 and paused strategy', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/strategies/strat-0001/disable',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PAUSED');
    expect(deps.strategyService.update).toHaveBeenCalledWith('strat-0001', { status: 'PAUSED' });
    await app.close();
  });

  it('POST /strategies/non-existent/enable returns 404', async () => {
    const { app } = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/strategies/non-existent/enable',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Strategy not found');
    await app.close();
  });
});

// ─── Run Routes ─────────────────────────────────────────────────

describe('Run Routes', () => {
  it('GET /runs returns all runs', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].runId).toBe('run-0001');
    expect(deps.runService.getAll).toHaveBeenCalledOnce();
    await app.close();
  });

  it('GET /runs?strategyId=strat-0001 returns filtered runs', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs?strategyId=strat-0001',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(deps.runService.getByStrategyId).toHaveBeenCalledWith('strat-0001');
    expect(deps.runService.getAll).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /runs triggers a new run', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: AUTH_HEADER,
      payload: { strategyId: 'strat-0001' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().runId).toBe('run-0001');
    expect(deps.runService.create).toHaveBeenCalledWith('strat-0001');
    expect(deps.stateMachine.execute).toHaveBeenCalled();
    await app.close();
  });

  it('POST /runs returns 400 when strategyId is missing', async () => {
    const { app } = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: AUTH_HEADER,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /runs/:id returns a run', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs/run-0001',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().runId).toBe('run-0001');
    expect(deps.runService.getById).toHaveBeenCalledWith('run-0001');
    await app.close();
  });

  it('GET /runs/:id returns 404 for non-existent run', async () => {
    const { app } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs/non-existent',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Run not found');
    await app.close();
  });

  it('GET /runs/strategy/:strategyId returns runs for a strategy', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs/strategy/strat-0001',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(deps.runService.getByStrategyId).toHaveBeenCalledWith('strat-0001');
    await app.close();
  });

  it('POST /runs/:id/resume resumes a failed run', async () => {
    // Override the mock for this test to return a FAILED run
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    const failedRun = { ...mockRun, state: 'FAILED' as const };
    deps.runService.getById = vi.fn().mockReturnValue(failedRun);
    deps.stateMachine.resume = vi.fn().mockResolvedValue({ ...mockRun, state: 'CLAIMING' });
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/runs/run-0001/resume',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(deps.stateMachine.resume).toHaveBeenCalledWith(failedRun);
    await app.close();
  });

  it('POST /runs/:id/resume returns 400 for non-FAILED run', async () => {
    const { app } = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs/run-0001/resume',
      headers: AUTH_HEADER,
    });
    // mockRun has state COMPLETE, so resume should reject
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Cannot resume');
    await app.close();
  });

  it('POST /runs/:id/resume returns 404 for non-existent run', async () => {
    const { app } = await createApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs/non-existent/resume',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// ─── Key Routes ─────────────────────────────────────────────────

describe('Key Routes', () => {
  it('GET /keys lists all OpenRouter keys', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/keys',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].hash).toBe('key-hash-001');
    // Verify secret is never exposed
    expect(res.json()[0]).not.toHaveProperty('key');
    expect(res.json()[0]).not.toHaveProperty('openrouter_key');
    expect(deps.openRouterClient.listKeys).toHaveBeenCalledOnce();
    await app.close();
  });

  it('GET /keys/:hash returns a key by hash', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/keys/key-hash-001',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hash).toBe('key-hash-001');
    expect(deps.openRouterClient.getKey).toHaveBeenCalledWith('key-hash-001');
    await app.close();
  });

  it('GET /keys/strategy/:strategyId returns keys for a strategy', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/keys/strategy/strat-0001',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    // CRITICAL: openrouter_key secret must never appear in response
    const keyResponse = res.json()[0];
    expect(keyResponse).not.toHaveProperty('openrouterKey');
    expect(keyResponse).not.toHaveProperty('openrouter_key');
    expect(keyResponse.holderWallet).toBe('WalletA');
    expect(deps.keyManagerService.getKeysByStrategy).toHaveBeenCalledWith('strat-0001');
    await app.close();
  });

  it('DELETE /keys/:hash revokes a key', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/keys/key-hash-001',
      headers: AUTH_HEADER,
      payload: { keyId: 'uk-0001' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revoked).toBe(true);
    expect(deps.keyManagerService.revokeKey).toHaveBeenCalledWith('uk-0001');
    await app.close();
  });

  it('DELETE /keys/:hash returns 404 for non-existent key', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.keyManagerService.revokeKey = vi.fn().mockResolvedValue(false);
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/keys/key-hash-001',
      headers: AUTH_HEADER,
      payload: { keyId: 'non-existent' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('DELETE /keys/:hash returns 400 when keyId is missing from body', async () => {
    const { app } = await createApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/keys/key-hash-001',
      headers: AUTH_HEADER,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// ─── Credit Pool Routes ─────────────────────────────────────────

describe('Credit Pool Routes', () => {
  it('GET /credit-pool returns pool status', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/credit-pool',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.balance).toBe(1000);
    expect(body.allocated).toBe(250);
    expect(body.available).toBe(750);
    expect(body.reserve).toBe(100);
    expect(body.runway).toBe('120 days');
    expect(deps.creditPoolService.getStatus).toHaveBeenCalledOnce();
    await app.close();
  });
});

// ─── Usage Routes ───────────────────────────────────────────────

describe('Usage Routes', () => {
  it('GET /usage/key/:hash returns usage snapshots for a key', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/key/key-hash-001',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].key_hash).toBe('key-hash-001');
    expect(deps.usageTrackingService.getKeyUsage).toHaveBeenCalledWith('key-hash-001', 100);
    await app.close();
  });

  it('GET /usage/key/:hash respects limit query param', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/key/key-hash-001?limit=10',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(deps.usageTrackingService.getKeyUsage).toHaveBeenCalledWith('key-hash-001', 10);
    await app.close();
  });

  it('GET /usage/strategy/:strategyId returns usage snapshots for a strategy', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/strategy/strat-0001',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].strategy_id).toBe('strat-0001');
    expect(deps.usageTrackingService.getStrategyUsage).toHaveBeenCalledWith('strat-0001', 100);
    await app.close();
  });

  it('GET /usage/strategy/:strategyId respects limit query param', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/strategy/strat-0001?limit=5',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(deps.usageTrackingService.getStrategyUsage).toHaveBeenCalledWith('strat-0001', 5);
    await app.close();
  });
});

// ─── Auth enforcement ───────────────────────────────────────────

describe('Auth enforcement on all routes', () => {
  const routes = [
    { method: 'GET' as const, url: '/api/strategies' },
    { method: 'GET' as const, url: '/api/runs/run-0001' },
    { method: 'GET' as const, url: '/api/keys' },
    { method: 'GET' as const, url: '/api/credit-pool' },
    { method: 'GET' as const, url: '/api/usage/key/key-hash-001' },
  ];

  for (const route of routes) {
    it(`${route.method} ${route.url} returns 401 without auth`, async () => {
      const app = Fastify({ logger: false });
      // Register auth hook first (mirrors what buildApp does)
      const { authHookFactory } = await import('../src/plugins/auth.js');
      app.addHook('preHandler', authHookFactory(TEST_TOKEN));
      await registerAllRoutes(app, createAllDeps());
      const res = await app.inject({ method: route.method, url: route.url });
      expect(res.statusCode).toBe(401);
      await app.close();
    });
  }
});

// ─── Boundary conditions ────────────────────────────────────────

describe('Boundary conditions', () => {
  it('GET /strategies returns empty array when no strategies exist', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.strategyService.getAll = vi.fn().mockReturnValue([]);
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'GET',
      url: '/api/strategies',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('GET /runs/strategy/:strategyId returns empty array when no runs exist', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.runService.getByStrategyId = vi.fn().mockReturnValue([]);
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'GET',
      url: '/api/runs/strategy/strat-no-runs',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('GET /keys/strategy/:strategyId returns empty array when no keys exist', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.keyManagerService.getKeysByStrategy = vi.fn().mockReturnValue([]);
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'GET',
      url: '/api/keys/strategy/strat-no-keys',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });
});

// ─── Wallet Key Routes ─────────────────────────────────────────

describe('Wallet Key Routes', () => {
  it('GET /keys/wallet/:wallet returns active key', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/keys/wallet/WalletA',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().keyId).toBe('uk-0001');
    expect(res.json().holderWallet).toBe('WalletA');
    expect(deps.keyManagerService.getActiveKeyByWallet).toHaveBeenCalledWith('WalletA');
    await app.close();
  });

  it('GET /keys/wallet/:wallet returns 404 when no active key', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.keyManagerService.getActiveKeyByWallet = vi.fn().mockReturnValue(null);
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'GET',
      url: '/api/keys/wallet/unknown-wallet',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('No active key found');
    await app.close();
  });

  it('DELETE /keys/wallet/:wallet revokes key without requiring keyId in body', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/keys/wallet/WalletA',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revoked).toBe(true);
    expect(res.json().wallet).toBe('WalletA');
    expect(deps.keyManagerService.getActiveKeyByWallet).toHaveBeenCalledWith('WalletA');
    expect(deps.keyManagerService.revokeKey).toHaveBeenCalledWith('uk-0001');
    await app.close();
  });

  it('DELETE /keys/wallet/:wallet returns 404 when no active key', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.keyManagerService.getActiveKeyByWallet = vi.fn().mockReturnValue(null);
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/keys/wallet/unknown-wallet',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST /keys/wallet/:wallet/rotate creates new key and revokes old', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.openRouterClient.createKey = vi.fn().mockResolvedValue({
      key: 'sk-new-secret',
      data: { ...mockKeyData, hash: 'key-hash-new' },
    });
    deps.keyManagerService.revokeKey = vi.fn().mockResolvedValue(true);
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/keys/wallet/WalletA/rotate',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rotated).toBe(true);
    expect(res.json().newHash).toBe('key-hash-new');
    expect(deps.openRouterClient.createKey).toHaveBeenCalled();
    expect(deps.keyManagerService.revokeKey).toHaveBeenCalledWith('uk-0001');
    await app.close();
  });

  it('POST /keys/wallet/:wallet/rotate returns partial success when revocation fails', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.openRouterClient.createKey = vi.fn().mockResolvedValue({
      key: 'sk-new-secret',
      data: { ...mockKeyData, hash: 'key-hash-new' },
    });
    deps.keyManagerService.revokeKey = vi.fn().mockRejectedValue(new Error('Revocation failed'));
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/keys/wallet/WalletA/rotate',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rotated).toBe(true);
    expect(res.json().newHash).toBe('key-hash-new');
    expect(res.json().warning).toContain('old key revocation failed');
    await app.close();
  });

  it('POST /keys/wallet/:wallet/rotate returns 404 when no active key', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.keyManagerService.getActiveKeyByWallet = vi.fn().mockReturnValue(null);
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/keys/wallet/unknown-wallet/rotate',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST /keys/wallet/:wallet/rotate returns 500 when createKey fails', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.openRouterClient.createKey = vi.fn().mockRejectedValue(new Error('API error'));
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/keys/wallet/WalletA/rotate',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('Failed to create new key');
    await app.close();
  });

  it('GET /keys/wallet/:wallet/usage returns usage for wallet active key', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/keys/wallet/WalletA/usage',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].key_hash).toBe('key-hash-001');
    expect(deps.keyManagerService.getActiveKeyByWallet).toHaveBeenCalledWith('WalletA');
    expect(deps.usageTrackingService.getKeyUsage).toHaveBeenCalledWith('key-hash-001');
    await app.close();
  });

  it('GET /keys/wallet/:wallet/usage returns 404 when no active key', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.keyManagerService.getActiveKeyByWallet = vi.fn().mockReturnValue(null);
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'GET',
      url: '/api/keys/wallet/unknown-wallet/usage',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /keys/wallet with empty string returns 404', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.keyManagerService.getActiveKeyByWallet = vi.fn().mockReturnValue(null);
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'GET',
      url: '/api/keys/wallet/',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// ─── Pool History Route ─────────────────────────────────────────

describe('Pool History Route', () => {
  it('GET /credit-pool/history returns allocation records', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/credit-pool/history',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe('alloc-001');
    expect(res.json()[0].runId).toBe('run-0001');
    expect(res.json()[0].amountUsd).toBe(100);
    expect(deps.creditPoolService.getPoolHistory).toHaveBeenCalledWith(100);
    await app.close();
  });

  it('GET /credit-pool/history respects limit query param', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/credit-pool/history?limit=50',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(deps.creditPoolService.getPoolHistory).toHaveBeenCalledWith(50);
    await app.close();
  });

  it('GET /credit-pool/history caps limit at 1000', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/credit-pool/history?limit=9999',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    expect(deps.creditPoolService.getPoolHistory).toHaveBeenCalledWith(1000);
    await app.close();
  });
});

// ─── Stats Route ────────────────────────────────────────────────

describe('Stats Route', () => {
  it('GET /stats returns aggregate statistics', async () => {
    const { app, deps } = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/stats',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalRuns).toBe(10);
    expect(body.completedRuns).toBe(8);
    expect(body.failedRuns).toBe(2);
    expect(body.totalClaimedSol).toBe(50.5);
    expect(body.totalSwappedUsdc).toBe(500.0);
    expect(body.totalAllocatedUsd).toBe(400.0);
    expect(body.totalKeysProvisioned).toBe(25);
    expect(body.totalKeysUpdated).toBe(5);
    expect(deps.runService.getAggregateStats).toHaveBeenCalledOnce();
    await app.close();
  });

  it('GET /stats returns all zeros when no data exists', async () => {
    const app = Fastify({ logger: false });
    const deps = createAllDeps();
    deps.runService.getAggregateStats = vi.fn().mockReturnValue({
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      totalClaimedSol: 0,
      totalSwappedUsdc: 0,
      totalAllocatedUsd: 0,
      totalKeysProvisioned: 0,
      totalKeysUpdated: 0,
    });
    await registerAllRoutes(app, deps);

    const res = await app.inject({
      method: 'GET',
      url: '/api/stats',
      headers: AUTH_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalRuns).toBe(0);
    expect(body.completedRuns).toBe(0);
    await app.close();
  });
});

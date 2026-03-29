import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { buildApp } from '../src/server.js';
import { authHookFactory } from '../src/plugins/auth.js';
import type { DatabaseConnection } from '../src/services/Database.js';
import type { OpenRouterClient } from '../src/clients/OpenRouterClient.js';

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

// ─── Test fixtures ──────────────────────────────────────────────

const TEST_TOKEN = 'test-bearer-token-12345';

function createMockDb(): DatabaseConnection {
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

function createMockOpenRouterClient(): OpenRouterClient {
  return {
    createKey: vi.fn(),
    listKeys: vi.fn(),
    getKey: vi.fn(),
    updateKey: vi.fn(),
    deleteKey: vi.fn(),
    getAccountCredits: vi.fn().mockResolvedValue({
      total_credits: 100,
      total_usage: 25,
    }),
  } as unknown as OpenRouterClient;
}

function createDeps(overrides?: Partial<DatabaseConnection & OpenRouterClient>) {
  return {
    port: 0, // Use port 0 to let OS assign a free port
    apiAuthToken: TEST_TOKEN,
    db: overrides ? { ...createMockDb(), ...overrides } : createMockDb(),
    openRouterClient: overrides
      ? ({ ...createMockOpenRouterClient(), ...overrides } as unknown as OpenRouterClient)
      : createMockOpenRouterClient(),
    // Mock services required by AllRouteDeps
    strategyService: {
      getAll: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    runService: {
      create: vi.fn().mockReturnValue({ runId: 'test-run', state: 'PENDING', strategyId: 'test' }),
      getById: vi.fn().mockReturnValue(null),
      getByStrategyId: vi.fn().mockReturnValue([]),
      getLatestByStrategy: vi.fn().mockReturnValue(null),
      updateState: vi.fn(),
      markFailed: vi.fn(),
    },
    stateMachine: {
      execute: vi.fn().mockResolvedValue({ runId: 'test-run', state: 'COMPLETE' }),
      resume: vi.fn().mockResolvedValue({ runId: 'test-run', state: 'CLAIMING' }),
    },
    keyManagerService: {
      getKeysByStrategy: vi.fn().mockReturnValue([]),
      getActiveKey: vi.fn().mockReturnValue(null),
      revokeKey: vi.fn().mockResolvedValue(false),
      provisionKeys: vi.fn(),
    },
    creditPoolService: {
      getStatus: vi.fn().mockResolvedValue({ balance: 0, allocated: 0, available: 0, reserve: 0, runway: '0 days' }),
      getPoolState: vi.fn().mockResolvedValue({ totalBalanceUsd: 0, totalAllocatedUsd: 0, availableUsd: 0, reservePct: 0, reservedUsd: 0, lastUpdated: '' }),
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
  };
}

// ─── Auth hook tests ────────────────────────────────────────────

describe('authHookFactory', () => {
  it('rejects requests without Authorization header with 401', async () => {
    const hook = authHookFactory(TEST_TOKEN);
    const app = Fastify();
    app.addHook('preHandler', hook);
    app.get('/test', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized', statusCode: 401 });
    await app.close();
  });

  it('rejects requests with malformed Authorization header', async () => {
    const hook = authHookFactory(TEST_TOKEN);
    const app = Fastify();
    app.addHook('preHandler', hook);
    app.get('/test', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized', statusCode: 401 });
    await app.close();
  });

  it('rejects requests with wrong Bearer token', async () => {
    const hook = authHookFactory(TEST_TOKEN);
    const app = Fastify();
    app.addHook('preHandler', hook);
    app.get('/test', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer wrong-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unauthorized', statusCode: 401 });
    await app.close();
  });

  it('allows requests with correct Bearer token', async () => {
    const hook = authHookFactory(TEST_TOKEN);
    const app = Fastify();
    app.addHook('preHandler', hook);
    app.get('/test', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});

// ─── Health route tests ─────────────────────────────────────────

describe('GET /health', () => {
  it('returns ok status with all dependency checks passing', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('uptime');
    expect(typeof body.uptime).toBe('number');
    expect(body.dependencies).toEqual({ openrouter: true, database: true });
    expect(body).toHaveProperty('responseTimeMs');

    await app.close();
  });

  it('returns degraded status when database is unreachable', async () => {
    const badDb = createMockDb();
    (badDb.prepare as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Database is locked');
    });

    const deps = createDeps({ prepare: badDb.prepare });
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.dependencies.database).toBe(false);
    expect(body.dependencies.openrouter).toBe(true);

    await app.close();
  });

  it('returns degraded status when OpenRouter is unreachable', async () => {
    const badClient = createMockOpenRouterClient();
    vi.mocked(badClient.getAccountCredits).mockRejectedValue(new Error('Network error'));

    const deps = createDeps();
    deps.openRouterClient = badClient;
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.dependencies.database).toBe(true);
    expect(body.dependencies.openrouter).toBe(false);

    await app.close();
  });

  it('returns degraded status when both dependencies are unreachable', async () => {
    const badDb = createMockDb();
    (badDb.prepare as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Database is locked');
    });
    const badClient = createMockOpenRouterClient();
    vi.mocked(badClient.getAccountCredits).mockRejectedValue(new Error('Network error'));

    const deps = createDeps();
    deps.db = badDb;
    deps.openRouterClient = badClient;
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.dependencies.database).toBe(false);
    expect(body.dependencies.openrouter).toBe(false);

    await app.close();
  });
});

// ─── Server lifecycle tests ─────────────────────────────────────

describe('buildApp / startServer', () => {
  it('buildApp returns a configured Fastify instance', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    expect(app).toBeDefined();
    expect(typeof app.close).toBe('function');
    await app.close();
  });

  it('server starts and closes cleanly via app.close()', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    await app.listen({ port: 0, host: '0.0.0.0' });
    const address = app.server.address();
    expect(address).not.toBeNull();

    await app.close();
  });

  it('unauthenticated request to any route returns 401', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    // Try /health without auth
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

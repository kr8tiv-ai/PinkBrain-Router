import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { buildApp } from '../src/server.js';
import { authHookFactory, resetAuthFailureTracker } from '../src/plugins/auth.js';
import type { DatabaseConnection } from '../src/services/Database.js';
import type { OpenRouterClient } from '../src/clients/OpenRouterClient.js';

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    fatal: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      fatal: vi.fn(),
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  })),
}));

// Reset brute-force tracker between tests so 401 tests don't poison later suites
beforeEach(() => {
  resetAuthFailureTracker();
});

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
    port: 0,
    apiAuthToken: TEST_TOKEN,
    logLevel: 'info',
    nodeEnv: 'test',
    db: overrides ? { ...createMockDb(), ...overrides } : createMockDb(),
    openRouterClient: overrides
      ? ({ ...createMockOpenRouterClient(), ...overrides } as unknown as OpenRouterClient)
      : createMockOpenRouterClient(),
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
      getActiveKeyByWallet: vi.fn().mockReturnValue(null),
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
    runLock: {
      acquire: vi.fn().mockReturnValue(true),
      release: vi.fn(),
      isLocked: vi.fn().mockReturnValue(false),
      releaseAll: vi.fn(),
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

  it('rejects wrong token of equal length via timing-safe comparison', async () => {
    // Tokens that differ only by one character but are the same length
    // should still be rejected — this exercises timingSafeEqual over !==
    const hook = authHookFactory('aaaaaaaaaaaaaaa');
    const app = Fastify();
    app.addHook('preHandler', hook);
    app.get('/test', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer aaaaaaaaaaaaaab' }, // same length, different last char
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects wrong token of different length', async () => {
    const hook = authHookFactory('short');
    const app = Fastify();
    app.addHook('preHandler', hook);
    app.get('/test', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer this-is-much-longer' },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects empty bearer token against non-empty expected', async () => {
    const hook = authHookFactory(TEST_TOKEN);
    const app = Fastify();
    app.addHook('preHandler', hook);
    app.get('/test', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer ' },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

// ─── Liveness probe tests ───────────────────────────────────────

describe('GET /health/live', () => {
  it('returns 200 with ok status without authentication', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('uptime');
    expect(typeof body.uptime).toBe('number');

    await app.close();
  });
});

// ─── Readiness probe tests ──────────────────────────────────────

describe('GET /health/ready', () => {
  it('returns 200 with all dependencies healthy', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('uptime');
    expect(body.dependencies.openrouter).toBe(true);
    expect(body.dependencies.database).toBe(true);
    expect(body).toHaveProperty('responseTimeMs');

    await app.close();
  });

  it('returns 503 when database is unreachable', async () => {
    const badDb = createMockDb();
    (badDb.prepare as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Database is locked');
    });

    const deps = createDeps({ prepare: badDb.prepare });
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.dependencies.database).toBe(false);
    expect(body.dependencies.openrouter).toBe(true);

    await app.close();
  });

  it('returns 503 when OpenRouter is unreachable', async () => {
    const badClient = createMockOpenRouterClient();
    vi.mocked(badClient.getAccountCredits).mockRejectedValue(new Error('Network error'));

    const deps = createDeps();
    deps.openRouterClient = badClient;
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.dependencies.database).toBe(true);
    expect(body.dependencies.openrouter).toBe(false);

    await app.close();
  });

  it('returns 503 when both dependencies are unreachable', async () => {
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
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.dependencies.database).toBe(false);
    expect(body.dependencies.openrouter).toBe(false);

    await app.close();
  });

  it('returns 200 without authentication', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
      // No Authorization header
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });
});

// ─── Server lifecycle and auth scoping tests ────────────────────

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

  it('unauthenticated request to /api routes returns 401', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    // /api routes require auth
    const response = await app.inject({
      method: 'GET',
      url: '/api/strategies',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('unauthenticated request to /health routes returns 200', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    // Health routes don't require auth
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });
});

// ─── Error handler tests ────────────────────────────────────────

describe('Error handler', () => {
  it('returns normalized JSON for unhandled routes', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/nonexistent-route',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('statusCode');
    expect(body).toHaveProperty('message');
    // Default is development mode, so message should be included
    expect(typeof body.message).toBe('string');

    await app.close();
  });

  it('hides error details in production mode', async () => {
    const deps = createDeps();
    deps.nodeEnv = 'production';
    const app = await buildApp(deps);

    // Register a route that throws to exercise our custom error handler
    app.get('/test-error', async () => {
      throw new Error('Secret implementation detail');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-error',
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    // In production, message should be generic
    expect(body.message).toBe('Internal server error');
    // Should NOT contain the actual error details
    expect(body).not.toHaveProperty('stack');

    await app.close();
  });

  it('includes error message in development mode', async () => {
    const deps = createDeps();
    deps.nodeEnv = 'development';
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/nonexistent-route',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    // In development, message should be descriptive
    expect(body.message).not.toBe('Internal server error');

    await app.close();
  });
});

// ─── Request logging tests ──────────────────────────────────────

describe('Request logging', () => {
  it('registers onRequest and onResponse hooks that do not break the request pipeline', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
    await app.close();
  });

  it('logs structured access info on every response', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    // Fastify wraps the pino logger, so use spyOn to intercept calls
    const infoSpy = vi.spyOn(app.log, 'info');

    await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    // onResponse hook should have logged a structured access entry
    expect(infoSpy).toHaveBeenCalled();
    const accessLogCall = infoSpy.mock.calls.find(
      (call) =>
        call[0] != null &&
        typeof call[0] === 'object' &&
        'method' in call[0] &&
        'url' in call[0] &&
        'statusCode' in call[0] &&
        'responseTime' in call[0],
    );
    expect(accessLogCall).toBeDefined();
    expect(accessLogCall![0].method).toBe('GET');
    expect(accessLogCall![0].url).toBe('/health/live');
    expect(typeof accessLogCall![0].responseTime).toBe('number');

    infoSpy.mockRestore();
    await app.close();
  });

  it('includes requestId in log entries', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const infoSpy = vi.spyOn(app.log, 'info');

    await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    const accessLogCall = infoSpy.mock.calls.find(
      (call) =>
        call[0] != null &&
        typeof call[0] === 'object' &&
        'requestId' in call[0],
    );
    expect(accessLogCall).toBeDefined();
    expect(typeof accessLogCall![0].requestId).toBe('string');

    infoSpy.mockRestore();
    await app.close();
  });

  it('does not throw when logging an error response', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    // Request a non-existent route — should 404 without throwing from the logging hook
    const response = await app.inject({
      method: 'GET',
      url: '/does-not-exist',
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

// ─── CORS configuration tests ───────────────────────────────────

describe('CORS configuration', () => {
  it('denies all origins by default (corsOrigins not set)', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health/live',
      headers: {
        origin: 'https://evil-site.com',
        'access-control-request-method': 'GET',
      },
    });

    // With origin: false (deny-all default), no CORS header echoed
    expect(response.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });

  it('restricts origins when corsOrigins is configured', async () => {
    const deps = createDeps();
    deps.corsOrigins = 'https://myapp.com,https://admin.myapp.com';
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health/live',
      headers: {
        origin: 'https://myapp.com',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBe('https://myapp.com');

    await app.close();
  });

  it('rejects non-whitelisted origin when corsOrigins is configured', async () => {
    const deps = createDeps();
    deps.corsOrigins = 'https://myapp.com';
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health/live',
      headers: {
        origin: 'https://evil-site.com',
        'access-control-request-method': 'GET',
      },
    });

    // Should NOT echo back the non-whitelisted origin
    expect(response.headers['access-control-allow-origin']).not.toBe('https://evil-site.com');

    await app.close();
  });

  it('handles empty corsOrigins string as deny-all', async () => {
    const deps = createDeps();
    deps.corsOrigins = '';
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health/live',
      headers: {
        origin: 'https://any-origin.com',
        'access-control-request-method': 'GET',
      },
    });

    // Empty string = deny-all (production safe default)
    expect(response.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });
});

// ─── Per-route rate limiting tests ──────────────────────────────

describe('Per-route rate limiting', () => {
  it('health routes bypass rate limiting (max: 0)', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    // Hit liveness probe many times — should never get rate limited
    for (let i = 0; i < 110; i++) {
      const response = await app.inject({
        method: 'GET',
        url: '/health/live',
      });
      expect(response.statusCode).toBe(200);
    }

    await app.close();
  });

  it('readiness probe bypasses rate limiting (max: 0)', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    for (let i = 0; i < 110; i++) {
      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });
      // Could be 200 or 503 depending on mocks, but NOT 429
      expect(response.statusCode).not.toBe(429);
    }

    await app.close();
  });

  it('POST /runs is rate limited to 5 per minute', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    // Make 6 POST /runs requests — the 6th should be rate limited
    let lastStatusCode = 0;
    for (let i = 0; i < 6; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
        payload: { strategyId: 'test-strategy' },
      });
      lastStatusCode = response.statusCode;
    }

    // At least one request should have been rate limited (429)
    // or the lock returned 409 — either way, not all succeed with 200
    // Since lock always acquires, we should see 429 on the 6th
    expect(lastStatusCode).toBe(429);

    await app.close();
  });

  it('GET /api routes fall back to global rate limit (100/min)', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    // GET /api/strategies should work fine under the global 100/min limit
    for (let i = 0; i < 10; i++) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/strategies',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(response.statusCode).toBe(200);
    }

    await app.close();
  });
});

// ─── Error detail leakage tests ─────────────────────────────────

describe('Error detail leakage prevention', () => {
  it('rotate endpoint 500 response has no detail field when createKey fails', async () => {
    const deps = createDeps();
    // Setup: getActiveKeyByWallet returns a key so rotation proceeds
    const mockKey = {
      keyId: 'or-key-123',
      strategyId: 'test-strategy',
      holderWallet: '7xKpPqREhiP1B6d3wTgs8MTwbLj5GhXFsJAiGbrZkQbL',
      openrouterKeyHash: 'abc123',
      spendingLimitUsd: 10,
      currentUsageUsd: 0,
      totalAllocatedUsd: 0,
      lastSyncedAt: null,
      status: 'ACTIVE' as const,
      createdAt: '2025-01-01T00:00:00Z',
    };
    deps.keyManagerService.getActiveKeyByWallet = vi.fn().mockReturnValue(mockKey);
    // createKey throws — previously this leaked error.message as `detail`
    deps.openRouterClient.createKey = vi.fn().mockRejectedValue(new Error('OpenRouter API key quota exceeded'));

    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/keys/wallet/7xKpPqREhiP1B6d3wTgs8MTwbLj5GhXFsJAiGbrZkQbL/rotate',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    // Must NOT contain the `detail` field that previously leaked error.message
    expect(body).not.toHaveProperty('detail');
    // Centralized error handler provides sanitized response
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('statusCode', 500);

    await app.close();
  });
});

// ─── Security headers tests ─────────────────────────────────────

describe('Security headers (@fastify/helmet)', () => {
  it('sets X-Content-Type-Options: nosniff on responses', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('sets X-Frame-Options to deny framing', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    // Helmet defaults to SAMEORIGIN or DENY depending on version
    const frameOptions = response.headers['x-frame-options'];
    expect(frameOptions).toBeDefined();
    expect(['DENY', 'SAMEORIGIN']).toContain(frameOptions);
    await app.close();
  });

  it('sets Strict-Transport-Security header', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    const hsts = response.headers['strict-transport-security'];
    expect(hsts).toBeDefined();
    expect(hsts).toContain('max-age=');
    await app.close();
  });

  it('sets X-DNS-Prefetch-Control header', async () => {
    const deps = createDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    const dnsPrefetch = response.headers['x-dns-prefetch-control'];
    expect(dnsPrefetch).toBeDefined();
    await app.close();
  });
});

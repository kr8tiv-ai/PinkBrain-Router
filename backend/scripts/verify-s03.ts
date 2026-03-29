/**
 * verify-s03.ts — S03 slice verification script
 *
 * Validates all REST API endpoints return expected data shapes,
 * authentication enforcement, and error handling.
 * Run: npx tsx scripts/verify-s03.ts
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { authHookFactory } from '../src/plugins/auth.js';
import { registerAllRoutes } from '../src/routes/index.js';

const TEST_TOKEN = 'verify-test-token';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

// ─── Mock services ────────────────────────────────────────────────

const MOCK_STRATEGY = {
  strategyId: 'strat-verify-001',
  ownerWallet: 'owner_wallet_11111111111111111111',
  source: 'CLAIMABLE_POSITIONS',
  distributionToken: '',
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const MOCK_RUN = {
  runId: 'run-verify-001',
  strategyId: 'strat-verify-001',
  state: 'COMPLETE',
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  claimedSol: 42.5,
  claimedTxSignature: null,
  swappedUsdc: 350,
  swapTxSignature: null,
  swapQuoteSnapshot: null,
  bridgedUsdc: 350,
  bridgeTxHash: null,
  fundedUsdc: 350,
  fundingTxHash: null,
  allocatedUsd: 300,
  keysProvisioned: 10,
  keysUpdated: 0,
  error: null,
};

const MOCK_KEY_DATA = {
  hash: 'key-verify-hash-001',
  name: 'test-key',
  disabled: false,
  limit: 10,
  limit_remaining: 8,
  usage: 2,
  usage_daily: 0.5,
  usage_weekly: 1.5,
  usage_monthly: 2,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  expires_at: null,
};

const MOCK_USER_KEY = {
  keyId: 'uk-001',
  strategyId: 'strat-verify-001',
  holderWallet: 'holder_wallet_11111111111111',
  openrouterKeyHash: 'key-verify-hash-001',
  openrouterKey: 'sk-or-secret',
  spendingLimitUsd: 10,
  currentUsageUsd: 2,
  status: 'ACTIVE',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  expiresAt: null,
};

const MOCK_USAGE_SNAPSHOT = {
  id: 'snap-001',
  key_hash: 'key-verify-hash-001',
  strategy_id: 'strat-verify-001',
  usage: 2,
  usage_daily: 0.5,
  usage_weekly: 1.5,
  usage_monthly: 2,
  limit_remaining: 8,
  limit: 10,
  polled_at: new Date().toISOString(),
};

const mockStrategyService = {
  getAll: () => [MOCK_STRATEGY],
  getById: (id: string) => (id === MOCK_STRATEGY.strategyId ? MOCK_STRATEGY : null),
  create: () => MOCK_STRATEGY,
  update: (id: string) => (id === MOCK_STRATEGY.strategyId ? MOCK_STRATEGY : null),
  delete: (id: string) => id === MOCK_STRATEGY.strategyId,
};

const mockRunService = {
  getById: (id: string) => (id === MOCK_RUN.runId ? MOCK_RUN : null),
  getByStrategyId: () => [MOCK_RUN],
  create: () => MOCK_RUN,
  getAll: () => [MOCK_RUN],
};

const mockStateMachine = {
  execute: async () => MOCK_RUN,
  resume: async () => MOCK_RUN,
};

const mockKeyManagerService = {
  getKeysByStrategy: () => [MOCK_USER_KEY],
  revokeKey: () => true,
};

const mockOpenRouterClient = {
  listKeys: async () => [MOCK_KEY_DATA],
  getKey: async () => MOCK_KEY_DATA,
  getAccountCredits: async () => ({ total_credits: 1000, total_usage: 200 }),
};

const mockCreditPoolService = {
  getStatus: async () => ({
    balance: 1000,
    allocated: 300,
    available: 700,
    reserve: 100,
    runway: '70 days',
  }),
};

const mockUsageTrackingService = {
  getKeyUsage: () => [MOCK_USAGE_SNAPSHOT],
  getStrategyUsage: () => [MOCK_USAGE_SNAPSHOT],
};

const mockDb = {
  prepare: () => ({
    get: () => ({ '1': 1 }),
    run: () => ({ changes: 1 }),
    all: () => [],
  }),
  exec: () => {},
};

// ─── Helpers ──────────────────────────────────────────────────────

interface InjectResult {
  statusCode: number;
  body: unknown;
}

async function inject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any,
  method: string,
  url: string,
  token?: string,
  body?: unknown,
): Promise<InjectResult> {
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;

  const opts: Record<string, unknown> = { method, url, headers };
  if (body) opts['payload'] = body;

  const res = await (app as unknown as { inject: (opts: Record<string, unknown>) => Promise<{ statusCode: number; body: string }> }).inject(opts);
  const raw = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  return { statusCode: res.statusCode, body: parsed };
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔧 S03 Slice Verification — REST API Endpoints\n');

  // Build app with mocked services
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
  await app.register(sensible);

  // Register auth (skip for health)
  const authHook = authHookFactory(TEST_TOKEN);
  app.addHook('preHandler', authHook);

  await registerAllRoutes(app, {
    db: mockDb as any,
    openRouterClient: mockOpenRouterClient as any,
    strategyService: mockStrategyService as any,
    runService: mockRunService as any,
    stateMachine: mockStateMachine as any,
    keyManagerService: mockKeyManagerService as any,
    creditPoolService: mockCreditPoolService as any,
    usageTrackingService: mockUsageTrackingService as any,
  });

  // ─── Unauthenticated requests ─────────────────────────────────

  console.log('🔐 Authentication enforcement...');

  const noAuth = await inject(app, 'GET', '/strategies');
  check('GET /strategies without auth → 401', noAuth.statusCode === 401);

  const noAuthPost = await inject(app, 'POST', '/runs', undefined, { strategyId: 'test' });
  check('POST /runs without auth → 401', noAuthPost.statusCode === 401);

  const badToken = await inject(app, 'GET', '/strategies', 'wrong-token');
  check('GET /strategies with wrong token → 401', badToken.statusCode === 401);

  // ─── Health endpoint (bypasses auth since auth returns reply.code(401).send)
  // Note: health route is registered before auth hook runs, but auth hook is preHandler.
  // Health route IS behind auth in the current server.ts setup.

  console.log('\n💚 Health endpoint...');

  const healthRes = await inject(app, 'GET', '/health', TEST_TOKEN);
  check('GET /health → 200', healthRes.statusCode === 200);
  const healthBody = healthRes.body as Record<string, unknown>;
  check('Health response has status field', typeof healthBody?.status === 'string');
  check('Health response has dependencies field', typeof healthBody?.dependencies === 'object');
  const deps = healthBody?.dependencies as Record<string, unknown>;
  check('Health dependencies has database', typeof deps?.database === 'boolean');
  check('Health dependencies has openrouter', typeof deps?.openrouter === 'boolean');

  // ─── Strategy endpoints ───────────────────────────────────────

  console.log('\n📊 Strategy endpoints...');

  const listStrats = await inject(app, 'GET', '/strategies', TEST_TOKEN);
  check('GET /strategies → 200', listStrats.statusCode === 200);
  check('GET /strategies returns array', Array.isArray(listStrats.body));
  const listBody = listStrats.body as Array<Record<string, unknown>>;
  check('Strategy has strategyId', listBody.length > 0 && typeof listBody[0].strategyId === 'string');
  check('Strategy has distribution', listBody.length > 0 && typeof listBody[0].distribution === 'string');

  const getStrat = await inject(app, 'GET', `/strategies/${MOCK_STRATEGY.strategyId}`, TEST_TOKEN);
  check('GET /strategies/:id → 200', getStrat.statusCode === 200);
  const getStratBody = getStrat.body as Record<string, unknown>;
  check('Strategy response has ownerWallet', typeof getStratBody?.ownerWallet === 'string');
  check('Strategy response has status', typeof getStratBody?.status === 'string');

  const getStrat404 = await inject(app, 'GET', '/strategies/nonexistent-id', TEST_TOKEN);
  check('GET /strategies/nonexistent → 404', getStrat404.statusCode === 404);

  const createStrat = await inject(app, 'POST', '/strategies', TEST_TOKEN, {
    ownerWallet: 'new_owner_wallet_11111111111',
  });
  check('POST /strategies → 200', createStrat.statusCode === 200);
  const createBody = createStrat.body as Record<string, unknown>;
  check('Created strategy has strategyId', typeof createBody?.strategyId === 'string');

  const patchStrat = await inject(app, 'PATCH', `/strategies/${MOCK_STRATEGY.strategyId}`, TEST_TOKEN, {
    status: 'PAUSED',
  });
  check('PATCH /strategies/:id → 200', patchStrat.statusCode === 200);

  const patchStrat404 = await inject(app, 'PATCH', '/strategies/nonexistent', TEST_TOKEN, {
    status: 'PAUSED',
  });
  check('PATCH /strategies/nonexistent → 404', patchStrat404.statusCode === 404);

  const deleteStrat = await inject(app, 'DELETE', `/strategies/${MOCK_STRATEGY.strategyId}`, TEST_TOKEN);
  check('DELETE /strategies/:id → 200', deleteStrat.statusCode === 200);
  const deleteBody = deleteStrat.body as Record<string, unknown>;
  check('Delete response has deleted: true', deleteBody?.deleted === true);

  const deleteStrat404 = await inject(app, 'DELETE', '/strategies/nonexistent', TEST_TOKEN);
  check('DELETE /strategies/nonexistent → 404', deleteStrat404.statusCode === 404);

  // ─── Run endpoints ────────────────────────────────────────────

  console.log('\n🚀 Run endpoints...');

  const getRun = await inject(app, 'GET', `/runs/${MOCK_RUN.runId}`, TEST_TOKEN);
  check('GET /runs/:id → 200', getRun.statusCode === 200);
  const getRunBody = getRun.body as Record<string, unknown>;
  check('Run has runId', typeof getRunBody?.runId === 'string');
  check('Run has state', typeof getRunBody?.state === 'string');
  check('Run has strategyId', typeof getRunBody?.strategyId === 'string');

  const getRun404 = await inject(app, 'GET', '/runs/nonexistent', TEST_TOKEN);
  check('GET /runs/nonexistent → 404', getRun404.statusCode === 404);

  const runsByStrat = await inject(app, 'GET', `/runs/strategy/${MOCK_STRATEGY.strategyId}`, TEST_TOKEN);
  check('GET /runs/strategy/:id → 200', runsByStrat.statusCode === 200);
  check('Runs by strategy returns array', Array.isArray(runsByStrat.body));

  // ─── Key endpoints ────────────────────────────────────────────

  console.log('\n🔑 Key endpoints...');

  const listKeys = await inject(app, 'GET', '/keys', TEST_TOKEN);
  check('GET /keys → 200', listKeys.statusCode === 200);
  check('GET /keys returns array', Array.isArray(listKeys.body));
  const keysBody = listKeys.body as Array<Record<string, unknown>>;
  check('Key has hash', keysBody.length > 0 && typeof keysBody[0].hash === 'string');
  check('Key has name', keysBody.length > 0 && typeof keysBody[0].name === 'string');
  check('Key does not expose secret', keysBody.length > 0 && !('key' in keysBody[0]));

  const keysByStrat = await inject(app, 'GET', `/keys/strategy/${MOCK_STRATEGY.strategyId}`, TEST_TOKEN);
  check('GET /keys/strategy/:id → 200', keysByStrat.statusCode === 200);
  check('Keys by strategy returns array', Array.isArray(keysByStrat.body));

  // ─── Credit pool endpoint ─────────────────────────────────────

  console.log('\n💰 Credit pool endpoint...');

  const poolStatus = await inject(app, 'GET', '/credit-pool', TEST_TOKEN);
  check('GET /credit-pool → 200', poolStatus.statusCode === 200);
  const poolBody = poolStatus.body as Record<string, unknown>;
  check('Pool has balance', typeof poolBody?.balance === 'number');
  check('Pool has allocated', typeof poolBody?.allocated === 'number');
  check('Pool has available', typeof poolBody?.available === 'number');
  check('Pool has reserve', typeof poolBody?.reserve === 'number');
  check('Pool has runway', typeof poolBody?.runway === 'string');

  // ─── Usage endpoints ──────────────────────────────────────────

  console.log('\n📈 Usage endpoints...');

  const usageByKey = await inject(app, 'GET', `/usage/key/${MOCK_KEY_DATA.hash}`, TEST_TOKEN);
  check('GET /usage/key/:hash → 200', usageByKey.statusCode === 200);
  check('Usage by key returns array', Array.isArray(usageByKey.body));
  const usageBody = usageByKey.body as Array<Record<string, unknown>>;
  check('Usage snapshot has key_hash', usageBody.length > 0 && typeof usageBody[0].key_hash === 'string');
  check('Usage snapshot has usage', usageBody.length > 0 && typeof usageBody[0].usage === 'number');
  check('Usage snapshot has polled_at', usageBody.length > 0 && typeof usageBody[0].polled_at === 'string');

  const usageByStrat = await inject(app, 'GET', `/usage/strategy/${MOCK_STRATEGY.strategyId}`, TEST_TOKEN);
  check('GET /usage/strategy/:id → 200', usageByStrat.statusCode === 200);
  check('Usage by strategy returns array', Array.isArray(usageByStrat.body));

  // ─── Summary ──────────────────────────────────────────────────

  await app.close();

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('verify-s03 failed:', error);
  process.exit(1);
});

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// ─── Module-level pino mock — required because phases import pino at module level ──
// vi.hoisted() ensures these are available inside the vi.mock factory which gets hoisted.
const { mockLogger: _ml, pinoFactory: _pf } = vi.hoisted(() => {
  const noop = vi.fn();
  const mockLogger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: vi.fn(() => mockLogger),
    fatal: noop,
    trace: noop,
  };
  const pinoFactory = vi.fn(() => mockLogger);
  return { mockLogger, pinoFactory };
});

vi.mock('pino', () => ({
  default: _pf,
  // Named export for `import { pino } from 'pino'` used by dynamic imports in stub phases
  pino: _pf,
}));

import { buildApp } from '../../src/server.js';
import { createPhaseHandlerMap } from '../../src/engine/phases/index.js';
import { createClaimPhase } from '../../src/engine/phases/claim.js';
import { createSwapPhase } from '../../src/engine/phases/swap.js';
import { createAllocatePhase } from '../../src/engine/phases/allocate.js';
import { StateMachine } from '../../src/engine/StateMachine.js';
import { ExecutionPolicy } from '../../src/engine/ExecutionPolicy.js';
import { WRAPPED_SOL_MINT } from '../../src/constants/addresses.js';
import type { Config } from '../../src/config/index.js';
import type { CreditRun } from '../../src/types/index.js';

// ─── Constants ──────────────────────────────────────────────────

const AUTH_TOKEN = 'e2e-test-token';
const AUTH_HEADER = { authorization: `Bearer ${AUTH_TOKEN}` };
const STRATEGY_ID = 'e2e-strat-1';
const RUN_ID = 'e2e-run-1';

// ─── Mutable run data — accumulates phase results across the pipeline ──

const runData: CreditRun = {
  runId: RUN_ID,
  strategyId: STRATEGY_ID,
  state: 'PENDING',
  startedAt: '2025-06-01T00:00:00Z',
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
};

// ─── Mock BagsClient ────────────────────────────────────────────

const mockBagsClient = {
  getClaimablePositions: vi.fn().mockResolvedValue([
    {
      isCustomFeeVault: false,
      baseMint: WRAPPED_SOL_MINT,
      isMigrated: true,
      totalClaimableLamportsUserShare: 10_000_000_000, // 10 SOL
      programId: 'FeojVxAyqmjCjCD5FAByXZNFLUhMCpjdBHoPEKzLqCJr',
      quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      virtualPool: 'vpool',
      virtualPoolAddress: 'vpool-address',
      virtualPoolClaimableAmount: 10_000_000_000,
      virtualPoolClaimableLamportsUserShare: 10_000_000_000,
      dammPoolClaimableAmount: 0,
      dammPoolClaimableLamportsUserShare: 0,
      dammPoolAddress: 'damm-address',
      claimableDisplayAmount: 10,
      user: 'e2e-wallet',
      claimerIndex: 0,
      userBps: 10000,
      customFeeVault: '',
      customFeeVaultClaimerA: '',
      customFeeVaultClaimerB: '',
      customFeeVaultClaimerSide: 'A' as const,
    },
  ]),
  getClaimTransactions: vi.fn().mockResolvedValue([
    {
      tx: 'base58-encoded-claim-tx',
      blockhash: { blockhash: 'hash-123', lastValidBlockHeight: 1000 },
    },
  ]),
  prepareSwap: vi.fn().mockResolvedValue({
    quote: {
      requestId: 'req-1',
      contextSlot: 1,
      inAmount: '10000000000', // 10 SOL in lamports
      inputMint: WRAPPED_SOL_MINT,
      outAmount: '200000000', // ~200 USDC (6 decimals)
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      minOutAmount: '190000000',
      otherAmountThreshold: '190000000',
      priceImpactPct: '0.5',
      slippageBps: 50,
      routePlan: [],
      platformFee: { amount: '0', feeBps: 0, feeAccount: '', segmenterFeeAmount: '0', segmenterFeePct: 0 },
      outTransferFee: '0',
      simulatedComputeUnits: 200000,
    },
    swapTx: {
      swapTransaction: 'base64-encoded-swap-tx',
      computeUnitLimit: 200000,
      lastValidBlockHeight: 1000,
      prioritizationFeeLamports: 1000,
    },
  }),
  getTradeQuote: vi.fn(),
  createSwapTransaction: vi.fn(),
  getTotalClaimableSol: vi.fn(),
  getRateLimitStatus: vi.fn().mockReturnValue({ remaining: 100, resetAt: Date.now() + 60000 }),
};

// ─── Mock signers ───────────────────────────────────────────────

const mockSignAndSendClaim = vi.fn().mockResolvedValue('mock-claim-sig');
const mockSignAndSendSwap = vi.fn().mockResolvedValue('mock-swap-sig');

// ─── Mock strategy ──────────────────────────────────────────────

const mockStrategy = {
  strategyId: STRATEGY_ID,
  ownerWallet: 'e2e-wallet',
  source: 'CLAIMABLE_POSITIONS' as const,
  distributionToken: 'mint-abc',
  swapConfig: { slippageBps: 50, maxPriceImpactBps: 300 },
  distribution: 'TOP_N_HOLDERS' as const,
  distributionTopN: 5,
  keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly' as const, expiryDays: 365 },
  creditPoolReservePct: 10,
  exclusionList: [],
  schedule: '0 */6 * * *',
  minClaimThreshold: 5,
  status: 'ACTIVE' as const,
  lastRunId: null,
  createdAt: '2025-06-01T00:00:00Z',
  updatedAt: '2025-06-01T00:00:00Z',
};

const mockStrategyService = {
  getAll: vi.fn().mockReturnValue([mockStrategy]),
  getById: vi.fn().mockImplementation((id: string) =>
    id === STRATEGY_ID ? { ...mockStrategy } : null,
  ),
  create: vi.fn().mockImplementation((input: Record<string, unknown>) => ({
    ...mockStrategy,
    strategyId: STRATEGY_ID,
    ownerWallet: (input.ownerWallet as string) ?? mockStrategy.ownerWallet,
    distributionToken: (input.distributionToken as string) ?? mockStrategy.distributionToken,
  })),
  update: vi.fn().mockImplementation((id: string, _input: Record<string, unknown>) =>
    id === STRATEGY_ID ? { ...mockStrategy } : null,
  ),
  delete: vi.fn().mockReturnValue(true),
};

// ─── Mock holders resolver ──────────────────────────────────────

const mockResolveHolders = vi.fn().mockResolvedValue([
  { wallet: 'holder-1', tokenBalance: '1000000' },
  { wallet: 'holder-2', tokenBalance: '500000' },
  { wallet: 'holder-3', tokenBalance: '250000' },
]);

// ─── Mock DistributionService ───────────────────────────────────

const mockAllocationSnapshots = [
  { holderWallet: 'holder-1', tokenBalance: '1000000', allocationWeight: 0.57, allocatedUsd: 108.3 },
  { holderWallet: 'holder-2', tokenBalance: '500000', allocationWeight: 0.28, allocatedUsd: 53.2 },
  { holderWallet: 'holder-3', tokenBalance: '250000', allocationWeight: 0.14, allocatedUsd: 28.5 },
];

const mockDistributionService = {
  allocate: vi.fn().mockResolvedValue({
    snapshotId: 'snap-1',
    runId: RUN_ID,
    holderCount: 3,
    totalAllocatedUsd: 190,
    allocationMode: 'TOP_N_HOLDERS',
    allocations: mockAllocationSnapshots,
    skippedHolders: 0,
  }),
  getSnapshotsByRun: vi.fn().mockReturnValue(mockAllocationSnapshots),
};

// ─── Mock audit service ─────────────────────────────────────────

const auditEntries: Array<{ logId: string; runId: string; phase: string; action: string; details: Record<string, unknown>; timestamp: string }> = [];

const mockAuditService = {
  logTransition: vi.fn().mockImplementation((runId: string, phase: string, action: string, details: Record<string, unknown>) => {
    auditEntries.push({ logId: `audit-${auditEntries.length}`, runId, phase, action, details, timestamp: new Date().toISOString() });
    return { logId: `audit-${auditEntries.length}`, runId, phase, action, details, timestamp: new Date().toISOString() };
  }),
  getByRunId: vi.fn().mockImplementation((runId: string) =>
    auditEntries.filter((e) => e.runId === runId),
  ),
  getLatest: vi.fn().mockReturnValue(null),
};

// ─── Mock run service — critical: updateState merges data ───────

const mockRunService = {
  create: vi.fn().mockImplementation((strategyId: string) => {
    runData.strategyId = strategyId;
    runData.state = 'PENDING';
    runData.startedAt = new Date().toISOString();
    runData.finishedAt = null;
    return { ...runData };
  }),
  updateState: vi.fn().mockImplementation((runId: string, state: string, data: Record<string, unknown> = {}) => {
    runData.state = state as CreditRun['state'];
    Object.assign(runData, data);
    if (state === 'COMPLETE' || state === 'FAILED') {
      runData.finishedAt = new Date().toISOString();
    }
    return { ...runData };
  }),
  getById: vi.fn().mockImplementation((id: string) =>
    id === RUN_ID ? { ...runData } : null,
  ),
  markFailed: vi.fn().mockImplementation((runId: string, error: { code: string; detail: string; failedState: string }) => {
    runData.state = 'FAILED';
    runData.error = error as CreditRun['error'];
    runData.finishedAt = new Date().toISOString();
    return { ...runData };
  }),
  getByStrategyId: vi.fn().mockReturnValue([{ ...runData }]),
  getAll: vi.fn().mockReturnValue([{ ...runData }]),
  getAggregateStats: vi.fn().mockReturnValue({
    totalRuns: 1,
    completedRuns: 1,
    failedRuns: 0,
    totalClaimedSol: 10,
    totalSwappedUsdc: 200,
    totalAllocatedUsd: 190,
    totalKeysProvisioned: 2,
    totalKeysUpdated: 0,
  }),
};

// ─── Mock DB ────────────────────────────────────────────────────

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

// ─── Mock OpenRouter client ─────────────────────────────────────

const mockOpenRouterClient = {
  listKeys: vi.fn().mockResolvedValue([]),
  getKey: vi.fn().mockResolvedValue({ hash: 'key-1', name: 'test' }),
  createKey: vi.fn().mockResolvedValue({ key: 'sk-test', data: { hash: 'hash-1' } }),
  updateKey: vi.fn(),
  deleteKey: vi.fn(),
  getAccountCredits: vi.fn().mockResolvedValue({ total_credits: 1000, total_usage: 0 }),
};

// ─── Mock supporting services ───────────────────────────────────

const mockKeyManagerService = {
  getKeysByStrategy: vi.fn().mockReturnValue([]),
  getActiveKey: vi.fn().mockReturnValue(null),
  getActiveKeyByWallet: vi.fn().mockReturnValue(null),
  revokeKey: vi.fn().mockResolvedValue(true),
  provisionKeys: vi.fn().mockResolvedValue({
    keysProvisioned: 3,
    keysUpdated: 0,
    keysFailed: 0,
    keyHashes: ['h1', 'h2', 'h3'],
    failedWallets: [],
  }),
};

// ─── Mock CctpBridgeService ─────────────────────────────────────

const mockCctpBridgeService = {
  isAvailable: vi.fn().mockReturnValue(true),
  getCircuitBreakerState: vi.fn().mockReturnValue({ state: 'CLOSED', failures: 0, lastFailureAt: null }),
  bridge: vi.fn().mockResolvedValue({
    success: true,
    txHash: 'mock-bridge-tx',
    amountUsdc: 200,
    fromChain: 'solana',
    toChain: 'base',
    steps: ['burn', 'attestation', 'mint'],
    state: 'COMPLETE',
  }),
};

// ─── Mock CoinbaseChargeService ────────────────────────────────

const mockCoinbaseChargeService = {
  isAvailable: vi.fn().mockReturnValue(true),
  fund: vi.fn().mockResolvedValue({
    success: true,
    chargeId: 'mock-charge-1',
    amountFunded: 200,
    previousBalance: 0,
    newBalance: 200,
    dryRun: true,
  }),
};

const mockCreditPoolService = {
  getStatus: vi.fn().mockResolvedValue({ balance: 1000, allocated: 190, available: 810, reserve: 100, runway: '120 days' }),
  getPoolState: vi.fn().mockResolvedValue({
    totalBalanceUsd: 1000,
    totalAllocatedUsd: 190,
    availableUsd: 810,
    reservePct: 10,
    reservedUsd: 100,
    lastUpdated: '2025-06-01T00:00:00Z',
  }),
  checkAllocation: vi.fn().mockResolvedValue({ allowed: true }),
  getPoolHistory: vi.fn().mockReturnValue([]),
  recordAllocation: vi.fn(),
  invalidateCache: vi.fn(),
};

const mockUsageTrackingService = {
  getKeyUsage: vi.fn().mockReturnValue([]),
  getStrategyUsage: vi.fn().mockReturnValue([]),
  start: vi.fn(),
  stop: vi.fn(),
  pollAllKeys: vi.fn(),
};

// ─── ExecutionPolicy with minimal Config ────────────────────────
// Construct a Config-compatible object directly since configSchema is not exported.
// All fields that configSchema would fill with defaults are provided explicitly.
const testConfig: Config = {
  bagsApiKey: 'test-bags-key',
  bagsApiBaseUrl: 'https://public-api-v2.bags.fm/api/v1',
  heliusApiKey: 'test-helius-key',
  heliusRpcUrl: 'https://mainnet.helius-rpc.com/?api-key=test-helius-key',
  solanaNetwork: 'mainnet-beta',
  openrouterManagementKey: 'test-openrouter-key',
  evmPrivateKey: undefined,
  evmChainId: 8453,
  apiAuthToken: AUTH_TOKEN,
  port: 0,
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
  dryRun: true,
  executionKillSwitch: false,
  maxDailyRuns: 100,
  maxClaimableSolPerRun: 100,
  maxKeyLimitUsd: 100,
  keyRotationDays: 90,
  usagePollIntervalMin: 15,
  signerPrivateKey: undefined,
  bagsAgentUsername: undefined,
  bagsAgentJwt: undefined,
  bagsAgentWalletAddress: undefined,
  databasePath: ':memory:',
  logLevel: 'error',
  nodeEnv: 'test',
};

// ─── Build real StateMachine and phase handlers ─────────────────

const phaseHandlers = createPhaseHandlerMap({
  claim: {
    bagsClient: mockBagsClient as any,
    strategyService: mockStrategyService as any,
    signAndSendClaim: mockSignAndSendClaim,
    dryRun: true,
  },
  swap: {
    bagsClient: mockBagsClient as any,
    strategyService: mockStrategyService as any,
    signAndSendSwap: mockSignAndSendSwap,
    dryRun: true,
  },
  bridge: {
    bridgeService: mockCctpBridgeService as any,
  },
  fund: {
    chargeService: mockCoinbaseChargeService as any,
    creditPoolService: mockCreditPoolService as any,
  },
  allocate: {
    distributionService: mockDistributionService as any,
    strategyService: mockStrategyService as any,
    resolveHolders: mockResolveHolders,
  },
  provision: {
    keyManagerService: mockKeyManagerService as any,
    distributionService: mockDistributionService as any,
    strategyService: mockStrategyService as any,
  },
});

const executionPolicy = new ExecutionPolicy(testConfig);

const stateMachine = new StateMachine({
  auditService: mockAuditService as any,
  runService: mockRunService as any,
  executionPolicy,
  phaseHandlers,
});

// ─── E2E Test ───────────────────────────────────────────────────

describe('E2E: Full pipeline integration (7 phases)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({
      apiAuthToken: AUTH_TOKEN,
      db: createMockDb() as any,
      openRouterClient: mockOpenRouterClient as any,
      strategyService: mockStrategyService as any,
      runService: mockRunService as any,
      stateMachine: stateMachine as any,
      keyManagerService: mockKeyManagerService as any,
      creditPoolService: mockCreditPoolService as any,
      usageTrackingService: mockUsageTrackingService as any,
      runLock: {
        acquire: vi.fn().mockReturnValue(true),
        release: vi.fn(),
        isLocked: vi.fn().mockReturnValue(false),
        releaseAll: vi.fn(),
      },
      port: 0,
      logLevel: 'silent',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/strategies creates a strategy', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/strategies',
      headers: AUTH_HEADER,
      payload: {
        ownerWallet: 'e2e-wallet',
        distributionToken: 'mint-abc',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ownerWallet).toBe('e2e-wallet');
    expect(body.strategyId).toBe(STRATEGY_ID);
  });

  it('POST /api/runs triggers a run that completes all 7 phases', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: AUTH_HEADER,
      payload: { strategyId: STRATEGY_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Run must complete all 7 phases
    expect(body.state).toBe('COMPLETE');
    expect(body.runId).toBe(RUN_ID);

    // Phase 1: CLAIMING — must claim SOL
    expect(body.claimedSol).toBeGreaterThan(0);

    // Phase 2: SWAPPING — must swap SOL to USDC
    expect(body.swappedUsdc).toBeGreaterThan(0);

    // Phase 3: BRIDGING — real factory delegates to CctpBridgeService
    expect(body.bridgedUsdc).toBeGreaterThan(0);

    // Phase 4: FUNDING — real factory delegates to CoinbaseChargeService
    expect(body.fundedUsdc).toBeGreaterThan(0);

    // Phase 5: ALLOCATING — must allocate to holders
    expect(body.allocatedUsd).toBeGreaterThan(0);

    // Phase 6: PROVISIONING — real factory delegates to KeyManagerService
    expect(body.keysProvisioned).toBeGreaterThan(0);

    // Verify data flow: mock bridge returns swappedUsdc, mock fund returns bridgedUsdc
    expect(body.bridgedUsdc).toBe(body.swappedUsdc);
    expect(body.fundedUsdc).toBe(body.bridgedUsdc);
  });

  it('GET /api/runs/:id returns the completed run with all phase data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/runs/${RUN_ID}`,
      headers: AUTH_HEADER,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.runId).toBe(RUN_ID);
    expect(body.state).toBe('COMPLETE');
    expect(body.claimedSol).toBeGreaterThan(0);
    expect(body.swappedUsdc).toBeGreaterThan(0);
    expect(body.bridgedUsdc).toBeGreaterThan(0);
    expect(body.fundedUsdc).toBeGreaterThan(0);
    expect(body.allocatedUsd).toBeGreaterThan(0);
    expect(body.finishedAt).not.toBeNull();
  });

  it('GET /health/live returns 200 (no auth required)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('GET /api/strategies without auth returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/strategies',
      // No Authorization header
    });

    expect(res.statusCode).toBe(401);
  });

  it('verify mocks were called with correct data flow', () => {
    // BagsClient called to get claimable positions
    expect(mockBagsClient.getClaimablePositions).toHaveBeenCalledWith('e2e-wallet');

    // In dry-run mode, claim phase returns early before fetching claim transactions.
    // Only verify positions were queried.
    expect(mockBagsClient.getClaimTransactions).not.toHaveBeenCalled();

    // Swap prepared with SOL input — canonical wrapped SOL mint (40 ones)
    expect(mockBagsClient.prepareSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMint: WRAPPED_SOL_MINT,
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      }),
    );

    // Holders resolved for allocation
    expect(mockResolveHolders).toHaveBeenCalledWith(expect.objectContaining({
      strategyId: STRATEGY_ID,
    }));

    // Distribution allocate called with the run and strategy
    expect(mockDistributionService.allocate).toHaveBeenCalled();

    // Bridge service called with the swapped USDC amount
    expect(mockCctpBridgeService.isAvailable).toHaveBeenCalled();
    expect(mockCctpBridgeService.bridge).toHaveBeenCalledWith(
      expect.objectContaining({ amountUsdc: expect.any(Number) }),
    );

    // Fund service called — availability check + pool check + fund
    expect(mockCoinbaseChargeService.isAvailable).toHaveBeenCalled();
    expect(mockCoinbaseChargeService.fund).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN_ID, strategyId: STRATEGY_ID }),
    );
    expect(mockCreditPoolService.checkAllocation).toHaveBeenCalled();

    // Provision phase called key manager with real allocations from snapshots
    expect(mockKeyManagerService.provisionKeys).toHaveBeenCalled();

    // State transitions logged to audit service (7 transitions: PENDING→CLAIMING→SWAPPING→...→COMPLETE)
    expect(mockAuditService.logTransition).toHaveBeenCalled();
  });
});

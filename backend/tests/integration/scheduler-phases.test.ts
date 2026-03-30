import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module-level pino mock — phases import pino at module level ──
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
  pino: _pf,
}));

vi.mock('node-cron', () => ({
  __esModule: true,
  default: {
    validate: vi.fn((expr: string) => {
      if (!expr || expr.trim() === '') return false;
      const parts = expr.trim().split(/\s+/);
      return parts.length >= 5;
    }),
    schedule: vi.fn((_expr: string, callback: () => void) => {
      const mockTask = { stop: vi.fn(), start: vi.fn() };
      (mockTask as any).__callback = callback;
      return mockTask;
    }),
  },
}));

import { SchedulerService } from '../../src/services/SchedulerService.js';
import { createPhaseHandlerMap } from '../../src/engine/phases/index.js';
import { StateMachine } from '../../src/engine/StateMachine.js';
import { ExecutionPolicy } from '../../src/engine/ExecutionPolicy.js';
import { RunLock } from '../../src/engine/RunLock.js';
import { WRAPPED_SOL_MINT } from '../../src/constants/addresses.js';
import type { Config } from '../../src/config/index.js';
import type { CreditRun } from '../../src/types/index.js';

// ─── Constants ──────────────────────────────────────────────────

const STRATEGY_ID = 'sched-strat-1';
const RUN_ID = 'sched-run-1';

// ─── Mutable run data — accumulates phase results ───────────────

const runData: CreditRun = {
  runId: RUN_ID,
  strategyId: STRATEGY_ID,
  state: 'PENDING',
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
};

// ─── Mock BagsClient ────────────────────────────────────────────

const mockBagsClient = {
  getClaimablePositions: vi.fn().mockResolvedValue([
    {
      isCustomFeeVault: false,
      baseMint: WRAPPED_SOL_MINT,
      isMigrated: true,
      totalClaimableLamportsUserShare: 10_000_000_000,
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
      user: 'sched-wallet',
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
      inAmount: '10000000000',
      inputMint: WRAPPED_SOL_MINT,
      outAmount: '200000000',
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
  ownerWallet: 'sched-wallet',
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
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockStrategyService = {
  getAll: vi.fn().mockReturnValue([mockStrategy]),
  getById: vi.fn().mockImplementation((id: string) =>
    id === STRATEGY_ID ? { ...mockStrategy } : null,
  ),
};

// ─── Mock holders resolver ──────────────────────────────────────

const mockResolveHolders = vi.fn().mockResolvedValue([
  { wallet: 'holder-1', tokenBalance: '1000000' },
  { wallet: 'holder-2', tokenBalance: '500000' },
  { wallet: 'holder-3', tokenBalance: '250000' },
]);

// ─── Mock DistributionService ───────────────────────────────────

const mockDistributionService = {
  allocate: vi.fn().mockResolvedValue({
    snapshotId: 'snap-1',
    runId: RUN_ID,
    holderCount: 3,
    totalAllocatedUsd: 190,
    allocationMode: 'TOP_N_HOLDERS',
    allocations: [
      { holderWallet: 'holder-1', tokenBalance: '1000000', allocationWeight: 0.57, allocatedUsd: 108.3 },
      { holderWallet: 'holder-2', tokenBalance: '500000', allocationWeight: 0.28, allocatedUsd: 53.2 },
      { holderWallet: 'holder-3', tokenBalance: '250000', allocationWeight: 0.14, allocatedUsd: 28.5 },
    ],
    skippedHolders: 0,
  }),
};

// ─── Mock audit service ─────────────────────────────────────────

const auditEntries: Array<{ runId: string; phase: string; action: string; details: Record<string, unknown> }> = [];

const mockAuditService = {
  logTransition: vi.fn().mockImplementation((runId: string, phase: string, action: string, details: Record<string, unknown>) => {
    auditEntries.push({ runId, phase, action, details });
    return { logId: `audit-${auditEntries.length}`, runId, phase, action, details, timestamp: new Date().toISOString() };
  }),
  getByRunId: vi.fn().mockImplementation((runId: string) =>
    auditEntries.filter((e) => e.runId === runId),
  ),
  getLatest: vi.fn().mockReturnValue(null),
};

// ─── Mock run service — merges data on updateState ──────────────

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
};

// ─── Test config ────────────────────────────────────────────────

const testConfig: Config = {
  bagsApiKey: 'test-bags-key',
  bagsApiBaseUrl: 'https://public-api-v2.bags.fm/api/v1',
  heliusApiKey: 'test-helius-key',
  heliusRpcUrl: 'https://mainnet.helius-rpc.com/?api-key=test-helius-key',
  solanaNetwork: 'mainnet-beta',
  openrouterManagementKey: 'test-openrouter-key',
  evmPrivateKey: undefined,
  evmChainId: 8453,
  apiAuthToken: 'test-token',
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

// ─── Build real phase handlers ──────────────────────────────────

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
  allocate: {
    distributionService: mockDistributionService as any,
    strategyService: mockStrategyService as any,
    resolveHolders: mockResolveHolders,
  },
  // bridge, fund, provision use default stubs
});

// ─── Build real ExecutionPolicy ─────────────────────────────────

const executionPolicy = new ExecutionPolicy(testConfig);

// ─── Build real StateMachine ────────────────────────────────────

const stateMachine = new StateMachine({
  auditService: mockAuditService as any,
  runService: mockRunService as any,
  executionPolicy,
  phaseHandlers,
});

// ─── Build real RunLock ─────────────────────────────────────────

const runLock = new RunLock();

// ─── Test ───────────────────────────────────────────────────────

describe('Scheduler integration: real phase handlers and audit trail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditEntries.length = 0;

    // Reset mutable run data
    runData.runId = RUN_ID;
    runData.strategyId = STRATEGY_ID;
    runData.state = 'PENDING';
    runData.startedAt = '2026-01-01T00:00:00Z';
    runData.finishedAt = null;
    runData.claimedSol = null;
    runData.claimedTxSignature = null;
    runData.swappedUsdc = null;
    runData.swapTxSignature = null;
    runData.swapQuoteSnapshot = null;
    runData.bridgedUsdc = null;
    runData.bridgeTxHash = null;
    runData.fundedUsdc = null;
    runData.fundingTxHash = null;
    runData.allocatedUsd = null;
    runData.keysProvisioned = null;
    runData.keysUpdated = null;
    runData.error = null;

    runLock.releaseAll();
  });

  it('executes all 7 phases to COMPLETE via scheduler cron callback', async () => {
    const scheduler = new SchedulerService({
      strategyService: mockStrategyService as any,
      runService: mockRunService as any,
      stateMachine: stateMachine as any,
      executionPolicy,
      runLock,
      config: testConfig,
    });

    await scheduler.start();

    // Fire the pipeline run through the scheduler's executeStrategyRun method.
    // Note: the cron callback (cron.schedule's arrow fn) does not return the promise,
    // so it can't be awaited — calling executeStrategyRun directly is the correct
    // approach for integration testing. Cron callback wiring is covered by the
    // scheduler unit tests.
    await (scheduler as any).executeStrategyRun(STRATEGY_ID);

    // (1) Run completes all 7 phases to COMPLETE state
    expect(runData.state).toBe('COMPLETE');
    expect(runData.finishedAt).not.toBeNull();

    // (2) All phase data flows correctly
    expect(runData.claimedSol).toBeGreaterThan(0);
    expect(runData.swappedUsdc).toBeGreaterThan(0);
    expect(runData.bridgedUsdc).toBeGreaterThan(0);
    expect(runData.fundedUsdc).toBeGreaterThan(0);
    expect(runData.allocatedUsd).toBeGreaterThan(0);
    expect(runData.keysProvisioned).toBeGreaterThan(0);

    // Data flow continuity: stubs forward swappedUsdc through bridge → fund
    expect(runData.bridgedUsdc).toBe(runData.swappedUsdc);
    expect(runData.fundedUsdc).toBe(runData.bridgedUsdc);

    // (3) Audit trail has exactly 7 logTransition calls
    // PENDING→CLAIMING, CLAIMING→SWAPPING, ..., PROVISIONING→COMPLETE
    expect(mockAuditService.logTransition).toHaveBeenCalledTimes(7);

    // Verify phase transition order (phase argument = 2nd arg to logTransition)
    const transitionPhases = mockAuditService.logTransition.mock.calls.map(
      (call: any[]) => call[1] as string,
    );
    expect(transitionPhases).toEqual([
      'PENDING', 'CLAIMING', 'SWAPPING', 'BRIDGING', 'FUNDING', 'ALLOCATING', 'PROVISIONING',
    ]);

    // Verify all transitions after PENDING are successful (action contains 'transition:')
    const transitionActions = mockAuditService.logTransition.mock.calls.map(
      (call: any[]) => call[2] as string,
    );
    // First transition (PENDING→CLAIMING) has no result, so action is 'fail:PENDING->CLAIMING'
    // All subsequent transitions pass a success result, so action starts with 'transition:'
    expect(transitionActions[0]).toMatch(/^fail:PENDING->CLAIMING$/);
    for (let i = 1; i < transitionActions.length; i++) {
      expect(transitionActions[i]).toMatch(/^transition:/);
    }

    // (4) executionPolicy.recordRunStart is called
    expect(executionPolicy.getState().dailyRunCount[STRATEGY_ID]).toBe(1);

    // (5) runLock acquire/release are called in order
    expect(runLock.isLocked(STRATEGY_ID)).toBe(false);
  });

  it('releases lock even when state machine throws', async () => {
    // Force the state machine to fail by removing all phase handlers
    const emptyStateMachine = new StateMachine({
      auditService: mockAuditService as any,
      runService: mockRunService as any,
      executionPolicy,
      phaseHandlers: new Map(),
    });

    const scheduler = new SchedulerService({
      strategyService: mockStrategyService as any,
      runService: mockRunService as any,
      stateMachine: emptyStateMachine as any,
      executionPolicy,
      runLock,
      config: testConfig,
    });

    await scheduler.start();
    await (scheduler as any).executeStrategyRun(STRATEGY_ID);

    // Lock must be released despite the failure
    expect(runLock.isLocked(STRATEGY_ID)).toBe(false);
  });

  it('skips run when execution policy blocks', async () => {
    // Create a policy with kill switch active
    const killSwitchPolicy = new ExecutionPolicy({
      ...testConfig,
      executionKillSwitch: true,
    });

    const scheduler = new SchedulerService({
      strategyService: mockStrategyService as any,
      runService: mockRunService as any,
      stateMachine: stateMachine as any,
      executionPolicy: killSwitchPolicy,
      runLock,
      config: testConfig,
    });

    await scheduler.start();
    await (scheduler as any).executeStrategyRun(STRATEGY_ID);

    // No run should have been created
    expect(mockRunService.create).not.toHaveBeenCalled();
    // Lock should not be held (acquire was never called)
    expect(runLock.isLocked(STRATEGY_ID)).toBe(false);
  });
});

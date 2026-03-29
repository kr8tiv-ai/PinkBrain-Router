import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaimPhase, defaultClaimPhase } from '../src/engine/phases/claim.js';
import { createSwapPhase, defaultSwapPhase } from '../src/engine/phases/swap.js';
import type { CreditRun, ClaimablePosition, ClaimTransaction, SwapTransaction, TradeQuote } from '../src/types/index.js';

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// ─── Shared fixtures ──────────────────────────────────────────

const mockRun: CreditRun = {
  runId: 'run-claim-swap-test',
  strategyId: 'strat-001',
  state: 'PENDING',
  startedAt: '2025-01-01T00:00:00Z',
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

function makePosition(overrides: Partial<ClaimablePosition> & { lamports: number }): ClaimablePosition {
  return {
    isCustomFeeVault: false,
    baseMint: 'So11111111111111111111111111111111111111112',
    isMigrated: true,
    totalClaimableLamportsUserShare: overrides.lamports,
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    virtualPool: 'vpool',
    virtualPoolAddress: '7xKpXq2oBkV4L7v7vYV7vYV7vYV7vYV7vYV7vY',
    virtualPoolClaimableAmount: overrides.lamports,
    virtualPoolClaimableLamportsUserShare: overrides.lamports,
    dammPoolClaimableAmount: 0,
    dammPoolClaimableLamportsUserShare: 0,
    dammPoolAddress: '',
    claimableDisplayAmount: overrides.lamports / 1_000_000_000,
    user: 'wallet-abc',
    claimerIndex: 0,
    userBps: 10000,
    customFeeVault: '',
    customFeeVaultClaimerA: '',
    customFeeVaultClaimerB: '',
    customFeeVaultClaimerSide: 'A',
    ...overrides,
  };
}

const mockClaimTx: ClaimTransaction = {
  tx: 'base64-transaction-data',
  blockhash: {
    blockhash: 'blockhash-123',
    lastValidBlockHeight: 200_000,
  },
};

// ─── Mock objects ─────────────────────────────────────────────

let mockBagsClient: {
  getClaimablePositions: ReturnType<typeof vi.fn>;
  getClaimTransactions: ReturnType<typeof vi.fn>;
  prepareSwap: ReturnType<typeof vi.fn>;
};
let mockStrategyService: {
  getById: ReturnType<typeof vi.fn>;
};
let mockSignAndSendClaim: ReturnType<typeof vi.fn>;
let mockSignAndSendSwap: ReturnType<typeof vi.fn>;

const defaultStrategy = {
  strategyId: 'strat-001',
  ownerWallet: 'wallet-abc',
  minClaimThreshold: 5,
  swapConfig: {
    slippageBps: 50,
    maxPriceImpactBps: 300,
  },
};

beforeEach(() => {
  mockBagsClient = {
    getClaimablePositions: vi.fn(),
    getClaimTransactions: vi.fn(),
    prepareSwap: vi.fn(),
  };
  mockStrategyService = {
    getById: vi.fn(),
  };
  mockSignAndSendClaim = vi.fn().mockResolvedValue('sig-abc123');
  mockSignAndSendSwap = vi.fn().mockResolvedValue('swap-sig-abc123');
});

// ─── defaultClaimPhase (backward compat) ─────────────────────

describe('defaultClaimPhase', () => {
  it('returns success with dry-run claimed SOL', async () => {
    const result = await defaultClaimPhase(mockRun);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      claimedSol: 10,
      claimedTxSignature: 'dry-run-tx-claim',
    });
  });

  it('returns success regardless of run state', async () => {
    const failedRun: CreditRun = {
      ...mockRun,
      state: 'FAILED',
      error: { code: 'TEST', detail: 'test', failedState: 'CLAIMING' },
    };

    const result = await defaultClaimPhase(failedRun);
    expect(result.success).toBe(true);
  });
});

// ─── createClaimPhase ─────────────────────────────────────────

describe('createClaimPhase', () => {
  // 1. Threshold skip — positions total 2 SOL, threshold is 5 SOL
  it('skips claim when total SOL is below threshold', async () => {
    mockStrategyService.getById.mockReturnValue({
      ...defaultStrategy,
      minClaimThreshold: 5,
    } as any);
    mockBagsClient.getClaimablePositions.mockResolvedValue([
      makePosition({ lamports: 2_000_000_000 }),
    ]);

    const phase = createClaimPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendClaim: mockSignAndSendClaim,
      dryRun: false,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      claimedSol: 0,
      skipped: true,
      claimableSol: 2,
      positionCount: 1,
    });
    // signAndSendClaim should NOT have been called
    expect(mockSignAndSendClaim).not.toHaveBeenCalled();
  });

  // 2. Successful single-position claim
  it('claims a single position above threshold', async () => {
    mockStrategyService.getById.mockReturnValue({
      ...defaultStrategy,
      minClaimThreshold: 5,
    } as any);
    mockBagsClient.getClaimablePositions.mockResolvedValue([
      makePosition({ lamports: 10_000_000_000 }),
    ]);
    mockBagsClient.getClaimTransactions.mockResolvedValue([mockClaimTx]);

    const phase = createClaimPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendClaim: mockSignAndSendClaim,
      dryRun: false,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      claimedSol: 10,
      claimedTxSignature: 'sig-abc123',
      positionsClaimed: 1,
    });
    expect(mockSignAndSendClaim).toHaveBeenCalledWith(mockClaimTx);
  });

  // 3. Multi-position claim — two positions with 5 SOL each, threshold 3 SOL
  it('claims multiple positions and aggregates total SOL', async () => {
    mockStrategyService.getById.mockReturnValue({
      ...defaultStrategy,
      minClaimThreshold: 3,
    } as any);
    mockBagsClient.getClaimablePositions.mockResolvedValue([
      makePosition({ lamports: 5_000_000_000, virtualPoolAddress: 'vpool-1' }),
      makePosition({ lamports: 5_000_000_000, virtualPoolAddress: 'vpool-2' }),
    ]);
    mockBagsClient.getClaimTransactions.mockResolvedValue([mockClaimTx]);

    const phase = createClaimPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendClaim: mockSignAndSendClaim,
      dryRun: false,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      claimedSol: 10,
    });
    // Each position calls getClaimTransactions, each returns 1 tx, so 2 signAndSendClaim calls
    expect(mockSignAndSendClaim).toHaveBeenCalledTimes(2);
    expect(result.data!.transactionsSent).toBe(2);
  });

  // 4. Dry-run mode — positions available, no transactions submitted
  it('returns claimable amounts in dry-run mode without submitting transactions', async () => {
    mockStrategyService.getById.mockReturnValue({
      ...defaultStrategy,
      minClaimThreshold: 1,
    } as any);
    mockBagsClient.getClaimablePositions.mockResolvedValue([
      makePosition({ lamports: 8_000_000_000 }),
    ]);

    const phase = createClaimPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendClaim: mockSignAndSendClaim,
      dryRun: true,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      claimedSol: 8,
      claimedTxSignature: null,
      dryRun: true,
      positionsClaimed: 1,
    });
    expect(mockSignAndSendClaim).not.toHaveBeenCalled();
  });

  // 5. Strategy not found
  it('returns STRATEGY_NOT_FOUND when strategyService returns null', async () => {
    mockStrategyService.getById.mockReturnValue(null);

    const phase = createClaimPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendClaim: mockSignAndSendClaim,
      dryRun: false,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'STRATEGY_NOT_FOUND',
    });
  });

  // 6. No claimable positions — empty array
  it('returns skipped success when no claimable positions found', async () => {
    mockStrategyService.getById.mockReturnValue(defaultStrategy as any);
    mockBagsClient.getClaimablePositions.mockResolvedValue([]);

    const phase = createClaimPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendClaim: mockSignAndSendClaim,
      dryRun: false,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      claimedSol: 0,
      skipped: true,
      reason: 'no-positions',
    });
    expect(mockSignAndSendClaim).not.toHaveBeenCalled();
  });

  // 7. Claim tx failure — signAndSendClaim throws
  it('returns CLAIM_TX_FAILED when signAndSendClaim throws', async () => {
    mockStrategyService.getById.mockReturnValue({
      ...defaultStrategy,
      minClaimThreshold: 1,
    } as any);
    mockBagsClient.getClaimablePositions.mockResolvedValue([
      makePosition({ lamports: 10_000_000_000 }),
    ]);
    mockBagsClient.getClaimTransactions.mockResolvedValue([mockClaimTx]);
    mockSignAndSendClaim.mockRejectedValue(new Error('Transaction simulation failed'));

    const phase = createClaimPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendClaim: mockSignAndSendClaim,
      dryRun: false,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'CLAIM_TX_FAILED',
    });
    expect(result.error!.message).toContain('Transaction simulation failed');
  });

  // Extra: BagsClient.getClaimablePositions throws — transient error should propagate
  it('propagates transient errors from getClaimablePositions for retry handling', async () => {
    mockStrategyService.getById.mockReturnValue(defaultStrategy as any);
    mockBagsClient.getClaimablePositions.mockRejectedValue(new Error('Network timeout'));

    const phase = createClaimPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendClaim: mockSignAndSendClaim,
      dryRun: false,
    });

    await expect(phase(mockRun)).rejects.toThrow('Network timeout');
  });

  // Extra: position with zero lamports is skipped in live mode
  it('skips positions with zero claimable lamports in live mode', async () => {
    mockStrategyService.getById.mockReturnValue({
      ...defaultStrategy,
      minClaimThreshold: 1,
    } as any);
    mockBagsClient.getClaimablePositions.mockResolvedValue([
      makePosition({ lamports: 5_000_000_000, virtualPoolAddress: 'vpool-1' }),
      makePosition({ lamports: 0, virtualPoolAddress: 'vpool-2' }),
      makePosition({ lamports: 3_000_000_000, virtualPoolAddress: 'vpool-3' }),
    ]);
    mockBagsClient.getClaimTransactions.mockResolvedValue([mockClaimTx]);

    const phase = createClaimPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendClaim: mockSignAndSendClaim,
      dryRun: false,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      claimedSol: 8,
    });
    // Only 2 non-zero positions → 2 getClaimTransactions calls, 2 signAndSendClaim calls
    expect(mockBagsClient.getClaimTransactions).toHaveBeenCalledTimes(2);
    expect(mockSignAndSendClaim).toHaveBeenCalledTimes(2);
  });

  // Extra: getClaimTransactions returns empty array — position skipped gracefully
  it('skips position when getClaimTransactions returns empty', async () => {
    mockStrategyService.getById.mockReturnValue({
      ...defaultStrategy,
      minClaimThreshold: 1,
    } as any);
    mockBagsClient.getClaimablePositions.mockResolvedValue([
      makePosition({ lamports: 5_000_000_000 }),
    ]);
    mockBagsClient.getClaimTransactions.mockResolvedValue([]);

    const phase = createClaimPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendClaim: mockSignAndSendClaim,
      dryRun: false,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(true);
    // Position had no tx → no signAndSendClaim call, but still succeeds
    expect(mockSignAndSendClaim).not.toHaveBeenCalled();
    // Should still have the claimed SOL since positions were found above threshold
    expect(result.data!.claimedSol).toBe(5);
  });

  // Extra: multiple transactions per position (pre-vault + vault-withdraw)
  it('handles multiple claim transactions per position', async () => {
    mockStrategyService.getById.mockReturnValue({
      ...defaultStrategy,
      minClaimThreshold: 1,
    } as any);
    const mockTx2: ClaimTransaction = {
      tx: 'base64-tx-2',
      blockhash: { blockhash: 'blockhash-456', lastValidBlockHeight: 200_000 },
    };
    mockBagsClient.getClaimablePositions.mockResolvedValue([
      makePosition({ lamports: 7_000_000_000 }),
    ]);
    mockBagsClient.getClaimTransactions.mockResolvedValue([mockClaimTx, mockTx2]);

    const phase = createClaimPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendClaim: mockSignAndSendClaim,
      dryRun: false,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      claimedSol: 7,
      transactionsSent: 2,
    });
    expect(mockSignAndSendClaim).toHaveBeenCalledTimes(2);
    expect(mockSignAndSendClaim).toHaveBeenCalledWith(mockClaimTx);
    expect(mockSignAndSendClaim).toHaveBeenCalledWith(mockTx2);
  });
});

// ─── Swap fixtures ─────────────────────────────────────────────────

const mockQuote: TradeQuote = {
  requestId: 'req-1',
  contextSlot: 100,
  inAmount: '10000000000',
  inputMint: 'So11111111111111111111111111111111111112',
  outAmount: '300000000',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  minOutAmount: '298500000',
  otherAmountThreshold: '298500000',
  priceImpactPct: '0.15',
  slippageBps: 50,
  routePlan: [],
  platformFee: { amount: '0', feeBps: 0, feeAccount: '', segmenterFeeAmount: '0', segmenterFeePct: 0 },
  outTransferFee: '0',
  simulatedComputeUnits: 200000,
};

const mockSwapTx: SwapTransaction = {
  swapTransaction: Buffer.from('fake-tx-data').toString('base64'),
  computeUnitLimit: 200000,
  lastValidBlockHeight: 300000,
  prioritizationFeeLamports: 1000,
};

function mockSwapSuccess() {
  mockBagsClient.prepareSwap.mockResolvedValue({ quote: mockQuote, swapTx: mockSwapTx });
  mockStrategyService.getById.mockReturnValue(defaultStrategy as any);
}

// ─── defaultSwapPhase (backward compat) ────────────────────────────────────

describe('defaultSwapPhase', () => {
  it('returns success with stub 300 USDC', async () => {
    const runWithClaim: CreditRun = { ...mockRun, claimedSol: 10 };
    const result = await defaultSwapPhase(runWithClaim);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      swappedUsdc: 300,
      swapTxSignature: 'dry-run-tx-swap',
    });
  });
});

// ─── createSwapPhase ──────────────────────────────────────────────────────

describe('createSwapPhase', () => {
  // 1. Skip when no claimed SOL (null)
  it('skips swap when claimedSol is null', async () => {
    mockStrategyService.getById.mockReturnValue(defaultStrategy as any);

    const phase = createSwapPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendSwap: mockSignAndSendSwap,
      dryRun: false,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      swappedUsdc: 0,
      skipped: true,
      reason: 'no-claimed-sol',
    });
    expect(mockBagsClient.prepareSwap).not.toHaveBeenCalled();
    expect(mockSignAndSendSwap).not.toHaveBeenCalled();
  });

  // 2. Skip when claimed SOL is zero
  it('skips swap when claimedSol is zero', async () => {
    const zeroRun: CreditRun = { ...mockRun, claimedSol: 0 };
    mockStrategyService.getById.mockReturnValue(defaultStrategy as any);

    const phase = createSwapPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendSwap: mockSignAndSendSwap,
      dryRun: false,
    });

    const result = await phase(zeroRun);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      swappedUsdc: 0,
      skipped: true,
      reason: 'no-claimed-sol',
    });
    expect(mockBagsClient.prepareSwap).not.toHaveBeenCalled();
    expect(mockSignAndSendSwap).not.toHaveBeenCalled();
  });

  // 3. Successful swap
  it('swaps claimed SOL to USDC and stores signature', async () => {
    mockSwapSuccess();

    const runWithClaim: CreditRun = { ...mockRun, claimedSol: 10 };
    const phase = createSwapPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendSwap: mockSignAndSendSwap,
      dryRun: false,
    });

    const result = await phase(runWithClaim);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      swappedUsdc: 300, // 300000000 / 1e6
      swapTxSignature: 'swap-sig-abc123',
    });
    expect(mockBagsClient.prepareSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMint: 'So11111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 10_000_000_000, // 10 SOL in lamports
        userPublicKey: '',
        slippageBps: 50,
        maxPriceImpactBps: 300,
      }),
    );
    expect(mockSignAndSendSwap).toHaveBeenCalledWith(mockSwapTx);
  });

  // 4. Dry-run mode — logs quote, no signAndSend call
  it('returns simulated amounts in dry-run mode without calling signAndSendSwap', async () => {
    mockSwapSuccess();

    const runWithClaim: CreditRun = { ...mockRun, claimedSol: 10 };
    const phase = createSwapPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendSwap: mockSignAndSendSwap,
      dryRun: true,
    });

    const result = await phase(runWithClaim);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      swappedUsdc: 300,
      dryRun: true,
    });
    expect(result.data!.swapTxSignature).toBeUndefined();
    expect(result.data!.swapQuoteSnapshot).toEqual(mockQuote);
    expect(mockSignAndSendSwap).not.toHaveBeenCalled();
  });

  // 5. Strategy not found
  it('returns STRATEGY_NOT_FOUND when strategyService returns null', async () => {
    mockStrategyService.getById.mockReturnValue(null);

    const phase = createSwapPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendSwap: mockSignAndSendSwap,
      dryRun: false,
    });

    const result = await phase(mockRun);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'STRATEGY_NOT_FOUND',
    });
    expect(mockBagsClient.prepareSwap).not.toHaveBeenCalled();
  });

  // 6. prepareSwap failure (transient) — error propagates for StateMachine retry
  it('propagates transient errors from prepareSwap for retry handling', async () => {
    mockStrategyService.getById.mockReturnValue(defaultStrategy as any);
    mockBagsClient.prepareSwap.mockRejectedValue(new Error('Connection refused'));

    const runWithClaim: CreditRun = { ...mockRun, claimedSol: 10 };
    const phase = createSwapPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendSwap: mockSignAndSendSwap,
      dryRun: false,
    });

    await expect(phase(runWithClaim)).rejects.toThrow('Connection refused');
    expect(mockSignAndSendSwap).not.toHaveBeenCalled();
  });

  // 7. Transaction send failure
  it('returns SWAP_TX_FAILED when signAndSendSwap throws', async () => {
    mockSwapSuccess();
    mockSignAndSendSwap.mockRejectedValueOnce(new Error('Transaction simulation failed'));

    const runWithClaim: CreditRun = { ...mockRun, claimedSol: 10 };
    const phase = createSwapPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendSwap: mockSignAndSendSwap,
      dryRun: false,
    });

    const result = await phase(runWithClaim);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'SWAP_TX_FAILED',
    });
    expect(result.error!.message).toContain('Transaction simulation failed');
  });

  // 9. Quote details stored in result
  it('stores swapQuoteSnapshot with correct trade quote fields', async () => {
    mockSwapSuccess();

    const runWithClaim: CreditRun = { ...mockRun, claimedSol: 10 };
    const phase = createSwapPhase({
      bagsClient: mockBagsClient as any,
      strategyService: mockStrategyService as any,
      signAndSendSwap: mockSignAndSendSwap,
      dryRun: false,
    });

    const result = await phase(runWithClaim);

    expect(result.success).toBe(true);
    const snapshot = result.data!.swapQuoteSnapshot as TradeQuote;
    expect(snapshot).toBeDefined();
    expect(snapshot.requestId).toBe('req-1');
    expect(snapshot.inAmount).toBe('10000000000');
    expect(snapshot.outAmount).toBe('300000000');
    expect(snapshot.inputMint).toBe('So11111111111111111111111111111111111112');
    expect(snapshot.outputMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(snapshot.slippageBps).toBe(50);
    expect(snapshot.priceImpactPct).toBe('0.15');
  });
});

import { describe, it, expect } from 'vitest';
import { claimPhase } from '../src/engine/phases/claim.js';
import { swapPhase } from '../src/engine/phases/swap.js';
import type { CreditRun } from '../src/types/index.js';

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

describe('claimPhase', () => {
  it('returns success with dry-run claimed SOL', async () => {
    const result = await claimPhase(mockRun);

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

    const result = await claimPhase(failedRun);
    expect(result.success).toBe(true);
  });
});

describe('swapPhase', () => {
  it('returns success with dry-run swapped USDC', async () => {
    const runWithClaim: CreditRun = { ...mockRun, claimedSol: 10 };
    const result = await swapPhase(runWithClaim);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      swappedUsdc: 300,
      swapTxSignature: 'dry-run-tx-swap',
    });
  });

  it('returns success even without claimed SOL on the run', async () => {
    const result = await swapPhase(mockRun);

    expect(result.success).toBe(true);
    expect(result.data.swappedUsdc).toBe(300);
  });
});

import pino from 'pino';
import type { PhaseResult, CreditRun } from '../../types/index.js';

const logger = pino({ name: 'phase:allocate' });

export async function allocatePhase(run: CreditRun): Promise<PhaseResult> {
  logger.info(
    { runId: run.runId, fundedUsdc: run.fundedUsdc },
    'ALLOCATING phase — would snapshot token holders and calculate per-user allocations',
  );

  // Dry-run: simulate allocating to 3 holders
  const holderCount = 3;
  const perHolder = (run.fundedUsdc ?? 300) / holderCount;

  return {
    success: true,
    data: {
      allocatedUsd: run.fundedUsdc ?? 300,
      holderCount,
      perHolder,
      allocationMode: 'EQUAL_SPLIT',
    },
  };
}

import pino from 'pino';
import type { PhaseResult, CreditRun } from '../../types/index.js';

const logger = pino({ name: 'phase:claim' });

export async function claimPhase(run: CreditRun): Promise<PhaseResult> {
  logger.info(
    { runId: run.runId, strategyId: run.strategyId },
    'CLAIMING phase — would query Bags.fm for claimable fees and execute claim transaction',
  );

  // Dry-run: simulate claiming 10 SOL
  return {
    success: true,
    data: {
      claimedSol: 10,
      claimedTxSignature: 'dry-run-tx-claim',
    },
  };
}

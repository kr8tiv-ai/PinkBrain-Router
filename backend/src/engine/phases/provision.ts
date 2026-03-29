import pino from 'pino';
import type { PhaseResult, CreditRun } from '../../types/index.js';

const logger = pino({ name: 'phase:provision' });

export async function provisionPhase(run: CreditRun): Promise<PhaseResult> {
  logger.info(
    { runId: run.runId, allocatedUsd: run.allocatedUsd },
    'PROVISIONING phase — would create/update OpenRouter API keys for qualifying holders',
  );

  // Dry-run: simulate provisioning 3 keys
  return {
    success: true,
    data: {
      keysProvisioned: 2,
      keysUpdated: 1,
    },
  };
}

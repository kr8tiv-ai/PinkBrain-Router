import pino from 'pino';
import type { CoinbaseChargeService } from '../../services/CoinbaseChargeService.js';
import type { CreditPoolService } from '../../services/CreditPoolService.js';
import type { PhaseResult, CreditRun } from '../../types/index.js';

const logger = pino({ name: 'phase:fund' });

export interface FundPhaseDeps {
  chargeService: CoinbaseChargeService;
  creditPoolService: CreditPoolService;
}

/**
 * FUNDING phase: Purchase OpenRouter credits using the bridged USDC.
 *
 * This phase:
 * 1. Checks if the credit pool has capacity for the funding amount
 * 2. Creates a funding intent via CoinbaseChargeService
 * 3. Updates the credit pool tracking
 *
 * In dry-run mode, the charge is simulated without hitting external APIs.
 */
export function createFundPhase(deps: FundPhaseDeps) {
  return async function fundPhase(run: CreditRun): Promise<PhaseResult> {
    const bridgedUsdc = run.bridgedUsdc;

    if (!bridgedUsdc || bridgedUsdc <= 0) {
      logger.warn(
        { runId: run.runId, bridgedUsdc },
        'No USDC available to fund — skipping funding phase',
      );

      return {
        success: true,
        data: {
          fundedUsdc: 0,
          fundingTxHash: null,
          skipped: true,
          reason: 'No USDC available from bridge phase',
        },
      };
    }

    // Check funding service availability
    if (!deps.chargeService.isAvailable()) {
      logger.error(
        { runId: run.runId },
        'Coinbase Charge circuit breaker is open — cannot proceed',
      );

      return {
        success: false,
        data: { fundedUsdc: 0, fundingTxHash: null },
        error: {
          code: 'FUNDING_UNAVAILABLE',
          message: 'Coinbase Charge service circuit breaker is OPEN. Retry after cooldown.',
        },
      };
    }

    logger.info(
      { runId: run.runId, amount: bridgedUsdc },
      'FUNDING phase — purchasing OpenRouter credits',
    );

    // Step 1: Verify pool capacity before funding
    const poolCheck = await deps.creditPoolService.checkAllocation(bridgedUsdc);
    if (!poolCheck.allowed) {
      logger.error(
        {
          runId: run.runId,
          reason: poolCheck.reason,
          requested: bridgedUsdc,
          available: poolCheck.availableAfterReserve,
        },
        'Funding blocked by credit pool reserve policy',
      );

      return {
        success: false,
        data: { fundedUsdc: 0, fundingTxHash: null },
        error: {
          code: 'POOL_RESERVE_EXCEEDED',
          message: poolCheck.reason ?? 'Allocation exceeds pool reserve policy',
        },
      };
    }

    // Step 2: Execute the funding
    const result = await deps.chargeService.fund({
      amountUsdc: bridgedUsdc,
      runId: run.runId,
      strategyId: run.strategyId,
    });

    if (!result.success) {
      logger.error(
        { runId: run.runId, error: result.error },
        'OpenRouter funding failed',
      );

      return {
        success: false,
        data: { fundedUsdc: 0, fundingTxHash: null },
        error: {
          code: 'FUNDING_FAILED',
          message: result.error ?? 'Unknown funding error',
        },
      };
    }

    logger.info(
      {
        runId: run.runId,
        chargeId: result.chargeId,
        amountFunded: result.amountFunded,
        previousBalance: result.previousBalance,
        newBalance: result.newBalance,
        dryRun: result.dryRun,
      },
      'FUNDING phase completed successfully',
    );

    return {
      success: true,
      data: {
        fundedUsdc: result.amountFunded,
        fundingTxHash: result.chargeId,
        previousBalance: result.previousBalance,
        newBalance: result.newBalance,
        dryRun: result.dryRun,
      },
    };
  };
}

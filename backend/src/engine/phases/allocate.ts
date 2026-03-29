import pino from 'pino';
import type { DistributionService } from '../../services/DistributionService.js';
import type { StrategyService } from '../../services/StrategyService.js';
import type { PhaseResult, CreditRun, Strategy } from '../../types/index.js';

const logger = pino({ name: 'phase:allocate' });

export interface AllocatePhaseDeps {
  distributionService: DistributionService;
  strategyService: StrategyService;
  /**
   * Holder resolver: fetches token holders for a strategy's distribution token.
   * In production this queries Helius for the top holders of the strategy's distribution token mint.
   * In tests this can be a function returning mock holder data.
   */
  resolveHolders: (strategy: Strategy) => Promise<Array<{ wallet: string; tokenBalance: string }>>;
}

/**
 * ALLOCATING phase: Calculate per-holder credit allocations from the funded pool.
 *
 * This phase:
 * 1. Loads the strategy configuration
 * 2. Resolves qualifying token holders
 * 3. Calculates allocations based on the strategy's distribution mode
 * 4. Persists allocation snapshots
 * 5. Records the allocation in the credit pool for reserve tracking
 */
export function createAllocatePhase(deps: AllocatePhaseDeps) {
  return async function allocatePhase(run: CreditRun): Promise<PhaseResult> {
    const fundedUsdc = run.fundedUsdc;

    if (!fundedUsdc || fundedUsdc <= 0) {
      logger.warn(
        { runId: run.runId, fundedUsdc },
        'No funded credits available for allocation — skipping',
      );

      return {
        success: true,
        data: {
          allocatedUsd: 0,
          holderCount: 0,
          skipped: true,
          reason: 'No funded credits available',
        },
      };
    }

    // Load the strategy
    const strategy = deps.strategyService.getById(run.strategyId);
    if (!strategy) {
      logger.error(
        { runId: run.runId, strategyId: run.strategyId },
        'Strategy not found for allocation',
      );

      return {
        success: false,
        data: { allocatedUsd: 0, holderCount: 0 },
        error: {
          code: 'STRATEGY_NOT_FOUND',
          message: `Strategy ${run.strategyId} not found`,
        },
      };
    }

    logger.info(
      { runId: run.runId, amount: fundedUsdc, mode: strategy.distribution },
      'ALLOCATING phase — calculating per-holder allocations',
    );

    // Resolve token holders
    let holders: Array<{ wallet: string; tokenBalance: string }>;
    try {
      holders = await deps.resolveHolders(strategy);
    } catch (error) {
      logger.error(
        { runId: run.runId, error: (error as Error).message },
        'Failed to resolve token holders',
      );

      return {
        success: false,
        data: { allocatedUsd: 0, holderCount: 0 },
        error: {
          code: 'HOLDER_RESOLUTION_FAILED',
          message: `Failed to resolve holders: ${(error as Error).message}`,
        },
      };
    }

    if (holders.length === 0) {
      logger.warn(
        { runId: run.runId },
        'No token holders found — allocation skipped',
      );

      return {
        success: true,
        data: {
          allocatedUsd: 0,
          holderCount: 0,
          skipped: true,
          reason: 'No token holders found',
        },
      };
    }

    // Execute allocation
    try {
      const result = await deps.distributionService.allocate(run, strategy, holders);

      logger.info(
        {
          runId: run.runId,
          snapshotId: result.snapshotId,
          holderCount: result.holderCount,
          totalAllocated: result.totalAllocatedUsd,
          skippedHolders: result.skippedHolders,
        },
        'ALLOCATING phase completed',
      );

      return {
        success: true,
        data: {
          allocatedUsd: result.totalAllocatedUsd,
          holderCount: result.holderCount,
          snapshotId: result.snapshotId,
          allocationMode: result.allocationMode,
          skippedHolders: result.skippedHolders,
        },
      };
    } catch (error) {
      logger.error(
        { runId: run.runId, error: (error as Error).message },
        'Allocation failed',
      );

      return {
        success: false,
        data: { allocatedUsd: 0, holderCount: 0 },
        error: {
          code: 'ALLOCATION_FAILED',
          message: (error as Error).message,
        },
      };
    }
  };
}

/**
 * Default allocate phase stub for when no deps are injected.
 */
export async function allocatePhase(run: CreditRun): Promise<PhaseResult> {
  const { pino } = await import('pino');
  const logger = pino({ name: 'phase:allocate:default' });
  logger.info(
    { runId: run.runId, fundedUsdc: run.fundedUsdc },
    'ALLOCATING phase — no allocate deps injected, returning stub',
  );

  const fundedUsdc = run.fundedUsdc ?? 300;
  const holderCount = 3;
  const perHolder = Math.floor((fundedUsdc / holderCount) * 100) / 100;

  return {
    success: true,
    data: {
      allocatedUsd: fundedUsdc,
      holderCount,
      perHolder,
      allocationMode: 'EQUAL_SPLIT',
    },
  };
}

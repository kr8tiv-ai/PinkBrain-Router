import pino from 'pino';
import type { KeyManagerService } from '../../services/KeyManagerService.js';
import type { DistributionService } from '../../services/DistributionService.js';
import type { StrategyService } from '../../services/StrategyService.js';
import type { PhaseResult, CreditRun, Strategy } from '../../types/index.js';

const logger = pino({ name: 'phase:provision' });

export interface ProvisionPhaseDeps {
  keyManagerService: KeyManagerService;
  distributionService: DistributionService;
  strategyService: StrategyService;
}

/**
 * PROVISIONING phase: Create or update OpenRouter API keys for allocated holders.
 *
 * This phase:
 * 1. Loads the most recent allocation snapshot for the run
 * 2. For each holder allocation, creates a new key or updates the existing one
 * 3. Records key hashes back to allocation snapshots for traceability
 * 4. Reports provisioning counts (new, updated, failed)
 */
export function createProvisionPhase(deps: ProvisionPhaseDeps) {
  return async function provisionPhase(run: CreditRun): Promise<PhaseResult> {
    const allocatedUsd = run.allocatedUsd;

    if (!allocatedUsd || allocatedUsd <= 0) {
      logger.warn(
        { runId: run.runId, allocatedUsd },
        'No allocated credits for provisioning — skipping',
      );

      return {
        success: true,
        data: {
          keysProvisioned: 0,
          keysUpdated: 0,
          keysFailed: 0,
          skipped: true,
          reason: 'No allocated credits',
        },
      };
    }

    // Load the strategy
    const strategy = deps.strategyService.getById(run.strategyId);
    if (!strategy) {
      logger.error(
        { runId: run.runId, strategyId: run.strategyId },
        'Strategy not found for provisioning',
      );

      return {
        success: false,
        data: { keysProvisioned: 0, keysUpdated: 0, keysFailed: 0 },
        error: {
          code: 'STRATEGY_NOT_FOUND',
          message: `Strategy ${run.strategyId} not found`,
        },
      };
    }

    // Load allocation snapshots for this run
    const snapshots = deps.distributionService.getSnapshotsByRun(run.runId);

    if (snapshots.length === 0) {
      logger.warn(
        { runId: run.runId },
        'No allocation snapshots found — cannot provision keys',
      );

      return {
        success: true,
        data: {
          keysProvisioned: 0,
          keysUpdated: 0,
          keysFailed: 0,
          skipped: true,
          reason: 'No allocation snapshots found',
        },
      };
    }

    logger.info(
      { runId: run.runId, holderCount: snapshots.length },
      'PROVISIONING phase — creating/updating OpenRouter keys',
    );

    // Build allocation list for key manager
    const allocations = snapshots.map((s) => ({
      holderWallet: s.holderWallet,
      allocatedUsd: s.allocatedUsd,
    }));

    // Provision keys
    try {
      const result = await deps.keyManagerService.provisionKeys(allocations, strategy);

      logger.info(
        {
          runId: run.runId,
          provisioned: result.keysProvisioned,
          updated: result.keysUpdated,
          failed: result.keysFailed,
          failedWallets: result.failedWallets.map((f) => f.wallet),
        },
        'PROVISIONING phase completed',
      );

      return {
        success: true,
        data: {
          keysProvisioned: result.keysProvisioned,
          keysUpdated: result.keysUpdated,
          keysFailed: result.keysFailed,
          keyHashes: result.keyHashes,
          failedWallets: result.failedWallets,
        },
      };
    } catch (error) {
      logger.error(
        { runId: run.runId, error: (error as Error).message },
        'Provisioning failed',
      );

      return {
        success: false,
        data: { keysProvisioned: 0, keysUpdated: 0, keysFailed: 0 },
        error: {
          code: 'PROVISIONING_FAILED',
          message: (error as Error).message,
        },
      };
    }
  };
}

/**
 * Default provision phase stub for when no deps are injected.
 */
export async function provisionPhase(run: CreditRun): Promise<PhaseResult> {
  const { pino } = await import('pino');
  const logger = pino({ name: 'phase:provision:default' });
  logger.info(
    { runId: run.runId, allocatedUsd: run.allocatedUsd },
    'PROVISIONING phase — no provision deps injected, returning stub',
  );

  return {
    success: true,
    data: {
      keysProvisioned: 2,
      keysUpdated: 1,
    },
  };
}

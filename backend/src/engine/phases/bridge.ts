import pino from 'pino';
import type { CctpBridgeService } from '../../services/CctpBridgeService.js';
import type { PhaseResult, CreditRun } from '../../types/index.js';

const logger = pino({ name: 'phase:bridge' });

export interface BridgePhaseDeps {
  bridgeService: CctpBridgeService;
  dryRun?: boolean;
}

/**
 * BRIDGING phase: Bridge USDC from Solana to Base via Circle Bridge Kit.
 *
 * After the swap phase produces USDC on Solana, this phase burns USDC on
 * Solana and mints it on Base via CCTP. The Bridge Kit SDK handles burn +
 * attestation polling + mint automatically.
 */
export function createBridgePhase(deps: BridgePhaseDeps) {
  return async function bridgePhase(run: CreditRun): Promise<PhaseResult> {
    const swappedUsdc = run.swappedUsdc;

    if (!swappedUsdc || swappedUsdc <= 0) {
      logger.warn(
        { runId: run.runId, swappedUsdc },
        'No USDC available to bridge — skipping bridge phase',
      );

      return {
        success: true,
        data: {
          bridgedUsdc: 0,
          bridgeTxHash: null,
          skipped: true,
          reason: 'No USDC available from swap phase',
        },
      };
    }

    // Dry-run path: return simulated data without calling bridge service
    if (deps.dryRun) {
      logger.info(
        { runId: run.runId, amount: swappedUsdc },
        'Dry-run mode — would bridge USDC Solana→Base, skipping real bridge',
      );
      return {
        success: true,
        data: {
          bridgedUsdc: swappedUsdc,
          bridgeTxHash: null,
          dryRun: true,
          fromChain: 'solana',
          toChain: 'base',
        },
      };
    }

    // Check bridge service availability
    if (!deps.bridgeService.isAvailable()) {
      const cbState = deps.bridgeService.getCircuitBreakerState();
      logger.error(
        { runId: run.runId, circuitBreakerState: cbState },
        'CCTP bridge circuit breaker is open — cannot proceed',
      );

      return {
        success: false,
        data: { bridgedUsdc: 0, bridgeTxHash: null },
        error: {
          code: 'BRIDGE_UNAVAILABLE',
          message: `CCTP bridge circuit breaker is OPEN (${cbState.failures} failures). Retry after cooldown.`,
        },
      };
    }

    logger.info(
      { runId: run.runId, amount: swappedUsdc },
      'BRIDGING phase — bridging USDC Solana→Base via Bridge Kit',
    );

    const result = await deps.bridgeService.bridge({
      amountUsdc: swappedUsdc,
    });

    if (!result.success) {
      logger.error(
        { runId: run.runId, error: result.error },
        'CCTP bridge failed',
      );

      return {
        success: false,
        data: { bridgedUsdc: 0, bridgeTxHash: null },
        error: {
          code: 'BRIDGE_FAILED',
          message: result.error ?? 'Unknown bridge error',
        },
      };
    }

    logger.info(
      {
        runId: run.runId,
        txHash: result.txHash,
        bridgedUsdc: result.amountUsdc,
        fromChain: result.fromChain,
        toChain: result.toChain,
        state: result.state,
      },
      'BRIDGING phase completed successfully',
    );

    return {
      success: true,
      data: {
        bridgedUsdc: result.amountUsdc,
        bridgeTxHash: result.txHash,
        fromChain: result.fromChain,
        toChain: result.toChain,
        bridgeState: result.state,
        steps: result.steps,
      },
    };
  };
}

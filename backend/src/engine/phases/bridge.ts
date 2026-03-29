import pino from 'pino';
import type { CctpBridgeService } from '../../services/CctpBridgeService.js';
import type { PhaseResult, CreditRun } from '../../types/index.js';

const logger = pino({ name: 'phase:bridge' });

export interface BridgePhaseDeps {
  bridgeService: CctpBridgeService;
  recipientSolanaAddress: string;
}

/**
 * BRIDGING phase: Bridge USDC from Base EVM chain to Solana via Circle CCTP.
 *
 * This is the reverse direction of what you might expect — the pipeline claims
 * fees on Solana, swaps to USDC, then bridges USDC TO Solana from Base
 * (where the Coinbase Charge USDC arrives) to fund the Solana-side operations.
 *
 * In the actual flow, if USDC is already on Solana after the swap phase,
 * this bridge step may be skipped (bridgedUsdc = 0). The bridge is needed
 * when credits are purchased via Coinbase Charge on Base and need to be
 * available on Solana.
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
      { runId: run.runId, amount: swappedUsdc, recipient: deps.recipientSolanaAddress },
      'BRIDGING phase — bridging USDC via CCTP',
    );

    const result = await deps.bridgeService.bridge({
      amountUsdc: swappedUsdc,
      recipientSolanaAddress: deps.recipientSolanaAddress,
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
        recipientSolanaAddress: result.recipientSolanaAddress,
      },
    };
  };
}

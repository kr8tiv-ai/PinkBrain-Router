import pino from 'pino';
import type { BagsAdapter } from '../../types/index.js';
import type { StrategyService } from '../../services/StrategyService.js';
import type { SwapTransaction, PhaseResult, CreditRun } from '../../types/index.js';

const logger = pino({ name: 'phase:swap' });

const SOL_MINT = 'So11111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LAMPORTS_PER_SOL = 1_000_000_000;

export interface SwapPhaseDeps {
  bagsClient: BagsAdapter;
  strategyService: StrategyService;
  signAndSendSwap: (tx: SwapTransaction) => Promise<string>;
  dryRun: boolean;
}

/**
 * SWAPPING phase: Convert claimed SOL to USDC via Bags.fm/Jupiter trade route.
 *
 * Simpler than claim — no per-position loop, no threshold check.
 * Flow: load strategy → validate claimedSol > 0 → prepareSwap → signAndSend → store result.
 */
export function createSwapPhase(deps: SwapPhaseDeps) {
  return async function swapPhase(run: CreditRun): Promise<PhaseResult> {
    logger.info(
      { runId: run.runId, strategyId: run.strategyId, dryRun: deps.dryRun, claimedSol: run.claimedSol },
      'SWAPPING phase — starting',
    );

    // 1. Load strategy
    const strategy = deps.strategyService.getById(run.strategyId);
    if (!strategy) {
      logger.error(
        { runId: run.runId, strategyId: run.strategyId },
        'Strategy not found for swapping',
      );
      return {
        success: false,
        error: {
          code: 'STRATEGY_NOT_FOUND',
          message: `Strategy ${run.strategyId} not found`,
        },
      };
    }

    // 2. Validate claimed SOL
    if (!run.claimedSol || run.claimedSol <= 0) {
      logger.info(
        { runId: run.runId, claimedSol: run.claimedSol },
        'No claimed SOL — skipping swap',
      );
      return {
        success: true,
        data: {
          swappedUsdc: 0,
          skipped: true,
          reason: 'no-claimed-sol',
        },
      };
    }

    // 3. Convert SOL to lamports
    const lamports = Math.floor(run.claimedSol * LAMPORTS_PER_SOL);

    logger.info(
      { runId: run.runId, sol: run.claimedSol, lamports, slippageBps: strategy.swapConfig.slippageBps, maxPriceImpactBps: strategy.swapConfig.maxPriceImpactBps },
      'Preparing swap via Bags.fm',
    );

    // 4. Query trade quote + build swap transaction (let errors propagate for StateMachine retry)
    const { quote, swapTx } = await deps.bagsClient.prepareSwap({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: lamports,
      userPublicKey: '', // populated by BagsClient from injected signer
      slippageBps: strategy.swapConfig.slippageBps,
      maxPriceImpactBps: strategy.swapConfig.maxPriceImpactBps,
    });

    logger.info(
      {
        runId: run.runId,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
        slippageBps: quote.slippageBps,
      },
      'Swap quote received',
    );

    // 5. Dry-run path: log quote details, return simulated amounts
    if (deps.dryRun) {
      logger.info(
        { runId: run.runId, outAmount: quote.outAmount },
        'Dry-run mode — logging quote, skipping transaction submission',
      );
      return {
        success: true,
        data: {
          swappedUsdc: Number(quote.outAmount) / 1e6,
          dryRun: true,
          swapQuoteSnapshot: quote,
        },
      };
    }

    // 6. Live path: sign and send swap transaction
    try {
      const signature = await deps.signAndSendSwap(swapTx);

      logger.info(
        { runId: run.runId, signature, outAmount: quote.outAmount },
        'Swap transaction confirmed',
      );

      return {
        success: true,
        data: {
          swappedUsdc: Number(quote.outAmount) / 1e6,
          swapTxSignature: signature,
          swapQuoteSnapshot: quote,
        },
      };
    } catch (error) {
      logger.error(
        { runId: run.runId, strategyId: run.strategyId, error: (error as Error).message },
        'Swap transaction failed',
      );
      return {
        success: false,
        error: {
          code: 'SWAP_TX_FAILED',
          message: `Swap failed: ${(error as Error).message}`,
        },
      };
    }
  };
}

/**
 * Default swap phase: returns a stub result when no deps are injected.
 * Used for testing the state machine without real services.
 */
export async function defaultSwapPhase(run: CreditRun): Promise<PhaseResult> {
  logger.info(
    { runId: run.runId, strategyId: run.strategyId, claimedSol: run.claimedSol },
    'SWAPPING phase — no swap deps injected, returning stub',
  );

  // Stub: simulate swapping 10 SOL to ~300 USDC
  return {
    success: true,
    data: {
      swappedUsdc: 300,
      swapTxSignature: 'dry-run-tx-swap',
    },
  };
}

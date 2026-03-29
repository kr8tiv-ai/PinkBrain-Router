import pino from 'pino';
import type { BagsAdapter } from '../../types/index.js';
import type { StrategyService } from '../../services/StrategyService.js';
import type { ClaimTransaction, PhaseResult, CreditRun } from '../../types/index.js';

const logger = pino({ name: 'phase:claim' });

export interface ClaimPhaseDeps {
  bagsClient: BagsAdapter;
  strategyService: StrategyService;
  signAndSendClaim: (tx: ClaimTransaction) => Promise<string>;
  dryRun: boolean;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * CLAIMING phase: Query Bags.fm for claimable fee positions, check SOL threshold,
 * execute on-chain claim transactions, and store claimed SOL + tx signature.
 */
export function createClaimPhase(deps: ClaimPhaseDeps) {
  return async function claimPhase(run: CreditRun): Promise<PhaseResult> {
    logger.info(
      { runId: run.runId, strategyId: run.strategyId, dryRun: deps.dryRun },
      'CLAIMING phase — starting',
    );

    // 1. Load strategy
    const strategy = deps.strategyService.getById(run.strategyId);
    if (!strategy) {
      logger.error(
        { runId: run.runId, strategyId: run.strategyId },
        'Strategy not found for claiming',
      );
      return {
        success: false,
        error: {
          code: 'STRATEGY_NOT_FOUND',
          message: `Strategy ${run.strategyId} not found`,
        },
      };
    }

    // 2. Query claimable positions
    let positions;
    try {
      positions = await deps.bagsClient.getClaimablePositions(strategy.ownerWallet);
    } catch (error) {
      logger.error(
        { runId: run.runId, wallet: strategy.ownerWallet, error: (error as Error).message },
        'Failed to fetch claimable positions',
      );
      // Let transient errors bubble up for StateMachine retry
      throw error;
    }

    if (positions.length === 0) {
      logger.info(
        { runId: run.runId, wallet: strategy.ownerWallet },
        'No claimable positions found',
      );
      return {
        success: true,
        data: {
          claimedSol: 0,
          claimedTxSignature: null,
          skipped: true,
          reason: 'no-positions',
        },
      };
    }

    // 3. Aggregate total claimable SOL
    const totalLamports = positions.reduce(
      (sum, pos) => sum + BigInt(pos.totalClaimableLamportsUserShare),
      0n,
    );
    const totalSol = Number(totalLamports) / LAMPORTS_PER_SOL;

    logger.info(
      { runId: run.runId, wallet: strategy.ownerWallet, totalSol, positionCount: positions.length, threshold: strategy.minClaimThreshold },
      'Claimable positions found',
    );

    // 4. Threshold check
    if (totalSol < strategy.minClaimThreshold) {
      logger.info(
        { runId: run.runId, totalSol, threshold: strategy.minClaimThreshold },
        'Claimable SOL below threshold — skipping',
      );
      return {
        success: true,
        data: {
          claimedSol: 0,
          claimedTxSignature: null,
          skipped: true,
          reason: 'below-threshold',
          claimableSol: totalSol,
          positionCount: positions.length,
        },
      };
    }

    // 5. Dry-run path: query only, no transactions
    if (deps.dryRun) {
      const claimablePositions = positions.filter(
        (pos) => pos.totalClaimableLamportsUserShare > 0,
      );
      logger.info(
        { runId: run.runId, totalSol, claimablePositions: claimablePositions.length },
        'Dry-run mode — would claim fees, skipping transaction submission',
      );
      return {
        success: true,
        data: {
          claimedSol: totalSol,
          claimedTxSignature: null,
          dryRun: true,
          positionsClaimed: claimablePositions.length,
        },
      };
    }

    // 6. Live path: iterate positions, sign and send claim transactions
    let lastSignature: string | null = null;
    let totalTransactionsSent = 0;

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];

      if (position.totalClaimableLamportsUserShare <= 0) {
        logger.debug(
          { runId: run.runId, positionIndex: i, virtualPool: position.virtualPoolAddress },
          'Position has zero claimable amount, skipping',
        );
        continue;
      }

      const positionSol = Number(BigInt(position.totalClaimableLamportsUserShare)) / LAMPORTS_PER_SOL;
      logger.info(
        { runId: run.runId, positionIndex: i, positionSol, virtualPool: position.virtualPoolAddress },
        'Processing claimable position',
      );

      try {
        // Get claim transactions for this position
        const claimTransactions = await deps.bagsClient.getClaimTransactions(
          strategy.ownerWallet,
          position,
        );

        if (!claimTransactions || claimTransactions.length === 0) {
          logger.warn(
            { runId: run.runId, positionIndex: i },
            'No claim transactions returned for position',
          );
          continue;
        }

        logger.info(
          { runId: run.runId, positionIndex: i, txCount: claimTransactions.length },
          'Claim transactions retrieved, signing and sending',
        );

        // Sign and send each transaction sequentially
        for (let j = 0; j < claimTransactions.length; j++) {
          const claimTx = claimTransactions[j];
          const isFinal = j === claimTransactions.length - 1;
          const label = isFinal ? 'vault-withdraw' : 'pre-vault';

          logger.debug(
            { runId: run.runId, positionIndex: i, txIndex: j, label },
            `Signing ${label} transaction`,
          );

          const signature = await deps.signAndSendClaim(claimTx);
          lastSignature = signature;
          totalTransactionsSent++;

          logger.info(
            { runId: run.runId, positionIndex: i, txIndex: j, signature, label },
            `${label} transaction confirmed`,
          );
        }
      } catch (error) {
        logger.error(
          { runId: run.runId, positionIndex: i, error: (error as Error).message },
          'Failed to claim position',
        );
        return {
          success: false,
          data: {
            claimedSol: 0,
            claimedTxSignature: null,
          },
          error: {
            code: 'CLAIM_TX_FAILED',
            message: `Claim failed at position ${i}: ${(error as Error).message}`,
          },
        };
      }
    }

    logger.info(
      { runId: run.runId, claimedSol: totalSol, transactionsSent: totalTransactionsSent, lastSignature },
      'CLAIMING phase completed',
    );

    return {
      success: true,
      data: {
        claimedSol: totalSol,
        claimedTxSignature: lastSignature,
        positionsClaimed: positions.length,
        transactionsSent: totalTransactionsSent,
      },
    };
  };
}

/**
 * Default claim phase: returns a stub result when no deps are injected.
 * Used for testing the state machine without real services.
 */
export async function defaultClaimPhase(run: CreditRun): Promise<PhaseResult> {
  logger.info(
    { runId: run.runId, strategyId: run.strategyId },
    'CLAIMING phase — no claim deps injected, returning stub',
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

import pino from 'pino';
import { parseUnits } from 'viem';
import type { EvmPaymentExecutor } from '../clients/EvmPaymentExecutor.js';
import { EvmExecutionError, EvmExecutionErrorCode } from '../clients/EvmPaymentExecutor.js';
import type { OpenRouterClient } from '../clients/OpenRouterClient.js';
import { CircuitBreaker } from '../clients/CircuitBreaker.js';

const logger = pino({ name: 'CoinbaseChargeService' });

// ─── Constants ──────────────────────────────────────────────────────────────

const USDC_DECIMALS = 6;
const MIN_GAS_WEI = 1_000_000_000_000_000n; // 0.001 ETH — service-level preflight
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes
const CHARGE_EXPIRY_BUFFER_MS = 60_000; // 60 seconds before expiry

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FundingRequest {
  amountUsdc: number;
  runId: string;
  strategyId: string;
}

export interface FundingResponse {
  success: boolean;
  chargeId?: string;
  fundingTxHash?: string;
  amountFunded: number;
  previousBalance: number;
  newBalance: number;
  dryRun: boolean;
  error?: string;
}

export class CoinbaseChargeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'CoinbaseChargeError';
  }
}

export interface CoinbaseChargeServiceConfig {
  dryRun?: boolean;
  evmPaymentExecutor?: EvmPaymentExecutor;
  evmChainId?: number;
}

// ─── Service ────────────────────────────────────────────────────────────────

/**
 * CoinbaseChargeService handles OpenRouter credit purchases via Coinbase Charge.
 *
 * Two operating modes:
 *   1. Without EvmPaymentExecutor: legacy stub that records funding intents
 *      (backward-compatible with pre-EVM codepaths).
 *   2. With EvmPaymentExecutor: full charge→approve→execute→confirm→poll flow
 *      that executes USDC payment on Base and waits for credit funding.
 */
export class CoinbaseChargeService {
  private readonly circuitBreaker: CircuitBreaker;
  private readonly dryRun: boolean;
  private readonly evmPaymentExecutor?: EvmPaymentExecutor;
  private readonly evmChainId: number;

  /**
   * @param openRouterClient  OpenRouter API client
   * @param dryRunOrConfig    `false` for live mode, `true` for dry-run, or a
   *                          config object. Accepts bare `boolean` for backward
   *                          compatibility with existing call sites.
   */
  constructor(
    private readonly openRouterClient: OpenRouterClient,
    dryRunOrConfig?: boolean | CoinbaseChargeServiceConfig,
  ) {
    const config =
      typeof dryRunOrConfig === 'boolean'
        ? { dryRun: dryRunOrConfig }
        : (dryRunOrConfig ?? {});

    this.dryRun = config.dryRun ?? false;
    this.evmPaymentExecutor = config.evmPaymentExecutor;
    this.evmChainId = config.evmChainId ?? 8453;

    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 30_000,
      name: 'coinbase-charge',
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Fund the OpenRouter credit pool.
   *
   * - dryRun: simulates with real credit baseline, no API side-effects.
   * - no executor: legacy stub that records a pending funding intent.
   * - executor: full EVM charge→approve→execute→confirm→poll flow.
   */
  async fund(request: FundingRequest): Promise<FundingResponse> {
    logger.info(
      { amount: request.amountUsdc, runId: request.runId, dryRun: this.dryRun, hasExecutor: !!this.evmPaymentExecutor },
      'Processing funding request',
    );

    if (this.dryRun) {
      return this.simulateFund(request);
    }

    try {
      const result = await this.circuitBreaker.execute(async () => {
        if (!this.evmPaymentExecutor) {
          return this.executeFundStub(request);
        }
        return this.executeFundEvm(request);
      });

      return { success: true, amountFunded: request.amountUsdc, dryRun: false, ...result };
    } catch (error) {
      return this.handleError(error, request);
    }
  }

  /** Confirm a previously-created funding intent. */
  async confirmFunding(chargeId: string): Promise<FundingResponse> {
    logger.info({ chargeId }, 'Confirming funding intent');

    try {
      const credits = await this.openRouterClient.getAccountCredits();

      logger.info(
        { chargeId, totalCredits: credits.total_credits, totalUsage: credits.total_usage },
        'Funding confirmed with updated credit balance',
      );

      return {
        success: true,
        chargeId,
        amountFunded: 0,
        previousBalance: credits.total_credits,
        newBalance: credits.total_credits,
        dryRun: false,
      };
    } catch (error) {
      const message = (error as Error).message;
      logger.error({ chargeId, error: message }, 'Failed to confirm funding');
      return {
        success: false,
        chargeId,
        amountFunded: 0,
        previousBalance: 0,
        newBalance: 0,
        dryRun: false,
        error: message,
      };
    }
  }

  /** Check current OpenRouter account credits. */
  async getCurrentCredits(): Promise<{ total_credits: number; total_usage: number }> {
    return this.openRouterClient.getAccountCredits();
  }

  isAvailable(): boolean {
    return this.circuitBreaker.getState().state !== 'OPEN';
  }

  // ── Private: execution paths ────────────────────────────────────────────

  /**
   * Legacy stub — records funding intent without executing EVM payment.
   * Used when EvmPaymentExecutor is not injected.
   */
  private async executeFundStub(
    request: FundingRequest,
  ): Promise<{ previousBalance: number; newBalance: number; chargeId: string }> {
    const credits = await this.openRouterClient.getAccountCredits();

    logger.info(
      { currentCredits: credits.total_credits, totalUsage: credits.total_usage, requestedAmount: request.amountUsdc },
      'Current OpenRouter credit state',
    );

    const chargeId = `charge-${request.runId}-${Date.now()}`;

    return {
      previousBalance: credits.total_credits,
      newBalance: credits.total_credits + request.amountUsdc,
      chargeId,
    };
  }

  /**
   * Full EVM execution: create charge → gas/USDC checks → approve → execute
   * calldata → wait for receipt → poll credits until funded.
   */
  private async executeFundEvm(
    request: FundingRequest,
  ): Promise<{
    previousBalance: number;
    newBalance: number;
    chargeId: string;
    fundingTxHash: string;
  }> {
    const executor = this.evmPaymentExecutor!;
    const wallet = executor.getWalletAddress();

    // (a) Capture credit baseline for polling comparison
    const baseline = await this.openRouterClient.getAccountCredits();
    logger.info({ baselineCredits: baseline.total_credits }, 'Credit baseline captured');

    // (b) Create charge via OpenRouter
    const charge = await this.openRouterClient.createCoinbaseCharge({
      amount: request.amountUsdc,
      sender: wallet,
      chain_id: this.evmChainId,
    });
    const chargeData = charge.data;
    logger.info({ chargeId: chargeData.id, expiresAt: chargeData.expires_at }, 'Charge created');

    const contractAddr = chargeData.web3_data.transfer_intent.metadata.contract_address;
    const callData = chargeData.web3_data.transfer_intent.call_data;
    const totalUsdc = parseFloat(callData.recipient_amount) + parseFloat(callData.fee_amount);
    const totalWei = parseUnits(totalUsdc.toString(), USDC_DECIMALS);

    // (c) Gas preflight — 0.001 ETH minimum
    const ethBal = await executor.getEthBalance(wallet);
    if (ethBal < MIN_GAS_WEI) {
      throw new CoinbaseChargeError(
        `[GAS_INSUFFICIENT] Insufficient ETH for gas: ${ethBal} wei, need >= ${MIN_GAS_WEI} wei (0.001 ETH)`,
        'GAS_INSUFFICIENT',
        false,
      );
    }
    logger.info({ ethBalanceWei: ethBal.toString() }, 'Gas balance sufficient');

    // (d) USDC balance check
    const usdcBal = await executor.getUsdcBalance(wallet);
    if (usdcBal < totalWei) {
      throw new CoinbaseChargeError(
        `[INSUFFICIENT_USDC] Insufficient USDC: have ${usdcBal} wei, need ${totalWei} wei (${totalUsdc} USDC)`,
        'INSUFFICIENT_USDC',
        false,
      );
    }
    logger.info({ usdcBalanceWei: usdcBal.toString(), requiredWei: totalWei.toString() }, 'USDC balance sufficient');

    // (e) Approve USDC spending by the charge contract
    const approveHash = await executor.approveUsdc(contractAddr as `0x${string}`, totalWei);
    logger.info({ approveHash }, 'USDC approved for charge contract');

    // (f) Execute the charge calldata on-chain
    const execHash = await executor.sendTransaction(
      contractAddr as `0x${string}`,
      callData.signature as `0x${string}`,
    );
    logger.info({ execHash }, 'Charge calldata executed on-chain');

    // (g) Wait for transaction receipt
    const receipt = await executor.waitForReceipt(execHash, 120_000);
    if (receipt.status === 'reverted') {
      throw new CoinbaseChargeError(
        `[EXECUTION_REVERTED] Transaction ${execHash} reverted on-chain`,
        'EXECUTION_REVERTED',
        false,
      );
    }
    logger.info({ txStatus: receipt.status, gasUsed: receipt.gasUsed?.toString() }, 'Transaction confirmed');

    // (h) Poll credits until balance increases by the funded amount
    const expiresAtMs = new Date(chargeData.expires_at).getTime();
    const deadline = Math.min(Date.now() + POLL_TIMEOUT_MS, expiresAtMs - CHARGE_EXPIRY_BUFFER_MS);

    let newCredits = baseline.total_credits;
    let polls = 0;

    while (Date.now() < deadline) {
      await this.sleep(POLL_INTERVAL_MS);
      polls++;

      const current = await this.openRouterClient.getAccountCredits();
      newCredits = current.total_credits;

      if (newCredits >= baseline.total_credits + request.amountUsdc) {
        logger.info({ previous: baseline.total_credits, new: newCredits, polls }, 'Credits funded');
        return {
          previousBalance: baseline.total_credits,
          newBalance: newCredits,
          chargeId: chargeData.id,
          fundingTxHash: execHash,
        };
      }
    }

    // Polling exhausted — credits did not arrive
    throw new CoinbaseChargeError(
      `[POLLING_TIMEOUT] Polling timeout after ${polls} checks over ${((polls * POLL_INTERVAL_MS) / 1000).toFixed(0)}s: credits unchanged (${baseline.total_credits}).`,
      'POLLING_TIMEOUT',
      true,
    );
  }

  // ── Private: dry-run ───────────────────────────────────────────────────

  private async simulateFund(request: FundingRequest): Promise<FundingResponse> {
    let previousBalance = 0;
    try {
      const credits = await this.openRouterClient.getAccountCredits();
      previousBalance = credits.total_credits;
    } catch {
      // Use 0 baseline if credits fetch fails in dry-run
    }

    const newBalance = previousBalance + request.amountUsdc;
    const chargeId = `dry-run-charge-${request.runId}`;

    logger.info(
      { chargeId, previousBalance, newBalance, amount: request.amountUsdc },
      'Dry-run funding simulated',
    );

    return {
      success: true,
      chargeId,
      amountFunded: request.amountUsdc,
      previousBalance,
      newBalance,
      dryRun: true,
    };
  }

  // ── Private: error handling ────────────────────────────────────────────

  private handleError(error: unknown, request: FundingRequest): FundingResponse {
    let coinbaseError: CoinbaseChargeError;

    if (error instanceof CoinbaseChargeError) {
      coinbaseError = error;
    } else if (error instanceof EvmExecutionError) {
      const retryable = error.code === EvmExecutionErrorCode.NETWORK_ERROR;
      coinbaseError = new CoinbaseChargeError(
        `[${error.code}] ${error.message}`,
        error.code,
        retryable,
      );
    } else {
      const message = error instanceof Error ? error.message : String(error);
      coinbaseError = new CoinbaseChargeError(message, 'UNKNOWN_ERROR', true);
    }

    logger.error(
      { code: coinbaseError.code, message: coinbaseError.message, retryable: coinbaseError.retryable },
      'Funding failed',
    );

    return {
      success: false,
      amountFunded: request.amountUsdc,
      previousBalance: 0,
      newBalance: 0,
      dryRun: false,
      error: coinbaseError.message,
    };
  }

  // ── Private: utilities ─────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

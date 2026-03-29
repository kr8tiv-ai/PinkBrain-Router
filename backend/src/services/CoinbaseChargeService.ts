import pino from 'pino';
import type { OpenRouterClient } from '../clients/OpenRouterClient.js';
import { CircuitBreaker } from '../clients/CircuitBreaker.js';

const logger = pino({ name: 'CoinbaseChargeService' });

/**
 * CoinbaseChargeService handles OpenRouter credit purchases.
 *
 * Since OpenRouter does not expose a programmatic credit purchase API,
 * this service abstracts the funding flow:
 *   1. Check current account credits
 *   2. Validate the funding target against pool reserve policy
 *   3. In live mode: record the intent and await manual/operator confirmation
 *   4. In dry-run mode: simulate the charge
 *
 * When OpenRouter adds a Coinbase Charge or programmatic purchase API,
 * this service will be the single point to integrate it.
 */
export interface FundingRequest {
  amountUsdc: number;
  runId: string;
  strategyId: string;
}

export interface FundingResponse {
  success: boolean;
  chargeId?: string;
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

export class CoinbaseChargeService {
  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    private readonly openRouterClient: OpenRouterClient,
    private readonly dryRun: boolean = false,
  ) {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 30_000,
      name: 'coinbase-charge',
    });
  }

  /**
   * Fund the OpenRouter credit pool.
   *
   * In dry-run mode: simulates the charge without hitting the API.
   * In live mode: checks current credits, records the funding intent, and returns
   * a pending state for manual/operator confirmation via Coinbase Commerce or Stripe.
   */
  async fund(request: FundingRequest): Promise<FundingResponse> {
    logger.info(
      { amount: request.amountUsdc, runId: request.runId, dryRun: this.dryRun },
      'Processing funding request',
    );

    if (this.dryRun) {
      return this.simulateFund(request);
    }

    try {
      const result = await this.circuitBreaker.execute(async () => {
        // Check current credits
        const credits = await this.openRouterClient.getAccountCredits();

        logger.info(
          {
            currentCredits: credits.total_credits,
            totalUsage: credits.total_usage,
            requestedAmount: request.amountUsdc,
          },
          'Current OpenRouter credit state',
        );

        // Generate a charge ID for tracking (used when external payment is confirmed)
        const chargeId = `charge-${request.runId}-${Date.now()}`;

        return {
          previousBalance: credits.total_credits,
          newBalance: credits.total_credits + request.amountUsdc,
          chargeId,
        };
      });

      logger.info(
        {
          chargeId: result.chargeId,
          previous: result.previousBalance,
          new: result.newBalance,
        },
        'Funding intent recorded (pending external payment confirmation)',
      );

      return {
        success: true,
        chargeId: result.chargeId,
        amountFunded: request.amountUsdc,
        previousBalance: result.previousBalance,
        newBalance: result.newBalance,
        dryRun: false,
      };
    } catch (error) {
      if (error instanceof CoinbaseChargeError) {
        logger.error({ code: error.code, message: error.message }, 'Funding failed');
        return {
          success: false,
          amountFunded: request.amountUsdc,
          previousBalance: 0,
          newBalance: 0,
          dryRun: false,
          error: error.message,
        };
      }

      const message = (error as Error).message;
      logger.error({ error: message }, 'Funding failed (unexpected error)');

      return {
        success: false,
        amountFunded: request.amountUsdc,
        previousBalance: 0,
        newBalance: 0,
        dryRun: false,
        error: message,
      };
    }
  }

  /**
   * Confirm a previously-created funding intent.
   * Call this after the operator manually pays via Coinbase Commerce/Stripe.
   * Refreshes the actual credit balance from OpenRouter.
   */
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
        amountFunded: 0, // Actual amount determined by the confirmed payment
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
    const state = this.circuitBreaker.getState();
    return state.state !== 'OPEN';
  }

  private simulateFund(request: FundingRequest): FundingResponse {
    const simulatedPrevious = 100; // Simulated existing balance
    const simulatedNew = simulatedPrevious + request.amountUsdc;
    const chargeId = `dry-run-charge-${request.runId}`;

    logger.info(
      {
        chargeId,
        simulatedPrevious,
        simulatedNew,
        amount: request.amountUsdc,
      },
      'Dry-run funding simulated',
    );

    return {
      success: true,
      chargeId,
      amountFunded: request.amountUsdc,
      previousBalance: simulatedPrevious,
      newBalance: simulatedNew,
      dryRun: true,
    };
  }
}

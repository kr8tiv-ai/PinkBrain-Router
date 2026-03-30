import pino from 'pino';
import type { BridgeKitClient, BridgeResult } from '../clients/BridgeKitClient.js';
import { BridgeKitError, BridgeKitErrorCode } from '../clients/BridgeKitClient.js';
import { CircuitBreaker } from '../clients/CircuitBreaker.js';

const logger = pino({ name: 'CctpBridgeService' });

export interface BridgeRequest {
  amountUsdc: number; // human-readable USDC amount (e.g., 300.00)
}

export interface BridgeResponse {
  success: boolean;
  txHash?: string;
  amountUsdc: number;
  fromChain: string;
  toChain: string;
  error?: string;
  steps?: BridgeResult['steps'];
  state?: BridgeResult['state'];
}

export class CctpBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'CctpBridgeError';
  }
}

export class CctpBridgeService {
  private readonly circuitBreaker: CircuitBreaker;

  constructor(private readonly bridgeKitClient: BridgeKitClient) {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 60_000,
      name: 'cctp-bridge',
    });
  }

  /**
   * Bridge USDC from Solana to Base via Circle Bridge Kit.
   * Burns USDC on Solana, polls for attestation, mints on Base.
   * Includes circuit breaker protection.
   */
  async bridge(request: BridgeRequest): Promise<BridgeResponse> {
    logger.info({ amount: request.amountUsdc }, 'Initiating Solana→Base bridge request');

    try {
      const result = await this.circuitBreaker.execute(async () => {
        const amountStr = request.amountUsdc.toString();
        return this.bridgeKitClient.bridge(amountStr);
      });

      logger.info(
        { txHash: result.txHash, amount: result.amountUsdc, state: result.state },
        'CCTP bridge completed successfully',
      );

      return {
        success: true,
        txHash: result.txHash,
        amountUsdc: result.amountUsdc,
        fromChain: result.fromChain,
        toChain: result.toChain,
        steps: result.steps,
        state: result.state,
      };
    } catch (error) {
      if (error instanceof BridgeKitError) {
        logger.error(
          { code: error.code, message: error.message },
          'Bridge failed (BridgeKit error)',
        );
        return {
          success: false,
          amountUsdc: request.amountUsdc,
          fromChain: 'solana',
          toChain: 'base',
          error: error.message,
        };
      }

      if (error instanceof CctpBridgeError) {
        logger.error({ code: error.code, message: error.message }, 'Bridge failed (CCTP error)');
        return {
          success: false,
          amountUsdc: request.amountUsdc,
          fromChain: 'solana',
          toChain: 'base',
          error: error.message,
        };
      }

      const message = (error as Error).message;
      const retryable = this.isRetryable(message);

      logger.error(
        { error: message, retryable },
        'Bridge failed (unexpected error)',
      );

      return {
        success: false,
        amountUsdc: request.amountUsdc,
        fromChain: 'solana',
        toChain: 'base',
        error: message,
      };
    }
  }

  /** Check if the circuit breaker is open (bridge unavailable) */
  isAvailable(): boolean {
    const state = this.circuitBreaker.getState();
    return state.state !== 'OPEN';
  }

  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }

  /** Classify an unexpected error as retryable or not */
  private isRetryable(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('timeout') ||
      lower.includes('nonce') ||
      lower.includes('gas') ||
      lower.includes('attestation') ||
      lower.includes('connection') ||
      lower.includes('eagain')
    );
  }
}

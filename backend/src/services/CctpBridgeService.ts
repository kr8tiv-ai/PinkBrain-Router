import pino from 'pino';
import type { CctpClient } from '../clients/CctpClient.js';
import { CircuitBreaker } from '../clients/CircuitBreaker.js';

const logger = pino({ name: 'CctpBridgeService' });

export interface BridgeRequest {
  amountUsdc: number; // human-readable USDC amount (e.g., 300.00)
  recipientSolanaAddress: string;
}

export interface BridgeResponse {
  success: boolean;
  txHash?: string;
  amountUsdc: number;
  fromChain: string;
  toChain: string;
  recipientSolanaAddress: string;
  error?: string;
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

  constructor(private readonly cctpClient: CctpClient) {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 60_000,
      name: 'cctp-bridge',
    });
  }

  /**
   * Bridge USDC from Base to Solana via CCTP.
   * Includes pre-flight balance check, circuit breaker protection, and idempotency.
   */
  async bridge(request: BridgeRequest): Promise<BridgeResponse> {
    logger.info(
      { amount: request.amountUsdc, recipient: request.recipientSolanaAddress },
      'Initiating bridge request',
    );

    try {
      const result = await this.circuitBreaker.execute(async () => {
        // Pre-flight: check USDC balance
        const balance = await this.cctpClient.getUsdcBalance();
        const amountSmallest = this.toSmallestUnits(request.amountUsdc);

        if (balance < amountSmallest) {
          throw new CctpBridgeError(
            `Insufficient USDC balance: have ${this.fromSmallestUnits(balance)}, need ${request.amountUsdc}`,
            'INSUFFICIENT_BALANCE',
            false,
          );
        }

        // Execute the bridge
        const bridgeResult = await this.cctpClient.bridgeToSolana({
          amountUsdc: amountSmallest,
          solanaRecipient: request.recipientSolanaAddress,
        });

        return bridgeResult;
      });

      logger.info(
        { txHash: result.txHash, amount: result.amountUsdc.toString() },
        'CCTP bridge completed successfully',
      );

      return {
        success: true,
        txHash: result.txHash,
        amountUsdc: this.fromSmallestUnits(result.amountUsdc),
        fromChain: result.fromChain,
        toChain: result.toChain,
        recipientSolanaAddress: result.solanaRecipient,
      };
    } catch (error) {
      if (error instanceof CctpBridgeError) {
        logger.error({ code: error.code, message: error.message }, 'Bridge failed (CCTP error)');
        return {
          success: false,
          amountUsdc: request.amountUsdc,
          fromChain: 'base',
          toChain: 'solana',
          recipientSolanaAddress: request.recipientSolanaAddress,
          error: error.message,
        };
      }

      const message = (error as Error).message;
      const retryable = message.includes('timeout') || message.includes('nonce') || message.includes('gas');

      logger.error(
        { error: message, retryable },
        'Bridge failed (unexpected error)',
      );

      return {
        success: false,
        amountUsdc: request.amountUsdc,
        fromChain: 'base',
        toChain: 'solana',
        recipientSolanaAddress: request.recipientSolanaAddress,
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

  private toSmallestUnits(amount: number): bigint {
    // USDC has 6 decimals
    return BigInt(Math.round(amount * 1_000_000));
  }

  private fromSmallestUnits(amount: bigint): number {
    return Number(amount) / 1_000_000;
  }
}

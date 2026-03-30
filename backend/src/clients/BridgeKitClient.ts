/* v8 ignore file -- @preserve */
import pino from 'pino';
import { Connection } from '@solana/web3.js';
import {
  BridgeKit,
  BridgeChain,
  type ChainDefinition,
  type BridgeChainIdentifier,
} from '@circle-fin/bridge-kit';
import { createAdapterFromPrivateKey as createSolanaAdapter } from '@circle-fin/adapter-solana';
import { createAdapterFromPrivateKey as createViemAdapter } from '@circle-fin/adapter-viem-v2';
import { CircuitBreaker } from './CircuitBreaker.js';

const logger = pino({ name: 'BridgeKitClient' });

// ─── Error types ────────────────────────────────────────────────

export enum BridgeKitErrorCode {
  TIMEOUT = 'TIMEOUT',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  BRIDGE_FAILED = 'BRIDGE_FAILED',
  ADAPTER_ERROR = 'ADAPTER_ERROR',
}

export class BridgeKitError extends Error {
  public readonly code: BridgeKitErrorCode;
  public readonly cause?: unknown;

  constructor(code: BridgeKitErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'BridgeKitError';
    this.code = code;
    this.cause = cause;
  }
}

// ─── SDK result shapes (not exported by the SDK, inferred from runtime) ─

/** Step returned by BridgeKit.bridge() / BridgeKit.estimate() */
interface SdkBridgeStep {
  name: string;
  state: string;
  txHash?: string;
  blockchain?: string;
}

/** Result returned by BridgeKit.bridge() */
interface SdkBridgeResult {
  amount: string;
  token: 'USDC';
  state: 'pending' | 'success' | 'error';
  config?: unknown;
  provider: string;
  source: { address: string; chain: ChainDefinition };
  destination: { address: string; chain: ChainDefinition; recipientAddress?: string; useForwarder?: boolean };
  steps: SdkBridgeStep[];
}

/** Result returned by BridgeKit.estimate() */
interface SdkEstimateResult {
  token: 'USDC';
  amount: string;
  source: { address: string; chain: ChainDefinition };
  destination: { address: string; chain: ChainDefinition; recipientAddress?: string };
  gasFees: Array<{
    name: string;
    token: string;
    blockchain: string;
    fees: {
      estimatedGas: string | null;
      gasPrice: string | null;
      totalFee: string | null;
    } | null;
  }>;
  fees: Array<{
    name: string;
    token: string;
    amount: string | null;
  }>;
}

// ─── Normalized result types ─────────────────────────────────────

export interface BridgeStep {
  name: string;
  state: string;
  txHash?: string;
  blockchain?: string;
}

export interface BridgeResult {
  txHash: string;
  amountUsdc: number;
  fromChain: string;
  toChain: string;
  state: string;
  steps: BridgeStep[];
  rawResult?: unknown;
}

export interface BridgeEstimate {
  token: string;
  amount: string;
  gasFees: Array<{
    name: string;
    token: string;
    blockchain: string;
    fees: {
      estimatedGas: string | null;
      gasPrice: string | null;
      totalFee: string | null;
    } | null;
  }>;
  fees: Array<{
    name: string;
    token: string;
    amount: string | null;
  }>;
}

// ─── Supported chains ───────────────────────────────────────────

const SUPPORTED_CHAINS = new Set<string>([
  BridgeChain.Solana,
  BridgeChain.Base,
  BridgeChain.Solana_Devnet,
  BridgeChain.Base_Sepolia,
]);

// ─── Client ─────────────────────────────────────────────────────

export interface BridgeKitClientConfig {
  solanaRpcUrl: string;
  solanaPrivateKey: string;
  evmPrivateKey: string;
  sourceChain?: string;
  destinationChain?: string;
  timeoutMs?: number;
  circuitBreaker?: CircuitBreaker;
}

export class BridgeKitClient {
  private readonly kit: BridgeKit;
  private readonly solanaRpcUrl: string;
  private readonly solanaPrivateKey: string;
  private readonly evmPrivateKey: string;
  private readonly sourceChain: string;
  private readonly destinationChain: string;
  private readonly timeoutMs: number;
  private readonly circuitBreaker?: CircuitBreaker;

  constructor(config: BridgeKitClientConfig) {
    this.solanaRpcUrl = config.solanaRpcUrl;
    this.solanaPrivateKey = config.solanaPrivateKey;
    this.evmPrivateKey = config.evmPrivateKey;
    this.sourceChain = config.sourceChain ?? BridgeChain.Solana;
    this.destinationChain = config.destinationChain ?? BridgeChain.Base;
    this.timeoutMs = config.timeoutMs ?? 1_800_000; // 30 min
    this.circuitBreaker = config.circuitBreaker;

    if (!SUPPORTED_CHAINS.has(this.sourceChain)) {
      throw new BridgeKitError(
        BridgeKitErrorCode.ADAPTER_ERROR,
        `Unsupported source chain: "${this.sourceChain}". Supported: ${[...SUPPORTED_CHAINS].join(', ')}`,
      );
    }
    if (!SUPPORTED_CHAINS.has(this.destinationChain)) {
      throw new BridgeKitError(
        BridgeKitErrorCode.ADAPTER_ERROR,
        `Unsupported destination chain: "${this.destinationChain}". Supported: ${[...SUPPORTED_CHAINS].join(', ')}`,
      );
    }

    this.kit = new BridgeKit();

    logger.info(
      { source: this.sourceChain, destination: this.destinationChain, timeoutMs: this.timeoutMs },
      'BridgeKitClient initialized',
    );
  }

  /**
   * Create the Solana adapter from stored config.
   * Instantiated per-call so fresh Connection state is used each time.
   */
  private createSolanaAdapter() {
    const connection = new Connection(this.solanaRpcUrl, 'confirmed');
    return createSolanaAdapter({
      privateKey: this.solanaPrivateKey,
      connection,
    });
  }

  /**
   * Create the EVM (viem) adapter from stored config.
   * Uses default RPCs from @circle-fin/bridge-kit chain definitions.
   */
  private createEvmAdapter() {
    return createViemAdapter({
      privateKey: this.evmPrivateKey,
    });
  }

  /**
   * Bridge USDC from source chain to destination chain via Circle Bridge Kit.
   *
   * @param amountUsdc - Human-readable USDC amount as a string (e.g., "10.50")
   * @returns Normalized BridgeResult with txHash, amount, chains, and step details
   */
  async bridge(amountUsdc: string): Promise<BridgeResult> {
    logger.info({ amount: amountUsdc, from: this.sourceChain, to: this.destinationChain }, 'Initiating bridge');

    const execute = async (): Promise<BridgeResult> => {
      const solanaAdapter = this.createSolanaAdapter();
      const evmAdapter = this.createEvmAdapter();

      const sourceChainId = this.sourceChain as BridgeChainIdentifier;
      const destChainId = this.destinationChain as BridgeChainIdentifier;

      logger.info({ amount: amountUsdc }, 'Calling BridgeKit.bridge() — this may take several minutes');

      const sdkResult: SdkBridgeResult = await this.withTimeout(
        this.kit.bridge({
          from: { adapter: solanaAdapter, chain: sourceChainId },
          to: { adapter: evmAdapter, chain: destChainId },
          amount: amountUsdc,
        }),
      ) as SdkBridgeResult;

      logger.info(
        { state: sdkResult.state, stepCount: sdkResult.steps.length, provider: sdkResult.provider },
        'BridgeKit.bridge() completed',
      );

      return this.normalizeResult(sdkResult);
    };

    if (this.circuitBreaker) {
      return this.circuitBreaker.execute(execute);
    }
    return execute();
  }

  /**
   * Estimate bridge fees and gas costs without executing.
   *
   * @param amountUsdc - Human-readable USDC amount as a string
   * @returns BridgeEstimate with fee breakdown
   */
  async estimateBridge(amountUsdc: string): Promise<BridgeEstimate> {
    logger.info({ amount: amountUsdc, from: this.sourceChain, to: this.destinationChain }, 'Estimating bridge');

    const solanaAdapter = this.createSolanaAdapter();
    const evmAdapter = this.createEvmAdapter();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkEstimate = await this.withTimeout(
      this.kit.estimate({
        from: { adapter: solanaAdapter, chain: this.sourceChain as BridgeChainIdentifier },
        to: { adapter: evmAdapter, chain: this.destinationChain as BridgeChainIdentifier },
        amount: amountUsdc,
      }),
    ) as any as SdkEstimateResult;

    logger.info({ gasFeeCount: sdkEstimate.gasFees.length, feeCount: sdkEstimate.fees.length }, 'Bridge estimate complete');

    return {
      token: sdkEstimate.token,
      amount: sdkEstimate.amount,
      gasFees: sdkEstimate.gasFees.map((gf) => ({
        name: gf.name,
        token: gf.token,
        blockchain: gf.blockchain,
        fees: gf.fees
          ? {
              estimatedGas: gf.fees.estimatedGas,
              gasPrice: gf.fees.gasPrice,
              totalFee: gf.fees.totalFee,
            }
          : null,
      })),
      fees: sdkEstimate.fees.map((f) => ({
        name: f.name,
        token: f.token,
        amount: f.amount,
      })),
    };
  }

  /**
   * Retry a failed bridge operation.
   *
   * @param result - The BridgeResult from a previous (failed) bridge call that includes rawResult
   */
  async retryBridge(result: BridgeResult): Promise<BridgeResult> {
    if (!result.rawResult) {
      throw new BridgeKitError(
        BridgeKitErrorCode.BRIDGE_FAILED,
        'Cannot retry: original raw SDK result not available',
      );
    }

    logger.info({ state: result.state, from: this.sourceChain, to: this.destinationChain }, 'Retrying bridge');

    const solanaAdapter = this.createSolanaAdapter();
    const evmAdapter = this.createEvmAdapter();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkResult: SdkBridgeResult = await this.withTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.kit.retry(result.rawResult as any, {
        from: solanaAdapter,
        to: evmAdapter,
      }),
    ) as any as SdkBridgeResult;

    logger.info({ state: sdkResult.state }, 'Bridge retry completed');

    return this.normalizeResult(sdkResult);
  }

  // ─── Private helpers ──────────────────────────────────────────

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    const timer = setTimeout(() => {
      throw new BridgeKitError(
        BridgeKitErrorCode.TIMEOUT,
        `Bridge operation timed out after ${this.timeoutMs}ms`,
      );
    }, this.timeoutMs);

    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new BridgeKitError(
                BridgeKitErrorCode.TIMEOUT,
                `Bridge operation timed out after ${this.timeoutMs}ms`,
              ),
            );
          }, this.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeResult(sdkResult: SdkBridgeResult): BridgeResult {
    // Extract the first successful step's txHash as the primary hash
    const firstSuccessStep = sdkResult.steps.find((s: SdkBridgeStep) => s.state === 'success');
    const txHash = firstSuccessStep?.txHash ?? 'unknown';

    // Log each step for observability
    for (const step of sdkResult.steps) {
      logger.info(
        { name: step.name, state: step.state, txHash: step.txHash },
        'Bridge step completed',
      );
    }

    return {
      txHash,
      amountUsdc: parseFloat(sdkResult.amount),
      fromChain: sdkResult.source.chain.name,
      toChain: sdkResult.destination.chain.name,
      state: sdkResult.state,
      steps: sdkResult.steps.map((s: SdkBridgeStep) => ({
        name: s.name,
        state: s.state,
        txHash: s.txHash ?? undefined,
        blockchain: s.blockchain ?? undefined,
      })),
      rawResult: sdkResult,
    };
  }
}

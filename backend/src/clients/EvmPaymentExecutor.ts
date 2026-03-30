import pino from 'pino';
import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type TransactionReceipt,
  type Hash,
  type Address,
} from 'viem';
import { privateKeyToAccount, type Account } from 'viem/accounts';
import { base } from 'viem/chains';
import { BASE_USDC } from '../constants/addresses.js';

const logger = pino({ name: 'EvmPaymentExecutor' });

// ─── Error types ────────────────────────────────────────────────

export enum EvmExecutionErrorCode {
  GAS_INSUFFICIENT = 'GAS_INSUFFICIENT',
  APPROVAL_FAILED = 'APPROVAL_FAILED',
  EXECUTION_REVERTED = 'EXECUTION_REVERTED',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
}

export class EvmExecutionError extends Error {
  public readonly code: EvmExecutionErrorCode;
  public readonly cause?: unknown;

  constructor(code: EvmExecutionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'EvmExecutionError';
    this.code = code;
    this.cause = cause;
  }
}

// ─── ERC-20 ABI fragment ──────────────────────────────────────
// USDC on Base uses 6 decimals (not 18 like most ERC-20 defaults).
// This executor works in wei (smallest unit, bigint) — callers handle
// human-readable conversions via parseUnits / formatUnits.

const usdcAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ─── Config ────────────────────────────────────────────────────

const DEFAULT_GAS_THRESHOLD_WEI = 100_000_000_000n; // 0.0001 ETH — rough minimum for ERC-20 txs
const DEFAULT_RECEIPT_TIMEOUT_MS = 120_000;

// ─── Client ────────────────────────────────────────────────────

export interface EvmPaymentExecutorConfig {
  privateKey: string;
  chainId: number;
  rpcUrl?: string;
}

export class EvmPaymentExecutor {
  private readonly walletClient: WalletClient;
  private readonly publicClient: PublicClient;
  private readonly account: Account;
  private readonly chain: typeof base;
  private readonly gasThresholdWei: bigint;

  constructor(config: EvmPaymentExecutorConfig) {
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);

    // Use built-in base chain for chainId 8453, defineChain for others
    if (config.chainId === 8453) {
      this.chain = base;
    } else {
      this.chain = base; // default to base; defineChain can be added for future chains
    }

    const rpcUrl = config.rpcUrl ?? this.chain.rpcUrls.default.http[0];

    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(rpcUrl),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(rpcUrl),
    }) as any as PublicClient;

    this.gasThresholdWei = DEFAULT_GAS_THRESHOLD_WEI;

    logger.info(
      { address: this.account.address, chainId: config.chainId },
      'EvmPaymentExecutor initialized',
    );
  }

  /** Derived wallet address */
  getWalletAddress(): Address {
    return this.account.address;
  }

  /** Read USDC balance of any address (6-decimal token on Base) */
  async getUsdcBalance(address: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: BASE_USDC as Address,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [address],
    });
  }

  /** Read native ETH balance for gas checks */
  async getEthBalance(address: Address): Promise<bigint> {
    return this.publicClient.getBalance({ address });
  }

  /** Approve USDC spending by a spender. Returns approval tx hash. */
  async approveUsdc(spender: Address, amountWei: bigint): Promise<Hash> {
    // Gas check before submitting
    const ethBalance = await this.publicClient.getBalance({
      address: this.account.address,
    });

    if (ethBalance < this.gasThresholdWei) {
      throw new EvmExecutionError(
        EvmExecutionErrorCode.GAS_INSUFFICIENT,
        `Insufficient ETH for gas: have ${ethBalance} wei, need at least ${this.gasThresholdWei} wei`,
      );
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: BASE_USDC as Address,
        abi: usdcAbi,
        functionName: 'approve',
        args: [spender, amountWei],
        account: this.account,
        chain: this.chain,
      });

      logger.info(
        { spender, amount: amountWei.toString(), hash },
        'USDC approval submitted',
      );

      return hash;
    } catch (err: unknown) {
      throw wrapViemError(err, EvmExecutionErrorCode.APPROVAL_FAILED);
    }
  }

  /** Submit arbitrary calldata to a contract. Returns tx hash. */
  async sendTransaction(to: Address, data: `0x${string}`): Promise<Hash> {
    // Gas check before submitting
    const ethBalance = await this.publicClient.getBalance({
      address: this.account.address,
    });

    if (ethBalance < this.gasThresholdWei) {
      throw new EvmExecutionError(
        EvmExecutionErrorCode.GAS_INSUFFICIENT,
        `Insufficient ETH for gas: have ${ethBalance} wei, need at least ${this.gasThresholdWei} wei`,
      );
    }

    try {
      const hash = await this.walletClient.sendTransaction({
        to,
        data,
        account: this.account,
        chain: this.chain,
      });

      logger.info({ to, hash }, 'Calldata transaction submitted');

      return hash;
    } catch (err: unknown) {
      throw wrapViemError(err, EvmExecutionErrorCode.EXECUTION_REVERTED);
    }
  }

  /** Wait for transaction receipt with configurable timeout. */
  async waitForReceipt(
    txHash: Hash,
    timeoutMs: number = DEFAULT_RECEIPT_TIMEOUT_MS,
  ): Promise<TransactionReceipt> {
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: timeoutMs,
      });

      logger.info(
        { status: receipt.status, gasUsed: receipt.gasUsed.toString(), hash: txHash },
        'Transaction receipt confirmed',
      );

      return receipt;
    } catch (err: unknown) {
      // viem throws WaitForTransactionReceiptTimeoutError on timeout
      if (err instanceof Error && err.name === 'WaitForTransactionReceiptTimeoutError') {
        throw new EvmExecutionError(
          EvmExecutionErrorCode.TIMEOUT,
          `Transaction ${txHash} not confirmed within ${timeoutMs}ms`,
          err,
        );
      }
      throw wrapViemError(err, EvmExecutionErrorCode.NETWORK_ERROR);
    }
  }
}

// ─── Error wrapping ────────────────────────────────────────────

function wrapViemError(
  err: unknown,
  fallbackCode: EvmExecutionErrorCode,
): EvmExecutionError {
  const message = err instanceof Error ? err.message : String(err);

  // Map known viem error types to specific codes
  if (err instanceof Error) {
    if (err.name === 'TransactionExecutionError') {
      return new EvmExecutionError(
        EvmExecutionErrorCode.EXECUTION_REVERTED,
        `Transaction reverted: ${message}`,
        err,
      );
    }
    if (
      err.name === 'ChainDisconnectedError' ||
      err.name === 'ClientChainNotConfiguredError' ||
      err.name === 'TransactionNotFoundError'
    ) {
      return new EvmExecutionError(
        EvmExecutionErrorCode.NETWORK_ERROR,
        `Network error (${err.name}): ${message}`,
        err,
      );
    }
  }

  return new EvmExecutionError(fallbackCode, message, err);
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── vi.hoisted: create mock function stubs above the hoist boundary ──
// These are available to both the vi.mock factories and the test body.
const {
  mockWriteContract,
  mockSendTransaction,
  mockReadContract,
  mockGetBalance,
  mockWaitForTransactionReceipt,
  mockCreateWalletClient,
  mockCreatePublicClient,
} = vi.hoisted(() => ({
  mockWriteContract: vi.fn(),
  mockSendTransaction: vi.fn(),
  mockReadContract: vi.fn(),
  mockGetBalance: vi.fn(),
  mockWaitForTransactionReceipt: vi.fn(),
  mockCreateWalletClient: vi.fn(),
  mockCreatePublicClient: vi.fn(),
}));

// ─── vi.mock factories (auto-hoisted by vitest) ────────────────────

vi.mock('viem/chains', () => ({
  base: {
    id: 8453,
    name: 'Base',
    network: 'base',
    nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://mainnet.base.org'] } },
  },
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createWalletClient: mockCreateWalletClient,
    createPublicClient: mockCreatePublicClient,
    http: vi.fn((url: string) => ({ type: 'http', url })),
  };
});

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn((key: string) => ({
    address: '0xTestWalletAddress1234567890abcdef' as `0x${string}`,
    type: 'local' as const,
    privateKey: key,
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
    signTypedData: vi.fn(),
    source: 'privateKey' as const,
  })),
}));

// pino mock — both default and named export (K022)
vi.mock('pino', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  return {
    default: vi.fn(() => mockLogger),
    pino: vi.fn(() => mockLogger),
  };
});

// ─── Import AFTER mocks are set up ─────────────────────────────────
import {
  EvmPaymentExecutor,
  EvmExecutionError,
  EvmExecutionErrorCode,
} from '../../src/clients/EvmPaymentExecutor.js';

// ─── Helpers ───────────────────────────────────────────────────

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TEST_WALLET = '0xTestWalletAddress1234567890abcdef' as `0x${string}`;
const TEST_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`;
const SPENDER = '0xSpender1234567890abcdef1234567890abcdef12' as `0x${string}`;

function setupMocks() {
  mockCreateWalletClient.mockReturnValue({
    writeContract: mockWriteContract,
    sendTransaction: mockSendTransaction,
  });
  mockCreatePublicClient.mockReturnValue({
    readContract: mockReadContract,
    getBalance: mockGetBalance,
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
  });
}

function createExecutor(chainId = 8453, rpcUrl?: string) {
  return new EvmPaymentExecutor({
    privateKey: TEST_PRIVATE_KEY,
    chainId,
    rpcUrl,
  });
}

// ─── Tests ─────────────────────────────────────────────────────

describe('EvmPaymentExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe('constructor', () => {
    it('derives correct wallet address from private key', () => {
      const executor = createExecutor();
      expect(executor.getWalletAddress()).toBe(TEST_WALLET);
    });

    it('creates wallet client with base chain and default RPC', () => {
      createExecutor();
      expect(mockCreateWalletClient).toHaveBeenCalledWith(
        expect.objectContaining({
          chain: expect.objectContaining({ id: 8453 }),
          transport: expect.objectContaining({ url: 'https://mainnet.base.org' }),
        }),
      );
    });

    it('uses custom RPC URL when provided', () => {
      createExecutor(8453, 'https://custom.base.rpc');
      expect(mockCreateWalletClient).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({ url: 'https://custom.base.rpc' }),
        }),
      );
    });

    it('creates public client with base chain', () => {
      createExecutor();
      expect(mockCreatePublicClient).toHaveBeenCalledWith(
        expect.objectContaining({
          chain: expect.objectContaining({ id: 8453 }),
        }),
      );
    });
  });

  describe('approveUsdc', () => {
    it('calls writeContract with correct USDC address, spender, and amount', async () => {
      mockWriteContract.mockResolvedValue(TEST_HASH);
      mockGetBalance.mockResolvedValue(1_000_000_000_000n); // 1 ETH — plenty of gas

      const executor = createExecutor();
      const amountWei = 1_000_000n; // 1 USDC

      const hash = await executor.approveUsdc(SPENDER, amountWei);

      expect(hash).toBe(TEST_HASH);
      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: TEST_USDC,
          functionName: 'approve',
          args: [SPENDER, amountWei],
        }),
      );
    });

    it('throws GAS_INSUFFICIENT when ETH balance below threshold', async () => {
      mockGetBalance.mockResolvedValue(50_000_000_000n); // below 0.0001 ETH threshold

      const executor = createExecutor();

      await expect(executor.approveUsdc(SPENDER, 1_000_000n)).rejects.toThrow(EvmExecutionError);
      await expect(executor.approveUsdc(SPENDER, 1_000_000n)).rejects.toMatchObject({
        code: EvmExecutionErrorCode.GAS_INSUFFICIENT,
      });
    });

    it('throws APPROVAL_FAILED when writeContract reverts', async () => {
      mockGetBalance.mockResolvedValue(1_000_000_000_000n);
      const revertError = new Error('execution reverted');
      revertError.name = 'TransactionExecutionError';
      mockWriteContract.mockRejectedValue(revertError);

      const executor = createExecutor();

      await expect(executor.approveUsdc(SPENDER, 1_000_000n)).rejects.toThrow(EvmExecutionError);
      await expect(executor.approveUsdc(SPENDER, 1_000_000n)).rejects.toMatchObject({
        code: EvmExecutionErrorCode.EXECUTION_REVERTED,
      });
    });
  });

  describe('sendTransaction', () => {
    it('calls sendTransaction with correct to and data', async () => {
      mockSendTransaction.mockResolvedValue(TEST_HASH);
      mockGetBalance.mockResolvedValue(1_000_000_000_000n);

      const executor = createExecutor();
      const calldata = '0xdeadbeef' as `0x${string}`;
      const to = '0xContract1234567890abcdef1234567890abcdef12' as `0x${string}`;

      const hash = await executor.sendTransaction(to, calldata);

      expect(hash).toBe(TEST_HASH);
      expect(mockSendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          to,
          data: calldata,
        }),
      );
    });

    it('throws GAS_INSUFFICIENT when ETH balance below threshold', async () => {
      mockGetBalance.mockResolvedValue(50_000_000_000n);

      const executor = createExecutor();

      await expect(
        executor.sendTransaction(SPENDER, '0x00' as `0x${string}`),
      ).rejects.toMatchObject({
        code: EvmExecutionErrorCode.GAS_INSUFFICIENT,
      });
    });

    it('throws EXECUTION_REVERTED on transaction revert', async () => {
      mockGetBalance.mockResolvedValue(1_000_000_000_000n);
      const revertError = new Error('execution reverted: custom reason');
      revertError.name = 'TransactionExecutionError';
      mockSendTransaction.mockRejectedValue(revertError);

      const executor = createExecutor();

      await expect(
        executor.sendTransaction(SPENDER, '0x00' as `0x${string}`),
      ).rejects.toMatchObject({
        code: EvmExecutionErrorCode.EXECUTION_REVERTED,
      });
    });
  });

  describe('waitForReceipt', () => {
    it('calls waitForTransactionReceipt with hash and returns receipt', async () => {
      const mockReceipt = {
        type: 'eip1559',
        status: 'success',
        hash: TEST_HASH,
        gasUsed: 65_000n,
        blockNumber: 12345n,
        blockHash: '0xblock' as `0x${string}`,
        transactionIndex: 0,
        from: TEST_WALLET,
        to: SPENDER,
        logs: [],
      };
      mockWaitForTransactionReceipt.mockResolvedValue(mockReceipt);

      const executor = createExecutor();
      const receipt = await executor.waitForReceipt(TEST_HASH);

      expect(receipt).toEqual(mockReceipt);
      expect(mockWaitForTransactionReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ hash: TEST_HASH, timeout: 120_000 }),
      );
    });

    it('uses custom timeout when provided', async () => {
      mockWaitForTransactionReceipt.mockResolvedValue({
        status: 'success',
        hash: TEST_HASH,
        gasUsed: 65_000n,
      } as any);

      const executor = createExecutor();
      await executor.waitForReceipt(TEST_HASH, 60_000);

      expect(mockWaitForTransactionReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 60_000 }),
      );
    });

    it('throws TIMEOUT on WaitForTransactionReceiptTimeoutError', async () => {
      const timeoutError = new Error('timed out');
      timeoutError.name = 'WaitForTransactionReceiptTimeoutError';
      mockWaitForTransactionReceipt.mockRejectedValue(timeoutError);

      const executor = createExecutor();

      await expect(executor.waitForReceipt(TEST_HASH)).rejects.toMatchObject({
        code: EvmExecutionErrorCode.TIMEOUT,
      });
    });

    it('throws NETWORK_ERROR on chain disconnect', async () => {
      const networkError = new Error('chain disconnected');
      networkError.name = 'ChainDisconnectedError';
      mockWaitForTransactionReceipt.mockRejectedValue(networkError);

      const executor = createExecutor();

      await expect(executor.waitForReceipt(TEST_HASH)).rejects.toMatchObject({
        code: EvmExecutionErrorCode.NETWORK_ERROR,
      });
    });
  });

  describe('getUsdcBalance', () => {
    it('calls readContract with correct USDC address and account', async () => {
      mockReadContract.mockResolvedValue(5_000_000n); // 5 USDC

      const executor = createExecutor();
      const balance = await executor.getUsdcBalance(TEST_WALLET);

      expect(balance).toBe(5_000_000n);
      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: TEST_USDC,
          functionName: 'balanceOf',
          args: [TEST_WALLET],
        }),
      );
    });
  });

  describe('getEthBalance', () => {
    it('calls getBalance with correct address', async () => {
      mockGetBalance.mockResolvedValue(2_000_000_000_000n); // 0.002 ETH

      const executor = createExecutor();
      const balance = await executor.getEthBalance(TEST_WALLET);

      expect(balance).toBe(2_000_000_000_000n);
      expect(mockGetBalance).toHaveBeenCalledWith({ address: TEST_WALLET });
    });
  });

  describe('error wrapping', () => {
    it('maps TransactionExecutionError to EXECUTION_REVERTED', async () => {
      mockGetBalance.mockResolvedValue(1_000_000_000_000n);
      const err = new Error('execution reverted');
      err.name = 'TransactionExecutionError';
      mockWriteContract.mockRejectedValue(err);

      const executor = createExecutor();

      try {
        await executor.approveUsdc(SPENDER, 1n);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(EvmExecutionError);
        expect((e as EvmExecutionError).code).toBe(EvmExecutionErrorCode.EXECUTION_REVERTED);
        expect((e as EvmExecutionError).cause).toBe(err);
      }
    });

    it('maps ChainDisconnectedError to NETWORK_ERROR', async () => {
      mockGetBalance.mockResolvedValue(1_000_000_000_000n);
      const err = new Error('chain disconnected');
      err.name = 'ChainDisconnectedError';
      mockWriteContract.mockRejectedValue(err);

      const executor = createExecutor();

      try {
        await executor.approveUsdc(SPENDER, 1n);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(EvmExecutionError);
        expect((e as EvmExecutionError).code).toBe(EvmExecutionErrorCode.NETWORK_ERROR);
      }
    });

    it('maps ClientChainNotConfiguredError to NETWORK_ERROR', async () => {
      mockGetBalance.mockResolvedValue(1_000_000_000_000n);
      const err = new Error('chain not configured');
      err.name = 'ClientChainNotConfiguredError';
      mockWriteContract.mockRejectedValue(err);

      const executor = createExecutor();

      try {
        await executor.approveUsdc(SPENDER, 1n);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(EvmExecutionError);
        expect((e as EvmExecutionError).code).toBe(EvmExecutionErrorCode.NETWORK_ERROR);
      }
    });

    it('wraps unknown errors with fallback code', async () => {
      mockGetBalance.mockResolvedValue(1_000_000_000_000n);
      mockWriteContract.mockRejectedValue(new Error('some unknown error'));

      const executor = createExecutor();

      try {
        await executor.approveUsdc(SPENDER, 1n);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(EvmExecutionError);
        // Unknown error during approve falls back to APPROVAL_FAILED
        expect((e as EvmExecutionError).code).toBe(EvmExecutionErrorCode.APPROVAL_FAILED);
      }
    });

    it('preserves string cause when error is not an Error instance', async () => {
      mockGetBalance.mockResolvedValue(1_000_000_000_000n);
      mockWriteContract.mockRejectedValue('string error');

      const executor = createExecutor();

      try {
        await executor.approveUsdc(SPENDER, 1n);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(EvmExecutionError);
        expect((e as EvmExecutionError).cause).toBe('string error');
      }
    });
  });
});

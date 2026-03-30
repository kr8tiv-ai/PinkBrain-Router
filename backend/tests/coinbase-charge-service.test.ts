import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseUnits } from 'viem';
import {
  CoinbaseChargeService,
  CoinbaseChargeError,
  type CoinbaseChargeServiceConfig,
} from '../src/services/CoinbaseChargeService.js';
import {
  EvmExecutionError,
  EvmExecutionErrorCode,
} from '../src/clients/EvmPaymentExecutor.js';
import type { EvmPaymentExecutor } from '../src/clients/EvmPaymentExecutor.js';
import type { OpenRouterClient } from '../src/clients/OpenRouterClient.js';

// ─── Pino mock ─────────────────────────────────────────────────────────────

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ─── Mock factories ────────────────────────────────────────────────────────

function createMockOpenRouterClient(overrides: Partial<OpenRouterClient> = {}) {
  return {
    getAccountCredits: vi.fn().mockResolvedValue({ total_credits: 100, total_usage: 20 }),
    createCoinbaseCharge: vi.fn().mockResolvedValue(mockChargeResponse()),
    ...overrides,
  } as unknown as OpenRouterClient;
}

function mockChargeResponse(overrides: Record<string, unknown> = {}) {
  const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  return {
    data: {
      id: 'charge-test-123',
      created_at: new Date().toISOString(),
      expires_at: future,
      web3_data: {
        transfer_intent: {
          call_data: {
            deadline: future,
            fee_amount: '0.5',
            id: 'call-123',
            operator: '0x0000000000000000000000000000000000000001',
            prefix: '0x',
            recipient: '0x0000000000000000000000000000000000000002',
            recipient_amount: '10',
            recipient_currency: 'USDC',
            refund_destination: '0x0000000000000000000000000000000000000003',
            signature: '0xdeadbeef',
          },
          metadata: {
            chain_id: 8453,
            contract_address: '0x0000000000000000000000000000000000000004',
            sender: '0x0000000000000000000000000000000000000005',
          },
        },
        metadata: {},
      },
      ...overrides,
    },
  };
}

function createMockExecutor(overrides: Partial<EvmPaymentExecutor> = {}) {
  return {
    getWalletAddress: vi.fn().mockReturnValue('0x00000000000000000000000000000000000000aa' as `0x${string}`),
    getEthBalance: vi.fn().mockResolvedValue(2_000_000_000_000_000n), // 0.002 ETH
    getUsdcBalance: vi.fn().mockResolvedValue(20_000_000n), // 20 USDC (6 decimals)
    approveUsdc: vi.fn().mockResolvedValue('0x00000000000000000000000000000000000000a1' as `0x${string}`),
    sendTransaction: vi.fn().mockResolvedValue('0x00000000000000000000000000000000000000b1' as `0x${string}`),
    waitForReceipt: vi.fn().mockResolvedValue({
      status: 'success',
      gasUsed: 21000n,
      blockNumber: 123456n,
      transactionHash: '0x00000000000000000000000000000000000000b1',
    }),
    ...overrides,
  } as unknown as EvmPaymentExecutor;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('CoinbaseChargeService', () => {
  // ── confirmFunding ─────────────────────────────────────────────────────

  describe('confirmFunding', () => {
    it('returns success with current credit balance when funding is confirmed', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockResolvedValue({ total_credits: 500, total_usage: 20 }),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      const result = await service.confirmFunding('charge-run-123');

      expect(result.success).toBe(true);
      expect(result.chargeId).toBe('charge-run-123');
      expect(result.previousBalance).toBe(500);
      expect(result.newBalance).toBe(500);
      expect(mockClient.getAccountCredits).toHaveBeenCalled();
    });

    it('returns failure when getAccountCredits throws', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      const result = await service.confirmFunding('charge-run-456');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  // ── getCurrentCredits ───────────────────────────────────────────────────

  describe('getCurrentCredits', () => {
    it('delegates to openRouterClient.getAccountCredits', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockResolvedValue({ total_credits: 1000, total_usage: 300 }),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      const credits = await service.getCurrentCredits();

      expect(credits).toEqual({ total_credits: 1000, total_usage: 300 });
      expect(mockClient.getAccountCredits).toHaveBeenCalledTimes(1);
    });
  });

  // ── isAvailable ─────────────────────────────────────────────────────────

  describe('isAvailable', () => {
    it('returns true when circuit breaker is closed', () => {
      const mockClient = createMockOpenRouterClient();
      const service = new CoinbaseChargeService(mockClient, false);

      expect(service.isAvailable()).toBe(true);
    });

    it('returns false after 3 consecutive failures', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockRejectedValue(new Error('fail')),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      for (let i = 0; i < 3; i++) {
        await service.fund({ amountUsdc: 100, runId: `run-${i}`, strategyId: 's1' }).catch(() => {});
      }

      expect(service.isAvailable()).toBe(false);
    });
  });

  // ── fund (backward compat — no executor) ────────────────────────────────

  describe('fund (backward compat — no executor)', () => {
    it('catches CoinbaseChargeError and returns failure', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockImplementation(() => {
          throw new CoinbaseChargeError('Insufficient funds', 'INSUFFICIENT_FUNDS', false);
        }),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      const result = await service.fund({ amountUsdc: 100, runId: 'r1', strategyId: 's1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient funds');
      expect(result.amountFunded).toBe(100);
    });

    it('catches unexpected errors and returns failure', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockRejectedValue(new Error('Something broke')),
      });
      const service = new CoinbaseChargeService(mockClient, false);

      const result = await service.fund({ amountUsdc: 200, runId: 'r2', strategyId: 's2' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Something broke');
      expect(result.previousBalance).toBe(0);
    });

    it('records funding intent via stub path when no executor is present', async () => {
      const mockClient = createMockOpenRouterClient();
      const service = new CoinbaseChargeService(mockClient, false);

      const result = await service.fund({ amountUsdc: 50, runId: 'r3', strategyId: 's3' });

      expect(result.success).toBe(true);
      expect(result.chargeId).toMatch(/^charge-r3-/);
      expect(result.previousBalance).toBe(100);
      expect(result.newBalance).toBe(150);
      expect(result.amountFunded).toBe(50);
      expect(result.dryRun).toBe(false);
      expect(result.fundingTxHash).toBeUndefined();
    });

    it('constructor accepts bare boolean for backward compatibility', async () => {
      const mockClient = createMockOpenRouterClient();
      const service = new CoinbaseChargeService(mockClient, true);

      const result = await service.fund({ amountUsdc: 10, runId: 'r4', strategyId: 's4' });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
    });

    it('constructor accepts config object', async () => {
      const mockClient = createMockOpenRouterClient();
      const config: CoinbaseChargeServiceConfig = { dryRun: true };
      const service = new CoinbaseChargeService(mockClient, config);

      const result = await service.fund({ amountUsdc: 10, runId: 'r5', strategyId: 's5' });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
    });
  });

  // ── fund (EVM execution) ────────────────────────────────────────────────

  describe('fund (EVM execution)', () => {
    const baseRequest = { amountUsdc: 10, runId: 'evm-run-1', strategyId: 's-evm' };
    const APPROVE_AMOUNT = parseUnits('10.5', 6); // recipient_amount(10) + fee_amount(0.5)

    it('executes full charge→approve→execute→confirm→poll flow', async () => {
      vi.useFakeTimers();

      let creditsCallCount = 0;
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockImplementation(async () => {
          creditsCallCount++;
          if (creditsCallCount <= 1) return { total_credits: 100, total_usage: 20 };
          return { total_credits: 110, total_usage: 20 }; // +10 = amountUsdc
        }),
      });
      const mockExecutor = createMockExecutor();
      const service = new CoinbaseChargeService(mockClient, {
        evmPaymentExecutor: mockExecutor,
        evmChainId: 8453,
      });

      const fundPromise = service.fund(baseRequest);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await fundPromise;

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(false);
      expect(result.fundingTxHash).toBe('0x00000000000000000000000000000000000000b1');
      expect(result.chargeId).toBe('charge-test-123');
      expect(result.previousBalance).toBe(100);
      expect(result.newBalance).toBe(110);
      expect(result.amountFunded).toBe(10);

      // Verify the full call chain
      expect(mockClient.createCoinbaseCharge).toHaveBeenCalledWith({
        amount: 10,
        sender: '0x00000000000000000000000000000000000000aa',
        chain_id: 8453,
      });
      expect(mockExecutor.getEthBalance).toHaveBeenCalledWith('0x00000000000000000000000000000000000000aa');
      expect(mockExecutor.getUsdcBalance).toHaveBeenCalledWith('0x00000000000000000000000000000000000000aa');
      expect(mockExecutor.approveUsdc).toHaveBeenCalledWith(
        '0x0000000000000000000000000000000000000004',
        APPROVE_AMOUNT,
      );
      expect(mockExecutor.sendTransaction).toHaveBeenCalledWith(
        '0x0000000000000000000000000000000000000004',
        '0xdeadbeef',
      );
      expect(mockExecutor.waitForReceipt).toHaveBeenCalledWith(
        '0x00000000000000000000000000000000000000b1',
        120_000,
      );

      vi.useRealTimers();
    });

    it('throws GAS_INSUFFICIENT when ETH balance below 0.001 ETH', async () => {
      const mockClient = createMockOpenRouterClient();
      const mockExecutor = createMockExecutor({
        getEthBalance: vi.fn().mockResolvedValue(500_000_000_000_000n), // 0.0005 ETH
      });
      const service = new CoinbaseChargeService(mockClient, {
        evmPaymentExecutor: mockExecutor,
      });

      const result = await service.fund(baseRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('GAS_INSUFFICIENT');
      expect(result.error).toContain('0.001 ETH');
    });

    it('throws INSUFFICIENT_USDC when USDC balance below required amount', async () => {
      const mockClient = createMockOpenRouterClient();
      const mockExecutor = createMockExecutor({
        getUsdcBalance: vi.fn().mockResolvedValue(5_000_000n), // 5 USDC, need 10.5
      });
      const service = new CoinbaseChargeService(mockClient, {
        evmPaymentExecutor: mockExecutor,
      });

      const result = await service.fund(baseRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('INSUFFICIENT_USDC');
    });

    it('maps APPROVAL_FAILED from executor to failure response', async () => {
      const mockClient = createMockOpenRouterClient();
      const mockExecutor = createMockExecutor({
        approveUsdc: vi.fn().mockRejectedValue(
          new EvmExecutionError(EvmExecutionErrorCode.APPROVAL_FAILED, 'ERC-20 approval reverted'),
        ),
      });
      const service = new CoinbaseChargeService(mockClient, {
        evmPaymentExecutor: mockExecutor,
      });

      const result = await service.fund(baseRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('APPROVAL_FAILED');
      expect(result.error).toContain('ERC-20 approval reverted');
    });

    it('maps EXECUTION_REVERTED from executor to failure response', async () => {
      const mockClient = createMockOpenRouterClient();
      const mockExecutor = createMockExecutor({
        sendTransaction: vi.fn().mockRejectedValue(
          new EvmExecutionError(EvmExecutionErrorCode.EXECUTION_REVERTED, 'Calldata execution reverted'),
        ),
      });
      const service = new CoinbaseChargeService(mockClient, {
        evmPaymentExecutor: mockExecutor,
      });

      const result = await service.fund(baseRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('EXECUTION_REVERTED');
    });

    it('maps NETWORK_ERROR from executor to failure response', async () => {
      const mockClient = createMockOpenRouterClient();
      const mockExecutor = createMockExecutor({
        sendTransaction: vi.fn().mockRejectedValue(
          new EvmExecutionError(EvmExecutionErrorCode.NETWORK_ERROR, 'Chain disconnected'),
        ),
      });
      const service = new CoinbaseChargeService(mockClient, {
        evmPaymentExecutor: mockExecutor,
      });

      const result = await service.fund(baseRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('NETWORK_ERROR');
    });

    it('maps TIMEOUT from executor to failure response', async () => {
      const mockClient = createMockOpenRouterClient();
      const mockExecutor = createMockExecutor({
        waitForReceipt: vi.fn().mockRejectedValue(
          new EvmExecutionError(EvmExecutionErrorCode.TIMEOUT, 'Transaction not confirmed in 120s'),
        ),
      });
      const service = new CoinbaseChargeService(mockClient, {
        evmPaymentExecutor: mockExecutor,
      });

      const result = await service.fund(baseRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('TIMEOUT');
    });

    it('returns failure when transaction receipt status is reverted', async () => {
      const mockClient = createMockOpenRouterClient();
      const mockExecutor = createMockExecutor({
        waitForReceipt: vi.fn().mockResolvedValue({
          status: 'reverted',
          gasUsed: 21000n,
          blockNumber: 123456n,
          transactionHash: '0x00000000000000000000000000000000000000b1',
        }),
      });
      const service = new CoinbaseChargeService(mockClient, {
        evmPaymentExecutor: mockExecutor,
      });

      const result = await service.fund(baseRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('EXECUTION_REVERTED');
      expect(result.error).toContain('reverted');
    });

    it('succeeds when credit polling detects balance increase', async () => {
      vi.useFakeTimers();

      let creditsCallCount = 0;
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockImplementation(async () => {
          creditsCallCount++;
          if (creditsCallCount <= 1) return { total_credits: 50, total_usage: 10 };
          return { total_credits: 60, total_usage: 10 }; // +10 = amountUsdc
        }),
      });
      const mockExecutor = createMockExecutor();
      const service = new CoinbaseChargeService(mockClient, {
        evmPaymentExecutor: mockExecutor,
      });

      const fundPromise = service.fund(baseRequest);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await fundPromise;

      expect(result.success).toBe(true);
      expect(result.previousBalance).toBe(50);
      expect(result.newBalance).toBe(60);
      expect(result.fundingTxHash).toBeDefined();

      vi.useRealTimers();
    });

    it('returns retryable POLLING_TIMEOUT when credits never increase', async () => {
      vi.useFakeTimers();

      const mockClient = createMockOpenRouterClient({
        // Always returns baseline — credits never increase
        getAccountCredits: vi.fn().mockResolvedValue({ total_credits: 100, total_usage: 20 }),
      });
      const mockExecutor = createMockExecutor();
      const service = new CoinbaseChargeService(mockClient, {
        evmPaymentExecutor: mockExecutor,
      });

      const fundPromise = service.fund(baseRequest);
      // Advance past the 25-minute polling timeout
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000 + 10_000);
      const result = await fundPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('POLLING_TIMEOUT');
      expect(result.error).toContain('100');

      vi.useRealTimers();
    }, 30_000);

    it('bails early if within 60s of charge expiry', async () => {
      vi.useFakeTimers();

      // Charge expires 70 seconds from now → polling deadline = 70s - 60s buffer = 10s
      const nearExpiry = new Date(Date.now() + 70_000).toISOString();
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockResolvedValue({ total_credits: 100, total_usage: 20 }),
        createCoinbaseCharge: vi.fn().mockResolvedValue(mockChargeResponse({ expires_at: nearExpiry })),
      });
      const mockExecutor = createMockExecutor();
      const service = new CoinbaseChargeService(mockClient, {
        evmPaymentExecutor: mockExecutor,
      });

      const fundPromise = service.fund(baseRequest);
      // Advance past the 10s polling deadline
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await fundPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('POLLING_TIMEOUT');

      vi.useRealTimers();
    });
  });

  // ── fund (dry-run) ──────────────────────────────────────────────────────

  describe('fund (dry-run)', () => {
    it('fetches real credits for dry-run baseline', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockResolvedValue({ total_credits: 250, total_usage: 80 }),
      });
      const service = new CoinbaseChargeService(mockClient, true);

      const result = await service.fund({ amountUsdc: 30, runId: 'dry-1', strategyId: 's1' });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.previousBalance).toBe(250);
      expect(result.newBalance).toBe(280);
      expect(result.amountFunded).toBe(30);
      expect(result.chargeId).toContain('dry-run');
    });

    it('uses 0 baseline if credits fetch fails in dry-run', async () => {
      const mockClient = createMockOpenRouterClient({
        getAccountCredits: vi.fn().mockRejectedValue(new Error('API down')),
      });
      const service = new CoinbaseChargeService(mockClient, true);

      const result = await service.fund({ amountUsdc: 10, runId: 'dry-2', strategyId: 's1' });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.previousBalance).toBe(0);
      expect(result.newBalance).toBe(10);
    });
  });
});

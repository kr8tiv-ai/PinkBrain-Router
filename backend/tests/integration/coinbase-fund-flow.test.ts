/**
 * Integration test for the full Coinbase fund flow.
 *
 * Exercises the real CoinbaseChargeService.fund() method with mocked external
 * dependencies (OpenRouter API + viem via EvmPaymentExecutor). This is an
 * integration test — it verifies the orchestration, call sequence, data flow,
 * and error classification of the service, not the individual client methods.
 *
 * Covers: happy path, polling success, polling timeout, gas insufficiency,
 * approval-before-execute call ordering, and FundingResponse shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseUnits } from 'viem';
import {
  CoinbaseChargeService,
  CoinbaseChargeError,
} from '../../src/services/CoinbaseChargeService.js';
import type { EvmPaymentExecutor } from '../../src/clients/EvmPaymentExecutor.js';
import type { OpenRouterClient } from '../../src/clients/OpenRouterClient.js';

// ─── Pino mock (K022: vi.hoisted for modules imported both statically and dynamically) ──

const { pinoFactory } = vi.hoisted(() => {
  const noop = vi.fn();
  const mockLogger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: vi.fn(() => mockLogger),
    fatal: noop,
    trace: noop,
  };
  const factory = vi.fn(() => mockLogger);
  return { pinoFactory: factory };
});

vi.mock('pino', () => ({
  default: pinoFactory,
  pino: pinoFactory,
}));

// ─── Constants ─────────────────────────────────────────────────────────────

const WALLET = '0x00000000000000000000000000000000000000AA' as `0x${string}`;
const CONTRACT_ADDR = '0x0000000000000000000000000000000000000004' as `0x${string}`;
const SIGNATURE = '0xdeadbeef' as `0x${string}`;
const APPROVE_HASH = '0x00000000000000000000000000000000000000a1' as `0x${string}`;
const EXEC_HASH = '0x00000000000000000000000000000000000000b1' as `0x${string}`;

const RECIPIENT_AMOUNT = '10'; // 10 USDC
const FEE_AMOUNT = '0.5'; // 0.5 USDC
const TOTAL_USDC = parseFloat(RECIPIENT_AMOUNT) + parseFloat(FEE_AMOUNT); // 10.5
const TOTAL_WEI = parseUnits(TOTAL_USDC.toString(), 6);

const BASELINE_CREDITS = 100;
const FUND_AMOUNT = 10; // amountUsdc in the FundingRequest

const MOCK_RECEIPT = {
  status: 'success' as const,
  gasUsed: 21000n,
  blockNumber: 123456n,
  transactionHash: EXEC_HASH,
};

// ─── Mock factories ────────────────────────────────────────────────────────

function buildChargeResponse(expiresAt: string) {
  return {
    data: {
      id: 'charge-integration-123',
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      web3_data: {
        transfer_intent: {
          call_data: {
            deadline: expiresAt,
            fee_amount: FEE_AMOUNT,
            id: 'call-abc-123',
            operator: '0x0000000000000000000000000000000000000001',
            prefix: '0x',
            recipient: '0x0000000000000000000000000000000000000002',
            recipient_amount: RECIPIENT_AMOUNT,
            recipient_currency: 'USDC',
            refund_destination: '0x0000000000000000000000000000000000000003',
            signature: SIGNATURE,
          },
          metadata: {
            chain_id: 8453,
            contract_address: CONTRACT_ADDR,
            sender: WALLET,
          },
        },
        metadata: {},
      },
    },
  };
}

/**
 * Create a call-order-tracking mock executor.
 * Validates that approveUsdc is called before sendTransaction.
 */
function createOrderedMockExecutor() {
  let approveCalled = false;
  const callOrder: string[] = [];

  const mock: Record<string, unknown> = {
    getWalletAddress: vi.fn().mockReturnValue(WALLET),
    getEthBalance: vi.fn().mockResolvedValue(2_000_000_000_000_000n), // 0.002 ETH
    getUsdcBalance: vi.fn().mockResolvedValue(parseUnits('20', 6)), // 20 USDC
    approveUsdc: vi.fn().mockImplementation(async (_spender: string, amount: bigint) => {
      callOrder.push('approve');
      approveCalled = true;
      // Validate that approve amount equals recipient + fee
      if (amount !== TOTAL_WEI) {
        throw new Error(
          `approveUsdc called with ${amount}, expected ${TOTAL_WEI} (recipient_amount + fee_amount)`,
        );
      }
      return APPROVE_HASH;
    }),
    sendTransaction: vi.fn().mockImplementation(async (to: string, data: `0x${string}`) => {
      callOrder.push('execute');
      // Validate that approve was called first
      if (!approveCalled) {
        throw new Error('sendTransaction called before approveUsdc — call order violation');
      }
      // Validate calldata signature is passed correctly
      if (data !== SIGNATURE) {
        throw new Error(`sendTransaction called with signature ${data}, expected ${SIGNATURE}`);
      }
      return EXEC_HASH;
    }),
    waitForReceipt: vi.fn().mockResolvedValue(MOCK_RECEIPT),
    _getCallOrder: () => [...callOrder],
  };

  return mock as unknown as EvmPaymentExecutor & { _getCallOrder: () => string[] };
}

function createMockOpenRouterClient(creditsFn: (callCount: number) => { total_credits: number; total_usage: number }) {
  let callCount = 0;
  return {
    getAccountCredits: vi.fn().mockImplementation(async () => {
      callCount++;
      return creditsFn(callCount);
    }),
    createCoinbaseCharge: vi.fn().mockResolvedValue(
      buildChargeResponse(new Date(Date.now() + 30 * 60 * 1000).toISOString()),
    ),
  } as unknown as OpenRouterClient;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Coinbase fund flow — integration', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Happy path: full flow with successful polling ───────────────────────

  it('executes the full fund flow: charge → approve → execute → confirm → poll success', async () => {
    vi.useFakeTimers();

    // First call = baseline, second call (poll) = credits increased by fund amount
    const mockClient = createMockOpenRouterClient((n) => {
      if (n <= 1) return { total_credits: BASELINE_CREDITS, total_usage: 20 };
      return { total_credits: BASELINE_CREDITS + FUND_AMOUNT, total_usage: 20 };
    });

    const executor = createOrderedMockExecutor();
    const service = new CoinbaseChargeService(mockClient, {
      evmPaymentExecutor: executor,
      evmChainId: 8453,
    });

    const fundPromise = service.fund({
      amountUsdc: FUND_AMOUNT,
      runId: 'integration-run-1',
      strategyId: 'strat-1',
    });

    // Advance past the first poll interval (10s)
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await fundPromise;

    // ── FundingResponse shape ───────────────────────────────────────────
    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.chargeId).toBe('charge-integration-123');
    expect(result.fundingTxHash).toBe(EXEC_HASH);
    expect(result.previousBalance).toBe(BASELINE_CREDITS);
    expect(result.newBalance).toBe(BASELINE_CREDITS + FUND_AMOUNT);
    expect(result.amountFunded).toBe(FUND_AMOUNT);

    // ── Call sequence ───────────────────────────────────────────────────
    expect(mockClient.createCoinbaseCharge).toHaveBeenCalledWith({
      amount: FUND_AMOUNT,
      sender: WALLET,
      chain_id: 8453,
    });
    expect(executor._getCallOrder()).toEqual(['approve', 'execute']);

    // ── Approval amount = recipient_amount + fee_amount ────────────────
    expect(executor.approveUsdc).toHaveBeenCalledWith(CONTRACT_ADDR, TOTAL_WEI);

    // ── Calldata signature passed correctly ────────────────────────────
    expect(executor.sendTransaction).toHaveBeenCalledWith(CONTRACT_ADDR, SIGNATURE);

    // ── Receipt confirmed ──────────────────────────────────────────────
    expect(executor.waitForReceipt).toHaveBeenCalledWith(EXEC_HASH, 120_000);

    vi.useRealTimers();
  });

  // ── Polling: first poll baseline, second poll increased → success ──────

  it('polls credits: baseline on first poll, increased on second → success', async () => {
    vi.useFakeTimers();

    const pollResults = [
      { total_credits: BASELINE_CREDITS, total_usage: 20 }, // call 1: baseline (pre-charge)
      { total_credits: BASELINE_CREDITS, total_usage: 20 }, // call 2: poll #1 — no change
      { total_credits: BASELINE_CREDITS + FUND_AMOUNT, total_usage: 20 }, // call 3: poll #2 — funded!
    ];
    let callIdx = 0;
    const mockClient = createMockOpenRouterClient(() => pollResults[callIdx++]);
    const executor = createOrderedMockExecutor();
    const service = new CoinbaseChargeService(mockClient, {
      evmPaymentExecutor: executor,
    });

    const fundPromise = service.fund({
      amountUsdc: FUND_AMOUNT,
      runId: 'integration-run-2',
      strategyId: 'strat-1',
    });

    // Advance past two poll intervals
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await fundPromise;

    expect(result.success).toBe(true);
    expect(result.previousBalance).toBe(BASELINE_CREDITS);
    expect(result.newBalance).toBe(BASELINE_CREDITS + FUND_AMOUNT);

    // getAccountCredits called 3 times: baseline + 2 polls
    expect(mockClient.getAccountCredits).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  // ── Polling timeout: all polls return baseline → POLLING_TIMEOUT ───────

  it('polling timeout: all polls return baseline → POLLING_TIMEOUT', async () => {
    vi.useFakeTimers();

    const mockClient = createMockOpenRouterClient(() => ({
      total_credits: BASELINE_CREDITS,
      total_usage: 20,
    }));
    const executor = createOrderedMockExecutor();
    const service = new CoinbaseChargeService(mockClient, {
      evmPaymentExecutor: executor,
    });

    const fundPromise = service.fund({
      amountUsdc: FUND_AMOUNT,
      runId: 'integration-run-3',
      strategyId: 'strat-1',
    });

    // Advance past the 25-minute polling timeout + one more interval
    await vi.advanceTimersByTimeAsync(25 * 60 * 1000 + 10_000);
    const result = await fundPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('POLLING_TIMEOUT');

    vi.useRealTimers();
  }, 30_000);

  // ── Gas check failure: getEthBalance returns 0 → GAS_INSUFFICIENT ──────

  it('gas check failure: zero ETH → GAS_INSUFFICIENT', async () => {
    const mockClient = createMockOpenRouterClient((n) => ({
      total_credits: BASELINE_CREDITS,
      total_usage: 20,
    }));
    const executor = createOrderedMockExecutor();
    // Override gas balance to 0
    (executor.getEthBalance as ReturnType<typeof vi.fn>).mockResolvedValue(0n);

    const service = new CoinbaseChargeService(mockClient, {
      evmPaymentExecutor: executor,
    });

    const result = await service.fund({
      amountUsdc: FUND_AMOUNT,
      runId: 'integration-run-4',
      strategyId: 'strat-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('GAS_INSUFFICIENT');
    // Executor should NOT have been asked to approve or execute
    expect(executor.approveUsdc).not.toHaveBeenCalled();
    expect(executor.sendTransaction).not.toHaveBeenCalled();
  });

  // ── Approval before execute: call order is enforced ────────────────────

  it('enforces approve-before-execute call order', async () => {
    vi.useFakeTimers();

    const mockClient = createMockOpenRouterClient((n) => {
      if (n <= 1) return { total_credits: BASELINE_CREDITS, total_usage: 20 };
      return { total_credits: BASELINE_CREDITS + FUND_AMOUNT, total_usage: 20 };
    });
    const executor = createOrderedMockExecutor();
    const service = new CoinbaseChargeService(mockClient, {
      evmPaymentExecutor: executor,
    });

    const fundPromise = service.fund({
      amountUsdc: FUND_AMOUNT,
      runId: 'integration-run-5',
      strategyId: 'strat-1',
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await fundPromise;

    // The mock executor throws if execute is called before approve.
    // If we get here without error, the order was correct.
    expect(executor._getCallOrder()).toEqual(['approve', 'execute']);

    vi.useRealTimers();
  });

  // ── Reverted transaction receipt → failure ─────────────────────────────

  it('returns failure when transaction receipt status is reverted', async () => {
    const mockClient = createMockOpenRouterClient((n) => ({
      total_credits: BASELINE_CREDITS,
      total_usage: 20,
    }));
    const executor = createOrderedMockExecutor();
    (executor.waitForReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...MOCK_RECEIPT,
      status: 'reverted' as const,
    });

    const service = new CoinbaseChargeService(mockClient, {
      evmPaymentExecutor: executor,
    });

    const result = await service.fund({
      amountUsdc: FUND_AMOUNT,
      runId: 'integration-run-6',
      strategyId: 'strat-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('EXECUTION_REVERTED');
    // Should still have approved and executed before the receipt check failed
    expect(executor.approveUsdc).toHaveBeenCalled();
    expect(executor.sendTransaction).toHaveBeenCalled();
  });
});

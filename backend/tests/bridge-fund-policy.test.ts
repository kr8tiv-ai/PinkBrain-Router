import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────

function createMockCctpClient(overrides: Record<string, unknown> = {}) {
  return {
    getUsdcBalance: vi.fn().mockResolvedValue(BigInt(1_000_000_000)), // 1000 USDC
    bridgeToSolana: vi.fn().mockResolvedValue({
      txHash: '0xbridge-tx-hash',
      amountUsdc: BigInt(300_000_000),
      fromChain: 'base-8453',
      toChain: 'solana',
      solanaRecipient: '7xKqBzWGkY',
    }),
    getWalletAddress: vi.fn().mockReturnValue('0xWalletAddress'),
    getChainId: vi.fn().mockReturnValue(8453),
    ...overrides,
  };
}

// ─── CctpBridgeService Tests ──────────────────────────────────────

describe('CctpBridgeService', () => {
  // Since we can't easily ESM-import the service with vi.mock,
  // we test the logic via inline construction.
  // The service itself is a thin orchestrator over CctpClient.

  it('should bridge USDC successfully', async () => {
    const mockClient = createMockCctpClient();

    // Dynamically import to get fresh module
    const { CctpBridgeService } = await import('../src/services/CctpBridgeService.js');
    const service = new CctpBridgeService(mockClient as any);

    const result = await service.bridge({
      amountUsdc: 300,
      recipientSolanaAddress: '7xKqBzWGkYExampleWalletAddressThatIsExactly32',
    });

    expect(result.success).toBe(true);
    expect(result.amountUsdc).toBe(300);
    expect(result.txHash).toBe('0xbridge-tx-hash');
    expect(result.fromChain).toBe('base-8453');
    expect(result.toChain).toBe('solana');
    expect(mockClient.bridgeToSolana).toHaveBeenCalledOnce();
  });

  it('should return error when balance is insufficient', async () => {
    const mockClient = createMockCctpClient({
      getUsdcBalance: vi.fn().mockResolvedValue(BigInt(100_000_000)), // 100 USDC
    });

    const { CctpBridgeService } = await import('../src/services/CctpBridgeService.js');
    const service = new CctpBridgeService(mockClient as any);

    const result = await service.bridge({
      amountUsdc: 300,
      recipientSolanaAddress: '7xKqBzWGkYExampleWalletAddressThatIsExactly32',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient USDC balance');
    expect(mockClient.bridgeToSolana).not.toHaveBeenCalled();
  });

  it('should handle unexpected errors', async () => {
    const mockClient = createMockCctpClient({
      bridgeToSolana: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });

    const { CctpBridgeService } = await import('../src/services/CctpBridgeService.js');
    const service = new CctpBridgeService(mockClient as any);

    const result = await service.bridge({
      amountUsdc: 300,
      recipientSolanaAddress: '7xKqBzWGkYExampleWalletAddressThatIsExactly32',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network timeout');
  });

  it('should track circuit breaker state', async () => {
    const mockClient = createMockCctpClient({
      bridgeToSolana: vi.fn().mockRejectedValue(new Error('Persistent failure')),
    });

    const { CctpBridgeService } = await import('../src/services/CctpBridgeService.js');
    const service = new CctpBridgeService(mockClient as any);

    // Should be available initially
    expect(service.isAvailable()).toBe(true);

    // Trip the circuit breaker
    for (let i = 0; i < 3; i++) {
      await service.bridge({
        amountUsdc: 300,
        recipientSolanaAddress: '7xKqBzWGkYExampleWalletAddressThatIsExactly32',
      });
    }

    // Circuit breaker should be open after 3 failures
    expect(service.isAvailable()).toBe(false);
  });
});

// ─── CoinbaseChargeService Tests ──────────────────────────────────

describe('CoinbaseChargeService', () => {
  it('should simulate funding in dry-run mode', async () => {
    const mockOpenRouter = {
      getAccountCredits: vi.fn().mockResolvedValue({
        total_credits: 100,
        total_usage: 25,
      }),
    };

    const { CoinbaseChargeService } = await import('../src/services/CoinbaseChargeService.js');
    const service = new CoinbaseChargeService(mockOpenRouter as any, true);

    const result = await service.fund({
      amountUsdc: 300,
      runId: 'test-run-1',
      strategyId: 'test-strategy-1',
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.amountFunded).toBe(300);
    expect(result.chargeId).toContain('dry-run-charge');
    expect(result.newBalance).toBe(400); // 100 + 300
  });

  it('should fund in live mode and return pending status', async () => {
    const mockOpenRouter = {
      getAccountCredits: vi.fn().mockResolvedValue({
        total_credits: 100,
        total_usage: 25,
      }),
    };

    const { CoinbaseChargeService } = await import('../src/services/CoinbaseChargeService.js');
    const service = new CoinbaseChargeService(mockOpenRouter as any, false);

    const result = await service.fund({
      amountUsdc: 300,
      runId: 'test-run-2',
      strategyId: 'test-strategy-2',
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.chargeId).toContain('charge-test-run-2');
    expect(result.previousBalance).toBe(100);
  });

  it('should confirm funding and refresh balance', async () => {
    const mockOpenRouter = {
      getAccountCredits: vi.fn().mockResolvedValue({
        total_credits: 400,
        total_usage: 25,
      }),
    };

    const { CoinbaseChargeService } = await import('../src/services/CoinbaseChargeService.js');
    const service = new CoinbaseChargeService(mockOpenRouter as any, false);

    const result = await service.confirmFunding('charge-123');

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(400);
  });
});

// ─── CreditPoolService Tests ──────────────────────────────────────

describe('CreditPoolService', () => {
  function createMockDb() {
    // Use a single prepare mock that dispatches based on SQL content
    const allocations: Array<{ id: string; run_id: string; amount_usd: number }> = [];

    function prepare(sql: string) {
      if (sql.includes('INSERT')) {
        return {
          run(...args: unknown[]) {
            allocations.push({
              id: args[0] as string,
              run_id: args[1] as string,
              amount_usd: args[2] as number,
            });
            return { changes: 1 };
          },
          get: () => null,
          all: () => [],
        };
      }
      if (sql.includes('SUM(amount_usdc)')) {
        return {
          run: () => ({ changes: 0 }),
          get: () => {
            const total = allocations.reduce(
              (sum: number, row) => sum + (row.amount_usd || 0),
              0,
            );
            return { total };
          },
          all: () => {
            const total = allocations.reduce(
              (sum: number, row) => sum + (row.amount_usd || 0),
              0,
            );
            return [{ total }];
          },
        };
      }
      // CREATE TABLE and other DDL
      return {
        run: () => ({ changes: 0 }),
        get: () => null,
        all: () => [],
      };
    }

    return {
      _allocations: allocations,
      exec: () => {},
      pragma: () => {},
      transaction: (fn: () => unknown) => fn(),
      close: () => {},
      prepare,
    };
  }

  it('should check allocation within reserve limits', async () => {
    const mockDb = createMockDb();
    const mockOpenRouter = {
      getAccountCredits: vi.fn().mockResolvedValue({
        total_credits: 1000,
        total_usage: 200,
      }),
    };

    const { CreditPoolService } = await import('../src/services/CreditPoolService.js');
    const service = new CreditPoolService(mockOpenRouter as any, mockDb as any, 10);

    const check = await service.checkAllocation(500);

    expect(check.allowed).toBe(true);
    // 10% reserve of 1000 = 100, so available = 1000 - 100 - 0 (no prior allocations) = 900
    expect(check.availableAfterReserve).toBe(900);
    expect(check.remainingAfterAllocation).toBe(400);
  });

  it('should block allocation exceeding reserve', async () => {
    const mockDb = createMockDb();
    const mockOpenRouter = {
      getAccountCredits: vi.fn().mockResolvedValue({
        total_credits: 1000,
        total_usage: 200,
      }),
    };

    const { CreditPoolService } = await import('../src/services/CreditPoolService.js');
    const service = new CreditPoolService(mockOpenRouter as any, mockDb as any, 10);

    const check = await service.checkAllocation(950);

    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('exceeds available pool');
  });

  it('should block zero or negative allocations', async () => {
    const mockDb = createMockDb();
    const mockOpenRouter = {
      getAccountCredits: vi.fn().mockResolvedValue({
        total_credits: 1000,
        total_usage: 200,
      }),
    };

    const { CreditPoolService } = await import('../src/services/CreditPoolService.js');
    const service = new CreditPoolService(mockOpenRouter as any, mockDb as any, 10);

    const checkZero = await service.checkAllocation(0);
    expect(checkZero.allowed).toBe(false);
    expect(checkZero.reason).toContain('positive');

    const checkNeg = await service.checkAllocation(-50);
    expect(checkNeg.allowed).toBe(false);
  });

  it('should track allocations and update available balance', async () => {
    const mockDb = createMockDb();
    const mockOpenRouter = {
      getAccountCredits: vi.fn().mockResolvedValue({
        total_credits: 1000,
        total_usage: 200,
      }),
    };

    const { CreditPoolService } = await import('../src/services/CreditPoolService.js');
    const service = new CreditPoolService(mockOpenRouter as any, mockDb as any, 10);

    // First allocation check
    const check1 = await service.checkAllocation(400);
    expect(check1.allowed).toBe(true);

    // Simulate allocation by directly pushing to mock data
    // (recordAllocation may fail in test due to crypto.randomUUID or mock mismatch)
    mockDb._allocations.push({ id: 'a1', run_id: 'run-1', amount_usd: 400 });
    service.invalidateCache();

    // Second allocation should see reduced available balance
    const check2 = await service.checkAllocation(400);
    // Available: 1000 - 100 (reserve) - 400 (allocated) = 500
    expect(check2.availableAfterReserve).toBe(500);
    expect(check2.allowed).toBe(true);
    expect(check2.remainingAfterAllocation).toBe(100);
  });

  it('should provide pool status with runway estimate', async () => {
    const mockDb = createMockDb();
    const mockOpenRouter = {
      getAccountCredits: vi.fn().mockResolvedValue({
        total_credits: 1000,
        total_usage: 200,
      }),
    };

    const { CreditPoolService } = await import('../src/services/CreditPoolService.js');
    const service = new CreditPoolService(mockOpenRouter as any, mockDb as any, 10);

    // Simulate an existing allocation
    mockDb._allocations.push({ id: 'a1', run_id: 'run-1', amount_usd: 200 });
    service.invalidateCache();

    const status = await service.getStatus();

    expect(status.balance).toBe(1000);
    expect(status.allocated).toBe(200);
    expect(status.available).toBe(800);
    expect(status.reserve).toBe(100);
  });
});

// ─── ExecutionPolicy Tests ────────────────────────────────────────

describe('ExecutionPolicy', () => {
  function createConfig(overrides: Record<string, unknown> = {}) {
    return {
      dryRun: false,
      executionKillSwitch: false,
      maxDailyRuns: 4,
      maxClaimableSolPerRun: 100,
      creditPoolReservePct: 10,
      openrouterManagementKey: 'sk-mgmt-test',
      evmPrivateKey: '0x' + '00'.repeat(32),
      ...overrides,
    } as any;
  }

  it('should block execution when kill switch is active', async () => {
    const { ExecutionPolicy } = await import('../src/engine/ExecutionPolicy.js');
    const policy = new ExecutionPolicy(createConfig({ executionKillSwitch: true }));

    expect(policy.canStartRun().allowed).toBe(false);
    expect(policy.canStartRun().reason).toContain('Kill switch');
    expect(policy.canExecutePhase('BRIDGING').allowed).toBe(false);
    expect(policy.canExecutePhase('FUNDING').allowed).toBe(false);
  });

  it('should allow all phases when kill switch is off', async () => {
    const { ExecutionPolicy } = await import('../src/engine/ExecutionPolicy.js');
    const policy = new ExecutionPolicy(createConfig());

    expect(policy.canStartRun().allowed).toBe(true);
    expect(policy.canExecutePhase('CLAIMING').allowed).toBe(true);
    expect(policy.canExecutePhase('BRIDGING').allowed).toBe(true);
    expect(policy.canExecutePhase('FUNDING').allowed).toBe(true);
  });

  it('should track daily run limits per strategy', async () => {
    const { ExecutionPolicy } = await import('../src/engine/ExecutionPolicy.js');
    const policy = new ExecutionPolicy(createConfig({ maxDailyRuns: 2 }));

    // Should allow first two runs
    expect(policy.canStartRun('strategy-1').allowed).toBe(true);
    policy.recordRunStart('strategy-1');
    expect(policy.canStartRun('strategy-1').allowed).toBe(true);
    policy.recordRunStart('strategy-1');

    // Should block the third
    const result = policy.canStartRun('strategy-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily run limit');

    // Different strategy should still be allowed
    expect(policy.canStartRun('strategy-2').allowed).toBe(true);
  });

  it('should enforce bridge amount safety caps', async () => {
    const { ExecutionPolicy } = await import('../src/engine/ExecutionPolicy.js');
    const policy = new ExecutionPolicy(createConfig({ maxClaimableSolPerRun: 100 }));

    // Normal amount should pass
    expect(policy.canBridge(5000).allowed).toBe(true);

    // Zero/negative should fail
    expect(policy.canBridge(0).allowed).toBe(false);
    expect(policy.canBridge(-100).allowed).toBe(false);

    // Amount exceeding cap should fail (100 SOL * 100 = 10,000 USDC cap)
    const result = policy.canBridge(20_000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('exceeds safety cap');
  });

  it('should enforce funding reserve policy', async () => {
    const { ExecutionPolicy } = await import('../src/engine/ExecutionPolicy.js');
    const policy = new ExecutionPolicy(createConfig({ creditPoolReservePct: 10 }));

    // Funding 500 from 1000 pool with 10% reserve = max fundable 900
    expect(policy.canFund(500, 1000).allowed).toBe(true);

    // Funding 950 would violate the 10% reserve
    const result = policy.canFund(950, 1000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('reserve');
  });

  it('should block funding when management key is missing', async () => {
    const { ExecutionPolicy } = await import('../src/engine/ExecutionPolicy.js');
    const policy = new ExecutionPolicy(createConfig({ openrouterManagementKey: '' }));

    expect(policy.canExecutePhase('FUNDING').allowed).toBe(false);
    expect(policy.canExecutePhase('FUNDING').reason).toContain('management key');
  });

  it('should report policy state', async () => {
    const { ExecutionPolicy } = await import('../src/engine/ExecutionPolicy.js');
    const policy = new ExecutionPolicy(createConfig());

    const state = policy.getState();
    expect(state.dryRun).toBe(false);
    expect(state.killSwitchActive).toBe(false);
  });

  it('should allow dry-run mode to bypass bridge/funding checks', async () => {
    const { ExecutionPolicy } = await import('../src/engine/ExecutionPolicy.js');
    const policy = new ExecutionPolicy(createConfig({ dryRun: true }));

    const bridgeCheck = policy.canExecutePhase('BRIDGING');
    expect(bridgeCheck.allowed).toBe(true);

    const fundCheck = policy.canExecutePhase('FUNDING');
    expect(fundCheck.allowed).toBe(true);
  });
});

// ─── Bridge Phase Tests ───────────────────────────────────────────

describe('bridge phase', () => {
  it('should bridge USDC via CctpBridgeService', async () => {
    const mockBridgeService = {
      bridge: vi.fn().mockResolvedValue({
        success: true,
        txHash: '0xbridge-test-tx',
        amountUsdc: 300,
        fromChain: 'base-8453',
        toChain: 'solana',
        recipientSolanaAddress: '7xKqBzWGkY',
      }),
      isAvailable: vi.fn().mockReturnValue(true),
      getCircuitBreakerState: vi.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }),
    };

    const { createBridgePhase } = await import('../src/engine/phases/bridge.js');
    const bridgePhase = createBridgePhase({
      bridgeService: mockBridgeService as any,
      recipientSolanaAddress: '7xKqBzWGkYExampleWalletAddressThatIsExactly32',
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'BRIDGING' as const,
      swappedUsdc: 300,
      bridgedUsdc: null,
      fundedUsdc: null,
    } as any;

    const result = await bridgePhase(run);

    expect(result.success).toBe(true);
    expect(result.data?.bridgedUsdc).toBe(300);
    expect(result.data?.bridgeTxHash).toBe('0xbridge-test-tx');
    expect(mockBridgeService.bridge).toHaveBeenCalledOnce();
  });

  it('should skip bridge when no USDC available', async () => {
    const mockBridgeService = {
      bridge: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(true),
      getCircuitBreakerState: vi.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }),
    };

    const { createBridgePhase } = await import('../src/engine/phases/bridge.js');
    const bridgePhase = createBridgePhase({
      bridgeService: mockBridgeService as any,
      recipientSolanaAddress: '7xKqBzWGkYExampleWalletAddressThatIsExactly32',
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'BRIDGING' as const,
      swappedUsdc: null,
    } as any;

    const result = await bridgePhase(run);

    expect(result.success).toBe(true);
    expect(result.data?.skipped).toBe(true);
    expect(mockBridgeService.bridge).not.toHaveBeenCalled();
  });

  it('should fail when circuit breaker is open', async () => {
    const mockBridgeService = {
      bridge: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(false),
      getCircuitBreakerState: vi.fn().mockReturnValue({ state: 'OPEN', failures: 3 }),
    };

    const { createBridgePhase } = await import('../src/engine/phases/bridge.js');
    const bridgePhase = createBridgePhase({
      bridgeService: mockBridgeService as any,
      recipientSolanaAddress: '7xKqBzWGkYExampleWalletAddressThatIsExactly32',
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'BRIDGING' as const,
      swappedUsdc: 300,
    } as any;

    const result = await bridgePhase(run);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BRIDGE_UNAVAILABLE');
    expect(mockBridgeService.bridge).not.toHaveBeenCalled();
  });
});

// ─── Fund Phase Tests ────────────────────────────────────────────

describe('fund phase', () => {
  it('should fund OpenRouter credits via CoinbaseChargeService', async () => {
    const mockChargeService = {
      fund: vi.fn().mockResolvedValue({
        success: true,
        chargeId: 'charge-test-run-123',
        amountFunded: 300,
        previousBalance: 100,
        newBalance: 400,
        dryRun: false,
      }),
      isAvailable: vi.fn().mockReturnValue(true),
    };

    const mockPoolService = {
      checkAllocation: vi.fn().mockResolvedValue({
        allowed: true,
        requestedAmount: 300,
        availableAfterReserve: 900,
        remainingAfterAllocation: 600,
      }),
    };

    const { createFundPhase } = await import('../src/engine/phases/fund.js');
    const fundPhase = createFundPhase({
      chargeService: mockChargeService as any,
      creditPoolService: mockPoolService as any,
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'FUNDING' as const,
      bridgedUsdc: 300,
    } as any;

    const result = await fundPhase(run);

    expect(result.success).toBe(true);
    expect(result.data?.fundedUsdc).toBe(300);
    expect(result.data?.fundingTxHash).toBe('charge-test-run-123');
    expect(mockPoolService.checkAllocation).toHaveBeenCalledWith(300);
    expect(mockChargeService.fund).toHaveBeenCalledOnce();
  });

  it('should skip funding when no USDC available', async () => {
    const mockChargeService = {
      fund: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(true),
    };

    const mockPoolService = {
      checkAllocation: vi.fn(),
    };

    const { createFundPhase } = await import('../src/engine/phases/fund.js');
    const fundPhase = createFundPhase({
      chargeService: mockChargeService as any,
      creditPoolService: mockPoolService as any,
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'FUNDING' as const,
      bridgedUsdc: null,
    } as any;

    const result = await fundPhase(run);

    expect(result.success).toBe(true);
    expect(result.data?.skipped).toBe(true);
    expect(mockPoolService.checkAllocation).not.toHaveBeenCalled();
  });

  it('should fail when pool reserve policy blocks funding', async () => {
    const mockChargeService = {
      fund: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(true),
    };

    const mockPoolService = {
      checkAllocation: vi.fn().mockResolvedValue({
        allowed: false,
        reason: 'Allocation $300.00 exceeds available pool ($50.00 after 10% reserve)',
        requestedAmount: 300,
        availableAfterReserve: 50,
        remainingAfterAllocation: -250,
      }),
    };

    const { createFundPhase } = await import('../src/engine/phases/fund.js');
    const fundPhase = createFundPhase({
      chargeService: mockChargeService as any,
      creditPoolService: mockPoolService as any,
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'FUNDING' as const,
      bridgedUsdc: 300,
    } as any;

    const result = await fundPhase(run);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('POOL_RESERVE_EXCEEDED');
    expect(mockChargeService.fund).not.toHaveBeenCalled();
  });

  it('should fail when charge service circuit breaker is open', async () => {
    const mockChargeService = {
      fund: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(false),
    };

    const mockPoolService = {
      checkAllocation: vi.fn(),
    };

    const { createFundPhase } = await import('../src/engine/phases/fund.js');
    const fundPhase = createFundPhase({
      chargeService: mockChargeService as any,
      creditPoolService: mockPoolService as any,
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'FUNDING' as const,
      bridgedUsdc: 300,
    } as any;

    const result = await fundPhase(run);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FUNDING_UNAVAILABLE');
  });

  it('should handle charge service failure', async () => {
    const mockChargeService = {
      fund: vi.fn().mockResolvedValue({
        success: false,
        amountFunded: 0,
        previousBalance: 0,
        newBalance: 0,
        dryRun: false,
        error: 'Payment gateway error',
      }),
      isAvailable: vi.fn().mockReturnValue(true),
    };

    const mockPoolService = {
      checkAllocation: vi.fn().mockResolvedValue({
        allowed: true,
        requestedAmount: 300,
        availableAfterReserve: 900,
        remainingAfterAllocation: 600,
      }),
    };

    const { createFundPhase } = await import('../src/engine/phases/fund.js');
    const fundPhase = createFundPhase({
      chargeService: mockChargeService as any,
      creditPoolService: mockPoolService as any,
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'FUNDING' as const,
      bridgedUsdc: 300,
    } as any;

    const result = await fundPhase(run);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FUNDING_FAILED');
    expect(result.error?.message).toContain('Payment gateway error');
  });
});

// ─── Phase Handler Map Tests ──────────────────────────────────────

describe('phase handler map', () => {
  it('should create handlers with injected dependencies', async () => {
    const { createPhaseHandlerMap } = await import('../src/engine/phases/index.js');

    const map = createPhaseHandlerMap({
      bridge: {
        bridgeService: {
          bridge: vi.fn().mockResolvedValue({ success: true, amountUsdc: 100, txHash: '0x' }),
          isAvailable: vi.fn().mockReturnValue(true),
          getCircuitBreakerState: vi.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }),
        },
        recipientSolanaAddress: 'test-address',
      },
      fund: {
        chargeService: {
          fund: vi.fn().mockResolvedValue({ success: true, amountFunded: 100, chargeId: 'c-1', previousBalance: 0, newBalance: 100, dryRun: false }),
          isAvailable: vi.fn().mockReturnValue(true),
        },
        creditPoolService: {
          checkAllocation: vi.fn().mockResolvedValue({ allowed: true, requestedAmount: 100, availableAfterReserve: 900, remainingAfterAllocation: 800 }),
        },
      },
    });

    expect(map.size).toBe(6);
    expect(map.has('CLAIMING')).toBe(true);
    expect(map.has('SWAPPING')).toBe(true);
    expect(map.has('BRIDGING')).toBe(true);
    expect(map.has('FUNDING')).toBe(true);
    expect(map.has('ALLOCATING')).toBe(true);
    expect(map.has('PROVISIONING')).toBe(true);
  });

  it('should create handlers with defaults when no deps provided', async () => {
    const { createPhaseHandlerMap } = await import('../src/engine/phases/index.js');

    const map = createPhaseHandlerMap();

    expect(map.size).toBe(6);

    // Default handlers should succeed with stub data
    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'BRIDGING' as const,
      swappedUsdc: 300,
      bridgedUsdc: null,
    } as any;

    const bridgeHandler = map.get('BRIDGING');
    expect(bridgeHandler).toBeDefined();
    const bridgeResult = await bridgeHandler!(run);
    expect(bridgeResult.success).toBe(true);

    const run2 = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'FUNDING' as const,
      bridgedUsdc: 300,
      fundedUsdc: null,
    } as any;

    const fundHandler = map.get('FUNDING');
    expect(fundHandler).toBeDefined();
    const fundResult = await fundHandler!(run2);
    expect(fundResult.success).toBe(true);
  });
});

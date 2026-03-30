import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────

function createMockBridgeKitClient(overrides: Record<string, unknown> = {}) {
  return {
    bridge: vi.fn().mockResolvedValue({
      txHash: 'solana-burn-tx-hash',
      amountUsdc: 300,
      fromChain: 'Solana',
      toChain: 'Base',
      state: 'success',
      steps: [
        { name: 'burn', state: 'success', txHash: 'solana-burn-tx-hash', blockchain: 'Solana' },
        { name: 'attestation', state: 'success', blockchain: 'CCTP' },
        { name: 'mint', state: 'success', txHash: 'base-mint-tx-hash', blockchain: 'Base' },
      ],
      rawResult: {},
    }),
    estimateBridge: vi.fn(),
    retryBridge: vi.fn(),
    ...overrides,
  };
}

// ─── CctpBridgeService Tests ──────────────────────────────────────

describe('CctpBridgeService', () => {
  it('should bridge USDC successfully', async () => {
    const mockClient = createMockBridgeKitClient();

    const { CctpBridgeService } = await import('../src/services/CctpBridgeService.js');
    const service = new CctpBridgeService(mockClient as any);

    const result = await service.bridge({ amountUsdc: 300 });

    expect(result.success).toBe(true);
    expect(result.amountUsdc).toBe(300);
    expect(result.txHash).toBe('solana-burn-tx-hash');
    expect(result.fromChain).toBe('Solana');
    expect(result.toChain).toBe('Base');
    expect(result.state).toBe('success');
    expect(result.steps).toHaveLength(3);
    expect(mockClient.bridge).toHaveBeenCalledOnce();
  }, 15_000);

  it('should return error for BridgeKitError', async () => {
    const { BridgeKitError, BridgeKitErrorCode } = await import('../src/clients/BridgeKitClient.js');
    const mockClient = createMockBridgeKitClient({
      bridge: vi.fn().mockRejectedValue(
        new BridgeKitError(BridgeKitErrorCode.INSUFFICIENT_BALANCE, 'Insufficient USDC balance'),
      ),
    });

    const { CctpBridgeService } = await import('../src/services/CctpBridgeService.js');
    const service = new CctpBridgeService(mockClient as any);

    const result = await service.bridge({ amountUsdc: 300 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient USDC balance');
    expect(result.fromChain).toBe('solana');
    expect(result.toChain).toBe('base');
  });

  it('should handle unexpected errors', async () => {
    const mockClient = createMockBridgeKitClient({
      bridge: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });

    const { CctpBridgeService } = await import('../src/services/CctpBridgeService.js');
    const service = new CctpBridgeService(mockClient as any);

    const result = await service.bridge({ amountUsdc: 300 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network timeout');
  });

  it('should handle BridgeKitError TIMEOUT correctly', async () => {
    const { BridgeKitError, BridgeKitErrorCode } = await import('../src/clients/BridgeKitClient.js');
    const mockClient = createMockBridgeKitClient({
      bridge: vi.fn().mockRejectedValue(
        new BridgeKitError(BridgeKitErrorCode.TIMEOUT, 'Bridge operation timed out after 1800000ms'),
      ),
    });

    const { CctpBridgeService } = await import('../src/services/CctpBridgeService.js');
    const service = new CctpBridgeService(mockClient as any);

    const result = await service.bridge({ amountUsdc: 300 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(result.fromChain).toBe('solana');
    expect(result.toChain).toBe('base');
    expect(result.amountUsdc).toBe(300);
    // TIMEOUT is a typed BridgeKitError — caught in the BridgeKitError branch, not isRetryable
    expect(result.error).not.toContain('retryable');
  });

  it('should classify retryable errors', async () => {
    const mockClient = createMockBridgeKitClient({
      bridge: vi.fn().mockRejectedValue(new Error('Attestation fetch failed')),
    });

    const { CctpBridgeService } = await import('../src/services/CctpBridgeService.js');
    const service = new CctpBridgeService(mockClient as any);

    const result = await service.bridge({ amountUsdc: 300 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Attestation fetch failed');
  });

  it('should track circuit breaker state', async () => {
    const mockClient = createMockBridgeKitClient({
      bridge: vi.fn().mockRejectedValue(new Error('Persistent failure')),
    });

    const { CctpBridgeService } = await import('../src/services/CctpBridgeService.js');
    const service = new CctpBridgeService(mockClient as any);

    expect(service.isAvailable()).toBe(true);

    // Trip the circuit breaker (3 failures)
    for (let i = 0; i < 3; i++) {
      await service.bridge({ amountUsdc: 300 });
    }

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

    const check1 = await service.checkAllocation(400);
    expect(check1.allowed).toBe(true);
    expect(check1.availableAfterReserve).toBe(900);
    expect(check1.remainingAfterAllocation).toBe(500);

    service.recordAllocation('run-1', 400);

    expect(mockDb._allocations.length).toBe(1);
    expect(mockDb._allocations[0].amount_usd).toBe(400);

    service.recordAllocation('run-2', 300);
    expect(mockDb._allocations.length).toBe(2);
  });

  it('should reflect allocations when pool state is refreshed after recording', async () => {
    const allocations: number[] = [400];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('INSERT')) {
          return {
            run: (...args: unknown[]) => {
              allocations.push((args[2] as number) || 0);
              return { changes: 1 };
            },
            get: () => null,
            all: () => [],
          };
        }
        if (sql.includes('SUM')) {
          return {
            run: () => ({ changes: 0 }),
            get: () => ({ total: allocations.reduce((s, v) => s + v, 0) }),
            all: () => [{ total: allocations.reduce((s, v) => s + v, 0) }],
          };
        }
        return {
          run: () => ({ changes: 0 }),
          get: () => null,
          all: () => [],
        };
      }),
      exec: vi.fn(),
      pragma: vi.fn(),
      transaction: (fn: () => unknown) => fn(),
      close: vi.fn(),
      _allocations: [] as Array<{ id: string; run_id: string; amount_usd: number }>,
    };
    const mockOpenRouter = {
      getAccountCredits: vi.fn().mockResolvedValue({
        total_credits: 1000,
        total_usage: 200,
      }),
    };

    const { CreditPoolService } = await import('../src/services/CreditPoolService.js');
    const service = new CreditPoolService(mockOpenRouter as any, mockDb as any, 10);

    service.recordAllocation('run-0', 400);

    const check = await service.checkAllocation(100);
    expect(check.availableAfterReserve).toBe(100);
    expect(check.remainingAfterAllocation).toBe(0);
    expect(check.allowed).toBe(true);
  });

  it('should provide pool status with runway estimate', async () => {
    const allocations: number[] = [200];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('INSERT')) {
          return {
            run: (...args: unknown[]) => {
              allocations.push((args[2] as number) || 0);
              return { changes: 1 };
            },
            get: () => null,
            all: () => [],
          };
        }
        if (sql.includes('SUM')) {
          return {
            run: () => ({ changes: 0 }),
            get: () => ({ total: allocations.reduce((s, v) => s + v, 0) }),
            all: () => [{ total: allocations.reduce((s, v) => s + v, 0) }],
          };
        }
        return {
          run: () => ({ changes: 0 }),
          get: () => null,
          all: () => [],
        };
      }),
      exec: vi.fn(),
      pragma: vi.fn(),
      transaction: (fn: () => unknown) => fn(),
      close: vi.fn(),
      _allocations: [] as Array<{ id: string; run_id: string; amount_usd: number }>,
    };
    const mockOpenRouter = {
      getAccountCredits: vi.fn().mockResolvedValue({
        total_credits: 1000,
        total_usage: 200,
      }),
    };

    const { CreditPoolService } = await import('../src/services/CreditPoolService.js');
    const service = new CreditPoolService(mockOpenRouter as any, mockDb as any, 10);

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

    expect(policy.canStartRun('strategy-1').allowed).toBe(true);
    policy.recordRunStart('strategy-1');
    expect(policy.canStartRun('strategy-1').allowed).toBe(true);
    policy.recordRunStart('strategy-1');

    const result = policy.canStartRun('strategy-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily run limit');

    expect(policy.canStartRun('strategy-2').allowed).toBe(true);
  });

  it('should enforce bridge amount safety caps', async () => {
    const { ExecutionPolicy } = await import('../src/engine/ExecutionPolicy.js');
    const policy = new ExecutionPolicy(createConfig({ maxClaimableSolPerRun: 100 }));

    expect(policy.canBridge(5000).allowed).toBe(true);

    expect(policy.canBridge(0).allowed).toBe(false);
    expect(policy.canBridge(-100).allowed).toBe(false);

    const result = policy.canBridge(20_000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('exceeds safety cap');
  });

  it('should enforce funding reserve policy', async () => {
    const { ExecutionPolicy } = await import('../src/engine/ExecutionPolicy.js');
    const policy = new ExecutionPolicy(createConfig({ creditPoolReservePct: 10 }));

    expect(policy.canFund(500, 1000).allowed).toBe(true);

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
  it('should bridge USDC from Solana to Base', async () => {
    const mockBridgeService = {
      bridge: vi.fn().mockResolvedValue({
        success: true,
        txHash: 'solana-burn-tx-hash',
        amountUsdc: 300,
        fromChain: 'Solana',
        toChain: 'Base',
        state: 'success',
        steps: [
          { name: 'burn', state: 'success', txHash: 'solana-burn-tx-hash' },
          { name: 'attestation', state: 'success' },
          { name: 'mint', state: 'success', txHash: 'base-mint-tx-hash' },
        ],
      }),
      isAvailable: vi.fn().mockReturnValue(true),
      getCircuitBreakerState: vi.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }),
    };

    const { createBridgePhase } = await import('../src/engine/phases/bridge.js');
    const bridgePhase = createBridgePhase({
      bridgeService: mockBridgeService as any,
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
    expect(result.data?.bridgeTxHash).toBe('solana-burn-tx-hash');
    expect(result.data?.fromChain).toBe('Solana');
    expect(result.data?.toChain).toBe('Base');
    expect(mockBridgeService.bridge).toHaveBeenCalledOnce();
    // Verify the bridge call does NOT include recipientSolanaAddress
    expect(mockBridgeService.bridge).toHaveBeenCalledWith({ amountUsdc: 300 });
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

  it('should propagate bridge failure from service', async () => {
    const mockBridgeService = {
      bridge: vi.fn().mockResolvedValue({
        success: false,
        amountUsdc: 300,
        fromChain: 'solana',
        toChain: 'base',
        error: 'Insufficient USDC balance',
      }),
      isAvailable: vi.fn().mockReturnValue(true),
      getCircuitBreakerState: vi.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }),
    };

    const { createBridgePhase } = await import('../src/engine/phases/bridge.js');
    const bridgePhase = createBridgePhase({
      bridgeService: mockBridgeService as any,
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'BRIDGING' as const,
      swappedUsdc: 300,
    } as any;

    const result = await bridgePhase(run);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BRIDGE_FAILED');
    expect(result.error?.message).toContain('Insufficient USDC balance');
  });

  it('should return simulated data in dry-run mode without calling bridge service', async () => {
    const mockBridgeService = {
      bridge: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(true),
      getCircuitBreakerState: vi.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }),
    };

    const { createBridgePhase } = await import('../src/engine/phases/bridge.js');
    const bridgePhase = createBridgePhase({
      bridgeService: mockBridgeService as any,
      dryRun: true,
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'BRIDGING' as const,
      swappedUsdc: 300,
    } as any;

    const result = await bridgePhase(run);

    expect(result.success).toBe(true);
    expect(result.data?.bridgedUsdc).toBe(300);
    expect(result.data?.bridgeTxHash).toBeNull();
    expect(result.data?.dryRun).toBe(true);
    expect(result.data?.fromChain).toBe('solana');
    expect(result.data?.toChain).toBe('base');
    expect(mockBridgeService.bridge).not.toHaveBeenCalled();
  });

  it('should skip dry-run when no USDC available', async () => {
    const mockBridgeService = {
      bridge: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(true),
      getCircuitBreakerState: vi.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }),
    };

    const { createBridgePhase } = await import('../src/engine/phases/bridge.js');
    const bridgePhase = createBridgePhase({
      bridgeService: mockBridgeService as any,
      dryRun: true,
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'BRIDGING' as const,
      swappedUsdc: 0,
    } as any;

    const result = await bridgePhase(run);

    expect(result.success).toBe(true);
    expect(result.data?.skipped).toBe(true);
    expect(result.data?.dryRun).toBeUndefined();
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

// ─── Provision Phase Dry-Run Tests ────────────────────────────────

describe('provision phase dry-run', () => {
  it('should return simulated data in dry-run mode without calling key manager', async () => {
    const mockKeyManager = {
      provisionKeys: vi.fn(),
    };
    const mockDistribution = {
      getSnapshotsByRun: vi.fn(),
    };
    const mockStrategy = {
      getById: vi.fn(),
    };

    const { createProvisionPhase } = await import('../src/engine/phases/provision.js');
    const provisionPhase = createProvisionPhase({
      keyManagerService: mockKeyManager as any,
      distributionService: mockDistribution as any,
      strategyService: mockStrategy as any,
      dryRun: true,
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'PROVISIONING' as const,
      allocatedUsd: 500,
    } as any;

    const result = await provisionPhase(run);

    expect(result.success).toBe(true);
    expect(result.data?.keysProvisioned).toBe(0);
    expect(result.data?.keysUpdated).toBe(0);
    expect(result.data?.keysFailed).toBe(0);
    expect(result.data?.dryRun).toBe(true);
    expect(mockKeyManager.provisionKeys).not.toHaveBeenCalled();
  });

  it('should skip dry-run when no allocated credits', async () => {
    const mockKeyManager = {
      provisionKeys: vi.fn(),
    };
    const mockDistribution = {
      getSnapshotsByRun: vi.fn(),
    };
    const mockStrategy = {
      getById: vi.fn(),
    };

    const { createProvisionPhase } = await import('../src/engine/phases/provision.js');
    const provisionPhase = createProvisionPhase({
      keyManagerService: mockKeyManager as any,
      distributionService: mockDistribution as any,
      strategyService: mockStrategy as any,
      dryRun: true,
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'PROVISIONING' as const,
      allocatedUsd: 0,
    } as any;

    const result = await provisionPhase(run);

    expect(result.success).toBe(true);
    expect(result.data?.skipped).toBe(true);
    expect(result.data?.dryRun).toBeUndefined();
    expect(mockKeyManager.provisionKeys).not.toHaveBeenCalled();
  });

  it('should call real services when dryRun is false', async () => {
    const mockKeyManager = {
      provisionKeys: vi.fn().mockResolvedValue({
        keysProvisioned: 2,
        keysUpdated: 1,
        keysFailed: 0,
        keyHashes: ['hash1', 'hash2'],
        failedWallets: [],
      }),
    };
    const mockDistribution = {
      getSnapshotsByRun: vi.fn().mockReturnValue([
        { holderWallet: 'wallet1', allocatedUsd: 200 },
        { holderWallet: 'wallet2', allocatedUsd: 300 },
      ]),
    };
    const mockStrategy = {
      getById: vi.fn().mockReturnValue({
        strategyId: 'test-strategy',
        distributionToken: 'token-address',
      }),
    };

    const { createProvisionPhase } = await import('../src/engine/phases/provision.js');
    const provisionPhase = createProvisionPhase({
      keyManagerService: mockKeyManager as any,
      distributionService: mockDistribution as any,
      strategyService: mockStrategy as any,
      dryRun: false,
    });

    const run = {
      runId: 'test-run',
      strategyId: 'test-strategy',
      state: 'PROVISIONING' as const,
      allocatedUsd: 500,
    } as any;

    const result = await provisionPhase(run);

    expect(result.success).toBe(true);
    expect(result.data?.keysProvisioned).toBe(2);
    expect(result.data?.keysUpdated).toBe(1);
    expect(result.data?.dryRun).toBeUndefined();
    expect(mockKeyManager.provisionKeys).toHaveBeenCalledOnce();
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
        } as any,
      },
      fund: {
        chargeService: {
          fund: vi.fn().mockResolvedValue({ success: true, amountFunded: 100, chargeId: 'c-1', previousBalance: 0, newBalance: 100, dryRun: false }),
          isAvailable: vi.fn().mockReturnValue(true),
        } as any,
        creditPoolService: {
          checkAllocation: vi.fn().mockResolvedValue({ allowed: true, requestedAmount: 100, availableAfterReserve: 900, remainingAfterAllocation: 800 }),
        } as any,
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
    expect(bridgeResult.data?.fromChain).toBe('solana');
    expect(bridgeResult.data?.toChain).toBe('base');

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

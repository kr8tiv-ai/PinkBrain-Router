import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── DistributionService Tests ────────────────────────────────────

describe('DistributionService', () => {
  function createMockDb() {
    const snapshots: Array<Record<string, unknown>> = [];
    return {
      _snapshots: snapshots,
      prepare: (sql: string) => {
        if (sql.includes('INSERT') && sql.includes('allocation_snapshots')) {
          return {
            run: (...params: unknown[]) => {
              snapshots.push({
                snapshotId: params[0],
                runId: params[1],
                holderWallet: params[2],
                tokenBalance: params[3],
                allocationWeight: params[4],
                allocatedUsd: params[5],
              });
              return { changes: 1 };
            },
            get: () => null,
            all: () => [],
          };
        }
        if (sql.includes('SELECT') && sql.includes('allocation_snapshots')) {
          return {
            run: () => ({ changes: 0 }),
            get: () => null,
            all: (...p: unknown[]) => {
              // prepare().all(runId) — p[0] is the runId string directly
              const runId = p[0] as string;
              return snapshots
                .filter((s) => s.runId === runId)
                .map((s) => ({
                  snapshotId: s.snapshotId,
                  runId: s.runId,
                  holderWallet: s.holderWallet,
                  tokenBalance: s.tokenBalance,
                  allocationWeight: s.allocationWeight,
                  allocatedUsd: s.allocatedUsd,
                  keyHash: null,
                  createdAt: new Date().toISOString(),
                }));
            },
          };
        }
        return { run: () => ({ changes: 0 }), get: () => null, all: () => [] };
      },
      exec: () => {},
      pragma: () => {},
      transaction: (fn: () => unknown) => fn(),
      close: () => {},
    };
  }

  function createMockPool(overrides: Record<string, unknown> = {}) {
    return {
      checkAllocation: vi.fn().mockResolvedValue({
        allowed: true,
        requestedAmount: 300,
        availableAfterReserve: 900,
        remainingAfterAllocation: 600,
      }),
      recordAllocation: vi.fn(),
      ...overrides,
    };
  }

  function createMockStrategy(overrides: Record<string, unknown> = {}) {
    return {
      strategyId: 'test-strategy-1',
      ownerWallet: 'owner_wallet_1111111111111111111',
      distribution: 'TOP_N_HOLDERS',
      distributionTopN: 5,
      exclusionList: [] as string[],
      keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly' as const, expiryDays: 365 },
      ...overrides,
    } as any;
  }

  function createMockRun(overrides: Record<string, unknown> = {}) {
    return {
      runId: 'test-run-1',
      strategyId: 'test-strategy-1',
      fundedUsdc: 300,
      ...overrides,
    } as any;
  }

  const holders = [
    { wallet: 'holder_a_wallet_111111111111111', tokenBalance: '500' },
    { wallet: 'holder_b_wallet_111111111111111', tokenBalance: '300' },
    { wallet: 'holder_c_wallet_111111111111111', tokenBalance: '200' },
  ];

  it('should allocate proportionally for TOP_N_HOLDERS', async () => {
    const mockDb = createMockDb();
    const mockPool = createMockPool();
    const { DistributionService } = await import('../src/services/DistributionService.js');
    const service = new DistributionService({ db: mockDb as any, creditPoolService: mockPool as any });

    const result = await service.allocate(
      createMockRun(),
      createMockStrategy(),
      holders,
    );

    expect('success' in result).toBe(false); // not a PhaseResult, AllocationResult
    expect(result.holderCount).toBe(3);
    expect(result.totalAllocatedUsd).toBe(300);
    expect(result.allocationMode).toBe('TOP_N_HOLDERS');

    // Weighted: 500/1000 * 300 = 150
    const aAlloc = result.allocations.find((a) => a.holderWallet.includes('holder_a'));
    expect(aAlloc?.allocatedUsd).toBe(150);
  });

  it('should allocate equally for EQUAL_SPLIT', async () => {
    const mockDb = createMockDb();
    const mockPool = createMockPool();
    const { DistributionService } = await import('../src/services/DistributionService.js');
    const service = new DistributionService({ db: mockDb as any, creditPoolService: mockPool as any });

    const result = await service.allocate(
      createMockRun(),
      createMockStrategy({ distribution: 'EQUAL_SPLIT' }),
      holders,
    );

    expect(result.holderCount).toBe(3);
    // 300 / 3 = 100 each
    expect(result.allocations[0].allocatedUsd).toBe(100);
    expect(result.allocations[1].allocatedUsd).toBe(100);
    expect(result.allocations[2].allocatedUsd).toBe(100);
  });

  it('should allocate all to owner for OWNER_ONLY', async () => {
    const mockDb = createMockDb();
    const mockPool = createMockPool();
    const { DistributionService } = await import('../src/services/DistributionService.js');
    const service = new DistributionService({ db: mockDb as any, creditPoolService: mockPool as any });

    const result = await service.allocate(
      createMockRun(),
      createMockStrategy({ distribution: 'OWNER_ONLY', ownerWallet: 'holder_b_wallet_111111111111111' }),
      holders,
    );

    expect(result.holderCount).toBe(1);
    expect(result.allocations[0].holderWallet).toBe('holder_b_wallet_111111111111111');
    expect(result.allocations[0].allocatedUsd).toBe(300);
  });

  it('should filter excluded wallets', async () => {
    const mockDb = createMockDb();
    const mockPool = createMockPool();
    const { DistributionService } = await import('../src/services/DistributionService.js');
    const service = new DistributionService({ db: mockDb as any, creditPoolService: mockPool as any });

    const result = await service.allocate(
      createMockRun(),
      createMockStrategy({ exclusionList: ['holder_c_wallet_111111111111111'] }),
      holders,
    );

    expect(result.holderCount).toBe(2);
    expect(result.skippedHolders).toBe(1);
  });

  it('should skip allocation when fundedUsdc is zero', async () => {
    const mockDb = createMockDb();
    const mockPool = createMockPool();
    const { DistributionService } = await import('../src/services/DistributionService.js');
    const service = new DistributionService({ db: mockDb as any, creditPoolService: mockPool as any });

    const result = await service.allocate(
      createMockRun({ fundedUsdc: 0 }),
      createMockStrategy(),
      holders,
    );

    expect(result.totalAllocatedUsd).toBe(0);
    expect(result.holderCount).toBe(0);
  });

  it('should throw when pool reserve policy blocks allocation', async () => {
    const mockDb = createMockDb();
    const mockPool = createMockPool({
      checkAllocation: vi.fn().mockResolvedValue({
        allowed: false,
        reason: 'exceeds reserve',
        requestedAmount: 300,
        availableAfterReserve: 50,
        remainingAfterAllocation: -250,
      }),
    });
    const { DistributionService } = await import('../src/services/DistributionService.js');
    const service = new DistributionService({ db: mockDb as any, creditPoolService: mockPool as any });

    await expect(
      service.allocate(createMockRun(), createMockStrategy(), holders),
    ).rejects.toThrow('Allocation blocked by pool reserve policy');
  });

  it('should handle empty holder list', async () => {
    const mockDb = createMockDb();
    const mockPool = createMockPool();
    const { DistributionService } = await import('../src/services/DistributionService.js');
    const service = new DistributionService({ db: mockDb as any, creditPoolService: mockPool as any });

    const result = await service.allocate(
      createMockRun(),
      createMockStrategy(),
      [],
    );

    expect(result.totalAllocatedUsd).toBe(0);
    expect(result.holderCount).toBe(0);
  });

  it('should record pool allocation after success', async () => {
    const mockDb = createMockDb();
    const mockPool = createMockPool();
    const { DistributionService } = await import('../src/services/DistributionService.js');
    const service = new DistributionService({ db: mockDb as any, creditPoolService: mockPool as any });

    await service.allocate(createMockRun(), createMockStrategy(), holders);

    expect(mockPool.recordAllocation).toHaveBeenCalledWith('test-run-1', 300);
  });

  it('should persist snapshots to DB', async () => {
    const mockDb = createMockDb();
    const mockPool = createMockPool();
    const { DistributionService } = await import('../src/services/DistributionService.js');
    const service = new DistributionService({ db: mockDb as any, creditPoolService: mockPool as any });

    await service.allocate(createMockRun(), createMockStrategy(), holders);

    expect(mockDb._snapshots.length).toBe(3);
  });

  it('should retrieve snapshots by run ID', async () => {
    const mockDb = createMockDb();
    const mockPool = createMockPool();
    const { DistributionService } = await import('../src/services/DistributionService.js');
    const service = new DistributionService({ db: mockDb as any, creditPoolService: mockPool as any });

    await service.allocate(createMockRun(), createMockStrategy(), holders);

    // The mock DB stores snapshots keyed by runId — verify they were persisted
    expect(mockDb._snapshots.length).toBe(3);

    // getSnapshotsByRun reads from the same mock DB using the SELECT handler
    const saved = service.getSnapshotsByRun('test-run-1');
    expect(saved.length).toBe(3);
    expect(saved.every((s) => s.runId === 'test-run-1')).toBe(true);
  });
});

// ─── KeyManagerService Tests ──────────────────────────────────────

describe('KeyManagerService', () => {
  function createMockDb() {
    const keys: Array<Record<string, unknown>> = [];
    return {
      _keys: keys,
      prepare: (sql: string) => {
        if (sql.includes('INSERT') && sql.includes('user_keys')) {
          return {
            run: (...params: unknown[]) => {
              keys.push({
                keyId: params[0],
                strategyId: params[1],
                holderWallet: params[2],
                openrouterKeyHash: params[3],
                spendingLimitUsd: params[4],
              });
              return { changes: 1 };
            },
            get: () => null,
            all: () => [],
          };
        }
        if (sql.includes('SELECT') && sql.includes('user_keys')) {
          return {
            run: () => ({ changes: 0 }),
            get: (...p: unknown[]) => {
              const wallet = (p as unknown[])[0];
              const strategyId = (p as unknown[])[1];
              return keys.find(
                (k) => k.holderWallet === wallet && k.strategyId === strategyId && k.status === 'ACTIVE',
              ) || null;
            },
            all: (...p: unknown[]) => {
              const strategyId = (p as unknown[])[0];
              return keys.filter((k) => k.strategyId === strategyId);
            },
          };
        }
        if (sql.includes('UPDATE')) {
          return {
            run: () => ({ changes: 1 }),
            get: () => null,
            all: () => [],
          };
        }
        return { run: () => ({ changes: 0 }), get: () => null, all: () => [] };
      },
      exec: () => {},
      pragma: () => {},
      transaction: (fn: () => unknown) => fn(),
      close: () => {},
    };
  }

  let keyCounter = 0;
  function createMockORClient() {
    return {
      createKey: vi.fn().mockImplementation(async (params: { name: string; limit: number }) => {
        keyCounter++;
        return {
          key: `sk-or-test-${keyCounter}`,
          data: {
            hash: `hash-test-${keyCounter}`,
            name: params.name,
            disabled: false,
            limit: params.limit,
            limit_remaining: params.limit,
            usage: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            expires_at: null,
            usage_daily: 0,
            usage_weekly: 0,
            usage_monthly: 0,
          },
        };
      }),
      updateKey: vi.fn().mockResolvedValue({
        hash: 'hash-updated',
        name: 'key',
        disabled: false,
        limit: 0,
        limit_remaining: 0,
        usage: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        expires_at: null,
        usage_daily: 0,
        usage_weekly: 0,
        usage_monthly: 0,
      }),
    };
  }

  function createMockStrategy() {
    return {
      strategyId: 's1',
      keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly' as const, expiryDays: 365 },
    } as any;
  }

  it('should provision new keys for holders', async () => {
    const mockDb = createMockDb();
    const mockOR = createMockORClient();
    const { KeyManagerService } = await import('../src/services/KeyManagerService.js');
    const service = new KeyManagerService({ openRouterClient: mockOR as any, db: mockDb as any });

    const result = await service.provisionKeys(
      [
        { holderWallet: 'wallet_a', allocatedUsd: 50 },
        { holderWallet: 'wallet_b', allocatedUsd: 25 },
      ],
      createMockStrategy(),
    );

    expect(result.keysProvisioned).toBe(2);
    expect(result.keysFailed).toBe(0);
    expect(result.keyHashes.length).toBe(2);
    expect(mockOR.createKey).toHaveBeenCalledTimes(2);
  });

  it('should create keys with correct spending limits', async () => {
    const mockDb = createMockDb();
    const mockOR = createMockORClient();
    const { KeyManagerService } = await import('../src/services/KeyManagerService.js');
    const service = new KeyManagerService({ openRouterClient: mockOR as any, db: mockDb as any });

    await service.provisionKeys(
      [
        { holderWallet: 'wallet_a', allocatedUsd: 50 },
        { holderWallet: 'wallet_b', allocatedUsd: 25 },
      ],
      createMockStrategy(),
    );

    expect(mockOR.createKey).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
    expect(mockOR.createKey).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25 }),
    );
  });

  it('should name keys with strategy and wallet prefix', async () => {
    const mockDb = createMockDb();
    const mockOR = createMockORClient();
    const { KeyManagerService } = await import('../src/services/KeyManagerService.js');
    const service = new KeyManagerService({ openRouterClient: mockOR as any, db: mockDb as any });

    await service.provisionKeys(
      [{ holderWallet: 'wallet_abcdef12', allocatedUsd: 10 }],
      createMockStrategy(),
    );

    expect(mockOR.createKey).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^creditbrain-/),
      }),
    );
  });

  it('should update existing key limit when limit changes', async () => {
    const mockDb = createMockDb();
    // Pre-populate an active key for wallet_a
    mockDb._keys.push({
      keyId: 'existing-key-1',
      strategyId: 's1',
      holderWallet: 'wallet_a',
      openrouterKeyHash: 'hash-existing-1',
      spendingLimitUsd: 10,
      status: 'ACTIVE',
    });

    const mockOR = createMockORClient();
    const { KeyManagerService } = await import('../src/services/KeyManagerService.js');
    const service = new KeyManagerService({ openRouterClient: mockOR as any, db: mockDb as any });

    const result = await service.provisionKeys(
      [{ holderWallet: 'wallet_a', allocatedUsd: 50 }],
      createMockStrategy(),
    );

    expect(result.keysUpdated).toBe(1);
    expect(result.keysProvisioned).toBe(0);
    expect(mockOR.updateKey).toHaveBeenCalledWith('hash-existing-1', { limit: 50 });
  });

  it('should not update key when limit is unchanged', async () => {
    const mockDb = createMockDb();
    mockDb._keys.push({
      keyId: 'existing-key-1',
      strategyId: 's1',
      holderWallet: 'wallet_a',
      openrouterKeyHash: 'hash-existing-1',
      spendingLimitUsd: 50,
      status: 'ACTIVE',
    });

    const mockOR = createMockORClient();
    const { KeyManagerService } = await import('../src/services/KeyManagerService.js');
    const service = new KeyManagerService({ openRouterClient: mockOR as any, db: mockDb as any });

    const result = await service.provisionKeys(
      [{ holderWallet: 'wallet_a', allocatedUsd: 50 }],
      createMockStrategy(),
    );

    expect(result.keysUpdated).toBe(0);
    expect(result.keysProvisioned).toBe(0);
    expect(mockOR.updateKey).not.toHaveBeenCalled();
  });

  it('should track failed key provisions', async () => {
    const mockDb = createMockDb();
    const mockOR = createMockORClient();
    // Make createKey fail for wallet_a
    mockOR.createKey.mockRejectedValueOnce(new Error('Rate limited'));

    const { KeyManagerService } = await import('../src/services/KeyManagerService.js');
    const service = new KeyManagerService({ openRouterClient: mockOR as any, db: mockDb as any });

    const result = await service.provisionKeys(
      [
        { holderWallet: 'wallet_a', allocatedUsd: 50 },
        { holderWallet: 'wallet_b', allocatedUsd: 25 },
      ],
      createMockStrategy(),
    );

    expect(result.keysFailed).toBe(1);
    expect(result.keysProvisioned).toBe(1);
    expect(result.failedWallets.length).toBe(1);
    expect(result.failedWallets[0].wallet).toBe('wallet_a');
    expect(result.failedWallets[0].reason).toBe('Rate limited');
  });
});

// ─── Allocate Phase Tests ─────────────────────────────────────────

describe('allocate phase', () => {
  it('should allocate via DistributionService', async () => {
    const mockDist = {
      allocate: vi.fn().mockResolvedValue({
        snapshotId: 'snap-1',
        runId: 'run-1',
        holderCount: 3,
        totalAllocatedUsd: 300,
        allocationMode: 'TOP_N_HOLDERS',
        allocations: [],
        skippedHolders: 0,
      }),
    };

    const mockStrategyService = {
      getById: vi.fn().mockReturnValue({
        strategyId: 's1',
        ownerWallet: 'owner',
        distribution: 'TOP_N_HOLDERS',
        distributionTopN: 5,
        exclusionList: [],
      }),
    };

    const holders = [
      { wallet: 'a', tokenBalance: '100' },
      { wallet: 'b', tokenBalance: '200' },
    ];

    const { createAllocatePhase } = await import('../src/engine/phases/allocate.js');
    const phase = createAllocatePhase({
      distributionService: mockDist as any,
      strategyService: mockStrategyService as any,
      resolveHolders: async () => holders,
    });

    const run = {
      runId: 'run-1',
      strategyId: 's1',
      fundedUsdc: 300,
    } as any;

    const result = await phase(run);

    expect(result.success).toBe(true);
    expect(result.data?.allocatedUsd).toBe(300);
    expect(result.data?.holderCount).toBe(3);
    expect(mockDist.allocate).toHaveBeenCalledOnce();
  });

  it('should skip when no funded credits', async () => {
    const { createAllocatePhase } = await import('../src/engine/phases/allocate.js');
    const phase = createAllocatePhase({
      distributionService: { allocate: vi.fn() } as any,
      strategyService: { getById: vi.fn() } as any,
      resolveHolders: vi.fn(),
    });

    const run = {
      runId: 'run-1',
      strategyId: 's1',
      fundedUsdc: null,
    } as any;

    const result = await phase(run);

    expect(result.success).toBe(true);
    expect(result.data?.skipped).toBe(true);
  });

  it('should fail when strategy not found', async () => {
    const { createAllocatePhase } = await import('../src/engine/phases/allocate.js');
    const phase = createAllocatePhase({
      distributionService: { allocate: vi.fn() } as any,
      strategyService: { getById: vi.fn().mockReturnValue(null) } as any,
      resolveHolders: vi.fn(),
    });

    const run = {
      runId: 'run-1',
      strategyId: 's1',
      fundedUsdc: 300,
    } as any;

    const result = await phase(run);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('STRATEGY_NOT_FOUND');
  });

  it('should fail when holder resolution fails', async () => {
    const { createAllocatePhase } = await import('../src/engine/phases/allocate.js');
    const phase = createAllocatePhase({
      distributionService: { allocate: vi.fn() } as any,
      strategyService: {
        getById: vi.fn().mockReturnValue({
          strategyId: 's1',
          distribution: 'TOP_N_HOLDERS',
          exclusionList: [],
        }),
      } as any,
      resolveHolders: vi.fn().mockRejectedValue(new Error('Helius timeout')),
    });

    const run = {
      runId: 'run-1',
      strategyId: 's1',
      fundedUsdc: 300,
    } as any;

    const result = await phase(run);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('HOLDER_RESOLUTION_FAILED');
  });
});

// ─── Provision Phase Tests ───────────────────────────────────────

describe('provision phase', () => {
  it('should provision keys via KeyManagerService', async () => {
    const mockKeyMgr = {
      provisionKeys: vi.fn().mockResolvedValue({
        keysProvisioned: 2,
        keysUpdated: 1,
        keysFailed: 0,
        failedWallets: [],
        keyHashes: ['hash-1', 'hash-2', 'hash-3'],
      }),
    };

    const mockDist = {
      getSnapshotsByRun: vi.fn().mockReturnValue([
        {
          holderWallet: 'wallet_a',
          allocatedUsd: 100,
          keyHash: null,
        },
        {
          holderWallet: 'wallet_b',
          allocatedUsd: 50,
          keyHash: null,
        },
        {
          holderWallet: 'wallet_c',
          allocatedUsd: 50,
          keyHash: null,
        },
      ]),
    };

    const mockStrategyService = {
      getById: vi.fn().mockReturnValue({
        strategyId: 's1',
        keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly', expiryDays: 365 },
      }),
    };

    const { createProvisionPhase } = await import('../src/engine/phases/provision.js');
    const phase = createProvisionPhase({
      keyManagerService: mockKeyMgr as any,
      distributionService: mockDist as any,
      strategyService: mockStrategyService as any,
    });

    const run = {
      runId: 'run-1',
      strategyId: 's1',
      allocatedUsd: 200,
    } as any;

    const result = await phase(run);

    expect(result.success).toBe(true);
    expect(result.data?.keysProvisioned).toBe(2);
    expect(result.data?.keysUpdated).toBe(1);
    expect(mockKeyMgr.provisionKeys).toHaveBeenCalledOnce();
  });

  it('should skip when no allocated credits', async () => {
    const { createProvisionPhase } = await import('../src/engine/phases/provision.js');
    const phase = createProvisionPhase({
      keyManagerService: { provisionKeys: vi.fn() } as any,
      distributionService: { getSnapshotsByRun: vi.fn() } as any,
      strategyService: { getById: vi.fn() } as any,
    });

    const run = {
      runId: 'run-1',
      strategyId: 's1',
      allocatedUsd: null,
    } as any;

    const result = await phase(run);

    expect(result.success).toBe(true);
    expect(result.data?.skipped).toBe(true);
  });

  it('should skip when no allocation snapshots', async () => {
    const { createProvisionPhase } = await import('../src/engine/phases/provision.js');
    const phase = createProvisionPhase({
      keyManagerService: { provisionKeys: vi.fn() } as any,
      distributionService: { getSnapshotsByRun: vi.fn().mockReturnValue([]) } as any,
      strategyService: {
        getById: vi.fn().mockReturnValue({
          strategyId: 's1',
          keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly', expiryDays: 365 },
        }),
      } as any,
    });

    const run = {
      runId: 'run-1',
      strategyId: 's1',
      allocatedUsd: 200,
    } as any;

    const result = await phase(run);

    expect(result.success).toBe(true);
    expect(result.data?.skipped).toBe(true);
    expect(result.data?.reason).toContain('No allocation snapshots');
  });

  it('should fail when strategy not found', async () => {
    const { createProvisionPhase } = await import('../src/engine/phases/provision.js');
    const phase = createProvisionPhase({
      keyManagerService: { provisionKeys: vi.fn() } as any,
      distributionService: { getSnapshotsByRun: vi.fn() } as any,
      strategyService: { getById: vi.fn().mockReturnValue(null) } as any,
    });

    const run = {
      runId: 'run-1',
      strategyId: 's1',
      allocatedUsd: 200,
    } as any;

    const result = await phase(run);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('STRATEGY_NOT_FOUND');
  });
});

// ─── Full Phase Handler Map with Allocate/Provision ──────────────

describe('phase handler map with allocate/provision', () => {
  it('should create all 6 handlers with full deps', async () => {
    const { createPhaseHandlerMap } = await import('../src/engine/phases/index.js');

    const map = createPhaseHandlerMap({
      bridge: {
        bridgeService: {
          bridge: vi.fn().mockResolvedValue({ success: true, amountUsdc: 100, txHash: '0x' }),
          isAvailable: vi.fn().mockReturnValue(true),
          getCircuitBreakerState: vi.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }),
        } as any,
        recipientSolanaAddress: 'test-address',
      },
      fund: {
        chargeService: {
          fund: vi.fn().mockResolvedValue({ success: true, amountFunded: 100, chargeId: 'c-1', previousBalance: 0, newBalance: 100, dryRun: false }),
          isAvailable: vi.fn().mockReturnValue(true),
        } as any,
        creditPoolService: {
          checkAllocation: vi.fn().mockResolvedValue({ allowed: true }),
        } as any,
      },
      allocate: {
        distributionService: {
          allocate: vi.fn().mockResolvedValue({
            snapshotId: 'snap-1',
            runId: 'run-1',
            holderCount: 3,
            totalAllocatedUsd: 100,
            allocationMode: 'TOP_N_HOLDERS',
            allocations: [],
            skippedHolders: 0,
          }),
        } as any,
        strategyService: {
          getById: vi.fn().mockReturnValue({
            strategyId: 's1',
            distribution: 'TOP_N_HOLDERS',
            exclusionList: [],
          }),
        } as any,
        resolveHolders: async () => [],
      },
      provision: {
        keyManagerService: {
          provisionKeys: vi.fn().mockResolvedValue({
            keysProvisioned: 2,
            keysUpdated: 0,
            keysFailed: 0,
            failedWallets: [],
            keyHashes: [],
          }),
        } as any,
        distributionService: {
          getSnapshotsByRun: vi.fn().mockReturnValue([]),
        } as any,
        strategyService: {
          getById: vi.fn().mockReturnValue({
            strategyId: 's1',
            keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly', expiryDays: 365 },
          }),
        } as any,
      },
    });

    expect(map.size).toBe(6);
    expect(map.has('ALLOCATING')).toBe(true);
    expect(map.has('PROVISIONING')).toBe(true);
  });

  it('should use default stubs for allocate/provision without deps', async () => {
    const { createPhaseHandlerMap } = await import('../src/engine/phases/index.js');

    const map = createPhaseHandlerMap();
    expect(map.size).toBe(6);

    const allocHandler = map.get('ALLOCATING');
    const allocResult = await allocHandler!({ runId: 'r1', strategyId: 's1', fundedUsdc: 300 } as any);
    expect(allocResult.success).toBe(true);
    expect(allocResult.data?.allocatedUsd).toBe(300);

    const provHandler = map.get('PROVISIONING');
    const provResult = await provHandler!({ runId: 'r1', strategyId: 's1', allocatedUsd: 200 } as any);
    expect(provResult.success).toBe(true);
    expect(provResult.data?.keysProvisioned).toBe(2);
  });
});

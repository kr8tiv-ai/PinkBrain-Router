/**
 * S02 cycle integration test — validates the full allocation → provisioning pipeline
 * works end-to-end using real service instances with mock external dependencies.
 */
import { describe, it, expect, vi } from 'vitest';

describe('S02 integration cycle', () => {
  it('should complete a full allocate → provision cycle with durable state', async () => {
    // ─── Set up mock DB with all required tables ───────────────────
    const allocationSnapshots: Array<Record<string, unknown>> = [];
    const userKeys: Array<Record<string, unknown>> = [];
    const creditPoolAllocations: Array<Record<string, unknown>> = [];

    function mockDb() {
      return {
        prepare: (sql: string) => {
          // INSERT for allocation_snapshots
          if (sql.includes('INSERT') && sql.includes('allocation_snapshots')) {
            return {
              run: (...params: unknown[]) => {
                allocationSnapshots.push({
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
          // INSERT for user_keys
          if (sql.includes('INSERT') && sql.includes('user_keys')) {
            return {
              run: (...params: unknown[]) => {
                userKeys.push({
                  keyId: params[0],
                  strategyId: params[1],
                  holderWallet: params[2],
                  openrouterKeyHash: params[3],
                  openrouterKey: params[4],
                  spendingLimitUsd: params[5],
                });
                return { changes: 1 };
              },
              get: () => null,
              all: () => [],
            };
          }
          // INSERT for credit_pool_allocations
          if (sql.includes('INSERT') && sql.includes('credit_pool_allocations')) {
            return {
              run: (...params: unknown[]) => {
                creditPoolAllocations.push({
                  id: params[0],
                  runId: params[1],
                  amountUsd: params[2],
                });
                return { changes: 1 };
              },
              get: () => null,
              all: () => [],
            };
          }
          // SELECT for allocation_snapshots (getSnapshotsByRun)
          if (sql.includes('SELECT') && sql.includes('allocation_snapshots')) {
            return {
              run: () => ({ changes: 0 }),
              get: () => null,
              all: (...p: unknown[]) => {
                const runId = p[0] as string;
                return allocationSnapshots
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
          // SELECT for user_keys
          if (sql.includes('SELECT') && sql.includes('user_keys')) {
            return {
              run: () => ({ changes: 0 }),
              get: (...p: unknown[]) => {
                const wallet = p[0] as string;
                const strategyId = p[1] as string;
                return userKeys.find(
                  (k) => k.holderWallet === wallet && k.strategyId === strategyId && k.status === 'ACTIVE',
                ) || null;
              },
              all: (...p: unknown[]) => {
                const strategyId = p[0] as string;
                return userKeys.filter((k) => k.strategyId === strategyId);
              },
            };
          }
          // SUM for credit_pool_allocations
          if (sql.includes('SUM(amount_usdc)')) {
            return {
              run: () => ({ changes: 0 }),
              get: () => ({
                total: creditPoolAllocations.reduce(
                  (sum: number, row) => sum + (row.amountUsd as number || 0),
                  0,
                ),
              }),
              all: () => [],
            };
          }
          // UPDATE statements
          if (sql.includes('UPDATE')) {
            return {
              run: (...params: unknown[]) => {
                if (sql.includes('user_keys') && sql.includes('key_hash') === false) {
                  // updateKeyRecord or revoke
                  const keyId = params[params.length - 1] as string;
                  const key = userKeys.find((k) => k.keyId === keyId);
                  if (key) {
                    if (sql.includes('spending_limit_usd')) {
                      const idx = sql.indexOf('spending_limit_usd = ?');
                      key.spendingLimitUsd = params[sql.split('=').length - 2]; // rough extraction
                    }
                  }
                }
                if (sql.includes('allocation_snapshots') && sql.includes('key_hash')) {
                  // updateAllocationKeyHash
                  const holderIdx = allocationSnapshots.findIndex(
                    (s) => s.holderWallet === (params[1] as string) && s.keyHash === null,
                  );
                  if (holderIdx >= 0) {
                    allocationSnapshots[holderIdx].keyHash = params[0];
                  }
                }
                return { changes: 1 };
              },
              get: () => null,
              all: () => [],
            };
          }
          // Default: DDL and other statements
          return { run: () => ({ changes: 0 }), get: () => null, all: () => [] };
        },
        exec: () => {},
        pragma: () => {},
        transaction: (fn: () => unknown) => fn(),
        close: () => {},
      };
    }

    const db = mockDb();

    // ─── Mock OpenRouter client ───────────────────────────────────
    const mockORClient = {
      createKey: vi.fn().mockImplementation(async (params: { name: string; limit: number }) => {
        return {
          key: 'sk-or-integration-' + Math.random().toString(36).slice(2),
          data: {
            hash: 'hash-integration-' + Math.random().toString(36).slice(2),
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
      getAccountCredits: vi.fn().mockResolvedValue({
        total_credits: 1000,
        total_usage: 200,
      }),
    };

    // ─── Instantiate services ─────────────────────────────────────
    const { DistributionService } = await import('../../src/services/DistributionService.js');
    const { KeyManagerService } = await import('../../src/services/KeyManagerService.js');
    const { createAllocatePhase } = await import('../../src/engine/phases/allocate.js');
    const { createProvisionPhase } = await import('../../src/engine/phases/provision.js');

    const mockPoolService = {
      checkAllocation: vi.fn().mockResolvedValue({
        allowed: true,
        requestedAmount: 300,
        availableAfterReserve: 900,
        remainingAfterAllocation: 600,
      }),
      recordAllocation: vi.fn(),
    };

    const mockStrategyService = {
      getById: vi.fn().mockReturnValue({
        strategyId: 's1',
        ownerWallet: 'owner_wallet_1111111111111111111',
        distribution: 'TOP_N_HOLDERS',
        distributionTopN: 5,
        exclusionList: [],
        keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly', expiryDays: 365 },
      }),
    };

    const distributionService = new DistributionService({
      db: db as any,
      creditPoolService: mockPoolService as any,
    });

    const keyManagerService = new KeyManagerService({
      openRouterClient: mockORClient as any,
      db: db as any,
    });

    // ─── Execute ALLOCATING phase ─────────────────────────────────
    const holders = [
      { wallet: 'holder_a_wallet_111111111111111', tokenBalance: '500' },
      { wallet: 'holder_b_wallet_111111111111111', tokenBalance: '300' },
      { wallet: 'holder_c_wallet_111111111111111', tokenBalance: '200' },
    ];

    const allocatePhase = createAllocatePhase({
      distributionService,
      strategyService: mockStrategyService as any,
      resolveHolders: async () => holders,
    });

    const run = {
      runId: 'integration-run-1',
      strategyId: 's1',
      fundedUsdc: 300,
    } as any;

    const allocResult = await allocatePhase(run);

    // ─── Assert ALLOCATING results ────────────────────────────────
    expect(allocResult.success).toBe(true);
    expect(allocResult.data?.allocatedUsd).toBe(300);
    expect(allocResult.data?.holderCount).toBe(3);

    // Verify snapshots were persisted
    expect(allocationSnapshots.length).toBe(3);
    expect(
      allocationSnapshots.every((s) => s.runId === 'integration-run-1'),
    ).toBe(true);

    // Verify pool allocation was recorded
    expect(mockPoolService.recordAllocation).toHaveBeenCalledWith(
      'integration-run-1',
      300,
    );

    // ─── Execute PROVISIONING phase ───────────────────────────────
    const provisionPhase = createProvisionPhase({
      keyManagerService,
      distributionService,
      strategyService: mockStrategyService as any,
    });

    // Simulate the run state after allocation
    const runAfterAlloc = {
      ...run,
      allocatedUsd: 300,
    } as any;

    const provResult = await provisionPhase(runAfterAlloc);

    // ─── Assert PROVISIONING results ──────────────────────────────
    expect(provResult.success).toBe(true);
    expect(provResult.data?.keysProvisioned).toBe(3);
    expect(provResult.data?.keysFailed).toBe(0);
    expect(provResult.data?.keyHashes.length).toBe(3);

    // Verify keys were persisted
    expect(userKeys.length).toBe(3);
    expect(
      userKeys.every((k) => k.strategyId === 's1'),
    ).toBe(true);

    // Verify OpenRouter was called for each key
    expect(mockORClient.createKey).toHaveBeenCalledTimes(3);

    // Verify key limits match allocation weights
    // Holder A: 500/1000 * 300 = 150, Holder B: 300/1000 * 300 = 90, Holder C: 200/1000 * 300 = 60
    const createdKeyLimits = mockORClient.createKey.mock.calls.map(
      (call: Array<{ limit: number }>) => call[0].limit,
    );
    expect(createdKeyLimits).toContain(150);
    expect(createdKeyLimits).toContain(90);
    expect(createdKeyLimits).toContain(60);

    // ─── Verify durable state is queryable ────────────────────────
    const snapshots = distributionService.getSnapshotsByRun('integration-run-1');
    expect(snapshots.length).toBe(3);
    expect(snapshots.some((s) => s.holderWallet.includes('holder_a'))).toBe(true);
    expect(snapshots.some((s) => s.holderWallet.includes('holder_b'))).toBe(true);
    expect(snapshots.some((s) => s.holderWallet.includes('holder_c'))).toBe(true);
  });
});

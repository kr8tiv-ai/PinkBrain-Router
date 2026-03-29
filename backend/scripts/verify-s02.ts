/**
 * verify-s02.ts — S02 slice verification script
 *
 * Validates that the allocation, provisioning, and full-cycle paths work end-to-end.
 * Run: npx tsx scripts/verify-s02.ts [--phase bridge,fund,allocate,provision]
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { parseArgs } from 'node:util';

async function main() {
  const { values: args } = parseArgs({
    options: {
      phase: { type: 'string', default: 'allocate,provision' },
    },
    strict: false,
    allowPositionals: true,
  });

  const phases = (args.phase as string).split(',').map((p: string) => p.trim().toLowerCase());

  let passed = 0;
  let failed = 0;

  function check(name: string, fn: () => boolean | Promise<boolean>) {
    return Promise.resolve(fn()).then((ok) => {
      if (ok) {
        console.log(`  ✅ ${name}`);
        passed++;
      } else {
        console.log(`  ❌ ${name}`);
        failed++;
      }
    });
  }

  // ─── Phase: allocate ──────────────────────────────────────────────

  if (phases.includes('allocate')) {
    console.log('\n🔧 Verifying ALLOCATE phase...');

    try {
      const { DistributionService } = await import('../src/services/DistributionService.js');

      const snapshots: Record<string, unknown[]> = {};
      const mockDb = {
        prepare: (sql: string) => {
          if (sql.includes('INSERT') && sql.includes('allocation_snapshots')) {
            return {
              run: (...params: unknown[]) => {
                const runId = params[1] as string;
                if (!snapshots[runId]) snapshots[runId] = [];
                snapshots[runId].push(params);
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
                const runId = p[0] as string;
                return (snapshots[runId] || []).map((row: unknown[]) => ({
                  snapshotId: row[0],
                  runId: row[1],
                  holderWallet: row[2],
                  tokenBalance: row[3],
                  allocationWeight: row[4],
                  allocatedUsd: row[5],
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

      const mockPool = {
        checkAllocation: async (amount: number) => ({
          allowed: amount > 0 && amount <= 900,
          reason: amount > 900 ? 'exceeds reserve' : undefined,
          requestedAmount: amount,
          availableAfterReserve: 900,
          remainingAfterAllocation: 900 - amount,
        }),
        recordAllocation: (_runId: string, _amount: number) => {},
      };

      const distService = new DistributionService({ db: mockDb as any, creditPoolService: mockPool as any });

      const mockRun = {
        runId: 'verify-run-allocate',
        strategyId: 'strategy-1',
        fundedUsdc: 300,
      } as any;

      const mockStrategy = {
        strategyId: 'strategy-1',
        ownerWallet: 'owner_wallet_1111111111111111111',
        distribution: 'TOP_N_HOLDERS' as const,
        distributionTopN: 5,
        exclusionList: [],
        keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly' as const, expiryDays: 365 },
      } as any;

      const holders = [
        { wallet: 'holder_a_wallet_111111111111111', tokenBalance: '500' },
        { wallet: 'holder_b_wallet_111111111111111', tokenBalance: '300' },
        { wallet: 'holder_c_wallet_111111111111111', tokenBalance: '200' },
      ];

      await check('DistributionService.allocate returns correct result', async () => {
        const result = await distService.allocate(mockRun, mockStrategy, holders);
        return (
          result.holderCount === 3 &&
          result.totalAllocatedUsd === 300 &&
          result.allocationMode === 'TOP_N_HOLDERS' &&
          result.skippedHolders === 0
        );
      });

      await check('Allocations are weighted by holdings (TOP_N)', async () => {
        const result = await distService.allocate(mockRun, mockStrategy, holders);
        const aAlloc = result.allocations.find((a: { holderWallet: string }) => a.holderWallet === 'holder_a_wallet_111111111111111');
        return aAlloc !== undefined && aAlloc.allocatedUsd === 150;
      });

      await check('Exclusion list filters holders', async () => {
        const exclStrategy = { ...mockStrategy, exclusionList: ['holder_c_wallet_111111111111111'] };
        const result = await distService.allocate(mockRun, exclStrategy as any, holders);
        return result.holderCount === 2 && result.skippedHolders === 1;
      });

      await check('Zero funded credits skips allocation', async () => {
        const zeroRun = { ...mockRun, fundedUsdc: 0 };
        const result = await distService.allocate(zeroRun, mockStrategy, holders);
        return result.totalAllocatedUsd === 0 && result.holderCount === 0;
      });
    } catch (error) {
      console.log(`  ❌ ALLOCATE phase import/execution failed: ${(error as Error).message}`);
      failed++;
    }
  }

  // ─── Phase: provision ────────────────────────────────────────────

  if (phases.includes('provision')) {
    console.log('\n🔧 Verifying PROVISION phase...');

    try {
      const { KeyManagerService } = await import('../src/services/KeyManagerService.js');

      const keys: Array<Record<string, unknown>> = [];
      const mockDb = {
        prepare: (sql: string) => {
          if (sql.includes('INSERT') && sql.includes('user_keys')) {
            return {
              run: (...params: unknown[]) => {
                keys.push({ keyId: params[0], wallet: params[2], hash: params[3] });
                return { changes: 1 };
              },
              get: () => null,
              all: () => [],
            };
          }
          if (sql.includes('SELECT') && sql.includes('user_keys')) {
            return {
              run: () => ({ changes: 0 }),
              get: () => null,
              all: () => keys.map((k) => ({
                keyId: k.keyId,
                strategyId: 's1',
                holderWallet: k.wallet,
                openrouterKeyHash: k.hash,
                openrouterKey: 'sk-test-key',
                spendingLimitUsd: 10,
                currentUsageUsd: 0,
                status: 'ACTIVE',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                expiresAt: null,
              })),
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

      const createdKeys: Array<{ name: string; limit: number }> = [];
      const mockORClient = {
        createKey: async (params: { name: string; limit: number }) => {
          createdKeys.push(params);
          return {
            key: 'sk-or-new-' + Math.random().toString(36).slice(2),
            data: {
              hash: 'hash-' + Math.random().toString(36).slice(2),
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
        },
        updateKey: async (hash: string, params: { limit?: number; disabled?: boolean }) => {
          return {
            hash,
            name: 'updated-key',
            disabled: params.disabled ?? false,
            limit: params.limit ?? 0,
            limit_remaining: params.limit ?? 0,
            usage: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            expires_at: null,
            usage_daily: 0,
            usage_weekly: 0,
            usage_monthly: 0,
          };
        },
      };

      const kmService = new KeyManagerService({
        openRouterClient: mockORClient as any,
        db: mockDb as any,
      });

      const mockStrategy = {
        strategyId: 's1',
        keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly' as const, expiryDays: 365 },
      } as any;

      await check('KeyManagerService provisions new keys for holders', async () => {
        const result = await kmService.provisionKeys(
          [
            { holderWallet: 'wallet_a', allocatedUsd: 50 },
            { holderWallet: 'wallet_b', allocatedUsd: 25 },
          ],
          mockStrategy,
        );
        return result.keysProvisioned === 2 && result.keysFailed === 0;
      });

      await check('Key names follow naming convention', async () => {
        return createdKeys.every((k) => k.name.startsWith('creditbrain-'));
      });

      await check('Provisioned key limits match allocation', async () => {
        return (
          createdKeys.find((k) => k.name.includes('wallet_a'))?.limit === 50 &&
          createdKeys.find((k) => k.name.includes('wallet_b'))?.limit === 25
        );
      });

      await check('Key hashes are returned for audit', async () => {
        const result = await kmService.provisionKeys(
          [{ holderWallet: 'wallet_c', allocatedUsd: 15 }],
          mockStrategy,
        );
        return result.keyHashes.length === 1 && result.keyHashes[0].startsWith('hash-');
      });
    } catch (error) {
      console.log(`  ❌ PROVISION phase import/execution failed: ${(error as Error).message}`);
      failed++;
    }
  }

  // ─── Phase: bridge,fund ──────────────────────────────────────────

  if (phases.includes('bridge') || phases.includes('fund')) {
    console.log('\n🔧 Verifying BRIDGE/FUND phases (from T01)...');

    try {
      const { CctpBridgeService } = await import('../src/services/CctpBridgeService.js');
      const { CoinbaseChargeService } = await import('../src/services/CoinbaseChargeService.js');
      const { ExecutionPolicy } = await import('../src/engine/ExecutionPolicy.js');

      await check('CctpBridgeService is importable', () => CctpBridgeService !== undefined);
      await check('CoinbaseChargeService is importable', () => CoinbaseChargeService !== undefined);
      await check('ExecutionPolicy is importable', () => ExecutionPolicy !== undefined);
    } catch (error) {
      console.log(`  ❌ BRIDGE/FUND verification failed: ${(error as Error).message}`);
      failed++;
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(50)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('verify-s02 failed:', error);
  process.exit(1);
});

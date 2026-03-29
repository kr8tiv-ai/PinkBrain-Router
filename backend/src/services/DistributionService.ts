import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { DatabaseConnection } from './Database.js';
import type { AllocationSnapshot, Strategy, CreditRun } from '../types/index.js';
import type { CreditPoolService } from './CreditPoolService.js';

const logger = pino({ name: 'DistributionService' });

export interface HolderRecord {
  wallet: string;
  tokenBalance: string;
}

export interface AllocationResult {
  snapshotId: string;
  runId: string;
  holderCount: number;
  totalAllocatedUsd: number;
  allocationMode: string;
  allocations: Array<{
    holderWallet: string;
    tokenBalance: string;
    allocationWeight: number;
    allocatedUsd: number;
  }>;
  skippedHolders: number;
}

export interface DistributionServiceDeps {
  db: DatabaseConnection;
  creditPoolService: CreditPoolService;
}

/**
 * DistributionService calculates per-holder credit allocations from funded pool balance.
 *
 * Supports multiple distribution modes:
 * - OWNER_ONLY: all credits to strategy owner
 * - TOP_N_HOLDERS: distribute proportionally to top N token holders
 * - EQUAL_SPLIT: equal split across qualifying holders
 * - WEIGHTED_BY_HOLDINGS: weighted by token balance
 * - CUSTOM_LIST: distribute to a predefined list
 */
export class DistributionService {
  constructor(private readonly deps: DistributionServiceDeps) {}

  /**
   * Execute the allocation phase for a run.
   *
   * 1. Fetch qualifying holders (from Helius / DB cache)
   * 2. Filter out exclusion list
   * 3. Calculate per-holder allocations based on strategy distribution mode
   * 4. Verify total allocation is within pool reserve policy
   * 5. Persist allocation snapshots to DB
   */
  async allocate(
    run: CreditRun,
    strategy: Strategy,
    holders: HolderRecord[],
  ): Promise<AllocationResult> {
    const amountToAllocate = run.fundedUsdc ?? 0;

    if (amountToAllocate <= 0) {
      logger.warn(
        { runId: run.runId, fundedUsdc: run.fundedUsdc },
        'No funded credits available for allocation — skipping',
      );

      const snapshotId = randomUUID();
      return {
        snapshotId,
        runId: run.runId,
        holderCount: 0,
        totalAllocatedUsd: 0,
        allocationMode: strategy.distribution,
        allocations: [],
        skippedHolders: 0,
      };
    }

    // Filter out excluded wallets
    const exclusionSet = new Set(strategy.exclusionList.map((w) => w.toLowerCase()));
    const qualifying = holders.filter(
      (h) => !exclusionSet.has(h.wallet.toLowerCase()),
    );

    if (qualifying.length === 0) {
      logger.warn(
        { runId: run.runId, totalHolders: holders.length },
        'No qualifying holders after exclusions — allocation skipped',
      );

      const snapshotId = randomUUID();
      return {
        snapshotId,
        runId: run.runId,
        holderCount: 0,
        totalAllocatedUsd: 0,
        allocationMode: strategy.distribution,
        allocations: [],
        skippedHolders: holders.length,
      };
    }

    // Check pool capacity
    const poolCheck = await this.deps.creditPoolService.checkAllocation(amountToAllocate);
    if (!poolCheck.allowed) {
      throw new Error(`Allocation blocked by pool reserve policy: ${poolCheck.reason}`);
    }

    // Calculate allocations based on mode
    const allocations = this.calculateAllocations(
      qualifying,
      amountToAllocate,
      strategy,
    );

    // Persist allocation snapshots
    const snapshotId = randomUUID();
    this.persistSnapshots(snapshotId, run.runId, allocations);

    // Record the pool allocation
    this.deps.creditPoolService.recordAllocation(run.runId, amountToAllocate);

    logger.info(
      {
        runId: run.runId,
        snapshotId,
        holderCount: allocations.length,
        totalAllocated: amountToAllocate,
        mode: strategy.distribution,
      },
      'Allocation phase completed',
    );

    return {
      snapshotId,
      runId: run.runId,
      holderCount: allocations.length,
      totalAllocatedUsd: amountToAllocate,
      allocationMode: strategy.distribution,
      allocations,
      skippedHolders: holders.length - qualifying.length,
    };
  }

  /**
   * Get allocation snapshots for a run.
   */
  getSnapshotsByRun(runId: string): AllocationSnapshot[] {
    const rows = this.deps.db
      .prepare(
        `SELECT snapshot_id as snapshotId, run_id as runId, holder_wallet as holderWallet,
                token_balance as tokenBalance, allocation_weight as allocationWeight,
                allocated_usd as allocatedUsd, key_hash as keyHash, created_at as createdAt
         FROM allocation_snapshots
         WHERE run_id = ?
         ORDER BY allocated_usd DESC`,
      )
      .all<AllocationSnapshot>(runId);

    return rows;
  }

  /**
   * Get allocation history for a holder wallet.
   */
  getSnapshotsByHolder(holderWallet: string): AllocationSnapshot[] {
    const rows = this.deps.db
      .prepare(
        `SELECT snapshot_id as snapshotId, run_id as runId, holder_wallet as holderWallet,
                token_balance as tokenBalance, allocation_weight as allocationWeight,
                allocated_usd as allocatedUsd, key_hash as keyHash, created_at as createdAt
         FROM allocation_snapshots
         WHERE holder_wallet = ?
         ORDER BY created_at DESC`,
      )
      .all<AllocationSnapshot>(holderWallet);

    return rows;
  }

  /**
   * Calculate per-holder allocations based on strategy distribution mode.
   */
  private calculateAllocations(
    holders: HolderRecord[],
    totalUsd: number,
    strategy: Strategy,
  ): Array<{
    holderWallet: string;
    tokenBalance: string;
    allocationWeight: number;
    allocatedUsd: number;
  }> {
    switch (strategy.distribution) {
      case 'OWNER_ONLY':
        return this.allocateOwnerOnly(holders, totalUsd, strategy);

      case 'TOP_N_HOLDERS':
        return this.allocateTopN(holders, totalUsd, strategy);

      case 'EQUAL_SPLIT':
        return this.allocateEqualSplit(holders, totalUsd);

      case 'WEIGHTED_BY_HOLDINGS':
        return this.allocateWeightedByHoldings(holders, totalUsd);

      case 'CUSTOM_LIST':
        return this.allocateTopN(holders, totalUsd, strategy);

      default:
        return this.allocateTopN(holders, totalUsd, strategy);
    }
  }

  private allocateOwnerOnly(
    holders: HolderRecord[],
    totalUsd: number,
    strategy: Strategy,
  ) {
    // Find the owner in the holder list, or use the strategy owner
    const owner = holders.find(
      (h) => h.wallet.toLowerCase() === strategy.ownerWallet.toLowerCase(),
    );

    if (!owner) {
      logger.warn(
        { strategyOwner: strategy.ownerWallet },
        'Strategy owner not found in holder list — defaulting to first holder',
      );
    }

    const target = owner ?? holders[0];

    return [
      {
        holderWallet: target.wallet,
        tokenBalance: target.tokenBalance,
        allocationWeight: 1.0,
        allocatedUsd: totalUsd,
      },
    ];
  }

  private allocateTopN(
    holders: HolderRecord[],
    totalUsd: number,
    strategy: Strategy,
  ) {
    // Sort by token balance descending (assuming balance is numeric string)
    const sorted = [...holders].sort(
      (a, b) => Number(b.tokenBalance) - Number(a.tokenBalance),
    );

    const topN = sorted.slice(0, strategy.distributionTopN);

    // Weight by balance within top N
    const totalBalance = topN.reduce(
      (sum, h) => sum + Number(h.tokenBalance),
      0,
    );

    if (totalBalance === 0) {
      // If all balances are zero, equal split
      return this.allocateEqualSplit(topN, totalUsd);
    }

    return topN.map((h) => {
      const weight = Number(h.tokenBalance) / totalBalance;
      const perHolder = Math.floor((weight * totalUsd * 100) / 100); // 2 decimal precision
      return {
        holderWallet: h.wallet,
        tokenBalance: h.tokenBalance,
        allocationWeight: weight,
        allocatedUsd: perHolder,
      };
    });
  }

  private allocateEqualSplit(
    holders: HolderRecord[],
    totalUsd: number,
  ) {
    const perHolder = Math.floor((totalUsd / holders.length) * 100) / 100;
    const weight = 1 / holders.length;

    return holders.map((h) => ({
      holderWallet: h.wallet,
      tokenBalance: h.tokenBalance,
      allocationWeight: weight,
      allocatedUsd: perHolder,
    }));
  }

  private allocateWeightedByHoldings(
    holders: HolderRecord[],
    totalUsd: number,
  ) {
    return this.allocateTopN(
      holders,
      totalUsd,
      { distributionTopN: holders.length } as Strategy,
    );
  }

  private persistSnapshots(
    snapshotId: string,
    runId: string,
    allocations: Array<{
      holderWallet: string;
      tokenBalance: string;
      allocationWeight: number;
      allocatedUsd: number;
    }>,
  ): void {
    const stmt = this.deps.db.prepare(
      `INSERT INTO allocation_snapshots (snapshot_id, run_id, holder_wallet, token_balance, allocation_weight, allocated_usd)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const alloc of allocations) {
      stmt.run(
        `${snapshotId}-${alloc.holderWallet.slice(0, 8)}`,
        runId,
        alloc.holderWallet,
        alloc.tokenBalance,
        alloc.allocationWeight,
        alloc.allocatedUsd,
      );
    }

    logger.debug(
      { snapshotId, runId, count: allocations.length },
      'Allocation snapshots persisted',
    );
  }
}

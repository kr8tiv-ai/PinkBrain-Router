import pino from 'pino';
import type { OpenRouterClient } from '../clients/OpenRouterClient.js';
import type { DatabaseConnection } from './Database.js';

const logger = pino({ name: 'CreditPoolService' });

export interface PoolState {
  totalBalanceUsd: number;
  totalAllocatedUsd: number;
  availableUsd: number;
  reservePct: number;
  reservedUsd: number;
  lastUpdated: string;
}

export interface AllocationCheck {
  allowed: boolean;
  reason?: string;
  requestedAmount: number;
  availableAfterReserve: number;
  remainingAfterAllocation: number;
}

export class CreditPoolService {
  private reservePct: number;
  private cache: PoolState | null = null;
  private cacheExpiry = 0;
  private readonly cacheTtlMs = 60_000; // 1 minute cache

  constructor(
    private readonly openRouterClient: OpenRouterClient,
    private readonly db: DatabaseConnection,
    reservePct: number = 10,
  ) {
    this.reservePct = reservePct;
    this.ensureTable();
  }

  /**
   * Get the current credit pool state.
   * Combines live OpenRouter balance with local allocation tracking.
   */
  async getPoolState(): Promise<PoolState> {
    // Return cached state if still valid
    if (this.cache && Date.now() < this.cacheExpiry) {
      return this.cache;
    }

    // Fetch live credits from OpenRouter
    const credits = await this.openRouterClient.getAccountCredits();
    const totalBalanceUsd = credits.total_credits;

    // Get total allocated from local DB
    const totalAllocatedUsd = this.getTotalAllocated();

    const availableUsd = totalBalanceUsd - totalAllocatedUsd;
    const reservedUsd = totalBalanceUsd * (this.reservePct / 100);

    const state: PoolState = {
      totalBalanceUsd,
      totalAllocatedUsd,
      availableUsd,
      reservePct: this.reservePct,
      reservedUsd,
      lastUpdated: new Date().toISOString(),
    };

    this.cache = state;
    this.cacheExpiry = Date.now() + this.cacheTtlMs;

    logger.debug(state, 'Credit pool state refreshed');
    return state;
  }

  /**
   * Check if an allocation of the given amount is allowed by pool reserve policy.
   */
  async checkAllocation(amountUsd: number): Promise<AllocationCheck> {
    const pool = await this.getPoolState();
    const availableAfterReserve = pool.totalBalanceUsd - pool.reservedUsd - pool.totalAllocatedUsd;
    const remainingAfterAllocation = availableAfterReserve - amountUsd;

    if (amountUsd <= 0) {
      return {
        allowed: false,
        reason: 'Allocation amount must be positive',
        requestedAmount: amountUsd,
        availableAfterReserve,
        remainingAfterAllocation: availableAfterReserve,
      };
    }

    if (remainingAfterAllocation < 0) {
      return {
        allowed: false,
        reason: `Allocation $${amountUsd.toFixed(2)} exceeds available pool ($${availableAfterReserve.toFixed(2)} after ${this.reservePct}% reserve)`,
        requestedAmount: amountUsd,
        availableAfterReserve,
        remainingAfterAllocation,
      };
    }

    return {
      allowed: true,
      requestedAmount: amountUsd,
      availableAfterReserve,
      remainingAfterAllocation,
    };
  }

  /**
   * Record that credits were allocated (called after key provisioning).
   * This tracks the "committed" allocation so we don't over-allocate.
   */
  recordAllocation(runId: string, amountUsd: number): void {
    try {
      this.db
        .prepare(
          `INSERT INTO credit_pool_allocations (id, run_id, amount_usd, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          crypto.randomUUID(),
          runId,
          amountUsd,
          new Date().toISOString(),
        );

      this.invalidateCache();

      logger.info({ runId, amount: amountUsd }, 'Credit pool allocation recorded');
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to record allocation');
      throw error;
    }
  }

  /**
   * Get the pool status suitable for API responses and audit.
   */
  async getStatus(): Promise<{
    balance: number;
    allocated: number;
    available: number;
    reserve: number;
    runway: string;
  }> {
    const pool = await this.getPoolState();

    // Simple runway estimate: if consuming at current allocation rate
    const runwayDays = pool.totalAllocatedUsd > 0
      ? Math.floor(pool.availableUsd / (pool.totalAllocatedUsd / 30))
      : Infinity;

    return {
      balance: pool.totalBalanceUsd,
      allocated: pool.totalAllocatedUsd,
      available: pool.availableUsd,
      reserve: pool.reservedUsd,
      runway: runwayDays === Infinity ? 'unlimited' : `${runwayDays} days`,
    };
  }

  /** Force invalidate the cache to fetch fresh data on next call. */
  invalidateCache(): void {
    this.cache = null;
    this.cacheExpiry = 0;
  }

  /**
   * Get recent pool allocation history.
   */
  getPoolHistory(limit = 100): Array<{ id: string; runId: string; amountUsd: number; createdAt: string }> {
    const rows = this.db
      .prepare(
        `SELECT id, run_id as runId, amount_usd as amountUsd, created_at as createdAt
         FROM credit_pool_allocations
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all<{ id: string; runId: string; amountUsd: number; createdAt: string }>(limit);

    return rows;
  }

  /** Update the reserve percentage. */
  setReservePct(pct: number): void {
    if (pct < 0 || pct > 50) {
      throw new Error('Reserve percentage must be between 0 and 50');
    }
    this.reservePct = pct;
    this.invalidateCache();
    logger.info({ reservePct: pct }, 'Credit pool reserve percentage updated');
  }

  private getTotalAllocated(): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(amount_usd), 0) as total FROM credit_pool_allocations')
      .get<{ total: number }>();

    return row?.total ?? 0;
  }

  private ensureTable(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS credit_pool_allocations (
          id          TEXT PRIMARY KEY,
          run_id      TEXT NOT NULL,
          amount_usd  REAL NOT NULL,
          created_at  TEXT NOT NULL
        )
      `);
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to ensure credit_pool_allocations table');
    }
  }
}

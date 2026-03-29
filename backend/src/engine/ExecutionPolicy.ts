import pino from 'pino';
import type { Config } from '../config/index.js';
import type { DatabaseConnection } from '../services/Database.js';

const logger = pino({ name: 'ExecutionPolicy' });

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface PolicyState {
  dryRun: boolean;
  killSwitchActive: boolean;
  dailyRunCount: Record<string, number>;
  lastRunDate: string | null;
}

export class ExecutionPolicy {
  private dailyRunCounts: Map<string, number> = new Map();
  private lastRunDate: string | null = null;
  private readonly db?: DatabaseConnection;

  constructor(private readonly config: Config, db?: DatabaseConnection) {
    this.db = db;
    if (this.db) {
      this.hydrateDailyCounts();
    }
  }

  isDryRun(): boolean {
    return this.config.dryRun;
  }

  isKillSwitchActive(): boolean {
    return this.config.executionKillSwitch;
  }

  /**
   * Check whether a new run is allowed to start at all.
   * Validates kill switch, daily run limits, and global safety constraints.
   */
  canStartRun(strategyId?: string): PolicyCheckResult {
    if (this.isKillSwitchActive()) {
      return { allowed: false, reason: 'Kill switch is active' };
    }

    // Check daily run limit per strategy
    if (strategyId) {
      this.resetDailyCountsIfNeeded();
      const count = this.dailyRunCounts.get(strategyId) ?? 0;
      if (count >= this.config.maxDailyRuns) {
        return {
          allowed: false,
          reason: `Daily run limit (${this.config.maxDailyRuns}) reached for strategy ${strategyId}`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record that a run has started (for daily limit tracking).
   */
  recordRunStart(strategyId: string): void {
    this.resetDailyCountsIfNeeded();
    const count = this.dailyRunCounts.get(strategyId) ?? 0;
    const newCount = count + 1;
    this.dailyRunCounts.set(strategyId, newCount);
    logger.debug({ strategyId, count: newCount }, 'Run start recorded');

    if (this.db) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        this.db
          .prepare(
            'INSERT INTO daily_run_counts (strategy_id, date, count) VALUES (?, ?, ?) ON CONFLICT(strategy_id, date) DO UPDATE SET count = excluded.count',
          )
          .run(strategyId, today, newCount);
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), strategyId },
          'Failed to persist daily run count to DB — in-memory count still valid',
        );
      }
    }
  }

  /**
   * Check whether a specific phase is allowed to execute.
   * Kill switch blocks everything. Dry-run allows execution but logs it.
   * Additional per-phase checks for BRIDGING and FUNDING.
   */
  canExecutePhase(phase: string): PolicyCheckResult {
    if (this.isKillSwitchActive()) {
      return { allowed: false, reason: 'Kill switch is active' };
    }

    if (this.isDryRun()) {
      logger.info({ phase }, 'Dry run mode — simulating phase execution');
      return { allowed: true };
    }

    // Phase-specific safety checks
    switch (phase) {
      case 'BRIDGING':
        return this.checkBridgePolicy();
      case 'FUNDING':
        return this.checkFundingPolicy();
      default:
        return { allowed: true };
    }
  }

  /**
   * Check if a bridging amount exceeds safety limits.
   */
  canBridge(amountUsdc: number): PolicyCheckResult {
    if (this.isKillSwitchActive()) {
      return { allowed: false, reason: 'Kill switch is active' };
    }

    // Sanity check: don't bridge negative or zero amounts
    if (amountUsdc <= 0) {
      return { allowed: false, reason: 'Bridge amount must be positive' };
    }

    // Cap: prevent accidental bridging of very large amounts
    const maxBridgeAmount = this.config.maxClaimableSolPerRun * 100; // Rough SOL->USDC conversion cap
    if (amountUsdc > maxBridgeAmount) {
      return {
        allowed: false,
        reason: `Bridge amount $${amountUsdc.toFixed(2)} exceeds safety cap $${maxBridgeAmount.toFixed(2)} (based on max SOL per run)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if a funding amount is allowed by pool reserve policy.
   */
  canFund(amountUsdc: number, currentPoolBalance: number): PolicyCheckResult {
    if (this.isKillSwitchActive()) {
      return { allowed: false, reason: 'Kill switch is active' };
    }

    if (amountUsdc <= 0) {
      return { allowed: false, reason: 'Funding amount must be positive' };
    }

    // Check reserve: don't fund more than (100 - reservePct)% of pool
    const reservePct = this.config.creditPoolReservePct;
    const maxFundable = currentPoolBalance * ((100 - reservePct) / 100);

    if (amountUsdc > maxFundable) {
      return {
        allowed: false,
        reason: `Funding $${amountUsdc.toFixed(2)} would violate ${reservePct}% reserve (max fundable: $${maxFundable.toFixed(2)})`,
      };
    }

    return { allowed: true };
  }

  /**
   * Get the current policy state for diagnostics and API responses.
   */
  getState(): PolicyState {
    return {
      dryRun: this.isDryRun(),
      killSwitchActive: this.isKillSwitchActive(),
      dailyRunCount: Object.fromEntries(this.dailyRunCounts),
      lastRunDate: this.lastRunDate,
    };
  }

  private checkBridgePolicy(): PolicyCheckResult {
    // EVM private key required for on-chain bridge transactions
    if (!this.config.evmPrivateKey) {
      return {
        allowed: true,
        reason: 'No EVM private key configured — bridge will operate in simulation mode',
      };
    }
    return { allowed: true };
  }

  private checkFundingPolicy(): PolicyCheckResult {
    // OpenRouter management key is required (validated at config load)
    if (!this.config.openrouterManagementKey) {
      return {
        allowed: false,
        reason: 'OpenRouter management key not configured',
      };
    }
    return { allowed: true };
  }

  private resetDailyCountsIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (this.lastRunDate !== today) {
      this.dailyRunCounts.clear();
      this.lastRunDate = today;
      logger.debug({ date: today }, 'Daily run counters reset');

      if (this.db) {
        this.hydrateDailyCounts();
      }
    }
  }

  private hydrateDailyCounts(): void {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const rows = this.db!
        .prepare('SELECT strategy_id, count FROM daily_run_counts WHERE date = ?')
        .all(today) as Array<{ strategy_id: string; count: number }>;

      this.dailyRunCounts.clear();
      this.lastRunDate = today;

      for (const row of rows) {
        this.dailyRunCounts.set(row.strategy_id, row.count);
      }

      logger.debug({ date: today, strategies: rows.length }, 'Hydrated daily run counts from DB');
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Failed to hydrate daily run counts from DB — starting with empty counts',
      );
      this.dailyRunCounts.clear();
    }
  }
}

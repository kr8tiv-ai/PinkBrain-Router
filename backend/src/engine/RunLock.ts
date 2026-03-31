import pino from 'pino';
import type { DatabaseConnection } from '../services/Database.js';

const logger = pino({ name: 'RunLock' });

/** Stale lock threshold — locks older than this are automatically reaped. */
const STALE_LOCK_MINUTES = 30;

/**
 * Persistent concurrency lock backed by the `run_locks` SQLite table.
 *
 * Guarantees:
 *  - A strategy can only have one active lock at a time (PRIMARY KEY).
 *  - Locks survive process restarts — stale locks are cleaned up automatically.
 *  - Uses INSERT-OR-IGNORE + changes check for atomic acquire.
 */
export class RunLock {
  constructor(private readonly db: DatabaseConnection) {}

  /**
   * Attempt to acquire a lock for the given strategy.
   * Returns true if acquired, false if already held by another run.
   */
  acquire(strategyId: string, runId?: string): boolean {
    // Clean stale locks first (orphaned from crashed processes)
    this.cleanStaleLocks();

    const result = this.db
      .prepare(
        'INSERT OR IGNORE INTO run_locks (strategy_id, run_id) VALUES (?, ?)',
      )
      .run(strategyId, runId ?? null);

    if (result.changes && result.changes > 0) {
      logger.debug({ strategyId, runId }, 'Run lock acquired');
      return true;
    }

    logger.warn({ strategyId }, 'Run lock conflict — concurrent run rejected');
    return false;
  }

  /**
   * Release the lock for a strategy. No-op if not held.
   */
  release(strategyId: string): void {
    const result = this.db
      .prepare('DELETE FROM run_locks WHERE strategy_id = ?')
      .run(strategyId);

    if (result.changes && result.changes > 0) {
      logger.debug({ strategyId }, 'Run lock released');
    }
  }

  /**
   * Check whether a strategy currently holds a lock.
   */
  isLocked(strategyId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM run_locks WHERE strategy_id = ?')
      .get<{ '1': number }>(strategyId);
    return !!row;
  }

  /**
   * Clear all locks. Use during shutdown cleanup.
   */
  releaseAll(): void {
    this.db.prepare('DELETE FROM run_locks').run();
    logger.debug('All run locks released');
  }

  /**
   * Remove locks older than STALE_LOCK_MINUTES.
   * Protects against orphaned locks from crashed processes.
   */
  private cleanStaleLocks(): void {
    const result = this.db
      .prepare(
        `DELETE FROM run_locks WHERE locked_at < datetime('now', '-${STALE_LOCK_MINUTES} minutes')`,
      )
      .run();

    if (result.changes && result.changes > 0) {
      logger.info(
        { cleaned: result.changes, thresholdMinutes: STALE_LOCK_MINUTES },
        'Cleaned stale run locks',
      );
    }
  }
}

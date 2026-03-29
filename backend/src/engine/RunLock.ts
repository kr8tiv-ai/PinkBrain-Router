import pino from 'pino';

const logger = pino({ name: 'RunLock' });

/**
 * In-memory concurrency lock keyed by strategy ID.
 * Prevents concurrent pipeline runs for the same strategy.
 */
export class RunLock {
  private readonly locks: Map<string, boolean> = new Map();

  /**
   * Attempt to acquire a lock for the given strategy.
   * Returns true if acquired, false if already held by another run.
   */
  acquire(strategyId: string): boolean {
    if (this.locks.has(strategyId)) {
      logger.warn({ strategyId }, 'Run lock conflict — concurrent run rejected');
      return false;
    }
    this.locks.set(strategyId, true);
    logger.debug({ strategyId }, 'Run lock acquired');
    return true;
  }

  /**
   * Release the lock for a strategy. No-op if not held.
   */
  release(strategyId: string): void {
    if (!this.locks.has(strategyId)) {
      return;
    }
    this.locks.delete(strategyId);
    logger.debug({ strategyId }, 'Run lock released');
  }

  /**
   * Check whether a strategy currently holds a lock.
   */
  isLocked(strategyId: string): boolean {
    return this.locks.has(strategyId);
  }

  /**
   * Clear all locks. Use during shutdown cleanup.
   */
  releaseAll(): void {
    const count = this.locks.size;
    this.locks.clear();
    if (count > 0) {
      logger.debug({ count }, 'All run locks released');
    }
  }
}

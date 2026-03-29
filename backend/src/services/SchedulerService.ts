import cron, { type ScheduledTask } from 'node-cron';
import pino from 'pino';
import type { Config } from '../config/index.js';
import type { Strategy } from '../types/index.js';
import type { StrategyService } from './StrategyService.js';
import type { RunService } from './RunService.js';
import type { StateMachine } from '../engine/StateMachine.js';
import type { ExecutionPolicy } from '../engine/ExecutionPolicy.js';
import type { RunLock } from '../engine/RunLock.js';

const logger = pino({ name: 'SchedulerService' });

export interface SchedulerServiceDeps {
  strategyService: StrategyService;
  runService: RunService;
  stateMachine: StateMachine;
  executionPolicy: ExecutionPolicy;
  runLock: RunLock;
  config: Config;
}

/**
 * Cron-based automation engine that queries ACTIVE strategies,
 * schedules each via node-cron, and fires pipeline runs on schedule.
 */
export class SchedulerService {
  private readonly deps: SchedulerServiceDeps;
  private readonly scheduledJobs: Map<string, ScheduledTask> = new Map();

  constructor(deps: SchedulerServiceDeps) {
    this.deps = deps;
  }

  /**
   * Start the scheduler: query ACTIVE strategies, validate and schedule each.
   * Strategies with invalid cron expressions or intervals below the minimum
   * are skipped with a warning log.
   */
  async start(): Promise<void> {
    let strategies: Strategy[];
    try {
      strategies = this.deps.strategyService.getAll();
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Failed to query strategies — starting with zero scheduled jobs',
      );
      return;
    }

    const activeStrategies = strategies.filter((s) => s.status === 'ACTIVE');

    for (const strategy of activeStrategies) {
      this.scheduleStrategy(strategy);
    }

    logger.info(
      { total: activeStrategies.length, scheduled: this.scheduledJobs.size },
      'Scheduler started',
    );
  }

  /**
   * Stop all scheduled cron jobs and clear the job map.
   */
  stop(): void {
    for (const [strategyId, task] of this.scheduledJobs) {
      try {
        task.stop();
      } catch (err) {
        logger.warn(
          { strategyId, err: err instanceof Error ? err.message : String(err) },
          'Error stopping scheduled job',
        );
      }
    }
    const count = this.scheduledJobs.size;
    this.scheduledJobs.clear();
    logger.info({ count }, 'All scheduled jobs stopped');
  }

  /**
   * Returns the number of currently scheduled jobs (useful for health checks).
   */
  getScheduledCount(): number {
    return this.scheduledJobs.size;
  }

  /**
   * Validate and schedule a single strategy's cron job.
   */
  private scheduleStrategy(strategy: Strategy): void {
    const { strategyId, schedule } = strategy;

    // Validate cron expression
    if (!cron.validate(schedule)) {
      logger.warn(
        { strategyId, schedule },
        'Strategy has invalid cron expression — skipping',
      );
      return;
    }

    // Validate minimum interval
    if (!this.meetsMinimumInterval(schedule)) {
      logger.warn(
        { strategyId, schedule, minHours: this.deps.config.minCronIntervalHours },
        'Strategy schedule interval below minimum — skipping',
      );
      return;
    }

    // Skip if already scheduled (shouldn't happen but guard anyway)
    if (this.scheduledJobs.has(strategyId)) {
      logger.debug({ strategyId }, 'Strategy already scheduled — skipping duplicate');
      return;
    }

    const task = cron.schedule(schedule, () => {
      this.executeStrategyRun(strategyId).catch((err) => {
        logger.error(
          { strategyId, err: err instanceof Error ? err.message : String(err) },
          'Unhandled error in scheduled strategy run',
        );
      });
    });

    this.scheduledJobs.set(strategyId, task);
    logger.info({ strategyId, schedule }, 'Strategy scheduled');
  }

  /**
   * Execute a pipeline run for a given strategy.
   * Checks ExecutionPolicy and RunLock before creating the run.
   */
  private async executeStrategyRun(strategyId: string): Promise<void> {
    // Check execution policy
    const policyCheck = this.deps.executionPolicy.canStartRun(strategyId);
    if (!policyCheck.allowed) {
      logger.info(
        { strategyId, reason: policyCheck.reason },
        'Scheduled run blocked by execution policy',
      );
      return;
    }

    // Acquire run lock
    if (!this.deps.runLock.acquire(strategyId)) {
      logger.warn(
        { strategyId },
        'Scheduled run skipped — concurrent run in progress',
      );
      return;
    }

    try {
      // Create the run
      const run = this.deps.runService.create(strategyId);
      this.deps.executionPolicy.recordRunStart(strategyId);

      logger.info(
        { runId: run.runId, strategyId },
        'Scheduled pipeline run started',
      );

      // Execute via StateMachine
      await this.deps.stateMachine.execute(run);
    } catch (err) {
      logger.error(
        { strategyId, err: err instanceof Error ? err.message : String(err) },
        'Scheduled run failed',
      );
    } finally {
      this.deps.runLock.release(strategyId);
    }
  }

  /**
   * Simple heuristic to check if a cron expression's interval meets
   * the configured minimum hours. Handles common patterns:
   *   star-slash-N minutes → N minutes
   *   0 star-slash-N hours → N hours
   *   0 0 → 24 hours (daily)
   * Returns true if interval >= minCronIntervalHours, or if it can't be parsed (fail open).
   */
  private meetsMinimumInterval(expression: string): boolean {
    const minHours = this.deps.config.minCronIntervalHours;
    const parts = expression.trim().split(/\s+/);

    if (parts.length < 5) return false;

    const minute = parts[0];
    const hour = parts[1];

    // `0 */N * * *` → every N hours
    const hourMatch = hour.match(/^\*\/(\d+)$/);
    if (hourMatch) {
      return parseInt(hourMatch[1], 10) >= minHours;
    }

    // `*/N * * * *` → every N minutes
    const minuteMatch = minute.match(/^\*\/(\d+)$/);
    if (minuteMatch) {
      const intervalMinutes = parseInt(minuteMatch[1], 10);
      return (intervalMinutes / 60) >= minHours;
    }

    // Specific hour pattern like `0 0 * * *` (daily = 24h) or `30 4 * * *` (1x/day = 24h)
    // If hour is a specific value (not `*` or `*/N`), it fires once per day → 24h
    if (!hour.includes('*')) {
      return 24 >= minHours;
    }

    // If hour is `*` (every hour) → 1 hour
    if (hour === '*') {
      return 1 >= minHours;
    }

    // Can't parse — allow it (fail open for uncommon patterns)
    return true;
  }
}

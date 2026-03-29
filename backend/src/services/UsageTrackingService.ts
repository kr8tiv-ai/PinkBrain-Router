import pino from 'pino';
import { randomUUID } from 'node:crypto';
import type { OpenRouterClient } from '../clients/OpenRouterClient.js';
import type { DatabaseConnection } from './Database.js';

const logger = pino({ name: 'UsageTrackingService' });

interface UsageSnapshotRow {
  id: string;
  key_hash: string;
  strategy_id: string;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  limit_remaining: number | null;
  limit: number | null;
  polled_at: string;
}

export class UsageTrackingService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly openRouterClient: OpenRouterClient;
  private readonly db: DatabaseConnection;

  constructor(openRouterClient: OpenRouterClient, db: DatabaseConnection) {
    this.openRouterClient = openRouterClient;
    this.db = db;
  }

  start(intervalMs = 900_000): void {
    if (this.timer) {
      logger.warn('UsageTrackingService already running, ignoring start()');
      return;
    }
    logger.info({ intervalMs }, 'UsageTrackingService starting');
    this.pollAllKeys();
    this.timer = setInterval(() => this.pollAllKeys(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('UsageTrackingService stopped');
    }
  }

  async pollAllKeys(): Promise<void> {
    let keys: Array<{ openrouterKeyHash: string; strategyId: string }>;
    try {
      keys = this.db
        .prepare("SELECT openrouter_key_hash as openrouterKeyHash, strategy_id as strategyId FROM user_keys WHERE status = 'ACTIVE'")
        .all() as Array<{ openrouterKeyHash: string; strategyId: string }>;
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Failed to query active keys from user_keys');
      return;
    }

    if (keys.length === 0) {
      logger.debug('No active keys found, skipping usage poll cycle');
      return;
    }

    logger.info({ keyCount: keys.length }, 'Usage poll cycle starting');

    let successCount = 0;
    let errorCount = 0;

    for (const key of keys) {
      try {
        const keyData = await this.openRouterClient.getKey(key.openrouterKeyHash);
        const now = new Date().toISOString();
        const id = randomUUID();

        try {
          this.db
            .prepare(
              `INSERT INTO usage_snapshots (id, key_hash, strategy_id, usage, usage_daily, usage_weekly, usage_monthly, limit_remaining, limit, polled_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(id, keyData.hash, key.strategyId, keyData.usage, keyData.usage_daily, keyData.usage_weekly, keyData.usage_monthly, keyData.limit_remaining, keyData.limit, now);
          successCount++;
          logger.debug({ hash: keyData.hash }, 'Usage snapshot persisted');
        } catch (insertErr) {
          logger.error({ hash: keyData.hash, err: (insertErr as Error).message }, 'Failed to persist usage snapshot');
          errorCount++;
        }
      } catch (fetchErr) {
        logger.error({ hash: key.openrouterKeyHash, err: (fetchErr as Error).message }, 'Failed to fetch usage for key');
        errorCount++;
      }
    }

    logger.info({ successCount, errorCount, totalKeys: keys.length }, 'Usage poll cycle completed');
  }

  getKeyUsage(keyHash: string, limit = 100): UsageSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT id, key_hash as key_hash, strategy_id as strategy_id, usage, usage_daily, usage_weekly, usage_monthly, limit_remaining, limit, polled_at
         FROM usage_snapshots
         WHERE key_hash = ?
         ORDER BY polled_at DESC
         LIMIT ?`,
      )
      .all(keyHash, limit) as UsageSnapshotRow[];
  }

  getStrategyUsage(strategyId: string, limit = 100): UsageSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT id, key_hash as key_hash, strategy_id as strategy_id, usage, usage_daily, usage_weekly, usage_monthly, limit_remaining, limit, polled_at
         FROM usage_snapshots
         WHERE strategy_id = ?
         ORDER BY polled_at DESC
         LIMIT ?`,
      )
      .all(strategyId, limit) as UsageSnapshotRow[];
  }
}

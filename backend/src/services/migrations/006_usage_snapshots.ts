import type { DatabaseConnection } from '../Database.js';

export const migration = {
  version: 6,
  name: 'usage_snapshots',
  up: (db: DatabaseConnection): void => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_snapshots (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        usage REAL NOT NULL DEFAULT 0,
        usage_daily REAL NOT NULL DEFAULT 0,
        usage_weekly REAL NOT NULL DEFAULT 0,
        usage_monthly REAL NOT NULL DEFAULT 0,
        limit_remaining REAL,
        limit REAL,
        polled_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_usage_key_hash ON usage_snapshots(key_hash);
      CREATE INDEX IF NOT EXISTS idx_usage_strategy_polled ON usage_snapshots(strategy_id, polled_at);
    `);
  },
};

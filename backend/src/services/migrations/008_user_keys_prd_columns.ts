import type { DatabaseConnection } from '../Database.js';

export const migration = {
  version: 8,
  name: 'user_keys_prd_columns',
  up: (db: DatabaseConnection): void => {
    db.exec(`
      ALTER TABLE user_keys ADD COLUMN total_allocated_usd REAL NOT NULL DEFAULT 0;
      ALTER TABLE user_keys ADD COLUMN last_synced_at TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_keys_strategy_wallet ON user_keys(strategy_id, holder_wallet);
    `);
  },
};

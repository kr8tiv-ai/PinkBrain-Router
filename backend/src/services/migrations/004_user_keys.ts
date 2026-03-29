import type { DatabaseConnection } from '../Database.js';

export const migration = {
  version: 4,
  name: 'user_keys',
  up: (db: DatabaseConnection): void => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_keys (
        key_id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        holder_wallet TEXT NOT NULL,
        openrouter_key_hash TEXT NOT NULL,
        openrouter_key TEXT,
        spending_limit_usd REAL NOT NULL,
        current_usage_usd REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
      );

      CREATE INDEX IF NOT EXISTS idx_user_keys_strategy ON user_keys(strategy_id);
      CREATE INDEX IF NOT EXISTS idx_user_keys_hash ON user_keys(openrouter_key_hash);
      CREATE INDEX IF NOT EXISTS idx_user_keys_status ON user_keys(status);
    `);
  },
};

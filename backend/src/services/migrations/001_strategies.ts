import type { DatabaseConnection } from '../Database.js';

export const migration = {
  version: 1,
  name: 'strategies',
  up: (db: DatabaseConnection): void => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS strategies (
        strategy_id TEXT PRIMARY KEY,
        owner_wallet TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'CLAIMABLE_POSITIONS',
        distribution_token TEXT NOT NULL DEFAULT '',
        swap_config TEXT NOT NULL DEFAULT '{"slippageBps":50,"maxPriceImpactBps":300}',
        distribution_mode TEXT NOT NULL DEFAULT 'TOP_N_HOLDERS',
        distribution_top_n INTEGER NOT NULL DEFAULT 100,
        key_config TEXT NOT NULL DEFAULT '{"defaultLimitUsd":10,"limitReset":"monthly","expiryDays":365}',
        credit_pool_reserve_pct REAL NOT NULL DEFAULT 10,
        exclusion_list TEXT NOT NULL DEFAULT '[]',
        schedule TEXT NOT NULL DEFAULT '0 */6 * * *',
        min_claim_threshold REAL NOT NULL DEFAULT 5,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        last_run_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_strategies_owner ON strategies(owner_wallet);
      CREATE INDEX IF NOT EXISTS idx_strategies_status ON strategies(status);
    `);
  },
};

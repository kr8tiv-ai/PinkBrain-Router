import type { DatabaseConnection } from '../Database.js';

export const migration = {
  version: 2,
  name: 'runs',
  up: (db: DatabaseConnection): void => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'PENDING',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        claimed_sol REAL,
        claimed_tx_sig TEXT,
        swapped_usdc REAL,
        swap_tx_sig TEXT,
        swap_quote_snapshot TEXT,
        bridged_usdc REAL,
        bridge_tx_hash TEXT,
        funded_usdc REAL,
        funding_tx_hash TEXT,
        allocated_usdc REAL,
        keys_provisioned INTEGER DEFAULT 0,
        keys_updated INTEGER DEFAULT 0,
        error_code TEXT,
        error_detail TEXT,
        error_failed_state TEXT,
        FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
      );

      CREATE INDEX IF NOT EXISTS idx_runs_strategy ON runs(strategy_id);
      CREATE INDEX IF NOT EXISTS idx_runs_state ON runs(state);
      CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
    `);
  },
};

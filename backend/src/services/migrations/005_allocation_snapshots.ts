import type { DatabaseConnection } from '../Database.js';

export const migration = {
  version: 5,
  name: 'allocation_snapshots',
  up: (db: DatabaseConnection): void => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS allocation_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        holder_wallet TEXT NOT NULL,
        token_balance TEXT NOT NULL,
        allocation_weight REAL NOT NULL,
        allocated_usd REAL NOT NULL,
        key_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (run_id) REFERENCES runs(run_id)
      );

      CREATE INDEX IF NOT EXISTS idx_allocation_run ON allocation_snapshots(run_id);
      CREATE INDEX IF NOT EXISTS idx_allocation_holder ON allocation_snapshots(holder_wallet);
    `);
  },
};

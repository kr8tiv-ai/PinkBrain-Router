import type { DatabaseConnection } from '../Database.js';

export const migration_010_run_locks = {
  version: 10,
  name: 'run_locks',
  up(db: DatabaseConnection): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS run_locks (
        strategy_id TEXT PRIMARY KEY,
        locked_at   TEXT NOT NULL DEFAULT (datetime('now')),
        run_id      TEXT
      )
    `);
  },
};

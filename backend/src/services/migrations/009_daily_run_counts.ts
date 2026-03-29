import type { DatabaseConnection } from '../Database.js';

export const migration = {
  version: 9,
  name: 'daily_run_counts',
  up: (db: DatabaseConnection): void => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_run_counts (
        strategy_id TEXT NOT NULL,
        date        TEXT NOT NULL,
        count       INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (strategy_id, date)
      )
    `);
  },
};

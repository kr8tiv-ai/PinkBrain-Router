import type { DatabaseConnection } from '../Database.js';

export const migration = {
  version: 3,
  name: 'audit_log',
  up: (db: DatabaseConnection): void => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        log_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        tx_signature TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (run_id) REFERENCES runs(run_id)
      );

      CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_log(run_id);
      CREATE INDEX IF NOT EXISTS idx_audit_phase ON audit_log(phase);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    `);
  },
};

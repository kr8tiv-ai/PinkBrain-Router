import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { DatabaseConnection } from './Database.js';
import type { AuditLogEntry, RunState } from '../types/index.js';

const logger = pino({ name: 'AuditService' });

export class AuditService {
  constructor(private readonly db: DatabaseConnection) {}

  logTransition(
    runId: string,
    phase: RunState,
    action: string,
    details: Record<string, unknown>,
    txSignature?: string,
  ): AuditLogEntry {
    const entry: AuditLogEntry = {
      logId: randomUUID(),
      runId,
      phase,
      action,
      details,
      txSignature,
      timestamp: new Date().toISOString(),
    };

    try {
      this.db
        .prepare(
          `INSERT INTO audit_log (log_id, run_id, phase, action, details, tx_signature, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.logId,
          entry.runId,
          entry.phase,
          entry.action,
          JSON.stringify(entry.details),
          entry.txSignature ?? null,
          entry.timestamp,
        );

      logger.debug(
        { logId: entry.logId, runId, phase, action },
        'Audit log entry recorded',
      );
    } catch (error) {
      logger.error(
        { logId: entry.logId, runId, phase, error: (error as Error).message },
        'Failed to write audit log entry',
      );
      // Audit failures should not crash the pipeline
    }

    return entry;
  }

  getByRunId(runId: string): AuditLogEntry[] {
    const rows = this.db
      .prepare(
        `SELECT log_id as logId, run_id as runId, phase, action, details, tx_signature as txSignature, timestamp
         FROM audit_log WHERE run_id = ? ORDER BY timestamp ASC`,
      )
      .all<AuditLogEntry>(runId);

    return rows.map((row) => ({
      ...row,
      details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
    }));
  }

  getLatest(runId: string): AuditLogEntry | null {
    const row = this.db
      .prepare(
        `SELECT log_id as logId, run_id as runId, phase, action, details, tx_signature as txSignature, timestamp
         FROM audit_log WHERE run_id = ? ORDER BY timestamp DESC LIMIT 1`,
      )
      .get<AuditLogEntry>(runId);

    if (!row) return null;
    return {
      ...row,
      details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
    };
  }
}

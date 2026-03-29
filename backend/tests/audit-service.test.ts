import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditService } from '../src/services/AuditService.js';

function createMockDb() {
  const rows: Array<Record<string, unknown>> = [];

  return {
    _rows: rows,
    prepare: (sql: string) => {
      if (sql.includes('INSERT') && sql.includes('audit_log')) {
        return {
          run: (...params: unknown[]) => {
            rows.push({
              logId: params[0],
              runId: params[1],
              phase: params[2],
              action: params[3],
              details: params[4], // stored as JSON string
              txSignature: params[5],
              timestamp: params[6],
            });
            return { changes: 1 };
          },
          get: () => null,
          all: () => [],
        };
      }

      if (sql.includes('SELECT') && sql.includes('audit_log')) {
        return {
          run: () => ({ changes: 0 }),
          get: (...p: unknown[]) => {
            const runId = p[0] as string;
            const filtered = rows.filter((r) => r.runId === runId);
            if (filtered.length === 0) return null;
            // DESC LIMIT 1 — getLatest returns most recent
            return filtered[filtered.length - 1];
          },
          all: (...p: unknown[]) => {
            const runId = p[0] as string;
            return rows.filter((r) => r.runId === runId);
          },
        };
      }

      return { run: () => ({ changes: 0 }), get: () => null, all: () => [] };
    },
    exec: () => {},
    pragma: () => {},
    transaction: (fn: () => unknown) => fn(),
    close: () => {},
  };
}

describe('AuditService', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let service: AuditService;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new AuditService(mockDb as any);
  });

  it('logTransition() inserts a row with correct fields and returns the entry', () => {
    const entry = service.logTransition(
      'run-1',
      'PENDING',
      'transition:PENDING->CLAIMING',
      { fromPhase: 'PENDING', toPhase: 'CLAIMING' },
    );

    expect(entry.logId).toBeDefined();
    expect(entry.runId).toBe('run-1');
    expect(entry.phase).toBe('PENDING');
    expect(entry.action).toBe('transition:PENDING->CLAIMING');
    expect(entry.details).toEqual({ fromPhase: 'PENDING', toPhase: 'CLAIMING' });
    expect(entry.timestamp).toBeDefined();
    expect(entry.txSignature).toBeUndefined();

    expect(mockDb._rows.length).toBe(1);
    expect(mockDb._rows[0].runId).toBe('run-1');
  });

  it('logTransition() with txSignature persists it', () => {
    const entry = service.logTransition(
      'run-2',
      'CLAIMING',
      'transition:CLAIMING->SWAPPING',
      { fromPhase: 'CLAIMING', toPhase: 'SWAPPING', claimedSol: 1.5 },
      'sig-tx-abc123',
    );

    expect(entry.txSignature).toBe('sig-tx-abc123');
    expect(mockDb._rows[0].txSignature).toBe('sig-tx-abc123');
  });

  it('logTransition() does not throw on DB write failure (swallows error)', () => {
    const failingDb = {
      prepare: () => ({
        run: () => {
          throw new Error('Database is locked');
        },
        get: () => null,
        all: () => [],
      }),
      exec: () => {},
      pragma: () => {},
      transaction: (fn: () => unknown) => fn(),
      close: () => {},
    };

    const failingService = new AuditService(failingDb as any);

    // Should not throw — audit failures are swallowed
    expect(() =>
      failingService.logTransition('run-1', 'PENDING', 'action', {}),
    ).not.toThrow();
  });

  it('logTransition() returns entry even when DB write fails', () => {
    const failingDb = {
      prepare: () => ({
        run: () => {
          throw new Error('Database is locked');
        },
        get: () => null,
        all: () => [],
      }),
      exec: () => {},
      pragma: () => {},
      transaction: (fn: () => unknown) => fn(),
      close: () => {},
    };

    const failingService = new AuditService(failingDb as any);

    const entry = failingService.logTransition('run-1', 'PENDING', 'action', { key: 'val' });

    // Entry should still be returned even though DB write failed
    expect(entry.logId).toBeDefined();
    expect(entry.runId).toBe('run-1');
    expect(entry.details).toEqual({ key: 'val' });
  });

  it('getByRunId() returns entries ordered by timestamp ASC with parsed JSON details', () => {
    // Log multiple entries
    service.logTransition('run-x', 'PENDING', 'action-1', { step: 1 });
    service.logTransition('run-x', 'CLAIMING', 'action-2', { step: 2 });
    service.logTransition('run-y', 'SWAPPING', 'action-3', { step: 3 }); // different run

    const entries = service.getByRunId('run-x');

    expect(entries.length).toBe(2);
    // Mock stores details as JSON string; getByRunId should parse them
    expect(entries[0].details).toEqual({ step: 1 });
    expect(entries[1].details).toEqual({ step: 2 });
  });

  it('getByRunId() returns empty array for unknown run', () => {
    const entries = service.getByRunId('nonexistent');
    expect(entries).toEqual([]);
  });

  it('getLatest() returns the most recent entry for a run', () => {
    service.logTransition('run-z', 'PENDING', 'first', { n: 1 });
    service.logTransition('run-z', 'CLAIMING', 'second', { n: 2 });
    service.logTransition('run-z', 'SWAPPING', 'third', { n: 3 });

    const latest = service.getLatest('run-z');

    expect(latest).not.toBeNull();
    expect(latest!.action).toBe('third');
    expect(latest!.details).toEqual({ n: 3 });
  });

  it('getLatest() returns null when no entries exist for run', () => {
    const latest = service.getLatest('nonexistent');
    expect(latest).toBeNull();
  });
});

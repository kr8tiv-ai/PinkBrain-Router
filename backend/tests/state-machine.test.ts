import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateMachine } from '../src/engine/StateMachine.js';
import { RunService } from '../src/services/RunService.js';
import { AuditService } from '../src/services/AuditService.js';
import type { PhaseHandler, StateMachineDeps } from '../src/engine/StateMachine.js';
import type { CreditRun, RunState, PhaseResult } from '../src/types/index.js';

// ─── Mock DB for RunService ─────────────────────────────────────

function createRunDb() {
  const rows: Array<Record<string, unknown>> = [];

  return {
    _rows: rows,
    prepare: (sql: string) => {
      if (sql.includes('INSERT') && sql.includes('runs')) {
        return {
          run: (...params: unknown[]) => {
            rows.push({
              run_id: params[0],
              strategy_id: params[1],
              state: params[2],
              started_at: params[3],
              finished_at: params[4],
              claimed_sol: params[5],
              claimed_tx_sig: params[6],
              swapped_usdc: params[7],
              swap_tx_sig: params[8],
              swap_quote_snapshot: params[9],
              bridged_usdc: params[10],
              bridge_tx_hash: params[11],
              funded_usdc: params[12],
              funding_tx_hash: params[13],
              allocated_usd: params[14],
              keys_provisioned: params[15],
              keys_updated: params[16],
              error_code: params[17],
              error_detail: params[18],
              error_failed_state: params[19],
            });
            return { changes: 1 };
          },
          get: () => null,
          all: () => [],
        };
      }

      if (sql.includes('SELECT') && sql.includes('runs')) {
        return {
          run: () => ({ changes: 0 }),
          get: (...p: unknown[]) => {
            const runId = p[0] as string;
            return rows.find((r) => r.run_id === runId) || null;
          },
          all: (...p: unknown[]) => {
            let filtered = [...rows];
            if (sql.includes('strategy_id = ?')) {
              const strategyId = p[0] as string;
              filtered = filtered.filter((r) => r.strategy_id === strategyId);
            }
            if (sql.includes('LIMIT 1')) return filtered.slice(0, 1);
            filtered.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
            return filtered;
          },
        };
      }

      if (sql.includes('UPDATE') && sql.includes('runs')) {
        return {
          run: (...params: unknown[]) => {
            const runId = params[params.length - 1] as string;
            const row = rows.find((r) => r.run_id === runId);
            if (!row) return { changes: 0 };

            if (sql.includes("state = 'FAILED'")) {
              row.state = 'FAILED';
              row.finished_at = params[0];
              row.error_code = params[1];
              row.error_detail = params[2];
              row.error_failed_state = params[3];
            } else {
              let paramIdx = 0;
              row.state = params[paramIdx++];
              if (sql.includes('claimed_sol')) row.claimed_sol = params[paramIdx++];
              if (sql.includes('claimed_tx_sig')) row.claimed_tx_sig = params[paramIdx++];
              if (sql.includes('swapped_usdc')) row.swapped_usdc = params[paramIdx++];
              if (sql.includes('swap_tx_sig')) row.swap_tx_sig = params[paramIdx++];
              if (sql.includes('swap_quote_snapshot')) row.swap_quote_snapshot = params[paramIdx++];
              if (sql.includes('bridged_usdc')) row.bridged_usdc = params[paramIdx++];
              if (sql.includes('bridge_tx_hash')) row.bridge_tx_hash = params[paramIdx++];
              if (sql.includes('funded_usdc')) row.funded_usdc = params[paramIdx++];
              if (sql.includes('funding_tx_hash')) row.funding_tx_hash = params[paramIdx++];
              if (sql.includes('allocated_usd')) row.allocated_usd = params[paramIdx++];
              if (sql.includes('keys_provisioned')) row.keys_provisioned = params[paramIdx++];
              if (sql.includes('keys_updated')) row.keys_updated = params[paramIdx++];
              if (sql.includes('finished_at')) row.finished_at = params[paramIdx++];
            }
            return { changes: 1 };
          },
          get: () => null,
          all: () => [],
        };
      }

      // Aggregate queries for getAggregateStats
      if (sql.includes('COUNT')) {
        return {
          run: () => ({ changes: 0 }),
          get: () => {
            if (sql.includes('COMPLETE')) return { count: rows.filter((r) => r.state === 'COMPLETE').length };
            if (sql.includes('FAILED')) return { count: rows.filter((r) => r.state === 'FAILED').length };
            return { count: rows.length };
          },
          all: () => [],
        };
      }

      if (sql.includes('SUM')) {
        return {
          run: () => ({ changes: 0 }),
          get: () => ({ total: 0 }),
          all: () => [],
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

// ─── Mock DB for AuditService ───────────────────────────────────

function createAuditDb() {
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
              details: params[4],
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
            return filtered.length > 0 ? filtered[filtered.length - 1] : null;
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

// ─── Helpers ────────────────────────────────────────────────────

function createMockPolicy(overrides: Partial<{
  canStartRun: () => { allowed: boolean; reason?: string };
  canExecutePhase: (phase: string) => { allowed: boolean; reason?: string };
  isDryRun: () => boolean;
}> = {}) {
  return {
    canStartRun: overrides.canStartRun ?? vi.fn().mockReturnValue({ allowed: true }),
    canExecutePhase: overrides.canExecutePhase ?? vi.fn().mockReturnValue({ allowed: true }),
    isDryRun: overrides.isDryRun ?? vi.fn().mockReturnValue(false),
  } as any;
}

function successResult(data: Record<string, unknown> = {}): PhaseResult {
  return { success: true, data };
}

function failResult(code: string, message: string): PhaseResult {
  return { success: false, error: { code, message } };
}

function createAllHandlers(overrides?: Partial<Record<RunState, PhaseHandler>>): Map<RunState, PhaseHandler> {
  const handlers = new Map<RunState, PhaseHandler>();
  const phases: RunState[] = ['CLAIMING', 'SWAPPING', 'BRIDGING', 'FUNDING', 'ALLOCATING', 'PROVISIONING'];
  for (const phase of phases) {
    if (overrides?.[phase]) {
      handlers.set(phase, overrides[phase]);
    } else {
      handlers.set(phase, vi.fn().mockResolvedValue(successResult({ [phase.toLowerCase()]: 'done' })));
    }
  }
  return handlers;
}

function createMachine(
  runDb: ReturnType<typeof createRunDb>,
  auditDb: ReturnType<typeof createAuditDb>,
  policy?: ReturnType<typeof createMockPolicy>,
  handlers?: Map<RunState, PhaseHandler>,
): StateMachine {
  const runService = new RunService(runDb as any);
  const auditService = new AuditService(auditDb as any);
  const deps: StateMachineDeps = {
    auditService,
    runService,
    executionPolicy: policy ?? createMockPolicy(),
    phaseHandlers: handlers ?? createAllHandlers(),
  };
  return new StateMachine(deps);
}

function createRun(overrides: Partial<CreditRun> = {}): CreditRun {
  return {
    runId: 'run-test-1',
    strategyId: 'strategy-1',
    state: 'PENDING',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    claimedSol: null,
    claimedTxSignature: null,
    swappedUsdc: null,
    swapTxSignature: null,
    swapQuoteSnapshot: null,
    bridgedUsdc: null,
    bridgeTxHash: null,
    fundedUsdc: null,
    fundingTxHash: null,
    allocatedUsd: null,
    keysProvisioned: null,
    keysUpdated: null,
    error: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('StateMachine', () => {
  let runDb: ReturnType<typeof createRunDb>;
  let auditDb: ReturnType<typeof createAuditDb>;

  beforeEach(() => {
    runDb = createRunDb();
    auditDb = createAuditDb();
  });

  describe('transition()', () => {
    it('validates allowed state transitions', async () => {
      const machine = createMachine(runDb, auditDb);
      const run = createRun({ state: 'PENDING' });

      // Insert into DB so RunService can find it for updateState
      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'PENDING',
        started_at: run.startedAt,
        finished_at: null,
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: null, error_detail: null, error_failed_state: null,
      });

      // PENDING -> CLAIMING is valid
      const result = await machine.transition(run, 'CLAIMING');
      expect(result.state).toBe('CLAIMING');

      // PENDING -> SWAPPING is invalid (use a fresh run with state reset in DB)
      const run2 = createRun({ state: 'PENDING', runId: 'run-invalid-1' });
      runDb._rows.push({
        run_id: 'run-invalid-1',
        strategy_id: run2.strategyId,
        state: 'PENDING',
        started_at: run2.startedAt,
        finished_at: null,
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: null, error_detail: null, error_failed_state: null,
      });
      await expect(
        machine.transition(run2, 'SWAPPING'),
      ).rejects.toThrow('Invalid state transition: PENDING → SWAPPING');

      // COMPLETE -> anything is invalid
      const run3 = createRun({ state: 'COMPLETE', runId: 'run-complete-1' });
      runDb._rows.push({
        run_id: 'run-complete-1',
        strategy_id: run3.strategyId,
        state: 'COMPLETE',
        started_at: run3.startedAt,
        finished_at: new Date().toISOString(),
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: null, error_detail: null, error_failed_state: null,
      });
      await expect(
        machine.transition(run3, 'CLAIMING'),
      ).rejects.toThrow('Invalid state transition');

      // FAILED -> CLAIMING is valid (resume)
      const failedRun = createRun({ state: 'FAILED', runId: 'run-fail-1' });
      runDb._rows.push({
        run_id: 'run-fail-1',
        strategy_id: failedRun.strategyId,
        state: 'FAILED',
        started_at: failedRun.startedAt,
        finished_at: new Date().toISOString(),
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: 'X', error_detail: 'Y', error_failed_state: 'PENDING',
      });
      const resumed = await machine.transition(failedRun, 'CLAIMING');
      expect(resumed.state).toBe('CLAIMING');
    });

    it('transition() logs audit entry and updates run state', async () => {
      const machine = createMachine(runDb, auditDb);
      const run = createRun({ state: 'PENDING' });

      // Insert into DB so RunService can find it for updateState
      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'PENDING',
        started_at: run.startedAt,
        finished_at: null,
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: null, error_detail: null, error_failed_state: null,
      });

      await machine.transition(run, 'CLAIMING', successResult({ claimedSol: 1.5 }));

      // Audit log should have an entry
      expect(auditDb._rows.length).toBeGreaterThan(0);
      const auditEntry = auditDb._rows.find((r: any) => r.runId === run.runId);
      expect(auditEntry).toBeDefined();
      expect(auditEntry.action).toContain('transition:PENDING->CLAIMING');
      // Details stored as JSON string in mock DB; parse to check content
      const details = typeof auditEntry.details === 'string'
        ? JSON.parse(auditEntry.details)
        : auditEntry.details;
      expect(details.runId).toBe(run.runId);
    });
  });

  describe('execute()', () => {
    it('runs full pipeline PENDING→CLAIMING→...→COMPLETE with mock handlers', async () => {
      const machine = createMachine(runDb, auditDb);
      const run = createRun({ state: 'PENDING' });

      // Insert into DB so RunService.updateState can find it
      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'PENDING',
        started_at: run.startedAt,
        finished_at: null,
        claimed_sol: null,
        claimed_tx_sig: null,
        swapped_usdc: null,
        swap_tx_sig: null,
        swap_quote_snapshot: null,
        bridged_usdc: null,
        bridge_tx_hash: null,
        funded_usdc: null,
        funding_tx_hash: null,
        allocated_usd: null,
        keys_provisioned: null,
        keys_updated: null,
        error_code: null,
        error_detail: null,
        error_failed_state: null,
      });

      const result = await machine.execute(run);

      expect(result.state).toBe('COMPLETE');
      expect(result.finishedAt).not.toBeNull();
    });

    it('stops on handler returning success:false (fails the run)', async () => {
      const handlers = createAllHandlers({
        SWAPPING: vi.fn().mockResolvedValue(failResult('SWAP_FAILED', 'Insufficient liquidity')),
      });
      const machine = createMachine(runDb, auditDb, undefined, handlers);
      const run = createRun({ state: 'PENDING' });

      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'PENDING',
        started_at: run.startedAt,
        finished_at: null,
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: null, error_detail: null, error_failed_state: null,
      });

      const result = await machine.execute(run);

      expect(result.state).toBe('FAILED');
      expect(result.error).not.toBeNull();
      expect(result.error!.code).toBe('SWAP_FAILED');
      // Claiming handler should have been called (succeeds), swapping handler called (fails)
      expect(handlers.get('CLAIMING')!).toHaveBeenCalled();
      expect(handlers.get('SWAPPING')!).toHaveBeenCalled();
      // Later phases should NOT have been called
      expect(handlers.get('BRIDGING')!).not.toHaveBeenCalled();
    });

    it('stops on handler throwing an error', async () => {
      const handlers = createAllHandlers({
        FUNDING: vi.fn().mockRejectedValue(new Error('Insufficient funds for gas')),
      });
      const machine = createMachine(runDb, auditDb, undefined, handlers);
      const run = createRun({ state: 'PENDING' });

      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'PENDING',
        started_at: run.startedAt,
        finished_at: null,
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: null, error_detail: null, error_failed_state: null,
      });

      const result = await machine.execute(run);

      expect(result.state).toBe('FAILED');
      expect(result.error).not.toBeNull();
      expect(result.error!.code).toBe('PHASE_ERROR');
      expect(result.error!.detail).toContain('Insufficient funds for gas');
    });

    it('skips already-completed phases (resume scenario)', async () => {
      const handlers = createAllHandlers();
      const machine = createMachine(runDb, auditDb, undefined, handlers);
      // Start the run already past CLAIMING
      const run = createRun({ state: 'BRIDGING' });

      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'BRIDGING',
        started_at: run.startedAt,
        finished_at: null,
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: null, error_detail: null, error_failed_state: null,
      });

      const result = await machine.execute(run);

      expect(result.state).toBe('COMPLETE');
      // CLAIMING and SWAPPING should be skipped
      expect(handlers.get('CLAIMING')!).not.toHaveBeenCalled();
      expect(handlers.get('SWAPPING')!).not.toHaveBeenCalled();
      // BRIDGING and later should be called
      expect(handlers.get('BRIDGING')!).toHaveBeenCalled();
      expect(handlers.get('PROVISIONING')!).toHaveBeenCalled();
    });

    it('fails on MISSING_HANDLER when no handler registered for a phase', async () => {
      // Create handlers map missing the BRIDGING handler
      const handlers = new Map<RunState, PhaseHandler>();
      handlers.set('CLAIMING', vi.fn().mockResolvedValue(successResult()));
      handlers.set('SWAPPING', vi.fn().mockResolvedValue(successResult()));
      // No BRIDGING handler
      handlers.set('FUNDING', vi.fn().mockResolvedValue(successResult()));
      handlers.set('ALLOCATING', vi.fn().mockResolvedValue(successResult()));
      handlers.set('PROVISIONING', vi.fn().mockResolvedValue(successResult()));

      const machine = createMachine(runDb, auditDb, undefined, handlers);
      const run = createRun({ state: 'PENDING' });

      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'PENDING',
        started_at: run.startedAt,
        finished_at: null,
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: null, error_detail: null, error_failed_state: null,
      });

      const result = await machine.execute(run);

      expect(result.state).toBe('FAILED');
      expect(result.error).not.toBeNull();
      expect(result.error!.code).toBe('MISSING_HANDLER');
      expect(result.error!.detail).toContain('BRIDGING');
    });

    it('blocks when policy.canStartRun() returns allowed:false', async () => {
      const policy = createMockPolicy({
        canStartRun: vi.fn().mockReturnValue({ allowed: false, reason: 'Kill switch active' }),
      });
      const machine = createMachine(runDb, auditDb, policy);
      const run = createRun({ state: 'PENDING' });

      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'PENDING',
        started_at: run.startedAt,
        finished_at: null,
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: null, error_detail: null, error_failed_state: null,
      });

      const result = await machine.execute(run);

      expect(result.state).toBe('FAILED');
      expect(result.error).not.toBeNull();
      expect(result.error!.code).toBe('POLICY_BLOCKED');
    });

    it('blocks when policy.canExecutePhase() returns allowed:false', async () => {
      const policy = createMockPolicy({
        canExecutePhase: vi.fn().mockReturnValue({ allowed: false, reason: 'Phase blocked' }),
      });
      const machine = createMachine(runDb, auditDb, policy);
      const run = createRun({ state: 'PENDING' });

      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'PENDING',
        started_at: run.startedAt,
        finished_at: null,
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: null, error_detail: null, error_failed_state: null,
      });

      const result = await machine.execute(run);

      expect(result.state).toBe('FAILED');
      expect(result.error).not.toBeNull();
      expect(result.error!.code).toBe('POLICY_BLOCKED');
    });
  });

  describe('resume()', () => {
    it('from FAILED state finds last successful phase from audit and continues', async () => {
      const handlers = createAllHandlers();
      const machine = createMachine(runDb, auditDb, undefined, handlers);

      const run = createRun({ state: 'FAILED' });
      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'FAILED',
        started_at: run.startedAt,
        finished_at: new Date().toISOString(),
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: 'PHASE_ERROR',
        error_detail: 'Bridge failed',
        error_failed_state: 'BRIDGING',
      });

      // Add audit entries showing we got up to BRIDGING successfully
      auditDb._rows.push(
        { logId: 'a1', runId: run.runId, phase: 'PENDING', action: 'transition:PENDING->CLAIMING', details: { toPhase: 'CLAIMING' }, txSignature: null, timestamp: '2025-01-01T00:00:00Z' },
        { logId: 'a2', runId: run.runId, phase: 'CLAIMING', action: 'transition:CLAIMING->SWAPPING', details: { toPhase: 'SWAPPING' }, txSignature: null, timestamp: '2025-01-01T00:00:01Z' },
        { logId: 'a3', runId: run.runId, phase: 'SWAPPING', action: 'transition:SWAPPING->BRIDGING', details: { toPhase: 'BRIDGING' }, txSignature: null, timestamp: '2025-01-01T00:00:02Z' },
        { logId: 'a4', runId: run.runId, phase: 'BRIDGING', action: 'fail:BRIDGING', details: { error: {} }, txSignature: null, timestamp: '2025-01-01T00:00:03Z' },
      );

      const result = await machine.resume(run);

      // Should resume from FUNDING (next after BRIDGING)
      expect(result.state).toBe('COMPLETE');
      // BRIDGING handler should NOT be called again — we resume past it
      expect(handlers.get('BRIDGING')!).not.toHaveBeenCalled();
      // FUNDING and onward should be called
      expect(handlers.get('FUNDING')!).toHaveBeenCalled();
      expect(handlers.get('PROVISIONING')!).toHaveBeenCalled();
    });

    it('from FAILED with no successful transitions restarts from CLAIMING', async () => {
      const handlers = createAllHandlers();
      const machine = createMachine(runDb, auditDb, undefined, handlers);

      const run = createRun({ state: 'FAILED' });
      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'FAILED',
        started_at: run.startedAt,
        finished_at: new Date().toISOString(),
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: 'X',
        error_detail: 'Y',
        error_failed_state: 'PENDING',
      });

      // No audit entries with "transition:" prefix — only fail entries
      auditDb._rows.push(
        { logId: 'a1', runId: run.runId, phase: 'PENDING', action: 'fail:PENDING', details: { error: {} }, txSignature: null, timestamp: '2025-01-01T00:00:00Z' },
      );

      const result = await machine.resume(run);

      // Should restart from CLAIMING and go all the way
      expect(result.state).toBe('COMPLETE');
      // All handlers should be called since we restart from scratch
      expect(handlers.get('CLAIMING')!).toHaveBeenCalled();
      expect(handlers.get('PROVISIONING')!).toHaveBeenCalled();
    });

    it('throws on non-FAILED state', async () => {
      const machine = createMachine(runDb, auditDb);
      const run = createRun({ state: 'PENDING' });

      runDb._rows.push({
        run_id: run.runId,
        strategy_id: run.strategyId,
        state: 'PENDING',
        started_at: run.startedAt,
        finished_at: null,
        claimed_sol: null, claimed_tx_sig: null, swapped_usdc: null,
        swap_tx_sig: null, swap_quote_snapshot: null, bridged_usdc: null,
        bridge_tx_hash: null, funded_usdc: null, funding_tx_hash: null,
        allocated_usd: null, keys_provisioned: null, keys_updated: null,
        error_code: null, error_detail: null, error_failed_state: null,
      });

      await expect(machine.resume(run)).rejects.toThrow(
        'Cannot resume run in state PENDING',
      );
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { StateMachine } from '../src/engine/StateMachine.js';
import { ExecutionPolicy } from '../src/engine/ExecutionPolicy.js';
import { RunService } from '../src/services/RunService.js';
import { AuditService } from '../src/services/AuditService.js';
import type { PhaseHandler, StateMachineDeps } from '../src/engine/StateMachine.js';
import type { CreditRun, PhaseResult } from '../src/types/index.js';

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  })),
}));

// ─── Helpers ────────────────────────────────────────────────────

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
              allocated_usdc: params[14],
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
              if (sql.includes('allocated_usdc')) row.allocated_usdc = params[paramIdx++];
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

      if (sql.includes('COUNT')) {
        return {
          run: () => ({ changes: 0 }),
          get: () => ({
            count: rows.filter((r) => {
              if (sql.includes('COMPLETE')) return r.state === 'COMPLETE';
              if (sql.includes('FAILED')) return r.state === 'FAILED';
              return true;
            }).length,
          }),
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
          get: () => null,
          all: (...p: unknown[]) => {
            let filtered = [...rows];
            if (sql.includes('run_id = ?')) {
              const runId = p[0] as string;
              filtered = filtered.filter((r) => r.run_id === runId);
            }
            return filtered;
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

function createTestRun(state: string = 'PENDING'): CreditRun {
  return {
    runId: 'run-001',
    strategyId: 'strat-001',
    state: state as CreditRun['state'],
    startedAt: '2026-03-29T00:00:00Z',
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
  };
}

// We need to create a test-compatible ExecutionPolicy without DB
// so we import the config type and create a minimal config
function createTestConfig() {
  return {
    bagsApiKey: 'test',
    bagsApiBaseUrl: 'https://test.bags.fm/api/v1',
    heliusApiKey: 'test',
    heliusRpcUrl: 'https://test.helius-rpc.com',
    solanaNetwork: 'devnet' as const,
    openrouterManagementKey: 'test',
    evmPrivateKey: undefined,
    evmChainId: 8453,
    apiAuthToken: 'test',
    port: 3001,
    feeThresholdSol: 5,
    feeSource: 'CLAIMABLE_POSITIONS' as const,
    swapSlippageBps: 50,
    defaultKeyLimitUsd: 10,
    keyLimitReset: 'monthly' as const,
    keyExpiryDays: 365,
    creditPoolReservePct: 10,
    distributionMode: 'TOP_N_HOLDERS' as const,
    distributionTopN: 100,
    distributionTokenMint: undefined,
    cronExpression: '0 */6 * * *',
    minCronIntervalHours: 1,
    dryRun: false,
    executionKillSwitch: false,
    maxDailyRuns: 10,
    maxClaimableSolPerRun: 100,
    maxKeyLimitUsd: 100,
    keyRotationDays: 90,
    usagePollIntervalMin: 15,
    signerPrivateKey: undefined,
    bagsAgentUsername: undefined,
    bagsAgentJwt: undefined,
    bagsAgentWalletAddress: undefined,
    databasePath: ':memory:',
    logLevel: 'info' as const,
    nodeEnv: 'test' as const,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('StateMachine withRetry wiring', () => {
  function createMachineWithSeededRun(claimHandler: PhaseHandler) {
    const runDb = createRunDb();
    const auditDb = createAuditDb();

    // Seed the run in the mock DB so updateState can find it
    runDb._rows.push({
      run_id: 'run-001',
      strategy_id: 'strat-001',
      state: 'PENDING',
      started_at: '2026-03-29T00:00:00Z',
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
      allocated_usdc: null,
      keys_provisioned: null,
      keys_updated: null,
      error_code: null,
      error_detail: null,
      error_failed_state: null,
    });

    // Register claimHandler for CLAIMING and stubs for remaining phases
    const handlers = new Map<string, PhaseHandler>([
      ['CLAIMING', claimHandler],
      ['SWAPPING', vi.fn().mockResolvedValue({ success: true, data: {} })],
      ['BRIDGING', vi.fn().mockResolvedValue({ success: true, data: {} })],
      ['FUNDING', vi.fn().mockResolvedValue({ success: true, data: {} })],
      ['ALLOCATING', vi.fn().mockResolvedValue({ success: true, data: {} })],
      ['PROVISIONING', vi.fn().mockResolvedValue({ success: true, data: {} })],
    ]);

    const machine = new StateMachine({
      auditService: new AuditService(auditDb as any),
      runService: new RunService(runDb as any),
      executionPolicy: new ExecutionPolicy(createTestConfig()),
      phaseHandlers: handlers,
    });

    return machine;
  }

  it('retries transient errors and succeeds on recovery', async () => {
    let callCount = 0;
    const claimHandler: PhaseHandler = vi.fn(async () => {
      callCount++;
      if (callCount <= 2) {
        const err = new Error('Connection reset by peer');
        (err as any).code = 'ECONNRESET';
        throw err;
      }
      return { success: true, data: {} };
    });

    const machine = createMachineWithSeededRun(claimHandler);
    const result = await machine.execute(createTestRun());

    // Retry worked — the CLAIMING phase handler was called 3 times (2 failures + 1 success)
    // and the pipeline completed since all other phases have stub handlers
    expect(result.state).toBe('COMPLETE');
    expect(callCount).toBe(3);
  });

  it('fails immediately on non-transient errors without retrying', async () => {
    const claimHandler: PhaseHandler = vi.fn(async () => {
      const err = new Error('Bad request');
      (err as any).statusCode = 400;
      throw err;
    });

    const machine = createMachineWithSeededRun(claimHandler);
    const result = await machine.execute(createTestRun());

    expect(result.state).toBe('FAILED');
    // Should be called exactly once — no retries for 400
    expect(claimHandler).toHaveBeenCalledOnce();
  });

  it('exhausts all retries and fails on persistent transient errors', async () => {
    const claimHandler: PhaseHandler = vi.fn(async () => {
      const err = new Error('Gateway timeout');
      (err as any).statusCode = 504;
      throw err;
    });

    const machine = createMachineWithSeededRun(claimHandler);
    const result = await machine.execute(createTestRun());

    expect(result.state).toBe('FAILED');
    // 1 initial + 3 retries = 4 total attempts
    expect(claimHandler).toHaveBeenCalledTimes(4);
  });

  it('retries on 429 rate limit errors', async () => {
    let callCount = 0;
    const claimHandler: PhaseHandler = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('Too many requests');
        (err as any).statusCode = 429;
        throw err;
      }
      return { success: true, data: {} };
    });

    const machine = createMachineWithSeededRun(claimHandler);
    const result = await machine.execute(createTestRun());
    expect(result.state).toBe('COMPLETE');
    expect(callCount).toBe(2);
  });

  it('retries on network ETIMEDOUT', async () => {
    let callCount = 0;
    const claimHandler: PhaseHandler = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('timed out');
        (err as any).code = 'ETIMEDOUT';
        throw err;
      }
      return { success: true, data: {} };
    });

    const machine = createMachineWithSeededRun(claimHandler);
    const result = await machine.execute(createTestRun());
    expect(result.state).toBe('COMPLETE');
    expect(callCount).toBe(2);
  });

  it('non-retryable business error fails immediately', async () => {
    const claimHandler: PhaseHandler = vi.fn(async () => {
      return {
        success: false,
        error: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough SOL' },
      };
    });

    const machine = createMachineWithSeededRun(claimHandler);
    const result = await machine.execute(createTestRun());
    expect(result.state).toBe('FAILED');
    expect(claimHandler).toHaveBeenCalledOnce();
  });
});

describe('isTransientError', () => {
  it('classifies ECONNRESET as transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    const err = new Error('connection reset');
    (err as any).code = 'ECONNRESET';
    expect(isTransientError(err)).toBe(true);
  });

  it('classifies ETIMEDOUT as transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    const err = new Error('timed out');
    (err as any).code = 'ETIMEDOUT';
    expect(isTransientError(err)).toBe(true);
  });

  it('classifies ECONNREFUSED as transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    const err = new Error('connection refused');
    (err as any).code = 'ECONNREFUSED';
    expect(isTransientError(err)).toBe(true);
  });

  it('classifies 429 as transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    const err = new Error('rate limited');
    (err as any).statusCode = 429;
    expect(isTransientError(err)).toBe(true);
  });

  it('classifies 500, 502, 503, 504 as transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    for (const status of [500, 502, 503, 504]) {
      const err = new Error('server error');
      (err as any).statusCode = status;
      expect(isTransientError(err)).toBe(true);
    }
  });

  it('classifies 400 as non-transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    const err = new Error('bad request');
    (err as any).statusCode = 400;
    expect(isTransientError(err)).toBe(false);
  });

  it('classifies 401, 403, 404, 422 as non-transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    for (const status of [401, 403, 404, 422]) {
      const err = new Error('client error');
      (err as any).statusCode = status;
      expect(isTransientError(err)).toBe(false);
    }
  });

  it('classifies "socket hang up" message as transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    const err = new Error('read ECONNRESET socket hang up');
    expect(isTransientError(err)).toBe(true);
  });

  it('classifies "timeout" in message as transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    const err = new Error('Request timeout after 30000ms');
    expect(isTransientError(err)).toBe(true);
  });

  it('classifies plain Error without transient signals as non-transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    const err = new Error('Insufficient funds for transfer');
    expect(isTransientError(err)).toBe(false);
  });

  it('classifies null/undefined as non-transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError('string')).toBe(false);
    expect(isTransientError(42)).toBe(false);
  });

  it('classifies error with status field (not statusCode) as transient', async () => {
    const { isTransientError } = await import('../src/engine/isTransientError.js');
    const err = new Error('rate limited');
    (err as any).status = 429;
    expect(isTransientError(err)).toBe(true);
  });
});

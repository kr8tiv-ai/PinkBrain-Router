import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { DatabaseConnection } from './Database.js';
import type { CreditRun, RunState, TradeQuote } from '../types/index.js';

const logger = pino({ name: 'RunService' });

export interface CreateRunData {
  claimedSol?: number;
  claimedTxSignature?: string;
  swappedUsdc?: number;
  swapTxSignature?: string;
  swapQuoteSnapshot?: TradeQuote;
  bridgedUsdc?: number;
  bridgeTxHash?: string;
  fundedUsdc?: number;
  fundingTxHash?: string;
  allocatedUsd?: number;
  keysProvisioned?: number;
  keysUpdated?: number;
}

export class RunService {
  constructor(private readonly db: DatabaseConnection) {}

  create(strategyId: string): CreditRun {
    const now = new Date().toISOString();
    const run: CreditRun = {
      runId: randomUUID(),
      strategyId,
      state: 'PENDING',
      startedAt: now,
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

    this.db
      .prepare(
        `INSERT INTO runs (run_id, strategy_id, state, started_at, finished_at,
         claimed_sol, claimed_tx_sig, swapped_usdc, swap_tx_sig, swap_quote_snapshot,
         bridged_usdc, bridge_tx_hash, funded_usdc, funding_tx_hash,
         allocated_usd, keys_provisioned, keys_updated, error_code, error_detail, error_failed_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.runId,
        run.strategyId,
        run.state,
        run.startedAt,
        run.finishedAt,
        run.claimedSol,
        run.claimedTxSignature,
        run.swappedUsdc,
        run.swapTxSignature,
        run.swapQuoteSnapshot ? JSON.stringify(run.swapQuoteSnapshot) : null,
        run.bridgedUsdc,
        run.bridgeTxHash,
        run.fundedUsdc,
        run.fundingTxHash,
        run.allocatedUsd,
        run.keysProvisioned,
        run.keysUpdated,
        null,
        null,
        null,
      );

    logger.info({ runId: run.runId, strategyId }, 'Run created');
    return run;
  }

  getById(id: string): CreditRun | null {
    const row = this.db
      .prepare('SELECT * FROM runs WHERE run_id = ?')
      .get<RawRunRow>(id);

    return row ? this.toRun(row) : null;
  }

  getByStrategyId(strategyId: string): CreditRun[] {
    const rows = this.db
      .prepare('SELECT * FROM runs WHERE strategy_id = ? ORDER BY started_at DESC')
      .all<RawRunRow>(strategyId);

    return rows.map((row) => this.toRun(row));
  }

  getLatestByStrategy(strategyId: string): CreditRun | null {
    const row = this.db
      .prepare('SELECT * FROM runs WHERE strategy_id = ? ORDER BY started_at DESC LIMIT 1')
      .get<RawRunRow>(strategyId);

    return row ? this.toRun(row) : null;
  }

  updateState(runId: string, newState: RunState, data: CreateRunData = {}): CreditRun | null {
    const existing = this.getById(runId);
    if (!existing) return null;

    const updates: string[] = ['state = ?'];
    const params: unknown[] = [newState];

    if (data.claimedSol !== undefined) {
      updates.push('claimed_sol = ?');
      params.push(data.claimedSol);
    }
    if (data.claimedTxSignature !== undefined) {
      updates.push('claimed_tx_sig = ?');
      params.push(data.claimedTxSignature);
    }
    if (data.swappedUsdc !== undefined) {
      updates.push('swapped_usdc = ?');
      params.push(data.swappedUsdc);
    }
    if (data.swapTxSignature !== undefined) {
      updates.push('swap_tx_sig = ?');
      params.push(data.swapTxSignature);
    }
    if (data.swapQuoteSnapshot !== undefined) {
      updates.push('swap_quote_snapshot = ?');
      params.push(data.swapQuoteSnapshot ? JSON.stringify(data.swapQuoteSnapshot) : null);
    }
    if (data.bridgedUsdc !== undefined) {
      updates.push('bridged_usdc = ?');
      params.push(data.bridgedUsdc);
    }
    if (data.bridgeTxHash !== undefined) {
      updates.push('bridge_tx_hash = ?');
      params.push(data.bridgeTxHash);
    }
    if (data.fundedUsdc !== undefined) {
      updates.push('funded_usdc = ?');
      params.push(data.fundedUsdc);
    }
    if (data.fundingTxHash !== undefined) {
      updates.push('funding_tx_hash = ?');
      params.push(data.fundingTxHash);
    }
    if (data.allocatedUsd !== undefined) {
      updates.push('allocated_usd = ?');
      params.push(data.allocatedUsd);
    }
    if (data.keysProvisioned !== undefined) {
      updates.push('keys_provisioned = ?');
      params.push(data.keysProvisioned);
    }
    if (data.keysUpdated !== undefined) {
      updates.push('keys_updated = ?');
      params.push(data.keysUpdated);
    }

    if (newState === 'COMPLETE' || newState === 'FAILED') {
      updates.push('finished_at = ?');
      params.push(new Date().toISOString());
    }

    params.push(runId);

    this.db
      .prepare(`UPDATE runs SET ${updates.join(', ')} WHERE run_id = ?`)
      .run(...params);

    logger.info({ runId, newState }, 'Run state updated');
    return this.getById(runId);
  }

  markFailed(
    runId: string,
    error: { code: string; detail: string; failedState: RunState },
  ): CreditRun | null {
    const existing = this.getById(runId);
    if (!existing) return null;

    this.db
      .prepare(
        `UPDATE runs SET state = 'FAILED', finished_at = ?, error_code = ?, error_detail = ?, error_failed_state = ?
         WHERE run_id = ?`,
      )
      .run(
        new Date().toISOString(),
        error.code,
        error.detail,
        error.failedState,
        runId,
      );

    logger.error({ runId, error: error.code, failedState: error.failedState }, 'Run marked as failed');
    return this.getById(runId);
  }

  private toRun(row: RawRunRow): CreditRun {
    return {
      runId: row.run_id,
      strategyId: row.strategy_id,
      state: row.state as RunState,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      claimedSol: row.claimed_sol,
      claimedTxSignature: row.claimed_tx_sig,
      swappedUsdc: row.swapped_usdc,
      swapTxSignature: row.swap_tx_sig,
      swapQuoteSnapshot: row.swap_quote_snapshot
        ? JSON.parse(row.swap_quote_snapshot)
        : null,
      bridgedUsdc: row.bridged_usdc,
      bridgeTxHash: row.bridge_tx_hash,
      fundedUsdc: row.funded_usdc,
      fundingTxHash: row.funding_tx_hash,
      allocatedUsd: row.allocated_usdc,
      keysProvisioned: row.keys_provisioned,
      keysUpdated: row.keys_updated,
      error: row.error_code
        ? { code: row.error_code, detail: row.error_detail ?? '', failedState: row.error_failed_state as RunState }
        : null,
    };
  }
}

interface RawRunRow {
  run_id: string;
  strategy_id: string;
  state: string;
  started_at: string;
  finished_at: string | null;
  claimed_sol: number | null;
  claimed_tx_sig: string | null;
  swapped_usdc: number | null;
  swap_tx_sig: string | null;
  swap_quote_snapshot: string | null;
  bridged_usdc: number | null;
  bridge_tx_hash: string | null;
  funded_usdc: number | null;
  funding_tx_hash: string | null;
  allocated_usdc: number | null;
  keys_provisioned: number | null;
  keys_updated: number | null;
  error_code: string | null;
  error_detail: string | null;
  error_failed_state: string | null;
}

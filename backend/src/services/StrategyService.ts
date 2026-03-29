import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { DatabaseConnection } from './Database.js';
import type { Strategy, StrategyStatus } from '../types/index.js';

const logger = pino({ name: 'StrategyService' });

export interface CreateStrategyInput {
  ownerWallet: string;
  source?: 'CLAIMABLE_POSITIONS' | 'PARTNER_FEES';
  distributionToken?: string;
  swapConfig?: { slippageBps: number; maxPriceImpactBps: number };
  distribution?: 'OWNER_ONLY' | 'TOP_N_HOLDERS' | 'EQUAL_SPLIT' | 'WEIGHTED_BY_HOLDINGS' | 'CUSTOM_LIST';
  distributionTopN?: number;
  keyConfig?: { defaultLimitUsd: number; limitReset: 'daily' | 'weekly' | 'monthly' | null; expiryDays: number };
  creditPoolReservePct?: number;
  exclusionList?: string[];
  schedule?: string;
  minClaimThreshold?: number;
}

export interface UpdateStrategyInput {
  distributionMode?: Strategy['distribution'];
  distributionTopN?: number;
  keyConfig?: Strategy['keyConfig'];
  creditPoolReservePct?: number;
  exclusionList?: string[];
  schedule?: string;
  minClaimThreshold?: number;
  status?: StrategyStatus;
}

export class StrategyService {
  constructor(private readonly db: DatabaseConnection) {}

  create(input: CreateStrategyInput): Strategy {
    const now = new Date().toISOString();
    const strategy: Strategy = {
      strategyId: randomUUID(),
      ownerWallet: input.ownerWallet,
      source: input.source ?? 'CLAIMABLE_POSITIONS',
      distributionToken: input.distributionToken ?? '',
      swapConfig: input.swapConfig ?? { slippageBps: 50, maxPriceImpactBps: 300 },
      distribution: input.distribution ?? 'TOP_N_HOLDERS',
      distributionTopN: input.distributionTopN ?? 100,
      keyConfig: input.keyConfig ?? {
        defaultLimitUsd: 10,
        limitReset: 'monthly',
        expiryDays: 365,
      },
      creditPoolReservePct: input.creditPoolReservePct ?? 10,
      exclusionList: input.exclusionList ?? [],
      schedule: input.schedule ?? '0 */6 * * *',
      minClaimThreshold: input.minClaimThreshold ?? 5,
      status: 'ACTIVE',
      lastRunId: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO strategies (strategy_id, owner_wallet, source, distribution_token, swap_config,
         distribution_mode, distribution_top_n, key_config, credit_pool_reserve_pct,
         exclusion_list, schedule, min_claim_threshold, status, last_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        strategy.strategyId,
        strategy.ownerWallet,
        strategy.source,
        strategy.distributionToken,
        JSON.stringify(strategy.swapConfig),
        strategy.distribution,
        strategy.distributionTopN,
        JSON.stringify(strategy.keyConfig),
        strategy.creditPoolReservePct,
        JSON.stringify(strategy.exclusionList),
        strategy.schedule,
        strategy.minClaimThreshold,
        strategy.status,
        strategy.lastRunId,
        strategy.createdAt,
        strategy.updatedAt,
      );

    logger.info({ strategyId: strategy.strategyId, owner: strategy.ownerWallet }, 'Strategy created');
    return strategy;
  }

  getById(id: string): Strategy | null {
    const row = this.db
      .prepare('SELECT * FROM strategies WHERE strategy_id = ?')
      .get<RawStrategyRow>(id);

    return row ? this.toStrategy(row) : null;
  }

  getAll(): Strategy[] {
    const rows = this.db
      .prepare('SELECT * FROM strategies ORDER BY created_at DESC')
      .all<RawStrategyRow>();

    return rows.map((row) => this.toStrategy(row));
  }

  getByOwner(ownerWallet: string): Strategy[] {
    const rows = this.db
      .prepare('SELECT * FROM strategies WHERE owner_wallet = ? ORDER BY created_at DESC')
      .all<RawStrategyRow>(ownerWallet);

    return rows.map((row) => this.toStrategy(row));
  }

  update(id: string, input: UpdateStrategyInput): Strategy | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.distributionMode !== undefined) {
      updates.push('distribution_mode = ?');
      params.push(input.distributionMode);
    }
    if (input.distributionTopN !== undefined) {
      updates.push('distribution_top_n = ?');
      params.push(input.distributionTopN);
    }
    if (input.keyConfig !== undefined) {
      updates.push('key_config = ?');
      params.push(JSON.stringify(input.keyConfig));
    }
    if (input.creditPoolReservePct !== undefined) {
      updates.push('credit_pool_reserve_pct = ?');
      params.push(input.creditPoolReservePct);
    }
    if (input.exclusionList !== undefined) {
      updates.push('exclusion_list = ?');
      params.push(JSON.stringify(input.exclusionList));
    }
    if (input.schedule !== undefined) {
      updates.push('schedule = ?');
      params.push(input.schedule);
    }
    if (input.minClaimThreshold !== undefined) {
      updates.push('min_claim_threshold = ?');
      params.push(input.minClaimThreshold);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      params.push(input.status);
    }

    if (updates.length === 0) return existing;

    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(id);

    this.db
      .prepare(`UPDATE strategies SET ${updates.join(', ')} WHERE strategy_id = ?`)
      .run(...params);

    logger.info({ strategyId: id, updatedFields: updates.length }, 'Strategy updated');
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM strategies WHERE strategy_id = ?')
      .run(id);

    if (result.changes && result.changes > 0) {
      logger.info({ strategyId: id }, 'Strategy deleted');
      return true;
    }
    return false;
  }

  private toStrategy(row: RawStrategyRow): Strategy {
    return {
      strategyId: row.strategy_id,
      ownerWallet: row.owner_wallet,
      source: row.source as Strategy['source'],
      distributionToken: row.distribution_token,
      swapConfig: typeof row.swap_config === 'string' ? JSON.parse(row.swap_config) : row.swap_config,
      distribution: row.distribution_mode as Strategy['distribution'],
      distributionTopN: row.distribution_top_n,
      keyConfig: typeof row.key_config === 'string' ? JSON.parse(row.key_config) : row.key_config,
      creditPoolReservePct: row.credit_pool_reserve_pct,
      exclusionList: typeof row.exclusion_list === 'string' ? JSON.parse(row.exclusion_list) : row.exclusion_list,
      schedule: row.schedule,
      minClaimThreshold: row.min_claim_threshold,
      status: row.status as StrategyStatus,
      lastRunId: row.last_run_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface RawStrategyRow {
  strategy_id: string;
  owner_wallet: string;
  source: string;
  distribution_token: string;
  swap_config: string;
  distribution_mode: string;
  distribution_top_n: number;
  key_config: string;
  credit_pool_reserve_pct: number;
  exclusion_list: string;
  schedule: string;
  min_claim_threshold: number;
  status: string;
  last_run_id: string | null;
  created_at: string;
  updated_at: string;
}

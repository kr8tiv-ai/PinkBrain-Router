import { describe, it, expect, beforeEach } from 'vitest';
import { StrategyService } from '../src/services/StrategyService.js';

function createMockDb() {
  const rows: Array<Record<string, unknown>> = [];

  return {
    _rows: rows,
    prepare: (sql: string) => {
      if (sql.includes('INSERT') && sql.includes('strategies')) {
        return {
          run: (...params: unknown[]) => {
            rows.push({
              strategy_id: params[0],
              owner_wallet: params[1],
              source: params[2],
              distribution_token: params[3],
              swap_config: params[4],
              distribution_mode: params[5],
              distribution_top_n: params[6],
              key_config: params[7],
              credit_pool_reserve_pct: params[8],
              exclusion_list: params[9],
              schedule: params[10],
              min_claim_threshold: params[11],
              status: params[12],
              last_run_id: params[13],
              created_at: params[14],
              updated_at: params[15],
            });
            return { changes: 1 };
          },
          get: () => null,
          all: () => [],
        };
      }

      if (sql.includes('SELECT') && sql.includes('strategies')) {
        return {
          run: () => ({ changes: 0 }),
          get: (...p: unknown[]) => {
            if (sql.includes('strategy_id = ?')) {
              const id = p[0] as string;
              return rows.find((r) => r.strategy_id === id) || null;
            }
            return null;
          },
          all: (...p: unknown[]) => {
            // Filter by owner_wallet if present
            const matches = sql.includes('owner_wallet = ?')
              ? rows.filter((r) => r.owner_wallet === p[0])
              : [...rows];
            // Sort DESC by created_at (last inserted is first)
            matches.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            return matches;
          },
        };
      }

      if (sql.includes('UPDATE') && sql.includes('strategies')) {
        // Column name → row field name mapping
        const colMap: Record<string, string> = {
          distribution_mode: 'distribution_mode',
          distribution_top_n: 'distribution_top_n',
          key_config: 'key_config',
          credit_pool_reserve_pct: 'credit_pool_reserve_pct',
          exclusion_list: 'exclusion_list',
          schedule: 'schedule',
          min_claim_threshold: 'min_claim_threshold',
          status: 'status',
          updated_at: 'updated_at',
        };
        return {
          run: (...params: unknown[]) => {
            // Last param is the strategy_id (WHERE clause)
            const id = params[params.length - 1] as string;
            const row = rows.find((r) => r.strategy_id === id);
            if (row) {
              // Extract column names from SQL: SET col1 = ?, col2 = ?, ...
              const setClause = sql.substring(
                sql.indexOf('SET') + 3,
                sql.indexOf('WHERE'),
              );
              const columns = setClause
                .split(',')
                .map((c) => c.trim().split('=')[0].trim());
              // columns[i] maps to params[i]
              for (let i = 0; i < columns.length; i++) {
                const col = columns[i];
                const field = colMap[col];
                if (field) {
                  row[field] = params[i];
                }
              }
            }
            return { changes: row ? 1 : 0 };
          },
          get: () => null,
          all: () => [],
        };
      }

      if (sql.includes('DELETE') && sql.includes('strategies')) {
        return {
          run: (...params: unknown[]) => {
            const id = params[0] as string;
            const idx = rows.findIndex((r) => r.strategy_id === id);
            if (idx >= 0) {
              rows.splice(idx, 1);
              return { changes: 1 };
            }
            return { changes: 0 };
          },
          get: () => null,
          all: () => [],
        };
      }

      return { run: () => ({ changes: 0 }), get: () => null, all: () => [] };
    },
  } as any;
}

describe('StrategyService', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: StrategyService;

  beforeEach(() => {
    db = createMockDb();
    service = new StrategyService(db as any);
  });

  it('create() persists with all defaults applied', () => {
    const strategy = service.create({ ownerWallet: 'wallet1' });

    expect(strategy.strategyId).toBeDefined();
    expect(strategy.ownerWallet).toBe('wallet1');
    expect(strategy.source).toBe('CLAIMABLE_POSITIONS');
    expect(strategy.distribution).toBe('TOP_N_HOLDERS');
    expect(strategy.distributionTopN).toBe(100);
    expect(strategy.creditPoolReservePct).toBe(10);
    expect(strategy.status).toBe('ACTIVE');
    expect(strategy.schedule).toBe('0 */6 * * *');
    expect(strategy.minClaimThreshold).toBe(5);
    expect(strategy.keyConfig).toEqual({
      defaultLimitUsd: 10,
      limitReset: 'monthly',
      expiryDays: 365,
    });
    expect(strategy.swapConfig).toEqual({
      slippageBps: 50,
      maxPriceImpactBps: 300,
    });
    expect(db._rows).toHaveLength(1);
  });

  it('create() with custom input overrides defaults', () => {
    const strategy = service.create({
      ownerWallet: 'wallet2',
      source: 'PARTNER_FEES',
      distribution: 'OWNER_ONLY',
      distributionTopN: 50,
      creditPoolReservePct: 20,
      minClaimThreshold: 10,
      schedule: '0 0 * * *',
    });

    expect(strategy.source).toBe('PARTNER_FEES');
    expect(strategy.distribution).toBe('OWNER_ONLY');
    expect(strategy.distributionTopN).toBe(50);
    expect(strategy.creditPoolReservePct).toBe(20);
    expect(strategy.minClaimThreshold).toBe(10);
    expect(strategy.schedule).toBe('0 0 * * *');
  });

  it('getById() returns a strategy or null', () => {
    const created = service.create({ ownerWallet: 'wallet1' });
    const found = service.getById(created.strategyId);
    expect(found).not.toBeNull();
    expect(found!.strategyId).toBe(created.strategyId);

    const missing = service.getById('non-existent');
    expect(missing).toBeNull();
  });

  it('getAll() returns strategies ordered by created_at DESC', () => {
    service.create({ ownerWallet: 'wallet1' });
    service.create({ ownerWallet: 'wallet2' });
    service.create({ ownerWallet: 'wallet3' });

    const all = service.getAll();
    expect(all).toHaveLength(3);
    // Most recently created should be first
    expect(all[0].createdAt >= all[1].createdAt).toBe(true);
    expect(all[1].createdAt >= all[2].createdAt).toBe(true);
  });

  it('getByOwner() returns strategies for a specific wallet', () => {
    service.create({ ownerWallet: 'ownerA' });
    service.create({ ownerWallet: 'ownerB' });
    service.create({ ownerWallet: 'ownerA' });

    const forA = service.getByOwner('ownerA');
    expect(forA).toHaveLength(2);
    expect(forA.every((s) => s.ownerWallet === 'ownerA')).toBe(true);

    const forB = service.getByOwner('ownerB');
    expect(forB).toHaveLength(1);
  });

  it('update() merges only provided fields and updates updatedAt', () => {
    const created = service.create({ ownerWallet: 'wallet1' });
    const updated = service.update(created.strategyId, {
      distributionMode: 'EQUAL_SPLIT',
      creditPoolReservePct: 25,
    });

    expect(updated).not.toBeNull();
    expect(updated!.strategyId).toBe(created.strategyId);
    expect(updated!.distribution).toBe('EQUAL_SPLIT');
    expect(updated!.creditPoolReservePct).toBe(25);
    // Non-updated fields should retain original values
    expect(updated!.ownerWallet).toBe('wallet1');
    expect(updated!.source).toBe('CLAIMABLE_POSITIONS');
  });

  it('update() returns null for non-existent strategy', () => {
    const result = service.update('non-existent', { distributionMode: 'EQUAL_SPLIT' });
    expect(result).toBeNull();
  });

  it('delete() returns true for existing, false for non-existent', () => {
    const created = service.create({ ownerWallet: 'wallet1' });
    expect(service.delete(created.strategyId)).toBe(true);
    expect(service.getById(created.strategyId)).toBeNull();
    expect(service.delete('non-existent')).toBe(false);
  });
});

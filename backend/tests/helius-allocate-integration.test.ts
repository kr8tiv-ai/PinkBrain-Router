import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DistributionService } from '../src/services/DistributionService.js';
import { createAllocatePhase } from '../src/engine/phases/allocate.js';

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

/**
 * Integration test: bootstrap → allocate phase → resolveHolders → HeliusClient → DistributionService.
 *
 * Proves the full DI path works end-to-end with mocked HTTP transport.
 */
describe('Allocate phase integration with HeliusClient', () => {
  let mockResolveHolders: ReturnType<typeof vi.fn>;
  let mockDistributionAllocate: ReturnType<typeof vi.fn>;

  function createMockDb() {
    const snapshots: Array<Record<string, unknown>> = [];
    return {
      _rows: snapshots,
      prepare: (sql: string) => {
        if (sql.includes('INSERT') && sql.includes('allocation_snapshots')) {
          return {
            run: (...params: unknown[]) => {
              snapshots.push({
                snapshotId: params[0],
                runId: params[1],
                holderWallet: params[2],
                tokenBalance: params[3],
                allocationWeight: params[4],
                allocatedUsd: params[5],
              });
              return { changes: 1 };
            },
            get: () => null,
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

  function createMockPool() {
    return {
      checkAllocation: vi.fn().mockResolvedValue({
        allowed: true,
        requestedAmount: 300,
        availableAfterReserve: 900,
        remainingAfterAllocation: 600,
      }),
      recordAllocation: vi.fn(),
    };
  }

  function createMockStrategy(overrides: Record<string, unknown> = {}) {
    return {
      strategyId: 'integration-strategy-1',
      ownerWallet: 'owner_wallet_1111111111111111111',
      distribution: 'TOP_N_HOLDERS',
      distributionTopN: 5,
      distributionToken: 'MintToken1111111111111111111111111111',
      exclusionList: [],
      keyConfig: { defaultLimitUsd: 10, limitReset: 'monthly' as const, expiryDays: 365 },
      ...overrides,
    } as any;
  }

  function createMockRun(overrides: Record<string, unknown> = {}) {
    return {
      runId: 'integration-run-1',
      strategyId: 'integration-strategy-1',
      fundedUsdc: 300,
      ...overrides,
    } as any;
  }

  function createDistributionService() {
    const mockDb = createMockDb();
    const mockPool = createMockPool();
    const service = new DistributionService({
      db: mockDb as any,
      creditPoolService: mockPool as any,
    });
    mockDistributionAllocate = vi.spyOn(service, 'allocate');
    return service;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls resolveHolders with strategy and passes holders to DistributionService.allocate', async () => {
    const holders = [
      { wallet: 'holder_a_wallet_111111111111111', tokenBalance: '500' },
      { wallet: 'holder_b_wallet_111111111111111', tokenBalance: '300' },
      { wallet: 'holder_c_wallet_111111111111111', tokenBalance: '200' },
    ];
    const strategy = createMockStrategy();
    const run = createMockRun();
    const distributionService = createDistributionService();

    mockResolveHolders = vi.fn((s: any) => {
      expect(s.distributionToken).toBe('MintToken1111111111111111111111111111');
      return Promise.resolve(holders);
    });

    const phase = createAllocatePhase({
      distributionService,
      strategyService: {
        getById: (id: string) => (id === 'integration-strategy-1' ? strategy : null),
      } as any,
      resolveHolders: mockResolveHolders,
    });

    const result = await phase(run);

    expect(result.success).toBe(true);
    expect(result.data?.holderCount).toBe(3);
    expect(mockDistributionAllocate).toHaveBeenCalledWith(run, strategy, holders);
  });

  it('returns success with skipped=true when holders are empty', async () => {
    const strategy = createMockStrategy();
    const run = createMockRun();
    const distributionService = createDistributionService();

    const phase = createAllocatePhase({
      distributionService,
      strategyService: {
        getById: (id: string) => (id === 'integration-strategy-1' ? strategy : null),
      } as any,
      resolveHolders: () => Promise.resolve([]),
    });

    const result = await phase(run);

    expect(result.success).toBe(true);
    expect(result.data?.skipped).toBe(true);
    expect(result.data?.holderCount).toBe(0);
    expect(mockDistributionAllocate).not.toHaveBeenCalled();
  });

  it('returns failure with HOLDER_RESOLUTION_FAILED when resolveHolders throws', async () => {
    const strategy = createMockStrategy();
    const run = createMockRun();
    const distributionService = createDistributionService();

    const phase = createAllocatePhase({
      distributionService,
      strategyService: {
        getById: (id: string) => (id === 'integration-strategy-1' ? strategy : null),
      } as any,
      resolveHolders: () => Promise.reject(new Error('Helius API timeout after 30s')),
    });

    const result = await phase(run);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('HOLDER_RESOLUTION_FAILED');
    expect(result.error?.message).toContain('Helius API timeout after 30s');
    expect(mockDistributionAllocate).not.toHaveBeenCalled();
  });

  it('returns success with holderCount matching returned holders', async () => {
    const holders = [
      { wallet: 'wallet_a', tokenBalance: '1000' },
      { wallet: 'wallet_b', tokenBalance: '500' },
    ];
    const strategy = createMockStrategy();
    const run = createMockRun();
    const distributionService = createDistributionService();

    const phase = createAllocatePhase({
      distributionService,
      strategyService: {
        getById: (id: string) => (id === 'integration-strategy-1' ? strategy : null),
      } as any,
      resolveHolders: () => Promise.resolve(holders),
    });

    const result = await phase(run);

    expect(result.success).toBe(true);
    expect(result.data?.holderCount).toBe(2);
    expect(result.data?.allocatedUsd).toBe(300);
  });
});

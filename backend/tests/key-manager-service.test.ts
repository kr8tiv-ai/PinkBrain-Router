import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyManagerService } from '../src/services/KeyManagerService.js';
import type { Strategy, UserKey } from '../src/types/index.js';
import type { DatabaseConnection } from '../src/services/Database.js';

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid-1234'),
}));

function createMockDb(): DatabaseConnection {
  const _rows: Record<string, unknown[]> = {
    user_keys: [],
    allocation_snapshots: [],
  };
  const db = {
    prepare: vi.fn((sql: string) => {
      // Simple mock that parses SQL to provide basic row tracking
      return {
        get: vi.fn((..._args: unknown[]) => {
          if (sql.includes('WHERE holder_wallet') && sql.includes('status')) {
            return _rows.user_keys.find(
              (r: unknown) =>
                (r as UserKey).holderWallet === _args[0] &&
                (r as UserKey).status === 'ACTIVE',
            ) ?? null;
          }
          if (sql.includes('WHERE key_id')) {
            return _rows.user_keys.find(
              (r: unknown) => (r as UserKey).keyId === _args[0],
            ) ?? null;
          }
          return null;
        }),
        all: vi.fn((..._args: unknown[]) => {
          if (sql.includes('WHERE strategy_id')) {
            return _rows.user_keys.filter(
              (r: unknown) => (r as UserKey).strategyId === _args[0],
            );
          }
          return [];
        }),
        run: vi.fn((..._args: unknown[]) => {
          const flatSql = sql.replace(/\s+/g, ' ').trim();
          if (flatSql.startsWith('INSERT INTO user_keys')) {
            _rows.user_keys.push({
              keyId: _args[0],
              strategyId: _args[1],
              holderWallet: _args[2],
              openrouterKeyHash: _args[3],
              spendingLimitUsd: _args[4],
              currentUsageUsd: _args[5],
              totalAllocatedUsd: _args[6],
              status: _args[7],
              createdAt: _args[8],
              updatedAt: _args[9],
              expiresAt: _args[10],
            });
          } else if (flatSql.startsWith('UPDATE user_keys SET status')) {
            const keyId = _args[_args.length - 1];
            const row = _rows.user_keys.find((r: unknown) => (r as UserKey).keyId === keyId);
            if (row) (row as UserKey).status = 'REVOKED';
          } else if (flatSql.startsWith('UPDATE user_keys SET spending_limit_usd')) {
            const keyId = _args[_args.length - 1];
            const row = _rows.user_keys.find((r: unknown) => (r as UserKey).keyId === keyId);
            if (row) (row as UserKey).spendingLimitUsd = _args[1] as number;
          } else if (flatSql.startsWith('UPDATE allocation_snapshots')) {
            // allocation update tracking
          }
        }),
      };
    }),
  } as unknown as DatabaseConnection;
}

const baseStrategy: Strategy = {
  strategyId: 'strat-001',
  ownerWallet: 'owner-wallet',
  claimableSolThreshold: 0.5,
  claimWallet: 'claim-wallet',
  swapSlippageBps: 100,
  bridgeAmountUsdcPerRun: 100,
  fundingReservePct: 10,
  enabled: true,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  keyConfig: {
    limitReset: null,
    expiryDays: 0,
  },
};

function createMockOpenRouterClient() {
  return {
    createKey: vi.fn().mockResolvedValue({
      key: 'key-abc',
      data: { hash: 'hash-new-key-123' },
    }),
    updateKey: vi.fn().mockResolvedValue({ success: true }),
  };
}

describe('KeyManagerService', () => {
  let mockDb: DatabaseConnection;
  let mockClient: ReturnType<typeof createMockOpenRouterClient>;
  let service: KeyManagerService;

  beforeEach(() => {
    mockDb = createMockDb();
    mockClient = createMockOpenRouterClient();
    service = new KeyManagerService({ openRouterClient: mockClient, db: mockDb });
  });

  describe('provisionKeys — existing key limit update', () => {
    it('updates spending limit when existing key has different limit', async () => {
      // Seed an existing active key directly into the mock DB
      (mockDb as unknown as { _rows: Record<string, unknown[]> })._rows.user_keys.push({
        keyId: 'key-existing',
        strategyId: 'strat-001',
        holderWallet: 'wallet-abc',
        openrouterKeyHash: 'hash-old-key',
        spendingLimitUsd: 50,
        currentUsageUsd: 0,
        totalAllocatedUsd: 0,
        status: 'ACTIVE',
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
        expiresAt: null,
      });

      const result = await service.provisionKeys(
        [{ holderWallet: 'wallet-abc', allocatedUsd: 100 }],
        baseStrategy,
      );

      expect(result.keysUpdated).toBe(1);
      expect(result.keysProvisioned).toBe(0);
      expect(mockClient.updateKey).toHaveBeenCalledWith('hash-old-key', { limit: 100 });
    });

    it('skips update when existing key already has correct limit', async () => {
      (mockDb as unknown as { _rows: Record<string, unknown[]> })._rows.user_keys.push({
        keyId: 'key-existing',
        strategyId: 'strat-001',
        holderWallet: 'wallet-abc',
        openrouterKeyHash: 'hash-old-key',
        spendingLimitUsd: 100,
        currentUsageUsd: 0,
        totalAllocatedUsd: 0,
        status: 'ACTIVE',
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
        expiresAt: null,
      });

      const result = await service.provisionKeys(
        [{ holderWallet: 'wallet-abc', allocatedUsd: 100 }],
        baseStrategy,
      );

      expect(result.keysUpdated).toBe(0);
      expect(result.keysProvisioned).toBe(0);
      expect(mockClient.updateKey).not.toHaveBeenCalled();
    });

    it('creates new key when no existing key found', async () => {
      const result = await service.provisionKeys(
        [{ holderWallet: 'wallet-new', allocatedUsd: 100 }],
        baseStrategy,
      );

      expect(result.keysProvisioned).toBe(1);
      expect(result.keysUpdated).toBe(0);
      expect(mockClient.createKey).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringContaining('creditbrain-strat-00'),
          limit: 100,
        }),
      );
    });

    it('handles individual key creation failures gracefully', async () => {
      mockClient.createKey.mockRejectedValueOnce(new Error('API error'));

      const result = await service.provisionKeys(
        [{ holderWallet: 'wallet-fail', allocatedUsd: 100 }],
        baseStrategy,
      );

      expect(result.keysFailed).toBe(1);
      expect(result.failedWallets).toHaveLength(1);
      expect(result.failedWallets[0].reason).toBe('API error');
    });
  });

  describe('buildKeyParams — limit reset', () => {
    it('sets daily limit reset on createKey', async () => {
      const dailyStrategy: Strategy = {
        ...baseStrategy,
        keyConfig: { limitReset: 'daily', expiryDays: 0 },
      };

      await service.provisionKeys(
        [{ holderWallet: 'wallet-daily', allocatedUsd: 50 }],
        dailyStrategy,
      );

      const callArgs = mockClient.createKey.mock.calls[0][0];
      expect(callArgs.limit_reset).toBeTruthy();
      // Should be a date string roughly 24h from now
      const resetDate = new Date(callArgs.limit_reset);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(resetDate.toDateString()).toBe(tomorrow.toDateString());
    });

    it('sets monthly limit reset on createKey', async () => {
      const monthlyStrategy: Strategy = {
        ...baseStrategy,
        keyConfig: { limitReset: 'monthly', expiryDays: 30 },
      };

      await service.provisionKeys(
        [{ holderWallet: 'wallet-monthly', allocatedUsd: 50 }],
        monthlyStrategy,
      );

      const callArgs = mockClient.createKey.mock.calls[0][0];
      expect(callArgs.limit_reset).toBeTruthy();
      expect(callArgs.expires_at).toBeTruthy();
    });

    it('sets weekly limit reset on createKey', async () => {
      const weeklyStrategy: Strategy = {
        ...baseStrategy,
        keyConfig: { limitReset: 'weekly', expiryDays: 0 },
      };

      await service.provisionKeys(
        [{ holderWallet: 'wallet-weekly', allocatedUsd: 50 }],
        weeklyStrategy,
      );

      const callArgs = mockClient.createKey.mock.calls[0][0];
      expect(callArgs.limit_reset).toBeTruthy();
    });
  });

  describe('revokeKey', () => {
    it('returns false when key not found', async () => {
      const result = await service.revokeKey('nonexistent-key');

      expect(result).toBe(false);
    });

    it('marks key as revoked even when OpenRouter disable fails', async () => {
      // Seed an existing key directly into the mock DB
      (mockDb as unknown as { _rows: Record<string, unknown[]> })._rows.user_keys.push({
        keyId: 'key-to-revoke',
        strategyId: 'strat-001',
        holderWallet: 'wallet-abc',
        openrouterKeyHash: 'hash-revoke-me',
        spendingLimitUsd: 100,
        currentUsageUsd: 0,
        totalAllocatedUsd: 0,
        status: 'ACTIVE',
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
        expiresAt: null,
      });

      mockClient.updateKey.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.revokeKey('key-to-revoke');

      expect(result).toBe(true);
      // Should still call updateKey even though it fails
      expect(mockClient.updateKey).toHaveBeenCalledWith('hash-revoke-me', { disabled: true });
    });
  });

  describe('getActiveKeyByWallet', () => {
    it('returns null when no active key exists', () => {
      const result = service.getActiveKeyByWallet('nonexistent-wallet');

      expect(result).toBeNull();
    });
  });

  describe('getKeysByStrategy', () => {
    it('returns empty array when no keys exist for strategy', () => {
      const result = service.getKeysByStrategy('nonexistent-strategy');

      expect(result).toEqual([]);
    });
  });
});

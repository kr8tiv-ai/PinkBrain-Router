import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { DatabaseConnection } from './Database.js';
import type { UserKey, Strategy, AllocationSnapshot } from '../types/index.js';
import type { OpenRouterClient, CreateKeyParams, UpdateKeyParams } from '../clients/OpenRouterClient.js';

const logger = pino({ name: 'KeyManagerService' });

export interface ProvisionResult {
  keysProvisioned: number;
  keysUpdated: number;
  keysFailed: number;
  failedWallets: Array<{ wallet: string; reason: string }>;
  keyHashes: string[];
}

export interface KeyManagerServiceDeps {
  openRouterClient: OpenRouterClient;
  db: DatabaseConnection;
}

/**
 * KeyManagerService creates and manages OpenRouter API keys for token holders.
 *
 * Responsibilities:
 * - Create new keys for holders who don't have one
 * - Update spending limits for existing keys
 * - Track key state in the local DB
 * - Provide audit visibility over provisioned keys
 */
export class KeyManagerService {
  constructor(private readonly deps: KeyManagerServiceDeps) {}

  /**
   * Provision or update keys for all holders in an allocation snapshot.
   */
  async provisionKeys(
    allocations: Array<{
      holderWallet: string;
      allocatedUsd: number;
    }>,
    strategy: Strategy,
  ): Promise<ProvisionResult> {
    let keysProvisioned = 0;
    let keysUpdated = 0;
    let keysFailed = 0;
    const failedWallets: Array<{ wallet: string; reason: string }> = [];
    const keyHashes: string[] = [];

    for (const alloc of allocations) {
      try {
        const existing = this.getActiveKey(alloc.holderWallet, strategy.strategyId);

        if (existing) {
          // Update the spending limit on the existing key
          if (existing.spendingLimitUsd !== alloc.allocatedUsd) {
            await this.deps.openRouterClient.updateKey(existing.openrouterKeyHash, {
              limit: alloc.allocatedUsd,
            });

            this.updateKeyRecord(existing.keyId, {
              spendingLimitUsd: alloc.allocatedUsd,
            });

            keyHashes.push(existing.openrouterKeyHash);
            keysUpdated++;
            logger.info(
              { keyHash: existing.openrouterKeyHash, wallet: alloc.holderWallet, newLimit: alloc.allocatedUsd },
              'Key spending limit updated',
            );
          } else {
            keyHashes.push(existing.openrouterKeyHash);
            logger.debug(
              { keyHash: existing.openrouterKeyHash, wallet: alloc.holderWallet },
              'Key already has correct limit — no update needed',
            );
          }
        } else {
          // Create a new key for this holder
          const keyParams = this.buildKeyParams(alloc.holderWallet, alloc.allocatedUsd, strategy);
          const { key, data } = await this.deps.openRouterClient.createKey(keyParams);

          this.persistKey({
            keyId: randomUUID(),
            strategyId: strategy.strategyId,
            holderWallet: alloc.holderWallet,
            openrouterKeyHash: data.hash,
            spendingLimitUsd: alloc.allocatedUsd,
            status: 'ACTIVE',
            expiresAt: this.calculateExpiry(strategy),
          });

          keyHashes.push(data.hash);
          keysProvisioned++;
          logger.info(
            { keyHash: data.hash, wallet: alloc.holderWallet, limit: alloc.allocatedUsd },
            'New OpenRouter key provisioned',
          );
        }

        // Update allocation snapshot with key hash
        this.updateAllocationKeyHash(alloc.holderWallet, keyHashes[keyHashes.length - 1]);
      } catch (error) {
        keysFailed++;
        const reason = (error as Error).message;
        failedWallets.push({ wallet: alloc.holderWallet, reason });

        logger.error(
          { wallet: alloc.holderWallet, error: reason },
          'Failed to provision key for holder',
        );
      }
    }

    logger.info(
      {
        total: allocations.length,
        provisioned: keysProvisioned,
        updated: keysUpdated,
        failed: keysFailed,
      },
      'Key provisioning completed',
    );

    return {
      keysProvisioned,
      keysUpdated,
      keysFailed,
      failedWallets,
      keyHashes,
    };
  }

  /**
   * Get the active key for a holder in a strategy.
   */
  getActiveKey(holderWallet: string, strategyId: string): UserKey | null {
    const row = this.deps.db
      .prepare(
        `SELECT key_id as keyId, strategy_id as strategyId, holder_wallet as holderWallet,
                openrouter_key_hash as openrouterKeyHash,
                spending_limit_usd as spendingLimitUsd, current_usage_usd as currentUsageUsd,
                total_allocated_usd as totalAllocatedUsd, last_synced_at as lastSyncedAt,
                status, created_at as createdAt, updated_at as updatedAt, expires_at as expiresAt
         FROM user_keys
         WHERE holder_wallet = ? AND strategy_id = ? AND status = 'ACTIVE'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get<UserKey>(holderWallet, strategyId);

    return row ?? null;
  }

  /**
   * Get the active key for a holder across all strategies.
   */
  getActiveKeyByWallet(holderWallet: string): UserKey | null {
    const row = this.deps.db
      .prepare(
        `SELECT key_id as keyId, strategy_id as strategyId, holder_wallet as holderWallet,
                openrouter_key_hash as openrouterKeyHash,
                spending_limit_usd as spendingLimitUsd, current_usage_usd as currentUsageUsd,
                total_allocated_usd as totalAllocatedUsd, last_synced_at as lastSyncedAt,
                status, created_at as createdAt, updated_at as updatedAt, expires_at as expiresAt
         FROM user_keys
         WHERE holder_wallet = ? AND status = 'ACTIVE'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get<UserKey>(holderWallet);

    return row ?? null;
  }

  /**
   * Get all keys for a strategy.
   */
  getKeysByStrategy(strategyId: string): UserKey[] {
    const rows = this.deps.db
      .prepare(
        `SELECT key_id as keyId, strategy_id as strategyId, holder_wallet as holderWallet,
                openrouter_key_hash as openrouterKeyHash,
                spending_limit_usd as spendingLimitUsd, current_usage_usd as currentUsageUsd,
                total_allocated_usd as totalAllocatedUsd, last_synced_at as lastSyncedAt,
                status, created_at as createdAt, updated_at as updatedAt, expires_at as expiresAt
         FROM user_keys
         WHERE strategy_id = ?
         ORDER BY created_at DESC`,
      )
      .all<UserKey>(strategyId);

    return rows;
  }

  /**
   * Revoke a key (mark as REVOKED and disable on OpenRouter).
   */
  async revokeKey(keyId: string): Promise<boolean> {
    const key = this.deps.db
      .prepare(
        `SELECT key_id as keyId, strategy_id as strategyId, holder_wallet as holderWallet,
                openrouter_key_hash as openrouterKeyHash, spending_limit_usd as spendingLimitUsd,
                status FROM user_keys WHERE key_id = ?`,
      )
      .get<UserKey>(keyId);

    if (!key) {
      logger.warn({ keyId }, 'Key not found for revocation');
      return false;
    }

    try {
      await this.deps.openRouterClient.updateKey(key.openrouterKeyHash, {
        disabled: true,
      });
    } catch (error) {
      logger.warn(
        { keyHash: key.openrouterKeyHash, error: (error as Error).message },
        'Failed to disable key on OpenRouter — marking as revoked locally',
      );
    }

    this.deps.db
      .prepare(`UPDATE user_keys SET status = 'REVOKED', updated_at = ? WHERE key_id = ?`)
      .run(new Date().toISOString(), keyId);

    logger.info({ keyId, keyHash: key.openrouterKeyHash }, 'Key revoked');
    return true;
  }

  private buildKeyParams(
    holderWallet: string,
    allocatedUsd: number,
    strategy: Strategy,
  ): CreateKeyParams {
    const name = `creditbrain-${strategy.strategyId.slice(0, 8)}-${holderWallet.slice(0, 8)}`;

    const params: CreateKeyParams = {
      name,
      limit: allocatedUsd,
    };

    if (strategy.keyConfig.limitReset) {
      const resetDate = this.calculateLimitReset(strategy.keyConfig.limitReset);
      params.limit_reset = resetDate;
    }

    if (strategy.keyConfig.expiryDays > 0) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + strategy.keyConfig.expiryDays);
      params.expires_at = expiresAt.toISOString();
    }

    return params;
  }

  private persistKey(data: {
    keyId: string;
    strategyId: string;
    holderWallet: string;
    openrouterKeyHash: string;
    spendingLimitUsd: number;
    status: string;
    expiresAt: string | null;
  }): void {
    const now = new Date().toISOString();

    this.deps.db
      .prepare(
        `INSERT INTO user_keys (key_id, strategy_id, holder_wallet, openrouter_key_hash,
         spending_limit_usd, current_usage_usd, total_allocated_usd, status, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.keyId,
        data.strategyId,
        data.holderWallet,
        data.openrouterKeyHash,
        data.spendingLimitUsd,
        0,
        0,
        data.status,
        now,
        now,
        data.expiresAt,
      );
  }

  private updateKeyRecord(
    keyId: string,
    updates: { spendingLimitUsd?: number; status?: string },
  ): void {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.spendingLimitUsd !== undefined) {
      setClauses.push('spending_limit_usd = ?');
      params.push(updates.spendingLimitUsd);
    }

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }

    if (setClauses.length === 0) return;

    setClauses.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(keyId);

    this.deps.db
      .prepare(`UPDATE user_keys SET ${setClauses.join(', ')} WHERE key_id = ?`)
      .run(...params);
  }

  private updateAllocationKeyHash(holderWallet: string, keyHash: string): void {
    // Update the most recent allocation snapshot for this holder
    this.deps.db
      .prepare(
        `UPDATE allocation_snapshots SET key_hash = ? WHERE holder_wallet = ? AND key_hash IS NULL ORDER BY created_at DESC LIMIT 1`,
      )
      .run(keyHash, holderWallet);
  }

  private calculateExpiry(strategy: Strategy): string | null {
    if (strategy.keyConfig.expiryDays <= 0) return null;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + strategy.keyConfig.expiryDays);
    return expiresAt.toISOString();
  }

  private calculateLimitReset(resetPeriod: 'daily' | 'weekly' | 'monthly' | null): string {
    if (!resetPeriod) return '';

    const now = new Date();
    switch (resetPeriod) {
      case 'daily': {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow.toISOString();
      }
      case 'weekly': {
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + (7 - nextWeek.getDay()));
        nextWeek.setHours(0, 0, 0, 0);
        return nextWeek.toISOString();
      }
      case 'monthly': {
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return nextMonth.toISOString();
      }
      default:
        return '';
    }
  }
}

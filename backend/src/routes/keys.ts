import type { FastifyInstance } from 'fastify';
import type { KeyManagerService } from '../services/KeyManagerService.js';
import type { OpenRouterClient, KeyData } from '../clients/OpenRouterClient.js';
import type { UsageTrackingService } from '../services/UsageTrackingService.js';

export interface KeyRouteDeps {
  keyManagerService: KeyManagerService;
  openRouterClient: OpenRouterClient;
  usageTrackingService: UsageTrackingService;
}

/**
 * Strip secret field from OpenRouter key data.
 * Never expose the actual API key in responses.
 */
function stripKeySecret(key: KeyData): Omit<KeyData, never> & Record<string, unknown> {
  const { hash, name, disabled, limit, limit_remaining, usage, usage_daily, usage_weekly, usage_monthly, created_at, updated_at, expires_at } = key;
  return {
    hash,
    name,
    disabled,
    limit,
    limit_remaining,
    usage,
    usage_daily,
    usage_weekly,
    usage_monthly,
    created_at,
    updated_at,
    expires_at,
  };
}

export async function keyRoutes(
  app: FastifyInstance,
  deps: KeyRouteDeps,
): Promise<void> {
  // GET /keys — list all OpenRouter keys
  app.get('/keys', {
    handler: async () => {
      const keys = await deps.openRouterClient.listKeys();
      return keys.map(stripKeySecret);
    },
  });

  // ── Wallet-centric routes (before parametric :hash routes) ──

  // GET /keys/wallet/:wallet — get active key by wallet
  app.get('/keys/wallet/:wallet', {
    handler: async (request, reply) => {
      const { wallet } = request.params as { wallet: string };
      const key = deps.keyManagerService.getActiveKeyByWallet(wallet);
      if (!key) {
        return reply.code(404).send({ error: 'No active key found for wallet', statusCode: 404 });
      }
      return key;
    },
  });

  // GET /keys/wallet/:wallet/usage — get usage snapshots for wallet's active key
  app.get('/keys/wallet/:wallet/usage', {
    handler: async (request, reply) => {
      const { wallet } = request.params as { wallet: string };
      const key = deps.keyManagerService.getActiveKeyByWallet(wallet);
      if (!key) {
        return reply.code(404).send({ error: 'No active key found for wallet', statusCode: 404 });
      }
      const usage = deps.usageTrackingService.getKeyUsage(key.openrouterKeyHash);
      return usage;
    },
  });

  // POST /keys/wallet/:wallet/rotate — rotate active key for wallet
  app.post('/keys/wallet/:wallet/rotate', {
    handler: async (request, reply) => {
      const { wallet } = request.params as { wallet: string };
      const oldKey = deps.keyManagerService.getActiveKeyByWallet(wallet);
      if (!oldKey) {
        return reply.code(404).send({ error: 'No active key found for wallet', statusCode: 404 });
      }

      // Step (b): Create a new key via OpenRouter — re-throw to let centralized error handler sanitize
      const newKeyData = await deps.openRouterClient.createKey({
        name: `creditbrain-rotate-${wallet.slice(0, 8)}`,
        limit: oldKey.spendingLimitUsd,
      });

      // Step (c): Revoke the old key — handle partial failure
      let revoked = false;
      try {
        revoked = await deps.keyManagerService.revokeKey(oldKey.keyId);
      } catch {
        // Partial failure: new key created but old key not revoked
      }

      if (!revoked) {
        return {
          rotated: true,
          warning: 'new key created but old key revocation failed',
          newHash: newKeyData.data.hash,
        };
      }

      return { rotated: true, newHash: newKeyData.data.hash };
    },
  });

  // DELETE /keys/wallet/:wallet — revoke active key by wallet
  app.delete('/keys/wallet/:wallet', {
    handler: async (request, reply) => {
      const { wallet } = request.params as { wallet: string };
      const key = deps.keyManagerService.getActiveKeyByWallet(wallet);
      if (!key) {
        return reply.code(404).send({ error: 'No active key found for wallet', statusCode: 404 });
      }
      const revoked = await deps.keyManagerService.revokeKey(key.keyId);
      if (!revoked) {
        return reply.code(404).send({ error: 'Key not found', statusCode: 404 });
      }
      return { revoked: true, wallet };
    },
  });

  // ── Strategy routes (before parametric :hash routes) ──

  // GET /keys/strategy/:strategyId — get keys for a strategy
  app.get('/keys/strategy/:strategyId', {
    handler: async (request) => {
      const { strategyId } = request.params as { strategyId: string };
      const keys = deps.keyManagerService.getKeysByStrategy(strategyId);
      return keys;
    },
  });

  // ── Hash-based routes (parametric — must come last) ──

  // GET /keys/:hash — get a single key by hash
  app.get('/keys/:hash', {
    handler: async (request, reply) => {
      const { hash } = request.params as { hash: string };
      try {
        const key = await deps.openRouterClient.getKey(hash);
        return stripKeySecret(key);
      } catch (error) {
        const msg = (error as Error).message;
        if (msg.includes('404') || msg.includes('NOT_FOUND')) {
          return reply.code(404).send({ error: 'Key not found', statusCode: 404 });
        }
        throw error;
      }
    },
  });

  // DELETE /keys/:hash — revoke a key
  app.delete('/keys/:hash', {
    schema: {
      body: {
        type: 'object',
        required: ['keyId'],
        properties: {
          keyId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { hash } = request.params as { hash: string };
      const { keyId } = request.body as { keyId: string };
      const revoked = await deps.keyManagerService.revokeKey(keyId);
      if (!revoked) {
        return reply.code(404).send({ error: 'Key not found', statusCode: 404 });
      }
      return { revoked: true, hash };
    },
  });
}

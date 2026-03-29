import type { FastifyInstance } from 'fastify';
import type { KeyManagerService } from '../services/KeyManagerService.js';
import type { OpenRouterClient, KeyData } from '../clients/OpenRouterClient.js';

export interface KeyRouteDeps {
  keyManagerService: KeyManagerService;
  openRouterClient: OpenRouterClient;
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

  // GET /keys/strategy/:strategyId — get keys for a strategy
  app.get('/keys/strategy/:strategyId', {
    handler: async (request) => {
      const { strategyId } = request.params as { strategyId: string };
      const keys = deps.keyManagerService.getKeysByStrategy(strategyId);
      // Never expose the openrouter_key secret
      return keys.map(({ openrouterKey: _secret, ...safeFields }) => safeFields);
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

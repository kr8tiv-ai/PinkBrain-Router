import type { FastifyInstance } from 'fastify';
import type { UsageTrackingService } from '../services/UsageTrackingService.js';

export interface UsageRouteDeps {
  usageTrackingService: UsageTrackingService;
}

export async function usageRoutes(
  app: FastifyInstance,
  deps: UsageRouteDeps,
): Promise<void> {
  // GET /usage/key/:hash — get usage snapshots for a key
  app.get('/usage/key/:hash', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
        },
      },
    },
    handler: async (request) => {
      const { hash } = request.params as { hash: string };
      const { limit } = request.query as { limit?: number };
      const snapshots = deps.usageTrackingService.getKeyUsage(hash, limit ?? 100);
      return snapshots;
    },
  });

  // GET /usage/strategy/:strategyId — get usage snapshots for a strategy
  app.get('/usage/strategy/:strategyId', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
        },
      },
    },
    handler: async (request) => {
      const { strategyId } = request.params as { strategyId: string };
      const { limit } = request.query as { limit?: number };
      const snapshots = deps.usageTrackingService.getStrategyUsage(strategyId, limit ?? 100);
      return snapshots;
    },
  });
}

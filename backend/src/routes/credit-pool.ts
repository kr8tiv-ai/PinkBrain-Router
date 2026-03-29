import type { FastifyInstance } from 'fastify';
import type { CreditPoolService } from '../services/CreditPoolService.js';

export interface CreditPoolRouteDeps {
  creditPoolService: CreditPoolService;
}

export async function creditPoolRoutes(
  app: FastifyInstance,
  deps: CreditPoolRouteDeps,
): Promise<void> {
  // GET /credit-pool — get pool status
  app.get('/credit-pool', {
    handler: async () => {
      const status = await deps.creditPoolService.getStatus();
      return status;
    },
  });

  // GET /credit-pool/history — get pool allocation history
  app.get('/credit-pool/history', {
    handler: async (request) => {
      const query = request.query as { limit?: string };
      let limit = 100;
      if (query.limit) {
        const parsed = parseInt(query.limit, 10);
        if (!isNaN(parsed) && parsed > 0) {
          limit = Math.min(parsed, 1000);
        }
      }
      const history = deps.creditPoolService.getPoolHistory(limit);
      return history;
    },
  });
}

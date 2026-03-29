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
}

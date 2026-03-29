import type { FastifyInstance } from 'fastify';
import type { RunService } from '../services/RunService.js';

export interface StatsRouteDeps {
  runService: RunService;
}

export async function statsRoutes(
  app: FastifyInstance,
  deps: StatsRouteDeps,
): Promise<void> {
  // GET /stats — aggregate statistics
  app.get('/stats', {
    handler: async () => {
      const stats = deps.runService.getAggregateStats();
      return stats;
    },
  });
}

import type { FastifyInstance } from 'fastify';
import type { DatabaseConnection } from '../services/Database.js';
import type { OpenRouterClient } from '../clients/OpenRouterClient.js';
import type { BagsClient } from '../clients/BagsClient.js';
import pino from 'pino';

const logger = pino({ name: 'health' });

export interface HealthDeps {
  db: DatabaseConnection;
  openRouterClient: OpenRouterClient;
  bagsClient?: BagsClient;
}

export async function healthRoutes(
  app: FastifyInstance,
  deps: HealthDeps,
): Promise<void> {
  // Liveness probe — always returns 200 if the process is running (rate limit exempt)
  app.get('/health/live', {
    config: { rateLimit: false },
    handler: async (_request, reply) => {
      reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    },
  });

  // Readiness probe — checks dependencies, returns 503 if any are down (rate limit exempt)
  app.get('/health/ready', {
    config: { rateLimit: false },
    handler: async (_request, reply) => {
      const startTime = Date.now();

      // Database check
      let database: boolean;
      try {
        deps.db.prepare('SELECT 1').get();
        database = true;
      } catch (err) {
        logger.error({ err }, 'Health check: database unreachable');
        database = false;
      }

      // OpenRouter check with 3s timeout
      let openrouter: boolean;
      try {
        await Promise.race([
          deps.openRouterClient.getAccountCredits(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('OpenRouter health check timed out (3s)')), 3000),
          ),
        ]);
        openrouter = true;
      } catch (err) {
        logger.warn({ err }, 'Health check: OpenRouter API unreachable');
        openrouter = false;
      }

      // Bags API check with 3s timeout (optional — skipped if client not injected)
      let bags: boolean;
      if (deps.bagsClient) {
        try {
          await Promise.race([
            deps.bagsClient.getRateLimitStatus(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Bags health check timed out (3s)')), 3000),
            ),
          ]);
          bags = true;
        } catch (err) {
          logger.warn({ err }, 'Health check: Bags API unreachable');
          bags = false;
        }
      } else {
        bags = true; // Not configured, don't penalize health
      }

      const allHealthy = database && openrouter && bags;

      const response = {
        status: allHealthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        dependencies: { openrouter, database, bags },
        responseTimeMs: Date.now() - startTime,
      };

      reply.code(allHealthy ? 200 : 503).send(response);
    },
  });
}

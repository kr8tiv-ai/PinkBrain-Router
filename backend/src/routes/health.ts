import type { FastifyInstance } from 'fastify';
import type { DatabaseConnection } from '../services/Database.js';
import type { OpenRouterClient } from '../clients/OpenRouterClient.js';
import pino from 'pino';

const logger = pino({ name: 'health' });

export interface HealthDeps {
  db: DatabaseConnection;
  openRouterClient: OpenRouterClient;
}

export async function healthRoutes(
  app: FastifyInstance,
  deps: HealthDeps,
): Promise<void> {
  app.get('/health', {
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

      const response = {
        status: 'ok' as const,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        dependencies: { openrouter, database },
        responseTimeMs: Date.now() - startTime,
      };

      reply.send(response);
    },
  });
}

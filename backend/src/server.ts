import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { authHookFactory } from './plugins/auth.js';
import { registerAllRoutes } from './routes/index.js';
import type { AllRouteDeps } from './routes/index.js';
import type { DatabaseConnection } from './services/Database.js';
import type { OpenRouterClient } from './clients/OpenRouterClient.js';

export interface ServerDeps extends AllRouteDeps {
  port: number;
  apiAuthToken: string;
}

export async function buildApp(deps: ServerDeps) {
  const app = Fastify({
    logger: true,
  });

  // CORS — allow all origins for hackathon
  await app.register(cors, {
    origin: true,
  });

  // Rate limiting — 100 requests/minute default
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Sensible — standardized error responses
  await app.register(sensible);

  // Auth hook on all routes
  const authHook = authHookFactory(deps.apiAuthToken);
  app.addHook('preHandler', authHook);

  // Register all routes under /api prefix
  await registerAllRoutes(app, deps);

  // Clean shutdown hook
  app.addHook('onClose', async () => {
    app.log.info('Server shutting down');
  });

  return app;
}

export async function startServer(deps: ServerDeps) {
  const app = await buildApp(deps);

  const address = await app.listen({ port: deps.port, host: '0.0.0.0' });
  app.log.info({ address, port: deps.port }, 'Server listening');

  return app;
}

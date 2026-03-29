import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { registerAllRoutes, healthRoutes } from './routes/index.js';
import type { AllRouteDeps } from './routes/index.js';
import type { HealthDeps } from './routes/health.js';
import type { DatabaseConnection } from './services/Database.js';
import type { OpenRouterClient } from './clients/OpenRouterClient.js';

export interface ServerDeps extends AllRouteDeps {
  port: number;
  apiAuthToken: string;
  logLevel?: string;
  nodeEnv?: string;
}

export async function buildApp(deps: ServerDeps) {
  const logLevel = deps.logLevel ?? 'info';
  const nodeEnv = deps.nodeEnv ?? 'development';

  const app = Fastify({
    logger: { level: logLevel },
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

  // Request logging — attach timing and ID
  app.addHook('onRequest', async (request) => {
    (request as any).startTime = Date.now();
    (request as any).id = crypto.randomUUID();
  });

  // Response logging — structured access log
  app.addHook('onResponse', async (request, reply) => {
    const startTime = (request as any).startTime as number;
    const requestId = (request as any).id as string;
    app.log.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: Date.now() - startTime,
      requestId,
    });
  });

  // Centralized error handler
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    app.log.error(
      { err: error, method: request.method, url: request.url },
      'Request error',
    );
    const isProduction = nodeEnv === 'production';
    reply.code(reply.statusCode >= 400 ? reply.statusCode : 500).send({
      error: error.name || 'InternalServerError',
      statusCode: reply.statusCode >= 400 ? reply.statusCode : 500,
      message: isProduction ? 'Internal server error' : (error.message || 'Internal server error'),
    });
  });

  // Health routes at root level — no auth required
  await healthRoutes(app, deps as HealthDeps);

  // API routes under /api prefix — auth scoped inside
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

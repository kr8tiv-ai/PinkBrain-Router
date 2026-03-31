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
  corsOrigins?: string;
}

export async function buildApp(deps: ServerDeps) {
  const logLevel = deps.logLevel ?? 'info';
  const nodeEnv = deps.nodeEnv ?? 'development';

  const app = Fastify({
    logger: { level: logLevel },
  });

  // CORS — configurable origins; defaults to allow all when empty (dev-friendly)
  const corsOriginsRaw = deps.corsOrigins ?? '';
  const corsOriginsList = corsOriginsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const corsConfig: { origin: boolean | string[] } = {
    origin: corsOriginsList.length > 0 ? corsOriginsList : false,
  };

  await app.register(cors, corsConfig);

  // Rate limiting — global 100 req/min default
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Sensible — standardized error responses
  await app.register(sensible);

  // Security headers — equivalent to helmet defaults, no external dep
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '0');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('X-DNS-Prefetch-Control', 'off');
    reply.header('X-Download-Options', 'noopen');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://public-api-v2.bags.fm https://openrouter.ai; font-src 'self'; object-src 'none'; frame-ancestors 'none'",
    );
  });

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
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const isProduction = nodeEnv === 'production';
    reply.code(statusCode).send({
      error: error.name || 'InternalServerError',
      statusCode,
      message: isProduction ? 'Internal server error' : (error.message || 'Internal server error'),
    });
  });

  // Health routes at root level — no auth required, rate limit exempt
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

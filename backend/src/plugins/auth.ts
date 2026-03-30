import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import pino from 'pino';

const logger = pino({ name: 'auth' });

function safeEqual(a: string, b: string): boolean {
  // Length check is safe — token lengths are not secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
}

export function authHookFactory(apiAuthToken: string) {
  return async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn(
        { ip: request.ip, timestamp: new Date().toISOString() },
        'Auth failed: missing or malformed Authorization header',
      );
      reply.code(401).send({ error: 'Unauthorized', statusCode: 401 });
      return;
    }

    const token = authHeader.slice(7); // Strip "Bearer " prefix

    if (!safeEqual(token, apiAuthToken)) {
      logger.warn(
        { ip: request.ip, timestamp: new Date().toISOString() },
        'Auth failed: invalid bearer token',
      );
      reply.code(401).send({ error: 'Unauthorized', statusCode: 401 });
      return;
    }
  };
}

import type { FastifyRequest, FastifyReply } from 'fastify';
import pino from 'pino';

const logger = pino({ name: 'auth' });

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

    if (token !== apiAuthToken) {
      logger.warn(
        { ip: request.ip, timestamp: new Date().toISOString() },
        'Auth failed: invalid bearer token',
      );
      reply.code(401).send({ error: 'Unauthorized', statusCode: 401 });
      return;
    }
  };
}

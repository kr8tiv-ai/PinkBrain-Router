import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import pino from 'pino';

const logger = pino({ name: 'auth' });

// Per-IP failure tracking for brute-force protection
const failureTracker = new Map<string, { count: number; firstFailAt: number }>();
const MAX_FAILURES = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const BLOCK_MS = 15 * 60 * 1000; // 15 minute block after exceeding limit

// Periodic cleanup of stale entries (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of failureTracker.entries()) {
    if (now - record.firstFailAt > BLOCK_MS) {
      failureTracker.delete(ip);
    }
  }
}, 10 * 60 * 1000).unref();

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
}

function recordFailure(ip: string): boolean {
  const now = Date.now();
  const record = failureTracker.get(ip);

  if (!record || now - record.firstFailAt > WINDOW_MS) {
    failureTracker.set(ip, { count: 1, firstFailAt: now });
    return false;
  }

  record.count += 1;

  if (record.count >= MAX_FAILURES) {
    logger.warn(
      { ip, failures: record.count, windowMs: WINDOW_MS },
      'Auth failure rate limit exceeded — blocking IP',
    );
    return true;
  }

  return false;
}

function isBlocked(ip: string): boolean {
  const record = failureTracker.get(ip);
  if (!record) return false;

  const now = Date.now();
  if (now - record.firstFailAt > BLOCK_MS) {
    failureTracker.delete(ip);
    return false;
  }

  return record.count >= MAX_FAILURES;
}

/** Clear all tracked auth failures. Useful for tests. */
export function resetAuthFailureTracker(): void {
  failureTracker.clear();
}

export function authHookFactory(apiAuthToken: string) {
  return async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ip = request.ip;

    // Check if IP is currently blocked
    if (isBlocked(ip)) {
      logger.warn({ ip }, 'Auth request from blocked IP');
      reply.code(429).send({
        error: 'Too Many Requests',
        statusCode: 429,
        message: 'Too many failed authentication attempts. Try again later.',
      });
      return;
    }

    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn(
        { ip, timestamp: new Date().toISOString() },
        'Auth failed: missing or malformed Authorization header',
      );
      recordFailure(ip);
      reply.code(401).send({ error: 'Unauthorized', statusCode: 401 });
      return;
    }

    const token = authHeader.slice(7);

    if (!safeEqual(token, apiAuthToken)) {
      logger.warn(
        { ip, timestamp: new Date().toISOString() },
        'Auth failed: invalid bearer token',
      );
      const blocked = recordFailure(ip);
      if (blocked) {
        reply.code(429).send({
          error: 'Too Many Requests',
          statusCode: 429,
          message: 'Too many failed authentication attempts. Try again later.',
        });
        return;
      }
      reply.code(401).send({ error: 'Unauthorized', statusCode: 401 });
      return;
    }

    // Successful auth — clear any failure tracking
    failureTracker.delete(ip);
  };
}

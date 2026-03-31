import type { FastifyInstance } from 'fastify';
import type { StrategyService } from '../services/StrategyService.js';
import type { Strategy } from '../types/index.js';
import { idParam } from '../plugins/validation.js';

export interface StrategyRouteDeps {
  strategyService: StrategyService;
}

export async function strategyRoutes(
  app: FastifyInstance,
  deps: StrategyRouteDeps,
): Promise<void> {
  // GET /strategies — list all strategies
  app.get('/strategies', {
    handler: async () => {
      const strategies = deps.strategyService.getAll();
      return strategies.map(stripKeySecret);
    },
  });

  // POST /strategies — create a new strategy
  app.post('/strategies', {
    schema: {
      body: {
        type: 'object',
        required: ['ownerWallet'],
        properties: {
          ownerWallet: { type: 'string', pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$' },
          source: { type: 'string', enum: ['CLAIMABLE_POSITIONS', 'PARTNER_FEES'] },
          distributionToken: { type: 'string' },
          distribution: {
            type: 'string',
            enum: ['OWNER_ONLY', 'TOP_N_HOLDERS', 'EQUAL_SPLIT', 'WEIGHTED_BY_HOLDINGS', 'CUSTOM_LIST'],
          },
          distributionTopN: { type: 'integer', minimum: 1 },
          keyConfig: {
            type: 'object',
            properties: {
              defaultLimitUsd: { type: 'number', minimum: 0 },
              limitReset: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
              expiryDays: { type: 'integer', minimum: 0 },
            },
          },
          creditPoolReservePct: { type: 'number', minimum: 0, maximum: 50 },
          exclusionList: { type: 'array', items: { type: 'string' } },
          schedule: { type: 'string' },
          minClaimThreshold: { type: 'number', minimum: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const strategy = deps.strategyService.create({
        ownerWallet: body.ownerWallet as string,
        source: body.source as 'CLAIMABLE_POSITIONS' | 'PARTNER_FEES' | undefined,
        distributionToken: body.distributionToken as string | undefined,
        distribution: body.distribution as Strategy['distribution'] | undefined,
        distributionTopN: body.distributionTopN as number | undefined,
        keyConfig: body.keyConfig as Strategy['keyConfig'] | undefined,
        creditPoolReservePct: body.creditPoolReservePct as number | undefined,
        exclusionList: body.exclusionList as string[] | undefined,
        schedule: body.schedule as string | undefined,
        minClaimThreshold: body.minClaimThreshold as number | undefined,
      });
      return stripKeySecret(strategy);
    },
  });

  // GET /strategies/:id — get a strategy by ID
  app.get('/strategies/:id', {
    schema: { params: idParam },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const strategy = deps.strategyService.getById(id);
      if (!strategy) {
        return reply.code(404).send({ error: 'Strategy not found', statusCode: 404 });
      }
      return stripKeySecret(strategy);
    },
  });

  // PATCH /strategies/:id — update a strategy
  app.patch('/strategies/:id', {
    schema: {
      params: idParam,
      body: {
        type: 'object',
        properties: {
          distribution: {
            type: 'string',
            enum: ['OWNER_ONLY', 'TOP_N_HOLDERS', 'EQUAL_SPLIT', 'WEIGHTED_BY_HOLDINGS', 'CUSTOM_LIST'],
          },
          distributionTopN: { type: 'integer', minimum: 1 },
          keyConfig: {
            type: 'object',
            properties: {
              defaultLimitUsd: { type: 'number', minimum: 0 },
              limitReset: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
              expiryDays: { type: 'integer', minimum: 0 },
            },
          },
          creditPoolReservePct: { type: 'number', minimum: 0, maximum: 50 },
          exclusionList: { type: 'array', items: { type: 'string' } },
          schedule: { type: 'string' },
          minClaimThreshold: { type: 'number', minimum: 0 },
          status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ERROR'] },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const strategy = deps.strategyService.update(id, {
        distributionMode: body.distribution as Strategy['distribution'] | undefined,
        distributionTopN: body.distributionTopN as number | undefined,
        keyConfig: body.keyConfig as Strategy['keyConfig'] | undefined,
        creditPoolReservePct: body.creditPoolReservePct as number | undefined,
        exclusionList: body.exclusionList as string[] | undefined,
        schedule: body.schedule as string | undefined,
        minClaimThreshold: body.minClaimThreshold as number | undefined,
        status: body.status as 'ACTIVE' | 'PAUSED' | 'ERROR' | undefined,
      });
      if (!strategy) {
        return reply.code(404).send({ error: 'Strategy not found', statusCode: 404 });
      }
      return stripKeySecret(strategy);
    },
  });

  // POST /strategies/:id/enable — activate a strategy
  app.post('/strategies/:id/enable', {
    schema: { params: idParam },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const strategy = deps.strategyService.update(id, { status: 'ACTIVE' });
      if (!strategy) {
        return reply.code(404).send({ error: 'Strategy not found', statusCode: 404 });
      }
      return stripKeySecret(strategy);
    },
  });

  // POST /strategies/:id/disable — pause a strategy
  app.post('/strategies/:id/disable', {
    schema: { params: idParam },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const strategy = deps.strategyService.update(id, { status: 'PAUSED' });
      if (!strategy) {
        return reply.code(404).send({ error: 'Strategy not found', statusCode: 404 });
      }
      return stripKeySecret(strategy);
    },
  });

  // DELETE /strategies/:id — delete a strategy
  app.delete('/strategies/:id', {
    schema: { params: idParam },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = deps.strategyService.delete(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'Strategy not found', statusCode: 404 });
      }
      return { deleted: true };
    },
  });
}

/**
 * Strip any sensitive fields from strategy responses.
 * Strategies don't currently contain secrets, but this is a safety net.
 */
function stripKeySecret<T>(obj: T): T {
  return obj;
}

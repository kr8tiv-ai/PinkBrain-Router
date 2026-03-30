import type { FastifyInstance } from 'fastify';
import type { RunService } from '../services/RunService.js';
import type { StateMachine } from '../engine/StateMachine.js';
import type { RunLock } from '../engine/RunLock.js';
import type { CreditRun } from '../types/index.js';

export interface RunRouteDeps {
  runService: RunService;
  stateMachine: StateMachine;
  runLock: RunLock;
}

export async function runRoutes(
  app: FastifyInstance,
  deps: RunRouteDeps,
): Promise<void> {
  // GET /runs — list all runs (optionally filter by strategyId query param)
  app.get('/runs', {
    handler: async (request) => {
      const query = request.query as { strategyId?: string };
      if (query.strategyId) {
        const runs = deps.runService.getByStrategyId(query.strategyId);
        return runs.map(stripRun);
      }
      const runs = deps.runService.getAll();
      return runs.map(stripRun);
    },
  });

  // POST /runs — trigger a new run for a strategy (rate limited: 5/min)
  app.post('/runs', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['strategyId'],
        properties: {
          strategyId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { strategyId } = request.body as { strategyId: string };

      // Acquire run lock — reject concurrent runs for the same strategy
      if (!deps.runLock.acquire(strategyId)) {
        return reply.code(409).send({
          error: 'A run is already in progress for this strategy',
          statusCode: 409,
        });
      }

      try {
        // Create the run
        const run = deps.runService.create(strategyId);

        // Execute the run via state machine
        const executedRun = await deps.stateMachine.execute(run);
        return stripRun(executedRun);
      } finally {
        deps.runLock.release(strategyId);
      }
    },
  });

  // GET /runs/:id — get a run by ID
  app.get('/runs/:id', {
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const run = deps.runService.getById(id);
      if (!run) {
        return reply.code(404).send({ error: 'Run not found', statusCode: 404 });
      }
      return stripRun(run);
    },
  });

  // GET /runs/strategy/:strategyId — list runs for a strategy
  app.get('/runs/strategy/:strategyId', {
    handler: async (request) => {
      const { strategyId } = request.params as { strategyId: string };
      const runs = deps.runService.getByStrategyId(strategyId);
      return runs.map(stripRun);
    },
  });

  // POST /runs/:id/resume — resume a failed run
  app.post('/runs/:id/resume', {
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const run = deps.runService.getById(id);
      if (!run) {
        return reply.code(404).send({ error: 'Run not found', statusCode: 404 });
      }
      if (run.state !== 'FAILED') {
        return reply.code(400).send({
          error: `Cannot resume run in state ${run.state}. Only FAILED runs can be resumed.`,
          statusCode: 400,
        });
      }
      const resumedRun = await deps.stateMachine.resume(run);
      return stripRun(resumedRun);
    },
  });
}

/**
 * Strip large or internal-only fields from run responses.
 * swapQuoteSnapshot is a full TradeQuote (routePlan, platformFee, etc.) —
 * several KB per run, unused by the frontend.
 */
function stripRun(run: CreditRun): Omit<CreditRun, 'swapQuoteSnapshot'> {
  const { swapQuoteSnapshot, ...rest } = run;
  return rest;
}
